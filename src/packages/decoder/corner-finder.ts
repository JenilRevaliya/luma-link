/**
 * LumaLink Optical Corner Fiducial Finder
 * Industrial QR-style 1:1:3:1:1 run-length finder pattern detection,
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

interface Run {
  isLight: boolean;
  len: number;
  startX: number;
}

interface ColRun {
  isLight: boolean;
  len: number;
  startY: number;
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

    // 1. Establish search bounds
    let sx = 0;
    let sy = 0;
    let sw = width;
    let sh = height;

    if (searchBounds && searchBounds.width > 40 && searchBounds.height > 40) {
      const padX = Math.round(Math.max(25, searchBounds.width * 0.18));
      const padY = Math.round(Math.max(25, searchBounds.height * 0.18));
      sx = Math.max(0, searchBounds.x - padX);
      sy = Math.max(0, searchBounds.y - padY);
      sw = Math.min(width - sx, searchBounds.width + 2 * padX);
      sh = Math.min(height - sy, searchBounds.height + 2 * padY);
    }

    if (sw < 40 || sh < 40) {
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
    if (contrast < 18) {
      // Uniform gray noise or dark frame
      return CornerFinder.handleDecayFallback();
    }

    // Test adaptive thresholds to handle ambient light variations & glare
    const thresholds = [
      minLuma + contrast * 0.44, // standard
      minLuma + contrast * 0.35, // shadow/low-exposure boost
      minLuma + contrast * 0.55, // glare/high-exposure boost
    ];

    let candidates: FinderCandidate[] = [];

    for (const threshold of thresholds) {
      const found = CornerFinder.scanForCandidates(data, width, height, sx, sy, sw, sh, threshold);
      candidates = candidates.concat(found);
      if (candidates.length >= 8) break; // Sufficient candidates acquired
    }

    // 3. Cluster candidates from adjacent scanlines
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

    // Sort clusters by hit count descending
    clusters.sort((a, b) => b.count - a.count);
    const points: Point2D[] = clusters.map((cl) => ({
      x: cl.sumX / cl.count,
      y: cl.sumY / cl.count,
    }));

    // 4. Resolve 4 corners from clusters
    let resolvedCorners: QuadCorners | null = null;

    if (points.length >= 4) {
      resolvedCorners = CornerFinder.assign4Corners(points, data, width, height);
    } else if (points.length === 3) {
      resolvedCorners = CornerFinder.extrapolateFrom3Corners(points, data, width, height);
    } else if (points.length === 2) {
      resolvedCorners = CornerFinder.extrapolateFrom2Corners(points[0], points[1]);
    }

    // 5. Fallback: Reticle-guided quadrant centroid search if scanline missed
    if (!resolvedCorners) {
      resolvedCorners = CornerFinder.findCornersViaQuadrants(
        data,
        width,
        height,
        sx,
        sy,
        sw,
        sh,
        minLuma,
        contrast
      );
    }

    // 6. Apply Temporal Smoothing & Hysteresis
    if (resolvedCorners) {
      CornerFinder.lockDecay = 15; // 15 frames (~500ms) memory across camera blurs
      CornerFinder.lockStreak = Math.min(30, CornerFinder.lockStreak + 1);

      let finalCorners = resolvedCorners;
      if (CornerFinder.lastValidCorners) {
        // High-stability exponential moving average (80% memory / 20% measurement)
        const alpha = 0.80;
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
   * Scans horizontal lines in the region and cross-checks matching vertical columns
   */
  private static scanForCandidates(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    threshold: number
  ): FinderCandidate[] {
    const candidates: FinderCandidate[] = [];
    const rowStep = Math.max(2, Math.round(sh / 100));

    for (let y = sy + 3; y < sy + sh - 3; y += rowStep) {
      const runs = CornerFinder.extractRowRuns(data, width, height, y, sx, sx + sw, threshold);

      for (let i = 0; i <= runs.length - 5; i++) {
        // Pattern sequence: Light -> Dark -> Light (core) -> Dark -> Light
        if (
          runs[i].isLight &&
          !runs[i + 1].isLight &&
          runs[i + 2].isLight &&
          !runs[i + 3].isLight &&
          runs[i + 4].isLight
        ) {
          const d0 = runs[i].len;
          const d1 = runs[i + 1].len;
          const d2 = runs[i + 2].len;
          const d3 = runs[i + 3].len;
          const d4 = runs[i + 4].len;

          const totalH = d0 + d1 + d2 + d3 + d4;
          const moduleH = totalH / 7;
          if (moduleH < 2) continue;

          const maxVarH = moduleH * 0.65;
          if (
            Math.abs(moduleH - d0) < maxVarH &&
            Math.abs(moduleH - d1) < maxVarH &&
            Math.abs(3 * moduleH - d2) < 3 * maxVarH &&
            Math.abs(moduleH - d3) < maxVarH &&
            Math.abs(moduleH - d4) < maxVarH
          ) {
            const candX = runs[i].startX + d0 + d1 + d2 / 2;

            // Cross check vertically at candX
            const vRes = CornerFinder.crossCheckVerticalRuns(
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
        }
      }
    }

    return candidates;
  }

  /**
   * Compresses horizontal scanline pixels into consecutive run lengths
   */
  private static extractRowRuns(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    y: number,
    minX: number,
    maxX: number,
    threshold: number
  ): Run[] {
    const runs: Run[] = [];
    if (minX >= maxX) return runs;

    let isLight = CornerFinder.getLuma(data, width, height, minX, y) >= threshold;
    let runLen = 1;
    let startX = minX;

    for (let x = minX + 1; x < maxX; x++) {
      const pixelLight = CornerFinder.getLuma(data, width, height, x, y) >= threshold;
      if (pixelLight === isLight) {
        runLen++;
      } else {
        runs.push({ isLight, len: runLen, startX });
        isLight = pixelLight;
        runLen = 1;
        startX = x;
      }
    }
    runs.push({ isLight, len: runLen, startX });
    return runs;
  }

  /**
   * Compresses vertical scanline pixels into consecutive run lengths
   */
  private static extractColRuns(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    cx: number,
    minY: number,
    maxY: number,
    threshold: number
  ): ColRun[] {
    const runs: ColRun[] = [];
    if (minY >= maxY) return runs;

    let isLight = CornerFinder.getLuma(data, width, height, cx, minY) >= threshold;
    let runLen = 1;
    let startY = minY;

    for (let y = minY + 1; y < maxY; y++) {
      const pixelLight = CornerFinder.getLuma(data, width, height, cx, y) >= threshold;
      if (pixelLight === isLight) {
        runLen++;
      } else {
        runs.push({ isLight, len: runLen, startY });
        isLight = pixelLight;
        runLen = 1;
        startY = y;
      }
    }
    runs.push({ isLight, len: runLen, startY });
    return runs;
  }

  /**
   * Cross-checks a candidate finder pattern vertically at column cx
   */
  private static crossCheckVerticalRuns(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    cx: number,
    rowY: number,
    moduleH: number,
    threshold: number,
    minY: number,
    maxY: number
  ): { y: number; moduleSize: number } | null {
    if (cx < 0 || cx >= width) return null;

    const colRuns = CornerFinder.extractColRuns(data, width, height, cx, minY, maxY, threshold);

    for (let j = 0; j <= colRuns.length - 5; j++) {
      if (
        colRuns[j].isLight &&
        !colRuns[j + 1].isLight &&
        colRuns[j + 2].isLight &&
        !colRuns[j + 3].isLight &&
        colRuns[j + 4].isLight
      ) {
        const coreYStart = colRuns[j + 2].startY;
        const coreYEnd = coreYStart + colRuns[j + 2].len;

        // Verify that rowY intersects or touches the center core
        if (rowY >= coreYStart - 2 && rowY <= coreYEnd + 2) {
          const v0 = colRuns[j].len;
          const v1 = colRuns[j + 1].len;
          const v2 = colRuns[j + 2].len;
          const v3 = colRuns[j + 3].len;
          const v4 = colRuns[j + 4].len;

          const vTotal = v0 + v1 + v2 + v3 + v4;
          const vMod = vTotal / 7;

          if (Math.abs(vMod - moduleH) <= moduleH * 0.65) {
            const maxVarV = vMod * 0.65;
            if (
              Math.abs(vMod - v0) < maxVarV &&
              Math.abs(vMod - v1) < maxVarV &&
              Math.abs(3 * vMod - v2) < 3 * maxVarV &&
              Math.abs(vMod - v3) < maxVarV &&
              Math.abs(vMod - v4) < maxVarV
            ) {
              const candY = colRuns[j].startY + v0 + v1 + v2 / 2;
              return { y: candY, moduleSize: vMod };
            }
          }
        }
      }
    }
    return null;
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
      if (rgb.b > 1.25 * rgb.r && rgb.g > 1.25 * rgb.r && rgb.b > 70) {
        tlIdx = i;
        break;
      }
    }

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

      // Find opposite corner across center (Bottom-Right)
      const sortedByOpposite = [...others].sort((a, b) => {
        const dA = (a.x - center.x) * (ptTL.x - center.x) + (a.y - center.y) * (ptTL.y - center.y);
        const dB = (b.x - center.x) * (ptTL.x - center.x) + (b.y - center.y) * (ptTL.y - center.y);
        return dA - dB;
      });
      ptBR = sortedByOpposite[0];

      const remaining = others.filter((p) => p !== ptBR);
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

    const opp = { x: armA.x + armB.x - cornerP.x, y: armA.y + armB.y - cornerP.y };
    return CornerFinder.assign4Corners([cornerP, armA, armB, opp], data, width, height);
  }

  /**
   * 2-Corner geometric reconstruction
   */
  private static extrapolateFrom2Corners(p0: Point2D, p1: Point2D): QuadCorners {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    // Assume p0 is TL, p1 is TR (or rotate)
    return {
      topLeft: p0,
      topRight: p1,
      bottomRight: { x: p1.x - dy, y: p1.y + dx },
      bottomLeft: { x: p0.x - dy, y: p0.y + dx },
    };
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
    const midX = sx + sw * 0.5;
    const midY = sy + sh * 0.5;

    // Search 4 quadrants around the reticle
    const ptTL = CornerFinder.sampleQuadrantCentroid(data, width, height, sx, midX, sy, midY, minLuma, contrast);
    const ptTR = CornerFinder.sampleQuadrantCentroid(data, width, height, midX, sx + sw, sy, midY, minLuma, contrast);
    const ptBR = CornerFinder.sampleQuadrantCentroid(data, width, height, midX, sx + sw, midY, sy + sh, minLuma, contrast);
    const ptBL = CornerFinder.sampleQuadrantCentroid(data, width, height, sx, midX, midY, sy + sh, minLuma, contrast);

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
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minLuma: number,
    contrast: number
  ): Point2D | null {
    const qMinX = Math.max(0, Math.round(minX));
    const qMaxX = Math.min(width - 1, Math.round(maxX));
    const qMinY = Math.max(0, Math.round(minY));
    const qMaxY = Math.min(height - 1, Math.round(maxY));

    if (qMaxX <= qMinX + 10 || qMaxY <= qMinY + 10) return null;

    const threshold = minLuma + contrast * 0.52;
    let sumX = 0;
    let sumY = 0;
    let totalWeight = 0;

    for (let y = qMinY; y <= qMaxY; y += 3) {
      for (let x = qMinX; x <= qMaxX; x += 3) {
        const luma = CornerFinder.getLuma(data, width, height, x, y);
        if (luma > threshold) {
          const weight = luma - threshold;
          sumX += x * weight;
          sumY += y * weight;
          totalWeight += weight;
        }
      }
    }

    if (totalWeight < 50) return null;
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
