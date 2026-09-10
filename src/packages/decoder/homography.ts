/**
 * 2D Projective Homography (Perspective Transform)
 * Direct Linear Transform (DLT) solver for 4-point quadrilateral mapping
 */

import type { Point2D } from '../protocol/types';

export class Homography {
  private h: number[]; // 3x3 matrix [h00, h01, h02, h10, h11, h12, h20, h21, h22]

  constructor(matrix9: number[]) {
    this.h = matrix9;
  }

  /**
   * Computes homography H mapping from unit square [0,1]x[0,1] or quad1 to quad2
   * Given source points src and destination points dst: dst = H * src
   */
  public static from4Points(src: Point2D[], dst: Point2D[]): Homography | null {
    if (src.length !== 4 || dst.length !== 4) return null;

    // Build 8x8 system of equations A * h = b
    const A: number[][] = [];
    const b: number[] = [];

    for (let i = 0; i < 4; i++) {
      const sx = src[i].x;
      const sy = src[i].y;
      const dx = dst[i].x;
      const dy = dst[i].y;

      A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
      b.push(dx);

      A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
      b.push(dy);
    }

    const h8 = Homography.solveGaussian(A, b);
    if (!h8) return null;

    return new Homography([
      h8[0], h8[1], h8[2],
      h8[3], h8[4], h8[5],
      h8[6], h8[7], 1.0,
    ]);
  }

  /**
   * Maps a point (x, y) through the homography: p' = H * p
   */
  public transform(x: number, y: number): Point2D {
    const w = this.h[6] * x + this.h[7] * y + this.h[8];
    if (Math.abs(w) < 1e-8) {
      return { x: 0, y: 0 };
    }
    const px = (this.h[0] * x + this.h[1] * y + this.h[2]) / w;
    const py = (this.h[3] * x + this.h[4] * y + this.h[5]) / w;
    return { x: px, y: py };
  }

  /**
   * Inverts the 3x3 homography matrix
   */
  public invert(): Homography | null {
    const m = this.h;
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);

    if (Math.abs(det) < 1e-9) return null;
    const invDet = 1.0 / det;

    const inv = [
      (m[4] * m[8] - m[5] * m[7]) * invDet,
      (m[2] * m[7] - m[1] * m[8]) * invDet,
      (m[1] * m[5] - m[2] * m[4]) * invDet,
      (m[5] * m[6] - m[3] * m[8]) * invDet,
      (m[0] * m[8] - m[2] * m[6]) * invDet,
      (m[2] * m[3] - m[0] * m[5]) * invDet,
      (m[3] * m[7] - m[4] * m[6]) * invDet,
      (m[1] * m[6] - m[0] * m[7]) * invDet,
      (m[0] * m[4] - m[1] * m[3]) * invDet,
    ];

    return new Homography(inv);
  }

  /**
   * Gaussian elimination with partial pivoting for 8x8 linear system
   */
  private static solveGaussian(A: number[][], b: number[]): number[] | null {
    const n = 8;
    const M: number[][] = [];
    for (let i = 0; i < n; i++) {
      M.push([...A[i], b[i]]);
    }

    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
          maxRow = k;
        }
      }

      // Swap rows
      const tmp = M[i];
      M[i] = M[maxRow];
      M[maxRow] = tmp;

      if (Math.abs(M[i][i]) < 1e-9) return null; // Singular matrix

      // Eliminate below
      for (let k = i + 1; k < n; k++) {
        const factor = M[k][i] / M[i][i];
        for (let j = i; j <= n; j++) {
          M[k][j] -= factor * M[i][j];
        }
      }
    }

    // Back substitution
    const x = new Array<number>(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = M[i][n];
      for (let j = i + 1; j < n; j++) {
        sum -= M[i][j] * x[j];
      }
      x[i] = sum / M[i][i];
    }

    return x;
  }
}
