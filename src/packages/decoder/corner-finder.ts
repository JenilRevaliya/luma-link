/**
 * LumaLink Optical Corner Fiducial Finder
 * Industrial QR-style 1:1:3:1:1 scanline finder pattern detection,
 * sub-pixel centroid clustering, affine corner completion, and
 * temporal hysteresis smoothing
 */

import type { Point2D, QuadCorners } from '../protocol/types';
import { VisualFrameRenderer } from '../encoder/visual-frame';

export interface DetectionResult {
  corners: QuadCorners;        // Fiducial marker center corners
  matrixCorners: QuadCorners;  // Exact boundary around the 16x16 matrix
  confidence: number;
  rotationOffset: number;      // 0, 1, 2, 3 (0°, 90°, 180°, 270°)
  isDirectLock: boolean;
}

interface FinderCandidate {
  x: number;
  y: number;
  moduleSize: number;
}

interface CandidateCluster {
  sumX: number;
  sumY: number;
  sumModule: number;
  count: number;
}

export class CornerFinder {
  private static lastValidCorners: QuadCorners | null = null;
  private static lockStreak = 0;
  private static lockDecay = 0; // Hysteresis decay memory (up to 15 frames)

  public static reset(): void {
    CornerFinder.lastValidCorners = null;
    CornerFinder.lockStreak = 0;
    CornerFinder.lockDecay = 0;
  }

