/**
 * Vision Pipeline: Full Camera Frame Processing and Optical Decoding
 */

import { MATRIX_SIZE, TOTAL_CELLS, FrameType, ColorIndex, type DecodedFrame, type QuadCorners, type RGBColor, type Point2D } from '../protocol/types';
import { VisualFrameRenderer } from '../encoder/visual-frame';
import { MatrixMapper } from '../encoder/matrix';
import { FrameCodec } from '../protocol/frame';
import { Homography } from './homography';
import { CornerFinder } from './corner-finder';
import { MatrixSampler } from './sampler';
import { ColorCalibrator } from '../calibration/color-calib';
import { debugLogger } from '../debug/debug-logger';

export interface PipelineResult {
  state: 'SEARCHING' | 'FOUND' | 'CALIBRATING' | 'RECEIVING';
  corners: QuadCorners | null;
  matrixCorners: QuadCorners | null;
  homography: Homography | null;
  decodedFrame: DecodedFrame | null;
  cellColors: RGBColor[] | null;
  gridSymbols: Uint8Array | null;
  averageConfidence: number;
  averageDistance: number;
}

export interface PipelineTrace {
  imageStats: {
    width: number;
    height: number;
    minLuma: number;
    maxLuma: number;
    avgLuma: number;
  };
  searchBounds: { x: number; y: number; width: number; height: number };
  cornersDetected: boolean;
  corners: QuadCorners | null;
  matrixCorners: QuadCorners | null;
  homographySuccess: boolean;
  colorCounts: { black: number; red: number; green: number; blue: number };
  dynamicBlackLuma: number;
  isCalibrated: boolean;
  rotations: {
    rotationDeg: number;
    magicHex: string;
    magicMatch: boolean;
    rsErrors: number;
    crcMatch: boolean;
    storedCrcHex: string;
    calcCrcHex: string;
    summary: string;
  }[];
  decoded: boolean;
  verdict: string;
}

export class VisionPipeline {
  private calibrator: ColorCalibrator;
  private currentOrientation = 0; // 0, 1, 2, 3 (0°, 90°, 180°, 270°)
  private lastKnownCorners: QuadCorners | null = null;
  private consecutiveLocks = 0;
  private lastReportedState: string = 'SEARCHING';
  private frameCount = 0;
  private lastUndecodedWarning = 0;

  constructor(calibrator: ColorCalibrator) {
    this.calibrator = calibrator;
  }

  public getLastKnownCorners(): QuadCorners | null {
    return this.lastKnownCorners;
  }

