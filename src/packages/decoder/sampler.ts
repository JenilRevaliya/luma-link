/**
 * Sub-Pixel Center-Kernel Color Sampler
 * Samples the optical matrix cells avoiding edge bleeding and chromatic aberration
 */

import { MATRIX_SIZE, TOTAL_CELLS, type RGBColor } from '../protocol/types';
import { VisualFrameRenderer } from '../encoder/visual-frame';
import { Homography } from './homography';

export class MatrixSampler {
  /**
   * Samples all 256 cells from camera ImageData using the Homography transform
   */
  public static sampleGrid(
    imgData: ImageData,
    homography: Homography
  ): RGBColor[] {
    const { width, height, data } = imgData;
    const colors: RGBColor[] = new Array(TOTAL_CELLS);

    const matrixInset = VisualFrameRenderer.MATRIX_INSET;
    const matrixFrac = VisualFrameRenderer.MATRIX_SIZE_FRAC;
    const cellSize = matrixFrac / MATRIX_SIZE;

    for (let r = 0; r < MATRIX_SIZE; r++) {
      for (let c = 0; c < MATRIX_SIZE; c++) {
        const idx = r * MATRIX_SIZE + c;

        // Normalized [0, 1] coordinates of cell center
        const u = matrixInset + (c + 0.5) * cellSize;
        const v = matrixInset + (r + 0.5) * cellSize;

        // Map to camera coordinates
        const pt = homography.transform(u, v);

        // Sample 3x3 kernel around the mapped center
        const rgb = MatrixSampler.sampleKernel(data, width, height, pt.x, pt.y);
        colors[idx] = rgb;
      }
    }

    return colors;
  }

  /**
   * Samples calibration quadrant regions to measure channel centroids
   */
  public static sampleCalibrationPatches(
    imgData: ImageData,
    homography: Homography
  ): { black: RGBColor; red: RGBColor; green: RGBColor; blue: RGBColor } {
    const { width, height, data } = imgData;

    // 4 Quadrants: Top-Left (Black), Top-Right (Red), Bottom-Left (Green), Bottom-Right (Blue)
    const qTL = homography.transform(0.35, 0.35);
    const qTR = homography.transform(0.65, 0.35);
    const qBL = homography.transform(0.35, 0.65);
    const qBR = homography.transform(0.65, 0.65);

    return {
      black: MatrixSampler.sampleKernel(data, width, height, qTL.x, qTL.y, 5),
      red:   MatrixSampler.sampleKernel(data, width, height, qTR.x, qTR.y, 5),
      green: MatrixSampler.sampleKernel(data, width, height, qBL.x, qBL.y, 5),
      blue:  MatrixSampler.sampleKernel(data, width, height, qBR.x, qBR.y, 5),
    };
  }

  /**
   * Samples a small NxN kernel around (cx, cy)
   */
  private static sampleKernel(
    data: Uint8ClampedArray,
    imgWidth: number,
    imgHeight: number,
    cx: number,
    cy: number,
    kernelRadius = 2
  ): RGBColor {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;

    const pxCenter = Math.round(cx);
    const pyCenter = Math.round(cy);

    for (let dy = -kernelRadius; dy <= kernelRadius; dy++) {
      for (let dx = -kernelRadius; dx <= kernelRadius; dx++) {
        const x = pxCenter + dx;
        const y = pyCenter + dy;

        if (x >= 0 && x < imgWidth && y >= 0 && y < imgHeight) {
          const idx = (y * imgWidth + x) * 4;
          sumR += data[idx];
          sumG += data[idx + 1];
          sumB += data[idx + 2];
          count++;
        }
      }
    }

    if (count === 0) return { r: 0, g: 0, b: 0 };
    return {
      r: Math.round(sumR / count),
      g: Math.round(sumG / count),
      b: Math.round(sumB / count),
    };
  }
}
