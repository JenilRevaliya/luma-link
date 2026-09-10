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

  it('classifies low-luma saturated red and blue as chromatic, not black', () => {
    const calibrator = new ColorCalibrator();
    // Moderately lit red on an LCD (luma ~45, below old dynamicBlackLuma of 70)
    const redCell = calibrator.classify(115, 20, 25);
    expect(redCell.color).toBe(ColorIndex.RED);

    // Moderately lit blue on an LCD (luma ~42, below old dynamicBlackLuma of 70)
    const blueCell = calibrator.classify(25, 30, 140);
    expect(blueCell.color).toBe(ColorIndex.BLUE);

    // True black LCD cell with backlight bleed
    const blackCell = calibrator.classify(30, 32, 35);
    expect(blackCell.color).toBe(ColorIndex.BLACK);
  });

  it('classifies cells under extreme specular glare and over-exposure correctly', () => {
    const calibrator = new ColorCalibrator();

    // Washed-out Black under harsh specular ceiling reflection (luma ~135, high brightness but achromatic)
    const glareBlack = calibrator.classify(134, 137, 135);
    expect(glareBlack.color).toBe(ColorIndex.BLACK);

    // Over-exposed clipped Green (camera sensor saturation at 255 with channel leakage)
    const overexposedGreen = calibrator.classify(180, 255, 180);
    expect(overexposedGreen.color).toBe(ColorIndex.GREEN);

    // Over-exposed clipped Red under sunlight
    const overexposedRed = calibrator.classify(255, 175, 175);
    expect(overexposedRed.color).toBe(ColorIndex.RED);

    // Over-exposed clipped Blue
    const overexposedBlue = calibrator.classify(170, 170, 255);
    expect(overexposedBlue.color).toBe(ColorIndex.BLUE);
  });

  it('returns null on noise image with no fiducials', () => {
    const width = 400;
    const height = 400;
    const buffer = new Uint8ClampedArray(width * height * 4);
    // Fill with moderate gray noise
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 80;
      buffer[i + 1] = 80;
      buffer[i + 2] = 80;
      buffer[i + 3] = 255;
    }
    const imgData = { width, height, data: buffer } as ImageData;
    const result = CornerFinder.findCorners(imgData);
    expect(result).toBeNull();
  });

  it('detects 4 QR 1:1:3:1:1 square finder patterns with sub-pixel accuracy', () => {
    CornerFinder.reset();
    const width = 600;
    const height = 600;
    const buffer = new Uint8ClampedArray(width * height * 4);

    // Dark background (#0a0a0f)
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 10;
      buffer[i + 1] = 10;
      buffer[i + 2] = 15;
      buffer[i + 3] = 255;
    }

    // Helper to draw 7x7 nested square finder pattern (M = 8px)
    const drawFiducial = (cx: number, cy: number, isTL: boolean) => {
      const M = 8;
      const halfW = 3.5 * M; // 28
      // 1. Outer 7x7 White box
      for (let y = cy - halfW; y < cy + halfW; y++) {
        for (let x = cx - halfW; x < cx + halfW; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            buffer[idx] = 255;
            buffer[idx + 1] = 255;
            buffer[idx + 2] = 255;
          }
        }
      }
      // 2. Inner 5x5 Dark box
      const halfDark = 2.5 * M; // 20
      for (let y = cy - halfDark; y < cy + halfDark; y++) {
        for (let x = cx - halfDark; x < cx + halfDark; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            buffer[idx] = 10;
            buffer[idx + 1] = 10;
            buffer[idx + 2] = 15;
          }
        }
      }
      // 3. Core 3x3 box
      const halfCore = 1.5 * M; // 12
      for (let y = cy - halfCore; y < cy + halfCore; y++) {
        for (let x = cx - halfCore; x < cx + halfCore; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            if (isTL) {
              buffer[idx] = 0;
              buffer[idx + 1] = 240;
              buffer[idx + 2] = 255; // Cyan
            } else {
              buffer[idx] = 255;
              buffer[idx + 1] = 255;
              buffer[idx + 2] = 255; // White
            }
          }
        }
      }
    };

    // Draw fiducials at inset 0.09 (54, 546)
    const inset = 0.09;
    const tl = { x: Math.round(width * inset), y: Math.round(height * inset) };
    const tr = { x: Math.round(width * (1 - inset)), y: Math.round(height * inset) };
    const br = { x: Math.round(width * (1 - inset)), y: Math.round(height * (1 - inset)) };
    const bl = { x: Math.round(width * inset), y: Math.round(height * (1 - inset)) };

    drawFiducial(tl.x, tl.y, true);
    drawFiducial(tr.x, tr.y, false);
    drawFiducial(br.x, br.y, false);
    drawFiducial(bl.x, bl.y, false);

    const imgData = { width, height, data: buffer } as ImageData;
    const res = CornerFinder.findCorners(imgData);

    expect(res).not.toBeNull();
    expect(res!.confidence).toBeGreaterThan(0.85);
    expect(res!.isDirectLock).toBe(true);

    // Verify corners match within 3px of true fiducial centers
    expect(Math.abs(res!.corners.topLeft.x - tl.x)).toBeLessThan(4);
    expect(Math.abs(res!.corners.topLeft.y - tl.y)).toBeLessThan(4);
    expect(Math.abs(res!.corners.topRight.x - tr.x)).toBeLessThan(4);
    expect(Math.abs(res!.corners.topRight.y - tr.y)).toBeLessThan(4);
    expect(Math.abs(res!.corners.bottomRight.x - br.x)).toBeLessThan(4);
    expect(Math.abs(res!.corners.bottomRight.y - br.y)).toBeLessThan(4);
    expect(Math.abs(res!.corners.bottomLeft.x - bl.x)).toBeLessThan(4);
    expect(Math.abs(res!.corners.bottomLeft.y - bl.y)).toBeLessThan(4);
  });

  it('extrapolates missing 4th corner via affine reconstruction when one corner is blinded', () => {
    CornerFinder.reset();
    const width = 600;
    const height = 600;
    const buffer = new Uint8ClampedArray(width * height * 4);

    // Dark background (#0a0a0f)
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 10;
      buffer[i + 1] = 10;
      buffer[i + 2] = 15;
      buffer[i + 3] = 255;
    }

    const drawFiducial = (cx: number, cy: number, isTL: boolean) => {
      const M = 8;
      const halfW = 3.5 * M;
      for (let y = cy - halfW; y < cy + halfW; y++) {
        for (let x = cx - halfW; x < cx + halfW; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            buffer[idx] = 255; buffer[idx + 1] = 255; buffer[idx + 2] = 255;
          }
        }
      }
      const halfDark = 2.5 * M;
      for (let y = cy - halfDark; y < cy + halfDark; y++) {
        for (let x = cx - halfDark; x < cx + halfDark; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            buffer[idx] = 10; buffer[idx + 1] = 10; buffer[idx + 2] = 15;
          }
        }
      }
      const halfCore = 1.5 * M;
      for (let y = cy - halfCore; y < cy + halfCore; y++) {
        for (let x = cx - halfCore; x < cx + halfCore; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            if (isTL) {
              buffer[idx] = 0; buffer[idx + 1] = 240; buffer[idx + 2] = 255;
            } else {
              buffer[idx] = 255; buffer[idx + 1] = 255; buffer[idx + 2] = 255;
            }
          }
        }
      }
    };

    const inset = 0.09;
    const tl = { x: Math.round(width * inset), y: Math.round(height * inset) };
    const tr = { x: Math.round(width * (1 - inset)), y: Math.round(height * inset) };
    const br = { x: Math.round(width * (1 - inset)), y: Math.round(height * (1 - inset)) };
    const bl = { x: Math.round(width * inset), y: Math.round(height * (1 - inset)) };

    // Only draw TL, TR, BL (BR is missing / blinded by glare)
    drawFiducial(tl.x, tl.y, true);
    drawFiducial(tr.x, tr.y, false);
    drawFiducial(bl.x, bl.y, false);

    const imgData = { width, height, data: buffer } as ImageData;
    const res = CornerFinder.findCorners(imgData);

    expect(res).not.toBeNull();
    // Reconstructed BR should be close to true BR
    expect(Math.abs(res!.corners.bottomRight.x - br.x)).toBeLessThan(6);
    expect(Math.abs(res!.corners.bottomRight.y - br.y)).toBeLessThan(6);
  });

  it('maintains lock across consecutive blurred frames via temporal hysteresis', () => {
    CornerFinder.reset();
    const width = 600;
    const height = 600;
    const clearBuffer = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < clearBuffer.length; i += 4) {
      clearBuffer[i] = 10; clearBuffer[i + 1] = 10; clearBuffer[i + 2] = 15; clearBuffer[i + 3] = 255;
    }

    const drawFiducial = (cx: number, cy: number, isTL: boolean) => {
      const M = 8;
      const halfW = 3.5 * M;
      for (let y = cy - halfW; y < cy + halfW; y++) {
        for (let x = cx - halfW; x < cx + halfW; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            clearBuffer[idx] = 255; clearBuffer[idx + 1] = 255; clearBuffer[idx + 2] = 255;
          }
        }
      }
      const halfDark = 2.5 * M;
      for (let y = cy - halfDark; y < cy + halfDark; y++) {
        for (let x = cx - halfDark; x < cx + halfDark; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            clearBuffer[idx] = 10; clearBuffer[idx + 1] = 10; clearBuffer[idx + 2] = 15;
          }
        }
      }
      const halfCore = 1.5 * M;
      for (let y = cy - halfCore; y < cy + halfCore; y++) {
        for (let x = cx - halfCore; x < cx + halfCore; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            if (isTL) {
              clearBuffer[idx] = 0; clearBuffer[idx + 1] = 240; clearBuffer[idx + 2] = 255;
            } else {
              clearBuffer[idx] = 255; clearBuffer[idx + 1] = 255; clearBuffer[idx + 2] = 255;
            }
          }
        }
      }
    };

    const inset = 0.09;
    drawFiducial(Math.round(width * inset), Math.round(height * inset), true);
    drawFiducial(Math.round(width * (1 - inset)), Math.round(height * inset), false);
    drawFiducial(Math.round(width * (1 - inset)), Math.round(height * (1 - inset)), false);
    drawFiducial(Math.round(width * inset), Math.round(height * (1 - inset)), false);

    const goodImg = { width, height, data: clearBuffer } as ImageData;
    // Step 1: establish lock
    const lockRes = CornerFinder.findCorners(goodImg);
    expect(lockRes).not.toBeNull();
    expect(lockRes!.isDirectLock).toBe(true);

    // Step 2: Feed completely empty/black frames (simulating motion blur)
    const blurBuffer = new Uint8ClampedArray(width * height * 4); // All zeros
    const blurImg = { width, height, data: blurBuffer } as ImageData;

    // Frames 1..10 should retain lock without dropping to null!
    for (let f = 0; f < 10; f++) {
      const blurredRes = CornerFinder.findCorners(blurImg);
      expect(blurredRes).not.toBeNull();
      expect(blurredRes!.confidence).toBeGreaterThan(0.75);
      expect(blurredRes!.isDirectLock).toBe(false);
    }
  });

  it('detects corners in a realistic 720x1280 mobile portrait camera view with background clutter and reticle bounds', () => {
    CornerFinder.reset();
    const width = 720;
    const height = 1280;
    const buffer = new Uint8ClampedArray(width * height * 4);

    // Fill with ambient room clutter (desk & wall luma ~60..120)
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 75;
      buffer[i + 1] = 80;
      buffer[i + 2] = 85;
      buffer[i + 3] = 255;
    }

    // Centered transmitter screen (400x400) inside camera view
    const screenX = 160;
    const screenY = 440;
    const screenDim = 400;

    // Dark screen background (#0a0a0f)
    for (let y = screenY; y < screenY + screenDim; y++) {
      for (let x = screenX; x < screenX + screenDim; x++) {
        const idx = (y * width + x) * 4;
        buffer[idx] = 10;
        buffer[idx + 1] = 10;
        buffer[idx + 2] = 15;
      }
    }

    const drawFiducial = (cx: number, cy: number, isTL: boolean) => {
      const M = 6;
      const halfW = 3.5 * M; // 21
      for (let y = cy - halfW; y < cy + halfW; y++) {
        for (let x = cx - halfW; x < cx + halfW; x++) {
          const idx = (y * width + x) * 4;
          buffer[idx] = 255; buffer[idx + 1] = 255; buffer[idx + 2] = 255;
        }
      }
      const halfDark = 2.5 * M; // 15
      for (let y = cy - halfDark; y < cy + halfDark; y++) {
        for (let x = cx - halfDark; x < cx + halfDark; x++) {
          const idx = (y * width + x) * 4;
          buffer[idx] = 10; buffer[idx + 1] = 10; buffer[idx + 2] = 15;
        }
      }
      const halfCore = 1.5 * M; // 9
      for (let y = cy - halfCore; y < cy + halfCore; y++) {
        for (let x = cx - halfCore; x < cx + halfCore; x++) {
          const idx = (y * width + x) * 4;
          if (isTL) {
            buffer[idx] = 0; buffer[idx + 1] = 240; buffer[idx + 2] = 255;
          } else {
            buffer[idx] = 255; buffer[idx + 1] = 255; buffer[idx + 2] = 255;
          }
        }
      }
    };

    const inset = 0.09;
    const tl = { x: Math.round(screenX + screenDim * inset), y: Math.round(screenY + screenDim * inset) };
    const tr = { x: Math.round(screenX + screenDim * (1 - inset)), y: Math.round(screenY + screenDim * inset) };
    const br = { x: Math.round(screenX + screenDim * (1 - inset)), y: Math.round(screenY + screenDim * (1 - inset)) };
    const bl = { x: Math.round(screenX + screenDim * inset), y: Math.round(screenY + screenDim * (1 - inset)) };

    drawFiducial(tl.x, tl.y, true);
    drawFiducial(tr.x, tr.y, false);
    drawFiducial(br.x, br.y, false);
    drawFiducial(bl.x, bl.y, false);

    // Reticle search bounds around the screen with margins
    const searchBounds = {
      x: screenX - 20,
      y: screenY - 20,
      width: screenDim + 40,
      height: screenDim + 40,
    };

    const imgData = { width, height, data: buffer } as ImageData;
    const res = CornerFinder.findCorners(imgData, searchBounds);

    expect(res).not.toBeNull();
    expect(res!.confidence).toBeGreaterThan(0.85);

    expect(Math.abs(res!.corners.topLeft.x - tl.x)).toBeLessThan(5);
    expect(Math.abs(res!.corners.topLeft.y - tl.y)).toBeLessThan(5);
    expect(Math.abs(res!.corners.topRight.x - tr.x)).toBeLessThan(5);
    expect(Math.abs(res!.corners.topRight.y - tr.y)).toBeLessThan(5);
    expect(Math.abs(res!.corners.bottomRight.x - br.x)).toBeLessThan(5);
    expect(Math.abs(res!.corners.bottomRight.y - br.y)).toBeLessThan(5);
    expect(Math.abs(res!.corners.bottomLeft.x - bl.x)).toBeLessThan(5);
    expect(Math.abs(res!.corners.bottomLeft.y - bl.y)).toBeLessThan(5);
  });
});
