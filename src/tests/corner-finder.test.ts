import { describe, it, expect } from 'vitest';
import { CornerFinder } from '../packages/decoder/corner-finder';
import { ColorCalibrator } from '../packages/calibration/color-calib';
import { ColorIndex, type RGBColor } from '../packages/protocol/types';

describe('CornerFinder & Optical Calibration', () => {
  it('computes matrix boundary tighter than outer fiducials', () => {
    const fiducialCorners = {
      topLeft: { x: 90, y: 90 },
      topRight: { x: 910, y: 90 },
      bottomRight: { x: 910, y: 910 },
      bottomLeft: { x: 90, y: 910 },
    };

    const matrixCorners = CornerFinder.computeMatrixCorners(fiducialCorners);

    // Matrix corners should be inside the fiducials (inset 0.20 vs 0.09)
    expect(matrixCorners.topLeft.x).toBeGreaterThan(fiducialCorners.topLeft.x);
    expect(matrixCorners.topLeft.y).toBeGreaterThan(fiducialCorners.topLeft.y);
    expect(matrixCorners.bottomRight.x).toBeLessThan(fiducialCorners.bottomRight.x);
    expect(matrixCorners.bottomRight.y).toBeLessThan(fiducialCorners.bottomRight.y);

    // Bounding width should match matrix fraction
    const fiducialSpan = fiducialCorners.topRight.x - fiducialCorners.topLeft.x;
    const matrixSpan = matrixCorners.topRight.x - matrixCorners.topLeft.x;
    expect(matrixSpan / fiducialSpan).toBeCloseTo(0.60 / 0.82, 2);
  });

  it('autoCalibrateFromDecodedGrid updates calibration status and centroids', () => {
    const calibrator = new ColorCalibrator();
    expect(calibrator.isCalibrated).toBe(false);

    // 16 cells with simulated captured camera colors (shifted gamut)
    const cellColors: RGBColor[] = [
      { r: 45, g: 48, b: 55 }, // black
      { r: 40, g: 42, b: 50 },
      { r: 42, g: 45, b: 52 },
      { r: 44, g: 46, b: 54 },

      { r: 230, g: 30, b: 35 }, // red
      { r: 220, g: 28, b: 32 },
      { r: 235, g: 32, b: 38 },
      { r: 225, g: 29, b: 34 },

      { r: 25, g: 215, b: 40 }, // green
      { r: 28, g: 220, b: 42 },
      { r: 24, g: 210, b: 38 },
      { r: 26, g: 218, b: 41 },

      { r: 30, g: 35, b: 235 }, // blue
      { r: 32, g: 38, b: 240 },
      { r: 28, g: 34, b: 230 },
      { r: 31, g: 36, b: 238 },
    ];

    const symbols = new Uint8Array([
      ColorIndex.BLACK, ColorIndex.BLACK, ColorIndex.BLACK, ColorIndex.BLACK,
      ColorIndex.RED, ColorIndex.RED, ColorIndex.RED, ColorIndex.RED,
      ColorIndex.GREEN, ColorIndex.GREEN, ColorIndex.GREEN, ColorIndex.GREEN,
      ColorIndex.BLUE, ColorIndex.BLUE, ColorIndex.BLUE, ColorIndex.BLUE,
    ]);

    calibrator.autoCalibrateFromDecodedGrid(cellColors, symbols);

    expect(calibrator.isCalibrated).toBe(true);
    expect(calibrator.calibrationFramesCount).toBe(1);

    // Now classify with the adapted calibrator
    const blackClass = calibrator.classify(43, 45, 52);
    expect(blackClass.color).toBe(ColorIndex.BLACK);

    const redClass = calibrator.classify(228, 31, 35);
    expect(redClass.color).toBe(ColorIndex.RED);
  });
});
