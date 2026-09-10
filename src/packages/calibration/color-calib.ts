/**
 * Adaptive Color Calibration and Classification Engine
 * Combines channel dominance heuristics (for instant pre-calibration lock)
 * with Euclidean centroid tracking (for post-calibration precision)
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

  // Dynamic black threshold adapted from camera frames
  public dynamicBlackLuma = 70;

  constructor() {
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
    const alpha = this.isCalibrated ? 0.35 : 0.85;

    this.centroids[ColorIndex.BLACK] = this.blend(this.centroids[ColorIndex.BLACK], measuredBlack, alpha);
    this.centroids[ColorIndex.RED]   = this.blend(this.centroids[ColorIndex.RED], measuredRed, alpha);
    this.centroids[ColorIndex.GREEN] = this.blend(this.centroids[ColorIndex.GREEN], measuredGreen, alpha);
    this.centroids[ColorIndex.BLUE]  = this.blend(this.centroids[ColorIndex.BLUE], measuredBlue, alpha);

    if (measuredWhite) {
      this.whiteRef = this.blend(this.whiteRef, measuredWhite, alpha);
    }

    // Dynamic black threshold: halfway between measured black and the minimum color luminance
    const blackLuma = 0.299 * this.centroids[ColorIndex.BLACK].r +
                      0.587 * this.centroids[ColorIndex.BLACK].g +
                      0.114 * this.centroids[ColorIndex.BLACK].b;

    const redLuma = 0.299 * this.centroids[ColorIndex.RED].r +
                    0.587 * this.centroids[ColorIndex.RED].g +
                    0.114 * this.centroids[ColorIndex.RED].b;

    const blueLuma = 0.299 * this.centroids[ColorIndex.BLUE].r +
                     0.587 * this.centroids[ColorIndex.BLUE].g +
                     0.114 * this.centroids[ColorIndex.BLUE].b;

    const minColorLuma = Math.min(redLuma, blueLuma);
    this.dynamicBlackLuma = Math.max(35, Math.min(100, (blackLuma + minColorLuma) * 0.5));

    this.isCalibrated = true;
    this.calibrationFramesCount++;
  }

  /**
   * Auto-calibrates color centroids directly from a successfully decoded grid of cells
   */
  public autoCalibrateFromDecodedGrid(cellColors: RGBColor[], symbols: Uint8Array): void {
    const sums: Record<number, { r: number; g: number; b: number; count: number }> = {
      [ColorIndex.BLACK]: { r: 0, g: 0, b: 0, count: 0 },
      [ColorIndex.RED]:   { r: 0, g: 0, b: 0, count: 0 },
      [ColorIndex.GREEN]: { r: 0, g: 0, b: 0, count: 0 },
      [ColorIndex.BLUE]:  { r: 0, g: 0, b: 0, count: 0 },
    };

    const len = Math.min(cellColors.length, symbols.length);
    for (let i = 0; i < len; i++) {
      const sym = symbols[i];
      if (sums[sym]) {
        sums[sym].r += cellColors[i].r;
        sums[sym].g += cellColors[i].g;
        sums[sym].b += cellColors[i].b;
        sums[sym].count++;
      }
    }

    // Require at least 4 samples of each color to calibrate
    if (
      sums[ColorIndex.BLACK].count >= 4 &&
      sums[ColorIndex.RED].count >= 4 &&
      sums[ColorIndex.GREEN].count >= 4 &&
      sums[ColorIndex.BLUE].count >= 4
    ) {
      const measuredBlack: RGBColor = {
        r: Math.round(sums[ColorIndex.BLACK].r / sums[ColorIndex.BLACK].count),
        g: Math.round(sums[ColorIndex.BLACK].g / sums[ColorIndex.BLACK].count),
        b: Math.round(sums[ColorIndex.BLACK].b / sums[ColorIndex.BLACK].count),
      };
      const measuredRed: RGBColor = {
        r: Math.round(sums[ColorIndex.RED].r / sums[ColorIndex.RED].count),
        g: Math.round(sums[ColorIndex.RED].g / sums[ColorIndex.RED].count),
        b: Math.round(sums[ColorIndex.RED].b / sums[ColorIndex.RED].count),
      };
      const measuredGreen: RGBColor = {
        r: Math.round(sums[ColorIndex.GREEN].r / sums[ColorIndex.GREEN].count),
        g: Math.round(sums[ColorIndex.GREEN].g / sums[ColorIndex.GREEN].count),
        b: Math.round(sums[ColorIndex.GREEN].b / sums[ColorIndex.GREEN].count),
      };
      const measuredBlue: RGBColor = {
        r: Math.round(sums[ColorIndex.BLUE].r / sums[ColorIndex.BLUE].count),
        g: Math.round(sums[ColorIndex.BLUE].g / sums[ColorIndex.BLUE].count),
        b: Math.round(sums[ColorIndex.BLUE].b / sums[ColorIndex.BLUE].count),
      };

      this.updateCalibration(measuredBlack, measuredRed, measuredGreen, measuredBlue);
    }
  }

  /**
   * Classifies a sampled RGB pixel to the nearest color symbol
   */
  public classify(r: number, g: number, b: number): { color: ColorIndexValue; distance: number; confidence: number } {
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;

    // 1. Channel Dominance for Chromatic Cells (Red, Green, Blue)
    // When photographed from displays, Red and Blue have low BT.601 luminance coefficients,
    // so checking dominance first prevents dark red/blue cells from being misclassified as black!
    const rDelta = r - Math.max(g, b);
    const gDelta = g - Math.max(r, b);
    const bDelta = b - Math.max(r, g);

    if (rDelta > 16 && r > 38 && r > g * 1.12 && r > b * 1.12) {
      return {
        color: ColorIndex.RED,
        distance: Math.abs(255 - r) + g + b,
        confidence: Math.min(1.0, Math.max(0.6, rDelta / 60)),
      };
    }

    if (gDelta > 16 && g > 38 && g > r * 1.12 && g > b * 1.12) {
      return {
        color: ColorIndex.GREEN,
        distance: r + Math.abs(255 - g) + b,
        confidence: Math.min(1.0, Math.max(0.6, gDelta / 60)),
      };
    }

    if (bDelta > 14 && b > 38 && b > r * 1.10 && b > g * 1.10) {
      return {
        color: ColorIndex.BLUE,
        distance: r + g + Math.abs(255 - b),
        confidence: Math.min(1.0, Math.max(0.6, bDelta / 60)),
      };
    }

    // 2. Black Detection:
    // Achromatic cells where all channels are low or desaturated
    const isDark = maxChannel < Math.max(65, this.dynamicBlackLuma) || luma < this.dynamicBlackLuma;
    const isDesaturatedDark = maxChannel < 95 && saturation < 0.22;

    if (isDark || isDesaturatedDark) {
      const dist = Math.hypot(
        r - this.centroids[ColorIndex.BLACK].r,
        g - this.centroids[ColorIndex.BLACK].g,
        b - this.centroids[ColorIndex.BLACK].b
      );
      return {
        color: ColorIndex.BLACK,
        distance: dist,
        confidence: Math.max(0.6, 1.0 - (maxChannel / 120)),
      };
    }

    // 3. Fallback to Nearest Centroid Distance Metric
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
      const c = this.centroids[color];
      const dr = r - c.r;
      const dg = g - c.g;
      const db = b - c.b;
      const dist = dr * dr + dg * dg * 1.1 + db * db;

      if (dist < minDistance) {
        secondMinDistance = minDistance;
        minDistance = dist;
        bestColor = color;
      } else if (dist < secondMinDistance) {
        secondMinDistance = dist;
      }
    }

    const confidence = secondMinDistance > 0 ? (secondMinDistance - minDistance) / secondMinDistance : 0.8;

    return {
      color: bestColor,
      distance: Math.sqrt(minDistance),
      confidence: Math.max(0.4, Math.min(1.0, confidence)),
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
    this.dynamicBlackLuma = 70;
  }

  private blend(oldColor: RGBColor, newColor: RGBColor, alpha: number): RGBColor {
    return {
      r: Math.round(oldColor.r * (1 - alpha) + newColor.r * alpha),
      g: Math.round(oldColor.g * (1 - alpha) + newColor.g * alpha),
      b: Math.round(oldColor.b * (1 - alpha) + newColor.b * alpha),
    };
  }
}
