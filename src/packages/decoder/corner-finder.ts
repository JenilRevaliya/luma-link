/**
 * LumaLink Optical Corner Fiducial Finder
 * Detects the 4 corner points of the LumaLink transmission area in a camera frame
 */

import type { Point2D, QuadCorners } from '../protocol/types';
import { VisualFrameRenderer } from '../encoder/visual-frame';

export interface DetectionResult {
  corners: QuadCorners;
  confidence: number;
  rotationOffset: number; // 0, 1, 2, 3 (0°, 90°, 180°, 270°)
}

export class CornerFinder {
  /**
   * Fast detection of the 4 transmission fiducial corners in camera image data
   */
  public static findCorners(
    imgData: ImageData,
    searchBounds?: { x: number; y: number; width: number; height: number }
  ): DetectionResult | null {
    const { width, height, data } = imgData;
    const sx = Math.max(0, searchBounds?.x || 0);
    const sy = Math.max(0, searchBounds?.y || 0);
    const sw = Math.min(width - sx, searchBounds?.width || width);
    const sh = Math.min(height - sy, searchBounds?.height || height);

    // Stride for fast processing
    const step = Math.max(2, Math.floor(Math.min(sw, sh) / 160));

    let minSum = Infinity;   // Top-Left: min(x + y)
    let maxSum = -Infinity;  // Bottom-Right: max(x + y)
    let minDiff = Infinity;  // Top-Right / Bottom-Left: min(x - y)
    let maxDiff = -Infinity; // max(x - y)

    let ptTL: Point2D = { x: sx, y: sy };
    let ptBR: Point2D = { x: sx + sw, y: sy + sh };
    let ptTR: Point2D = { x: sx + sw, y: sy };
    let ptBL: Point2D = { x: sx, y: sy + sh };

    let detectedPointsCount = 0;

    // Scan inside region for high-contrast border and fiducial markers
    for (let y = sy; y < sy + sh; y += step) {
      for (let x = sx; x < sx + sw; x += step) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // High contrast bright edge or colored cell detection
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const isBright = luma > 180;
        const isVibrantColor = (r > 160 && g < 100 && b < 100) || // Red
                               (g > 150 && r < 100 && b < 100) || // Green
                               (b > 160 && r < 100 && g < 100);   // Blue

        if (isBright || isVibrantColor) {
          detectedPointsCount++;

          const sum = x + y;
          const diff = x - y;

          if (sum < minSum) {
            minSum = sum;
            ptTL = { x, y };
          }
          if (sum > maxSum) {
            maxSum = sum;
            ptBR = { x, y };
          }
          if (diff > maxDiff) {
            maxDiff = diff;
            ptTR = { x, y };
          }
          if (diff < minDiff) {
            minDiff = diff;
            ptBL = { x, y };
          }
        }
      }
    }

    // Minimum area / candidate threshold
    const minDistanceThreshold = Math.min(sw, sh) * 0.20;
    const diag1 = Math.hypot(ptBR.x - ptTL.x, ptBR.y - ptTL.y);
    const diag2 = Math.hypot(ptTR.x - ptBL.x, ptTR.y - ptBL.y);

    if (diag1 < minDistanceThreshold || diag2 < minDistanceThreshold || detectedPointsCount < 20) {
      // Fallback to reticle default region if camera feed is centered
      const margin = Math.min(sw, sh) * 0.12;
      return {
        corners: {
          topLeft:     { x: sx + margin, y: sy + margin },
          topRight:    { x: sx + sw - margin, y: sy + margin },
          bottomRight: { x: sx + sw - margin, y: sy + sh - margin },
          bottomLeft:  { x: sx + margin, y: sy + sh - margin },
        },
        confidence: 0.5,
        rotationOffset: 0,
      };
    }

    return {
      corners: {
        topLeft: ptTL,
        topRight: ptTR,
        bottomRight: ptBR,
        bottomLeft: ptBL,
      },
      confidence: Math.min(1.0, detectedPointsCount / 200),
      rotationOffset: 0,
    };
  }

  /**
   * Generates corner points from simulated canvas position for loopback testing
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
