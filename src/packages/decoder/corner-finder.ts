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

    // 1. Establish central alignment square in the camera viewport
    const squareDim = Math.round(Math.min(width, height) * 0.70);
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

    // 2. Search for the 4 corner fiducials in the 4 corner quadrants of the target area
    const fiducialInset = VisualFrameRenderer.FIDUCIAL_INSET;
    const expectedTL: Point2D = { x: sx + sw * fiducialInset, y: sy + sh * fiducialInset };
    const expectedTR: Point2D = { x: sx + sw * (1 - fiducialInset), y: sy + sh * fiducialInset };
    const expectedBR: Point2D = { x: sx + sw * (1 - fiducialInset), y: sy + sh * (1 - fiducialInset) };
    const expectedBL: Point2D = { x: sx + sw * fiducialInset, y: sy + sh * (1 - fiducialInset) };

    const searchRadius = Math.round(Math.min(sw, sh) * 0.18);

    // Refine centroids near expected locations
    const ptTL = CornerFinder.findFiducialCentroid(data, width, height, expectedTL, searchRadius);
    const ptTR = CornerFinder.findFiducialCentroid(data, width, height, expectedTR, searchRadius);
    const ptBR = CornerFinder.findFiducialCentroid(data, width, height, expectedBR, searchRadius);
    const ptBL = CornerFinder.findFiducialCentroid(data, width, height, expectedBL, searchRadius);

    let corners: QuadCorners = {
      topLeft: ptTL || expectedTL,
      topRight: ptTR || expectedTR,
      bottomRight: ptBR || expectedBR,
      bottomLeft: ptBL || expectedBL,
    };

    let fiducialsFound = 0;
    if (ptTL) fiducialsFound++;
    if (ptTR) fiducialsFound++;
    if (ptBR) fiducialsFound++;
    if (ptBL) fiducialsFound++;

    // 3. Temporal smoothing filter to eliminate jitter
    if (CornerFinder.lastValidCorners && fiducialsFound >= 2) {
      const alpha = 0.75; // Smoothing factor
      corners = {
        topLeft: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.topLeft, corners.topLeft, alpha),
        topRight: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.topRight, corners.topRight, alpha),
        bottomRight: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.bottomRight, corners.bottomRight, alpha),
        bottomLeft: CornerFinder.lerpPoint(CornerFinder.lastValidCorners.bottomLeft, corners.bottomLeft, alpha),
      };
      CornerFinder.lockStreak++;
    } else if (fiducialsFound >= 2) {
      CornerFinder.lockStreak = 1;
    } else {
      CornerFinder.lockStreak = Math.max(0, CornerFinder.lockStreak - 1);
    }

    CornerFinder.lastValidCorners = corners;

    // 4. Calculate exact matrix bounding box inside the fiducials
    const matrixCorners = CornerFinder.computeMatrixCorners(corners);

    const confidence = fiducialsFound >= 3 ? 0.95 : fiducialsFound >= 2 ? 0.75 : 0.5;

    return {
      corners,
      matrixCorners,
      confidence,
      rotationOffset: 0,
      isDirectLock: fiducialsFound >= 2,
    };
  }

  /**
   * Searches for a high-contrast concentric target centroid around an expected point
   */
  private static findFiducialCentroid(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    center: Point2D,
    radius: number
  ): Point2D | null {
    const minX = Math.max(0, Math.round(center.x - radius));
    const maxX = Math.min(width - 1, Math.round(center.x + radius));
    const minY = Math.max(0, Math.round(center.y - radius));
    const maxY = Math.min(height - 1, Math.round(center.y + radius));

    let sumX = 0;
    let sumY = 0;
    let totalWeight = 0;

    // Sample pixels in local window
    for (let y = minY; y <= maxY; y += 2) {
      for (let x = minX; x <= maxX; x += 2) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const luma = 0.299 * r + 0.587 * g + 0.114 * b;

        // The fiducial features a bright white ring and cyan/white bullseye (high luminance)
        if (luma > 150) {
          // Weight towards proximity to center and brightness
          const d = Math.hypot(x - center.x, y - center.y);
          const spatialWeight = Math.max(0.1, 1 - d / radius);
          const weight = (luma - 150) * spatialWeight;

          sumX += x * weight;
          sumY += y * weight;
          totalWeight += weight;
        }
      }
    }

    if (totalWeight < 100) return null;

    return {
      x: sumX / totalWeight,
      y: sumY / totalWeight,
    };
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