  /**
   * Processes a video frame ImageData, detects markers, warps, samples, and decodes
   */
  public processFrame(
    imgData: ImageData,
    overrideCorners?: QuadCorners | null,
    searchBounds?: { x: number; y: number; width: number; height: number }
  ): PipelineResult {
    let corners: QuadCorners | null = overrideCorners || null;
    let matrixCorners: QuadCorners | null = null;

    if (!corners) {
      const det = CornerFinder.findCorners(imgData, searchBounds);
      if (det) {
        corners = det.corners;
        matrixCorners = det.matrixCorners;
      }
    } else {
      matrixCorners = CornerFinder.computeMatrixCorners(corners);
    }

    if (!corners) {
      return {
        state: 'SEARCHING',
        corners: null,
        matrixCorners: null,
        homography: null,
        decodedFrame: null,
        cellColors: null,
        gridSymbols: null,
        averageConfidence: 0,
        averageDistance: 0,
      };
    }

    // Normalized fiducials on transmitter canvas
    const fiducials = VisualFrameRenderer.getFiducialCenters();
    const srcPoints: Point2D[] = [
      fiducials.topLeft,
      fiducials.topRight,
      fiducials.bottomRight,
      fiducials.bottomLeft,
    ];

    const dstPoints: Point2D[] = [
      corners.topLeft,
      corners.topRight,
      corners.bottomRight,
      corners.bottomLeft,
    ];

    // Compute homography mapping from unit square canvas to camera frame
    const H = Homography.from4Points(srcPoints, dstPoints);
    if (!H) {
      return {
        state: 'SEARCHING',
        corners,
        matrixCorners,
        homography: null,
        decodedFrame: null,
        cellColors: null,
        gridSymbols: null,
        averageConfidence: 0,
        averageDistance: 0,
      };
    }

    // Sample 256 cells from camera
    const cellColors = MatrixSampler.sampleGrid(imgData, H);

    // Classify colors into symbols
    const gridSymbols = new Uint8Array(TOTAL_CELLS);
    let totalConfidence = 0;
    let totalDist = 0;

    for (let i = 0; i < TOTAL_CELLS; i++) {
      const c = cellColors[i];
      const res = this.calibrator.classify(c.r, c.g, c.b);
      gridSymbols[i] = res.color;
      totalConfidence += res.confidence;
      totalDist += res.distance;
    }

    const avgConfidence = totalConfidence / TOTAL_CELLS;
    const avgDistance = totalDist / TOTAL_CELLS;

    // Try decoding at current orientation and 3 rotations
    let decodedFrame: DecodedFrame | null = null;
    const testOrientations = [
      this.currentOrientation,
      (this.currentOrientation + 1) % 4,
      (this.currentOrientation + 2) % 4,
      (this.currentOrientation + 3) % 4,
    ];

    for (const rot of testOrientations) {
      const rotatedGrid = this.rotateGrid(gridSymbols, rot);
      const rawBytes = MatrixMapper.matrixToBytes(rotatedGrid);
      const frame = FrameCodec.decodeFrame(rawBytes);

      if (frame && frame.validCrc) {
        decodedFrame = frame;
        this.currentOrientation = rot;
        break;
      }
    }

    this.frameCount++;
    let state: PipelineResult['state'] = 'FOUND';

    if (decodedFrame) {
      this.consecutiveLocks++;
      if (decodedFrame.header.frameType === FrameType.CALIBRATION) {
        state = 'CALIBRATING';
        const patches = MatrixSampler.sampleCalibrationPatches(imgData, H);
        this.calibrator.updateCalibration(patches.black, patches.red, patches.green, patches.blue);
      } else {
        state = 'RECEIVING';
        if (cellColors && !this.calibrator.isCalibrated) {
          this.calibrator.autoCalibrateFromDecodedGrid(cellColors, gridSymbols);
        }
      }

      if (state !== this.lastReportedState) {
        debugLogger.success('RX', `Pipeline locked! State: [${state}] (Orientation: ${this.currentOrientation * 90}°, ECC: ${decodedFrame.correctedErrors} errs)`);
        this.lastReportedState = state;
      }
    } else {
      this.consecutiveLocks = Math.max(0, this.consecutiveLocks - 1);
      if (this.frameCount - this.lastUndecodedWarning >= 90) {
        this.lastUndecodedWarning = this.frameCount;
        const insp = FrameCodec.inspectFrame(MatrixMapper.matrixToBytes(gridSymbols));
        debugLogger.warn('CODEC', `Optical frame not decoded across 4 rotations. Rot 0: ${insp.summary}`);
      }
    }

    this.lastKnownCorners = corners;

    return {
      state,
      corners,
      matrixCorners,
      homography: H,
      decodedFrame,
      cellColors,
      gridSymbols,
      averageConfidence: avgConfidence,
      averageDistance: avgDistance,
    };
  }

  /**
   * Generates a comprehensive step-by-step diagnostic audit of a single frame
   */
  public traceFrame(
    imgData: ImageData,
    overrideCorners?: QuadCorners | null,
    searchBounds?: { x: number; y: number; width: number; height: number }
  ): PipelineTrace {
    const { width, height, data } = imgData;

    // 1. Calculate image stats
    let minLuma = 255;
    let maxLuma = 0;
    let sumLuma = 0;
    const sampleStep = Math.max(1, Math.floor((width * height) / 2000));
    let samplesCount = 0;

    for (let i = 0; i < data.length; i += 4 * sampleStep) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (l < minLuma) minLuma = l;
      if (l > maxLuma) maxLuma = l;
      sumLuma += l;
      samplesCount++;
    }

    const avgLuma = samplesCount > 0 ? Math.round(sumLuma / samplesCount) : 0;

    const squareDim = Math.round(Math.min(width, height) * 0.70);
    const defaultBounds = {
      x: Math.round((width - squareDim) / 2),
      y: Math.round((height - squareDim) / 2),
      width: squareDim,
      height: squareDim,
    };
    const bounds = searchBounds || defaultBounds;

    // 2. Corner detection
    let corners: QuadCorners | null = overrideCorners || null;
    let matrixCorners: QuadCorners | null = null;

    if (!corners) {
      const det = CornerFinder.findCorners(imgData, searchBounds);
      if (det) {
        corners = det.corners;
        matrixCorners = det.matrixCorners;
      }
    } else {
      matrixCorners = CornerFinder.computeMatrixCorners(corners);
    }

    if (!corners) {
      return {
        imageStats: { width, height, minLuma: Math.round(minLuma), maxLuma: Math.round(maxLuma), avgLuma },
        searchBounds: bounds,
        cornersDetected: false,
        corners: null,
        matrixCorners: null,
        homographySuccess: false,
        colorCounts: { black: 0, red: 0, green: 0, blue: 0 },
        dynamicBlackLuma: Math.round(this.calibrator.dynamicBlackLuma),
        isCalibrated: this.calibrator.isCalibrated,
        rotations: [],
        decoded: false,
        verdict: `Marker detection failed. Contrast in search area: ${Math.round(maxLuma - minLuma)} (avg luma: ${avgLuma}). Align sender screen closer inside the brackets.`,
      };
    }

