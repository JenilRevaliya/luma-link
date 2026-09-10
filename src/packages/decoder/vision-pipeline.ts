/**
 * Vision Pipeline: Full Camera Frame Processing and Optical Decoding
 */

import { MATRIX_SIZE, TOTAL_CELLS, FrameType, type DecodedFrame, type QuadCorners, type RGBColor, type Point2D } from '../protocol/types';
import { VisualFrameRenderer } from '../encoder/visual-frame';
import { MatrixMapper } from '../encoder/matrix';
import { FrameCodec } from '../protocol/frame';
import { Homography } from './homography';
import { CornerFinder } from './corner-finder';
import { MatrixSampler } from './sampler';
import { ColorCalibrator } from '../calibration/color-calib';

export interface PipelineResult {
  state: 'SEARCHING' | 'FOUND' | 'CALIBRATING' | 'RECEIVING';
  corners: QuadCorners | null;
  homography: Homography | null;
  decodedFrame: DecodedFrame | null;
  cellColors: RGBColor[] | null;
  gridSymbols: Uint8Array | null;
  averageConfidence: number;
  averageDistance: number;
}

export class VisionPipeline {
  private calibrator: ColorCalibrator;
  private currentOrientation = 0; // 0, 1, 2, 3 (0°, 90°, 180°, 270°)
  private lastKnownCorners: QuadCorners | null = null;
  private consecutiveLocks = 0;

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
    overrideCorners?: QuadCorners | null
  ): PipelineResult {
    let corners: QuadCorners | null = overrideCorners || null;

    if (!corners) {
      const det = CornerFinder.findCorners(imgData);
      if (det) {
        corners = det.corners;
      }
    }

    if (!corners) {
      return {
        state: 'SEARCHING',
        corners: null,
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

    let state: PipelineResult['state'] = 'FOUND';

    if (decodedFrame) {
      this.consecutiveLocks++;
      if (decodedFrame.header.frameType === FrameType.CALIBRATION) {
        state = 'CALIBRATING';
        // Update calibration from patches
        const patches = MatrixSampler.sampleCalibrationPatches(imgData, H);
        this.calibrator.updateCalibration(patches.black, patches.red, patches.green, patches.blue);
      } else {
        state = 'RECEIVING';
      }
    } else {
      this.consecutiveLocks = Math.max(0, this.consecutiveLocks - 1);
    }

    this.lastKnownCorners = corners;

    return {
      state,
      corners,
      homography: H,
      decodedFrame,
      cellColors,
      gridSymbols,
      averageConfidence: avgConfidence,
      averageDistance: avgDistance,
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
          // 90 deg clockwise: (r, c) -> (c, n - 1 - r)
          dstR = c;
          dstC = n - 1 - r;
        } else if (steps === 2) {
          // 180 deg: (r, c) -> (n - 1 - r, n - 1 - c)
          dstR = n - 1 - r;
          dstC = n - 1 - c;
        } else if (steps === 3) {
          // 270 deg: (r, c) -> (n - 1 - c, r)
          dstR = n - 1 - c;
          dstC = r;
        }

        out[dstR * n + dstC] = grid[srcIdx];
      }
    }

    return out;
  }
}