  /**
   * Locates optical transmission corners in camera image data using QR-standard
   * 1:1:3:1:1 module scanlines and sub-pixel clustering
   */
  public static findCorners(
    imgData: ImageData,
    searchBounds?: { x: number; y: number; width: number; height: number }
  ): DetectionResult | null {
    const { width, height, data } = imgData;

    // 1. Establish search bounds (expand slightly for margin of error if provided)
    let sx = 0;
    let sy = 0;
    let sw = width;
    let sh = height;

    if (searchBounds && searchBounds.width > 40 && searchBounds.height > 40) {
      const padX = Math.round(Math.max(30, searchBounds.width * 0.20));
      const padY = Math.round(Math.max(30, searchBounds.height * 0.20));
      sx = Math.max(0, searchBounds.x - padX);
      sy = Math.max(0, searchBounds.y - padY);
      sw = Math.min(width - sx, searchBounds.width + 2 * padX);
      sh = Math.min(height - sy, searchBounds.height + 2 * padY);
    } else {
      // Default: scan full camera image
      sx = 0;
      sy = 0;
      sw = width;
      sh = height;
    }

    if (sw < 50 || sh < 50) {
      return CornerFinder.handleDecayFallback();
    }

    // 2. Measure local luminance range across region
    let minLuma = 255;
    let maxLuma = 0;
    const lumaStep = Math.max(4, Math.round(Math.min(sw, sh) / 60));

    for (let y = sy; y < sy + sh; y += lumaStep) {
      for (let x = sx; x < sx + sw; x += lumaStep) {
        const luma = CornerFinder.getLuma(data, width, height, x, y);
        if (luma < minLuma) minLuma = luma;
        if (luma > maxLuma) maxLuma = luma;
      }
    }

    const contrast = maxLuma - minLuma;
    if (contrast < 20) {
      // Scene lacks sufficient contrast (e.g. gray noise or black frame)
      return CornerFinder.handleDecayFallback();
    }

    const threshold = minLuma + contrast * 0.44;

    // 3. QR-Style 1:1:3:1:1 Scanline Detection
    const candidates: FinderCandidate[] = [];
    const rowStep = Math.max(2, Math.round(sh / 110));

    for (let y = sy + 4; y < sy + sh - 4; y += rowStep) {
      // stateCount: [Light0, Dark1, Light2 (center core), Dark3, Light4]
      const stateCount = [0, 0, 0, 0, 0];
      let currentState = 0;
      let isLight = CornerFinder.getLuma(data, width, height, sx, y) >= threshold;

      for (let x = sx; x < sx + sw; x++) {
        const pixelLight = CornerFinder.getLuma(data, width, height, x, y) >= threshold;

        if (pixelLight === isLight) {
          stateCount[currentState]++;
        } else {
          // Transition occurred
          if (isLight) {
            // Light -> Dark transition.
            // If currentState === 4, stateCount has the full 5-run sequence
            if (currentState === 4) {
              if (CornerFinder.checkRatio(stateCount)) {
                const totalH = stateCount[0] + stateCount[1] + stateCount[2] + stateCount[3] + stateCount[4];
                const moduleH = totalH / 7;
                const candX = x - stateCount[4] - stateCount[3] - stateCount[2] / 2;

                // Vertical Cross-Check
                const vRes = CornerFinder.crossCheckVertical(
                  data,
                  width,
                  height,
                  Math.round(candX),
                  y,
                  moduleH,
                  threshold,
                  sy,
                  sy + sh
                );

                if (vRes !== null) {
                  candidates.push({
                    x: candX,
                    y: vRes.y,
                    moduleSize: (moduleH + vRes.moduleSize) / 2,
                  });
                }
              }

              // Shift state counts: drop first pair, keep last 3, add new dark run
              stateCount[0] = stateCount[2];
              stateCount[1] = stateCount[3];
              stateCount[2] = stateCount[4];
              stateCount[3] = 1;
              stateCount[4] = 0;
              currentState = 3;
            } else {
              currentState++;
              stateCount[currentState] = 1;
            }
          } else {
            // Dark -> Light transition
            currentState++;
            if (currentState > 4) currentState = 4;
            stateCount[currentState] = 1;
          }

          isLight = pixelLight;
        }
      }
    }

    // 4. Cluster candidates from adjacent scanlines
    const clusters: CandidateCluster[] = [];
    for (const cand of candidates) {
      let matched = false;
      for (const cl of clusters) {
        const cx = cl.sumX / cl.count;
        const cy = cl.sumY / cl.count;
        const avgMod = cl.sumModule / cl.count;
        if (Math.hypot(cand.x - cx, cand.y - cy) < avgMod * 2.8) {
          cl.sumX += cand.x;
          cl.sumY += cand.y;
          cl.sumModule += cand.moduleSize;
          cl.count++;
          matched = true;
          break;
        }
      }
      if (!matched) {
        clusters.push({
          sumX: cand.x,
          sumY: cand.y,
          sumModule: cand.moduleSize,
          count: 1,
        });
      }
    }

    // Sort clusters by hit counts
    const points: Point2D[] = clusters
      .filter((cl) => cl.count >= 1)
      .map((cl) => ({ x: cl.sumX / cl.count, y: cl.sumY / cl.count }));

    // 5. Match and extrapolate the 4 corners
    let resolvedCorners: QuadCorners | null = null;

    if (points.length >= 4) {
      resolvedCorners = CornerFinder.assign4Corners(points, data, width, height);
    } else if (points.length === 3) {
      resolvedCorners = CornerFinder.extrapolateFrom3Corners(points, data, width, height);
    }

    // 6. Secondary fallback: Reticle-guided quadrant bullseye search if QR scanline missed
    if (!resolvedCorners) {
      resolvedCorners = CornerFinder.findCornersViaQuadrants(data, width, height, sx, sy, sw, sh, minLuma, contrast);
    }

    // 7. Apply Temporal Smoothing & Hysteresis Lock
    if (resolvedCorners) {
      CornerFinder.lockDecay = 15; // Retain lock for up to 15 frames (~500ms) across blurs
      CornerFinder.lockStreak = Math.min(25, CornerFinder.lockStreak + 1);

      let finalCorners = resolvedCorners;
      if (CornerFinder.lastValidCorners) {
        // High-stability exponential smoothing (82% memory / 18% measurement)
        const alpha = 0.82;
        finalCorners = {
          topLeft: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.topLeft, resolvedCorners.topLeft, alpha),
          topRight: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.topRight, resolvedCorners.topRight, alpha),
          bottomRight: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.bottomRight, resolvedCorners.bottomRight, alpha),
          bottomLeft: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.bottomLeft, resolvedCorners.bottomLeft, alpha),
        };
      }

      CornerFinder.lastValidCorners = finalCorners;
      return {
        corners: finalCorners,
        matrixCorners: CornerFinder.computeMatrixCorners(finalCorners),
        confidence: Math.min(0.99, 0.85 + CornerFinder.lockStreak * 0.01),
        rotationOffset: 0,
        isDirectLock: true,
      };
    }

    return CornerFinder.handleDecayFallback();
  }

  /**
   * Validates whether 5 run lengths conform to the 1:1:3:1:1 module ratio
   */
  private static checkRatio(stateCount: number[]): boolean {
    const total = stateCount[0] + stateCount[1] + stateCount[2] + stateCount[3] + stateCount[4];
    if (total < 7) return false;
    const moduleSize = total / 7;
    const maxVar = moduleSize * 0.58; // Allow up to 58% variance for perspective tilt

    return (
      Math.abs(moduleSize - stateCount[0]) < maxVar &&
      Math.abs(moduleSize - stateCount[1]) < maxVar &&
      Math.abs(3 * moduleSize - stateCount[2]) < 3 * maxVar &&
      Math.abs(moduleSize - stateCount[3]) < maxVar &&
      Math.abs(moduleSize - stateCount[4]) < maxVar
    );
  }

  /**
   * Cross-checks a candidate finder pattern vertically at column cx
   */
  private static crossCheckVertical(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    cx: number,
    startRow: number,
    moduleH: number,
    threshold: number,
    minY: number,
    maxY: number
  ): { y: number; moduleSize: number } | null {
    if (cx < 0 || cx >= width) return null;

    // Scan up within light center core
    let coreUp = 0;
    while (startRow - coreUp >= minY && CornerFinder.getLuma(data, width, height, cx, startRow - coreUp) >= threshold) {
      coreUp++;
    }
    if (coreUp === 0 || startRow - coreUp < minY) return null;

    // Scan up within dark ring
    let darkRingUp = 0;
    while (startRow - coreUp - darkRingUp >= minY && CornerFinder.getLuma(data, width, height, cx, startRow - coreUp - darkRingUp) < threshold) {
      darkRingUp++;
    }
    if (darkRingUp === 0 || startRow - coreUp - darkRingUp < minY) return null;

    // Scan up within outer light border
    let outerLightUp = 0;
    while (startRow - coreUp - darkRingUp - outerLightUp >= minY && CornerFinder.getLuma(data, width, height, cx, startRow - coreUp - darkRingUp - outerLightUp) >= threshold) {
      outerLightUp++;
    }
    if (outerLightUp === 0) return null;

    // Scan down within light center core
    let coreDown = 1;
    while (startRow + coreDown <= maxY && CornerFinder.getLuma(data, width, height, cx, startRow + coreDown) >= threshold) {
      coreDown++;
    }
    if (startRow + coreDown > maxY) return null;

    // Scan down within dark ring
    let darkRingDown = 0;
    while (startRow + coreDown + darkRingDown <= maxY && CornerFinder.getLuma(data, width, height, cx, startRow + coreDown + darkRingDown) < threshold) {
      darkRingDown++;
    }
    if (darkRingDown === 0 || startRow + coreDown + darkRingDown > maxY) return null;

    // Scan down within outer light border
    let outerLightDown = 0;
    while (startRow + coreDown + darkRingDown + outerLightDown <= maxY && CornerFinder.getLuma(data, width, height, cx, startRow + coreDown + darkRingDown + outerLightDown) >= threshold) {
      outerLightDown++;
    }
    if (outerLightDown === 0) return null;

    const vRuns = [outerLightUp, darkRingUp, coreUp + coreDown - 1, darkRingDown, outerLightDown];
    const totalV = vRuns[0] + vRuns[1] + vRuns[2] + vRuns[3] + vRuns[4];
    if (totalV < 7) return null;

    const moduleV = totalV / 7;
    // Ensure vertical module size agrees with horizontal module size within 48%
    if (Math.abs(moduleV - moduleH) > 0.48 * moduleH) return null;

    const maxVarV = moduleV * 0.58;
    if (
      Math.abs(moduleV - vRuns[0]) > maxVarV ||
      Math.abs(moduleV - vRuns[1]) > maxVarV ||
      Math.abs(3 * moduleV - vRuns[2]) > 3 * maxVarV ||
      Math.abs(moduleV - vRuns[3]) > maxVarV ||
      Math.abs(moduleV - vRuns[4]) > maxVarV
    ) {
      return null;
    }

    const centerY = startRow + (coreDown - 1 - coreUp) / 2;
    return { y: centerY, moduleSize: moduleV };
  }

  /**
   * Assigns 4 detected points to Top-Left, Top-Right, Bottom-Right, Bottom-Left
   */
  private static assign4Corners(
    points: Point2D[],
    data: Uint8ClampedArray,
    width: number,
    height: number
  ): QuadCorners {
    // If more than 4, select the 4 that form the largest bounding area
    let selected = points;
    if (points.length > 4) {
      const cx = points.reduce((acc, p) => acc + p.x, 0) / points.length;
      const cy = points.reduce((acc, p) => acc + p.y, 0) / points.length;
      selected = [...points].sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy)).slice(0, 4);
    }

    // Check for Cyan anchor (Top-Left)
    let tlIdx = -1;
    for (let i = 0; i < selected.length; i++) {
      const p = selected[i];
      const rgb = CornerFinder.getRGB(data, width, height, Math.round(p.x), Math.round(p.y));
      if (rgb.b > 1.25 * rgb.r && rgb.g > 1.25 * rgb.r && rgb.b > 80) {
        tlIdx = i;
        break;
      }
    }

    // Geometrical sorting relative to centroid
    const center = {
      x: selected.reduce((sum, p) => sum + p.x, 0) / 4,
      y: selected.reduce((sum, p) => sum + p.y, 0) / 4,
    };

    let ptTL: Point2D;
    let ptTR: Point2D;
    let ptBR: Point2D;
    let ptBL: Point2D;

    if (tlIdx >= 0) {
      ptTL = selected[tlIdx];
      const others = selected.filter((_, i) => i !== tlIdx);
      // Sort others by angle relative to center
      others.sort((a, b) => {
        const angA = Math.atan2(a.y - center.y, a.x - center.x);
        const angB = Math.atan2(b.y - center.y, b.x - center.x);
        return angA - angB;
      });
      // The opposite point across center is Bottom-Right
      const sortedByDistToOpposite = [...others].sort((a, b) => {
        const dA = (a.x - center.x) * (ptTL.x - center.x) + (a.y - center.y) * (ptTL.y - center.y);
        const dB = (b.x - center.x) * (ptTL.x - center.x) + (b.y - center.y) * (ptTL.y - center.y);
        return dA - dB; // Most negative dot product is opposite
      });
      ptBR = sortedByDistToOpposite[0];
      const remaining = others.filter((p) => p !== ptBR);
      // Cross product to distinguish TR from BL
      const vTL_BR = { x: ptBR.x - ptTL.x, y: ptBR.y - ptTL.y };
      const cross0 = vTL_BR.x * (remaining[0].y - ptTL.y) - vTL_BR.y * (remaining[0].x - ptTL.x);
      if (cross0 > 0) {
        ptTR = remaining[1];
        ptBL = remaining[0];
      } else {
        ptTR = remaining[0];
        ptBL = remaining[1];
      }
    } else {
      // Spatial geometric classification
      ptTL = [...selected].sort((a, b) => a.x + a.y - (b.x + b.y))[0];
      ptBR = [...selected].sort((a, b) => b.x + b.y - (a.x + a.y))[0];
      const remaining = selected.filter((p) => p !== ptTL && p !== ptBR);
      if (remaining[0].x > remaining[1].x) {
        ptTR = remaining[0];
        ptBL = remaining[1];
      } else {
        ptTR = remaining[1];
        ptBL = remaining[0];
      }
    }

    return { topLeft: ptTL, topRight: ptTR, bottomRight: ptBR, bottomLeft: ptBL };
  }

  /**
   * Reconstructs 4th corner using ISO/IEC 18004 QR parallelogram affine completion
   */
  private static extrapolateFrom3Corners(
    points: Point2D[],
    data: Uint8ClampedArray,
    width: number,
    height: number
  ): QuadCorners {
    const [p0, p1, p2] = points;
    // Find right-angle corner P: minimum absolute dot product
    const dot0 = Math.abs((p1.x - p0.x) * (p2.x - p0.x) + (p1.y - p0.y) * (p2.y - p0.y));
    const dot1 = Math.abs((p0.x - p1.x) * (p2.x - p1.x) + (p0.y - p1.y) * (p2.y - p1.y));
    const dot2 = Math.abs((p0.x - p2.x) * (p1.x - p2.x) + (p0.y - p2.y) * (p1.y - p2.y));

    let cornerP: Point2D;
    let armA: Point2D;
    let armB: Point2D;

    if (dot0 <= dot1 && dot0 <= dot2) {
      cornerP = p0; armA = p1; armB = p2;
    } else if (dot1 <= dot0 && dot1 <= dot2) {
      cornerP = p1; armA = p0; armB = p2;
    } else {
      cornerP = p2; armA = p0; armB = p1;
    }

    // Reconstruct 4th corner
    const opp = { x: armA.x + armB.x - cornerP.x, y: armA.y + armB.y - cornerP.y };
    return CornerFinder.assign4Corners([cornerP, armA, armB, opp], data, width, height);
  }

  /**
   * Secondary quadrant centroid fallback search
   */
  private static findCornersViaQuadrants(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    minLuma: number,
    contrast: number
  ): QuadCorners | null {
    const fiducialInset = VisualFrameRenderer.FIDUCIAL_INSET;
    const radius = Math.min(sw, sh) * 0.12;

    const expectedTL: Point2D = { x: sx + sw * fiducialInset, y: sy + sh * fiducialInset };
    const expectedTR: Point2D = { x: sx + sw * (1 - fiducialInset), y: sy + sh * fiducialInset };
    const expectedBR: Point2D = { x: sx + sw * (1 - fiducialInset), y: sy + sh * (1 - fiducialInset) };
    const expectedBL: Point2D = { x: sx + sw * fiducialInset, y: sy + sh * (1 - fiducialInset) };

    const ptTL = CornerFinder.sampleQuadrantCentroid(data, width, height, expectedTL, radius, minLuma, contrast);
    const ptTR = CornerFinder.sampleQuadrantCentroid(data, width, height, expectedTR, radius, minLuma, contrast);
    const ptBR = CornerFinder.sampleQuadrantCentroid(data, width, height, expectedBR, radius, minLuma, contrast);
    const ptBL = CornerFinder.sampleQuadrantCentroid(data, width, height, expectedBL, radius, minLuma, contrast);

    let count = 0;
    if (ptTL) count++;
    if (ptTR) count++;
    if (ptBR) count++;
    if (ptBL) count++;

    if (count === 4) {
      return { topLeft: ptTL!, topRight: ptTR!, bottomRight: ptBR!, bottomLeft: ptBL! };
    }
    if (count === 3) {
      const resolvedTL = ptTL || (ptTR && ptBL && ptBR ? { x: ptTR.x + ptBL.x - ptBR.x, y: ptTR.y + ptBL.y - ptBR.y } : null);
      const resolvedTR = ptTR || (ptTL && ptBR && ptBL ? { x: ptTL.x + ptBR.x - ptBL.x, y: ptTL.y + ptBR.y - ptBL.y } : null);
      const resolvedBR = ptBR || (ptTR && ptBL && ptTL ? { x: ptTR.x + ptBL.x - ptTL.x, y: ptTR.y + ptBL.y - ptTL.y } : null);
      const resolvedBL = ptBL || (ptTL && ptBR && ptTR ? { x: ptTL.x + ptBR.x - ptTR.x, y: ptTL.y + ptBR.y - ptTR.y } : null);
      if (resolvedTL && resolvedTR && resolvedBR && resolvedBL) {
        return { topLeft: resolvedTL, topRight: resolvedTR, bottomRight: resolvedBR, bottomLeft: resolvedBL };
      }
    }
    return null;
  }

  private static sampleQuadrantCentroid(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    center: Point2D,
    radius: number,
    minLuma: number,
    contrast: number
  ): Point2D | null {
    const minX = Math.max(0, Math.round(center.x - radius));
    const maxX = Math.min(width - 1, Math.round(center.x + radius));
    const minY = Math.max(0, Math.round(center.y - radius));
    const maxY = Math.min(height - 1, Math.round(center.y + radius));

    const threshold = minLuma + contrast * 0.55;
    let sumX = 0;
    let sumY = 0;
    let totalWeight = 0;

    for (let y = minY; y <= maxY; y += 2) {
      for (let x = minX; x <= maxX; x += 2) {
        const luma = CornerFinder.getLuma(data, width, height, x, y);
        if (luma > threshold) {
          const d = Math.hypot(x - center.x, y - center.y);
          const weight = (luma - threshold) * Math.max(0.1, 1 - d / radius);
          sumX += x * weight;
          sumY += y * weight;
          totalWeight += weight;
        }
      }
    }

    if (totalWeight < 40) return null;
    return { x: sumX / totalWeight, y: sumY / totalWeight };
  }

  private static handleDecayFallback(): DetectionResult | null {
    if (CornerFinder.lockDecay > 0 && CornerFinder.lastValidCorners) {
      CornerFinder.lockDecay--;
      return {
        corners: CornerFinder.lastValidCorners,
        matrixCorners: CornerFinder.computeMatrixCorners(CornerFinder.lastValidCorners),
        confidence: 0.82,
        rotationOffset: 0,
        isDirectLock: false,
      };
    }
    CornerFinder.lastValidCorners = null;
    CornerFinder.lockStreak = 0;
    return null;
  }

  private static getLuma(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    const idx = (py * width + px) * 4;
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  private static getRGB(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    x: number,
    y: number
  ): { r: number; g: number; b: number } {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    const idx = (py * width + px) * 4;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
  }

  private static lerpPoint(p1: Point2D, p2: Point2D, alpha: number): Point2D {
    return {
      x: p1.x * alpha + p2.x * (1 - alpha),
      y: p1.y * alpha + p2.y * (1 - alpha),
    };
  }

  private static bilinearInterpolate(q: QuadCorners, u: number, v: number): Point2D {
    const topX = q.topLeft.x * (1 - u) + q.topRight.x * u;
    const topY = q.topLeft.y * (1 - u) + q.topRight.y * u;
    const botX = q.bottomLeft.x * (1 - u) + q.bottomRight.x * u;
    const botY = q.bottomLeft.y * (1 - u) + q.bottomRight.y * u;

    return {
      x: topX * (1 - v) + botX * v,
      y: topY * (1 - v) + botY * v,
    };
  }

  /**
   * Computes the bounding quad of the 16x16 data matrix inside the corner fiducials
   */
  public static computeMatrixCorners(corners: QuadCorners): QuadCorners {
    const fiducialInset = VisualFrameRenderer.FIDUCIAL_INSET;
    const mStart = (VisualFrameRenderer.MATRIX_INSET - fiducialInset) / (1 - 2 * fiducialInset);
    const mEnd = (1 - VisualFrameRenderer.MATRIX_INSET - fiducialInset) / (1 - 2 * fiducialInset);

    return {
      topLeft: CornerFinder.bilinearInterpolate(corners, mStart, mStart),
      topRight: CornerFinder.bilinearInterpolate(corners, mEnd, mStart),
      bottomRight: CornerFinder.bilinearInterpolate(corners, mEnd, mEnd),
      bottomLeft: CornerFinder.bilinearInterpolate(corners, mStart, mEnd),
    };
  }

  /**
   * Generates simulated corners for loopback benchmark testing
   */
  public static createSimulatedCorners(
    canvasWidth: number,
    canvasHeight: number,
    tiltX = 0,
    tiltY = 0
  ): QuadCorners {
    const fiducials = VisualFrameRenderer.getFiducialCenters();
    return {
      topLeft:     { x: fiducials.topLeft.x * canvasWidth + tiltX,     y: fiducials.topLeft.y * canvasHeight + tiltY },
      topRight:    { x: fiducials.topRight.x * canvasWidth - tiltX,    y: fiducials.topRight.y * canvasHeight + tiltY },
      bottomRight: { x: fiducials.bottomRight.x * canvasWidth - tiltX, y: fiducials.bottomRight.y * canvasHeight - tiltY },
      bottomLeft:  { x: fiducials.bottomLeft.x * canvasWidth + tiltX,  y: fiducials.bottomLeft.y * canvasHeight - tiltY },
    };
  }
}