    // 3. Homography
    const fiducials = VisualFrameRenderer.getFiducialCenters();
    const srcPoints: Point2D[] = [fiducials.topLeft, fiducials.topRight, fiducials.bottomRight, fiducials.bottomLeft];
    const dstPoints: Point2D[] = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
    const H = Homography.from4Points(srcPoints, dstPoints);

    if (!H) {
      return {
        imageStats: { width, height, minLuma: Math.round(minLuma), maxLuma: Math.round(maxLuma), avgLuma },
        searchBounds: bounds,
        cornersDetected: true,
        corners,
        matrixCorners,
        homographySuccess: false,
        colorCounts: { black: 0, red: 0, green: 0, blue: 0 },
        dynamicBlackLuma: Math.round(this.calibrator.dynamicBlackLuma),
        isCalibrated: this.calibrator.isCalibrated,
        rotations: [],
        decoded: false,
        verdict: `Homography perspective solver failed on 4 corner points. Corners may be collinear.`,
      };
    }

    // 4. Sample and classify
    const cellColors = MatrixSampler.sampleGrid(imgData, H);
    const gridSymbols = new Uint8Array(TOTAL_CELLS);
    const counts = { black: 0, red: 0, green: 0, blue: 0 };

    for (let i = 0; i < TOTAL_CELLS; i++) {
      const c = cellColors[i];
      const res = this.calibrator.classify(c.r, c.g, c.b);
      gridSymbols[i] = res.color;
      if (res.color === ColorIndex.BLACK) counts.black++;
      else if (res.color === ColorIndex.RED) counts.red++;
      else if (res.color === ColorIndex.GREEN) counts.green++;
      else if (res.color === ColorIndex.BLUE) counts.blue++;
    }

    // 5. Check 4 rotations
    const rotations: PipelineTrace['rotations'] = [];
    let decoded = false;
    let decodedRotation = -1;

    for (let rot = 0; rot < 4; rot++) {
      const rotatedGrid = this.rotateGrid(gridSymbols, rot);
      const rawBytes = MatrixMapper.matrixToBytes(rotatedGrid);
      const inspection = FrameCodec.inspectFrame(rawBytes);

      rotations.push({
        rotationDeg: rot * 90,
        magicHex: inspection.magicHex,
        magicMatch: inspection.magicMatch,
        rsErrors: inspection.rsCorrectedErrors,
        crcMatch: inspection.crcMatch,
        storedCrcHex: inspection.storedCrcHex,
        calcCrcHex: inspection.calcCrcHex,
        summary: inspection.summary,
      });

      if (inspection.isValid && !decoded) {
        decoded = true;
        decodedRotation = rot * 90;
      }
    }

    let verdict = '';
    if (decoded) {
      verdict = `SUCCESS: Optical frame decoded at rotation ${decodedRotation}°!`;
    } else {
      if (counts.black > 230) {
        verdict = `EXPOSURE TOO DARK: ${counts.black}/256 cells classified as Black. Increase sender screen brightness or decrease distance.`;
      } else if (counts.black < 10) {
        verdict = `EXPOSURE TOO BRIGHT / GLARE: Only ${counts.black} black cells found. Lower ambient room lighting or tilt away from reflections.`;
      } else if (rotations.some((r) => r.magicMatch && !r.crcMatch)) {
        verdict = `CRC ERROR: Frame header recognized ('LM') but payload corrupted. Hold phone steady or reduce transmitter FPS.`;
      } else {
        verdict = `ALIGNMENT: Protocol header 'LM' not detected in any rotation. Center sender screen squarely in reticle.`;
      }
    }

    return {
      imageStats: { width, height, minLuma: Math.round(minLuma), maxLuma: Math.round(maxLuma), avgLuma },
      searchBounds: bounds,
      cornersDetected: true,
      corners,
      matrixCorners,
      homographySuccess: true,
      colorCounts: counts,
      dynamicBlackLuma: Math.round(this.calibrator.dynamicBlackLuma),
      isCalibrated: this.calibrator.isCalibrated,
      rotations,
      decoded,
      verdict,
    };
  }

  /**
   * Rotates 16x16 grid clockwise by 90 * steps degrees
   */
  private rotateGrid(grid: Uint8Array, steps: number): Uint8Array {
    if (steps % 4 === 0) return grid;

    const out = new Uint8Array(TOTAL_CELLS);
    const n = MATRIX_SIZE;

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const srcIdx = r * n + c;
        let dstR = r;
        let dstC = c;

        if (steps === 1) {
          dstR = c;
          dstC = n - 1 - r;
        } else if (steps === 2) {
          dstR = n - 1 - r;
          dstC = n - 1 - c;
        } else if (steps === 3) {
          dstR = n - 1 - c;
          dstC = r;
        }

        out[dstR * n + dstC] = grid[srcIdx];
      }
    }

    return out;
  }
}
