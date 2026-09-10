/**
 * LumaLink Optical Corner Fiducial Finder
 * Robust multi-tier detection: reticle-guided fiducial centroid search,
 * adaptive thresholding, and sub-pixel corner refinement
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

export class CornerFinder {
  private static lastValidCorners: QuadCorners | null = null;
  private static lockStreak = 0;

  /**
   * Locates transmission corners in camera image data using reticle-guided centroid detection
   */
  public static findCorners(
    imgData: ImageData,
    searchBounds?: { x: number; y: number; width: number; height: number }
  ): DetectionResult | null {
    const { width, height, data } = imgData;

    // 1. Target search area
    const squareDim = Math.round(Math.min(width, height) * 0.72);
    const centerX = Math.round(width / 2);
    const centerY = Math.round(height / 2);

    const defaultBounds = {
      x: Math.round(centerX - squareDim / 2),
      y: Math.round(centerY - squareDim / 2),
      width: squareDim,
      height: squareDim,
    };

    const bounds = searchBounds || defaultBounds;
    const sx = Math.max(0, bounds.x);
    const sy = Math.max(0, bounds.y);
    const sw = Math.min(width - sx, bounds.width);
    const sh = Math.min(height - sy, bounds.height);

    if (sw < 40 || sh < 40) return null;

    const fiducialInset = VisualFrameRenderer.FIDUCIAL_INSET;
    const expectedTL: Point2D = { x: sx + sw * fiducialInset, y: sy + sh * fiducialInset };
    const expectedTR: Point2D = { x: sx + sw * (1 - fiducialInset), y: sy + sh * fiducialInset };
    const expectedBR: Point2D = { x: sx + sw * (1 - fiducialInset), y: sy + sh * (1 - fiducialInset) };
    const expectedBL: Point2D = { x: sx + sw * fiducialInset, y: sy + sh * (1 - fiducialInset) };

    const midX = sx + sw * 0.5;
    const midY = sy + sh * 0.5;
    const expectedDim = Math.min(sw, sh);

    // 2. Search each corner quadrant for concentric fiducial bullseye
    let ptTL = CornerFinder.findFiducialInQuadrant(data, width, height, { minX: sx, maxX: midX, minY: sy, maxY: midY }, expectedTL, expectedDim);
    let ptTR = CornerFinder.findFiducialInQuadrant(data, width, height, { minX: midX, maxX: sx + sw, minY: sy, maxY: midY }, expectedTR, expectedDim);
    let ptBR = CornerFinder.findFiducialInQuadrant(data, width, height, { minX: midX, maxX: sx + sw, minY: midY, maxY: sy + sh }, expectedBR, expectedDim);
    let ptBL = CornerFinder.findFiducialInQuadrant(data, width, height, { minX: sx, maxX: midX, minY: midY, maxY: sy + sh }, expectedBL, expectedDim);

    let fiducialsFound = 0;
    if (ptTL) fiducialsFound++;
    if (ptTR) fiducialsFound++;
    if (ptBR) fiducialsFound++;
    if (ptBL) fiducialsFound++;

    // 3. Extrapolate missing corners if 3 or 2 are detected with high confidence
    if (fiducialsFound === 3) {
      if (!ptTL && ptTR && ptBR && ptBL) ptTL = { x: ptTR.x + ptBL.x - ptBR.x, y: ptTR.y + ptBL.y - ptBR.y };
      else if (!ptTR && ptTL && ptBR && ptBL) ptTR = { x: ptTL.x + ptBR.x - ptBL.x, y: ptTL.y + ptBR.y - ptBL.y };
      else if (!ptBR && ptTL && ptTR && ptBL) ptBR = { x: ptTR.x + ptBL.x - ptTL.x, y: ptTR.y + ptBL.y - ptTL.y };
      else if (!ptBL && ptTL && ptTR && ptBR) ptBL = { x: ptTL.x + ptBR.x - ptTR.x, y: ptTL.y + ptBR.y - ptTR.y };
      fiducialsFound = 4;
    } else if (fiducialsFound === 2) {
      // 2-corner geometric reconstruction when extreme glare blinds 2 corners
      if (ptTL && ptTR) {
        const ux = ptTR.x - ptTL.x;
        const uy = ptTR.y - ptTL.y;
        ptBL = { x: ptTL.x - uy, y: ptTL.y + ux };
        ptBR = { x: ptTR.x - uy, y: ptTR.y + ux };
        fiducialsFound = 4;
      } else if (ptBL && ptBR) {
        const ux = ptBR.x - ptBL.x;
        const uy = ptBR.y - ptBL.y;
        ptTL = { x: ptBL.x + uy, y: ptBL.y - ux };
        ptTR = { x: ptBR.x + uy, y: ptBR.y - ux };
        fiducialsFound = 4;
      } else if (ptTL && ptBL) {
        const wx = ptBL.x - ptTL.x;
        const wy = ptBL.y - ptTL.y;
        ptTR = { x: ptTL.x - wy, y: ptTL.y + wx };
        ptBR = { x: ptBL.x - wy, y: ptBL.y + wx };
        fiducialsFound = 4;
      } else if (ptTR && ptBR) {
        const wx = ptBR.x - ptTR.x;
        const wy = ptBR.y - ptTR.y;
        ptTL = { x: ptTR.x + wy, y: ptTR.y - wx };
        ptBL = { x: ptBR.x + wy, y: ptBR.y - wx };
        fiducialsFound = 4;
      } else if (ptTL && ptBR) {
        const cx = (ptTL.x + ptBR.x) * 0.5;
        const cy = (ptTL.y + ptBR.y) * 0.5;
        const dx = ptBR.x - ptTL.x;
        const dy = ptBR.y - ptTL.y;
        ptTR = { x: cx - dy * 0.5, y: cy + dx * 0.5 };
        ptBL = { x: cx + dy * 0.5, y: cy - dx * 0.5 };
        fiducialsFound = 4;
      } else if (ptTR && ptBL) {
        const cx = (ptTR.x + ptBL.x) * 0.5;
        const cy = (ptTR.y + ptBL.y) * 0.5;
        const dx = ptTR.x - ptBL.x;
        const dy = ptTR.y - ptBL.y;
        ptTL = { x: cx - dy * 0.5, y: cy + dx * 0.5 };
        ptBR = { x: cx + dy * 0.5, y: cy - dx * 0.5 };
        fiducialsFound = 4;
      }
    }

    // 4. If fewer than 2 fiducials found, check if we can sustain a short-lived streak
    if (fiducialsFound < 4 || !ptTL || !ptTR || !ptBR || !ptBL) {
      if (CornerFinder.lockStreak > 0 && CornerFinder.lastValidCorners) {
        CornerFinder.lockStreak = Math.max(0, CornerFinder.lockStreak - 1);
        if (CornerFinder.lockStreak > 0) {
          return {
            corners: CornerFinder.lastValidCorners,
            matrixCorners: CornerFinder.computeMatrixCorners(CornerFinder.lastValidCorners),
            confidence: 0.60,
            rotationOffset: 0,
            isDirectLock: false,
          };
        }
      }
      CornerFinder.lastValidCorners = null;
      CornerFinder.lockStreak = 0;
      return null;
    }

    let corners: QuadCorners = {
      topLeft: ptTL,
      topRight: ptTR,
      bottomRight: ptBR,
      bottomLeft: ptBL,
    };

    // 5. Temporal smoothing filter to eliminate camera jitter
    if (CornerFinder.lastValidCorners) {
      const alpha = 0.70;
      corners = {
        topLeft: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.topLeft, corners.topLeft, alpha),
        topRight: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.topRight, corners.topRight, alpha),
        bottomRight: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.bottomRight, corners.bottomRight, alpha),
        bottomLeft: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.bottomLeft, corners.bottomLeft, alpha),
      };
      CornerFinder.lockStreak = Math.min(10, CornerFinder.lockStreak + 1);
    } else {
      CornerFinder.lockStreak = 1;
    }

    CornerFinder.lastValidCorners = corners;
    const matrixCorners = CornerFinder.computeMatrixCorners(corners);

    return {
      corners,
      matrixCorners,
      confidence: 0.95,
      rotationOffset: 0,
      isDirectLock: true,
    };
  }

  /**
   * Searches for a concentric fiducial bullseye in a given quadrant
   */
  private static findFiducialInQuadrant(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    quadrant: { minX: number; maxX: number; minY: number; maxY: number },
    expectedCenter: Point2D,
    expectedDim: number
  ): Point2D | null {
    const minX = Math.max(0, Math.round(quadrant.minX));
    const maxX = Math.min(width - 1, Math.round(quadrant.maxX));
    const minY = Math.max(0, Math.round(quadrant.minY));
    const maxY = Math.min(height - 1, Math.round(quadrant.maxY));

    if (maxX <= minX + 12 || maxY <= minY + 12) return null;

    // 1. Measure local luminance range in quadrant
    let minLuma = 255;
    let maxLuma = 0;
    const step = 4;

    for (let y = minY; y <= maxY; y += step) {
      for (let x = minX; x <= maxX; x += step) {
        const luma = CornerFinder.getLuma(data, width, height, x, y);
        if (luma < minLuma) minLuma = luma;
        if (luma > maxLuma) maxLuma = luma;
      }
    }

    const contrast = maxLuma - minLuma;
    if (contrast < 18) return null;

    const brightThreshold = minLuma + contrast * 0.45;

    // 2. Sample candidates for concentric ring signature (bright dot, dark ring, bright ring)
    let bestScore = 0;
    let bestCandidate: Point2D | null = null;
    let bestDotRadius = Math.max(2, Math.round(expectedDim * 0.022));

    const testScales = [expectedDim * 0.8, expectedDim, expectedDim * 1.2];
    const candidateStep = Math.max(2, Math.round(expectedDim * 0.018));

    for (let y = minY + 6; y <= maxY - 6; y += candidateStep) {
      for (let x = minX + 6; x <= maxX - 6; x += candidateStep) {
        const cLuma = CornerFinder.getLuma(data, width, height, x, y);
        if (cLuma < brightThreshold) continue;

        for (const S of testScales) {
          const rMid = Math.max(2, Math.round(S * 0.038));
          const rOuter = Math.max(4, Math.round(S * 0.055));
          const rOut = Math.max(6, Math.round(S * 0.080));

          const midLuma = (
            CornerFinder.getLuma(data, width, height, x + rMid, y) +
            CornerFinder.getLuma(data, width, height, x - rMid, y) +
            CornerFinder.getLuma(data, width, height, x, y + rMid) +
            CornerFinder.getLuma(data, width, height, x, y - rMid)
          ) * 0.25;

          const ringLuma = (
            CornerFinder.getLuma(data, width, height, x + rOuter, y) +
            CornerFinder.getLuma(data, width, height, x - rOuter, y) +
            CornerFinder.getLuma(data, width, height, x, y + rOuter) +
            CornerFinder.getLuma(data, width, height, x, y - rOuter)
          ) * 0.25;

          const outLuma = (
            CornerFinder.getLuma(data, width, height, x + rOut, y) +
            CornerFinder.getLuma(data, width, height, x - rOut, y) +
            CornerFinder.getLuma(data, width, height, x, y + rOut) +
            CornerFinder.getLuma(data, width, height, x, y - rOut)
          ) * 0.25;

          const score = (cLuma - midLuma) + (ringLuma - midLuma) + (ringLuma - outLuma);

          if (score > bestScore) {
            bestScore = score;
            bestCandidate = { x, y };
            bestDotRadius = S * 0.022;
          }
        }
      }
    }

    if (!bestCandidate || bestScore < 18) {
      // Fallback: search around expected center point if local contrast is present
      return CornerFinder.fallbackCentroid(data, width, height, expectedCenter, expectedDim * 0.18, minLuma, contrast);
    }

    return CornerFinder.refineDotCentroid(data, width, height, bestCandidate, Math.max(3, Math.round(bestDotRadius * 1.5)));
  }

  private static fallbackCentroid(
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

    const threshold = minLuma + contrast * 0.60;
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

  private static refineDotCentroid(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    center: Point2D,
    radius: number
  ): Point2D {
    const minX = Math.max(0, Math.round(center.x - radius));
    const maxX = Math.min(width - 1, Math.round(center.x + radius));
    const minY = Math.max(0, Math.round(center.y - radius));
    const maxY = Math.min(height - 1, Math.round(center.y + radius));

    let sumX = 0;
    let sumY = 0;
    let totalWeight = 0;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d = Math.hypot(x - center.x, y - center.y);
        if (d > radius) continue;
        const luma = CornerFinder.getLuma(data, width, height, x, y);
        const weight = luma * (1 - d / (radius * 1.2));
        sumX += x * weight;
        sumY += y * weight;
        totalWeight += weight;
      }
    }

    if (totalWeight < 1) return center;
    return { x: sumX / totalWeight, y: sumY / totalWeight };
  }

  private static getLuma(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    const idx = (py * width + px) * 4;
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  private static lerpPoint(p1: Point2D, p2: Point2D, alpha: number): Point2D {
    return {
      x: p1.x * alpha + p2.x * (1 - alpha),
      y: p1.y * alpha + p2.y * (1 - alpha),
    };
  }

  private static bilinearInterpolate(q: QuadCorners, u: number, v: number): Point2D {
    // Interpolate along top and bottom edges, then vertically
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
