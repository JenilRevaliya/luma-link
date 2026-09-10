/**
 * Adaptive Color Calibration and Classification Engine
 * Classifies optical symbols based on measured camera channel centroids
 */

import {
  ColorIndex,
  DEFAULT_PALETTE,
  REFERENCE_WHITE,
  type ColorIndexValue,
  type RGBColor,
} from '../protocol/types';

export class ColorCalibrator {
  private centroids: Record<ColorIndexValue, RGBColor>;
  private whiteRef: RGBColor;
  public isCalibrated = false;
  public calibrationFramesCount = 0;

  constructor() {
    // Initialize with standard theoretical palette
    this.centroids = {
      [ColorIndex.BLACK]: { ...DEFAULT_PALETTE[ColorIndex.BLACK] },
      [ColorIndex.RED]:   { ...DEFAULT_PALETTE[ColorIndex.RED] },
      [ColorIndex.GREEN]: { ...DEFAULT_PALETTE[ColorIndex.GREEN] },
      [ColorIndex.BLUE]:  { ...DEFAULT_PALETTE[ColorIndex.BLUE] },
    };
    this.whiteRef = { ...REFERENCE_WHITE };
  }

  /**
   * Updates reference centroids using measured samples from a CALIBRATION frame
   */
  public updateCalibration(
    measuredBlack: RGBColor,
    measuredRed: RGBColor,
    measuredGreen: RGBColor,
    measuredBlue: RGBColor,
    measuredWhite?: RGBColor
  ): void {
    const alpha = this.isCalibrated ? 0.35 : 1.0; // Exponential moving average after initial lock

    this.centroids[ColorIndex.BLACK] = this.blend(this.centroids[ColorIndex.BLACK], measuredBlack, alpha);
    this.centroids[ColorIndex.RED]   = this.blend(this.centroids[ColorIndex.RED], measuredRed, alpha);
    this.centroids[ColorIndex.GREEN] = this.blend(this.centroids[ColorIndex.GREEN], measuredGreen, alpha);
    this.centroids[ColorIndex.BLUE]  = this.blend(this.centroids[ColorIndex.BLUE], measuredBlue, alpha);

    if (measuredWhite) {
      this.whiteRef = this.blend(this.whiteRef, measuredWhite, alpha);
    }

    this.isCalibrated = true;
    this.calibrationFramesCount++;
  }

  /**
   * Classifies a sampled RGB pixel to the nearest calibrated color symbol
   */
  public classify(r: number, g: number, b: number): { color: ColorIndexValue; distance: number; confidence: number } {
    let minDistance = Infinity;
    let secondMinDistance = Infinity;
    let bestColor: ColorIndexValue = ColorIndex.BLACK;

    const colors: ColorIndexValue[] = [
      ColorIndex.BLACK,
      ColorIndex.RED,
      ColorIndex.GREEN,
      ColorIndex.BLUE,
    ];

    for (const color of colors) {
      const centroid = this.centroids[color];
      // Weighted Euclidean distance giving perceptual balance
      // dr * 0.3, dg * 0.59, db * 0.11 or standard Euclidean with chromaticity bias
      const dr = r - centroid.r;
      const dg = g - centroid.g;
      const db = b - centroid.b;

      // Color distance with slight green-channel sensitivity normalization
      const dist = dr * dr * 1.0 + dg * dg * 1.2 + db * db * 0.9;

      if (dist < minDistance) {
        secondMinDistance = minDistance;
        minDistance = dist;
        bestColor = color;
      } else if (dist < secondMinDistance) {
        secondMinDistance = dist;
      }
    }

    // Confidence margin: difference between closest and second closest candidate
    const confidence = secondMinDistance > 0 ? (secondMinDistance - minDistance) / secondMinDistance : 1.0;

    return {
      color: bestColor,
      distance: Math.sqrt(minDistance),
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  }

  public getCentroids(): Record<ColorIndexValue, RGBColor> {
    return {
      [ColorIndex.BLACK]: { ...this.centroids[ColorIndex.BLACK] },
      [ColorIndex.RED]:   { ...this.centroids[ColorIndex.RED] },
      [ColorIndex.GREEN]: { ...this.centroids[ColorIndex.GREEN] },
      [ColorIndex.BLUE]:  { ...this.centroids[ColorIndex.BLUE] },
    };
  }

  public reset(): void {
    this.centroids = {
      [ColorIndex.BLACK]: { ...DEFAULT_PALETTE[ColorIndex.BLACK] },
      [ColorIndex.RED]:   { ...DEFAULT_PALETTE[ColorIndex.RED] },
      [ColorIndex.GREEN]: { ...DEFAULT_PALETTE[ColorIndex.GREEN] },
      [ColorIndex.BLUE]:  { ...DEFAULT_PALETTE[ColorIndex.BLUE] },
    };
    this.isCalibrated = false;
    this.calibrationFramesCount = 0;
  }

  private blend(oldColor: RGBColor, newColor: RGBColor, alpha: number): RGBColor {
    return {
      r: Math.round(oldColor.r * (1 - alpha) + newColor.r * alpha),
      g: Math.round(oldColor.g * (1 - alpha) + newColor.g * alpha),
      b: Math.round(oldColor.b * (1 - alpha) + newColor.b * alpha),
    };
  }
}
