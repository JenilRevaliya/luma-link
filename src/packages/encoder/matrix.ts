/**
 * Matrix Symbol Mapper: converts 64-byte frame buffers to/from 16x16 color symbol grids
 */

import {
  MATRIX_SIZE,
  TOTAL_CELLS,
  TOTAL_FRAME_BYTES,
} from '../protocol/types';

export class MatrixMapper {
  /**
   * Converts 64-byte buffer into 256 cell color indices (16x16)
   */
  public static bytesToMatrix(bytes: Uint8Array): Uint8Array {
    if (bytes.length !== TOTAL_FRAME_BYTES) {
      throw new Error(`Invalid frame buffer length ${bytes.length}, expected ${TOTAL_FRAME_BYTES}`);
    }

    const grid = new Uint8Array(TOTAL_CELLS);
    let cellIdx = 0;

    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      grid[cellIdx++] = (b >> 6) & 0x03;
      grid[cellIdx++] = (b >> 4) & 0x03;
      grid[cellIdx++] = (b >> 2) & 0x03;
      grid[cellIdx++] = b & 0x03;
    }

    return grid;
  }

  /**
   * Converts 256 cell color indices back into 64-byte buffer
   */
  public static matrixToBytes(grid: Uint8Array | number[]): Uint8Array {
    if (grid.length !== TOTAL_CELLS) {
      throw new Error(`Invalid grid length ${grid.length}, expected ${TOTAL_CELLS}`);
    }

    const bytes = new Uint8Array(TOTAL_FRAME_BYTES);
    let cellIdx = 0;

    for (let i = 0; i < TOTAL_FRAME_BYTES; i++) {
      const c0 = grid[cellIdx++] & 0x03;
      const c1 = grid[cellIdx++] & 0x03;
      const c2 = grid[cellIdx++] & 0x03;
      const c3 = grid[cellIdx++] & 0x03;
      bytes[i] = (c0 << 6) | (c1 << 4) | (c2 << 2) | c3;
    }

    return bytes;
  }

  /**
   * Generates a calibrated test pattern for CALIBRATION frame
   * Transmits pure reference regions for Black, Red, Green, Blue, and White
   */
  public static generateCalibrationGrid(): Uint8Array {
    const grid = new Uint8Array(TOTAL_CELLS);
    for (let r = 0; r < MATRIX_SIZE; r++) {
      for (let c = 0; c < MATRIX_SIZE; c++) {
        const idx = r * MATRIX_SIZE + c;
        // 4 quadrants: Top-Left=Black, Top-Right=Red, Bottom-Left=Green, Bottom-Right=Blue
        const top = r < MATRIX_SIZE / 2;
        const left = c < MATRIX_SIZE / 2;
        if (top && left) {
          grid[idx] = 0; // Black
        } else if (top && !left) {
          grid[idx] = 1; // Red
        } else if (!top && left) {
          grid[idx] = 2; // Green
        } else {
          grid[idx] = 3; // Blue
        }
      }
    }
    return grid;
  }
}
