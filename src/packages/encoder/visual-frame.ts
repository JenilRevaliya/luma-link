/**
 * LumaLink Visual Frame Renderer
 * Draws the optical transmission frame with 4 corner fiducials, safe margins, and 16x16 color matrix
 */

import {
  MATRIX_SIZE,
  DEFAULT_PALETTE,
  type ColorIndexValue,
  type Point2D,
  type QuadCorners,
} from '../protocol/types';

export interface RenderOptions {
  canvasSize?: number; // Canvas width and height (square)
  palette?: typeof DEFAULT_PALETTE;
  showDebugGrid?: boolean;
}

export class VisualFrameRenderer {
  public static readonly FIDUCIAL_INSET = 0.09; // Distance from corner to fiducial center
  public static readonly MATRIX_INSET = 0.20;   // Distance from border to matrix area
  public static readonly MATRIX_SIZE_FRAC = 1 - 2 * VisualFrameRenderer.MATRIX_INSET; // 0.60

  /**
   * Returns normalized [0..1] coordinates for the 4 fiducial centers
   */
  public static getFiducialCenters(): QuadCorners {
    const inset = VisualFrameRenderer.FIDUCIAL_INSET;
    return {
      topLeft: { x: inset, y: inset },
      topRight: { x: 1 - inset, y: inset },
      bottomRight: { x: 1 - inset, y: 1 - inset },
      bottomLeft: { x: inset, y: 1 - inset },
    };
  }

  /**
   * Renders the full optical frame onto an HTMLCanvasElement
   */
  public static renderToCanvas(
    canvas: HTMLCanvasElement,
    cellGrid: Uint8Array | number[],
    options: RenderOptions = {}
  ): void {
    const size = options.canvasSize || canvas.width || 800;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const palette = options.palette || DEFAULT_PALETTE;

    // 1. High contrast dark background & Quiet Zone around fiducials
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, size, size);

    // 2. Draw 4 Corner QR-Style Fiducial Markers (7x7 modules, 1:1:3:1:1 ratio)
    const fiducials = VisualFrameRenderer.getFiducialCenters();
    VisualFrameRenderer.drawFiducial(ctx, fiducials.topLeft, size, true); // TL has unique cyan orientation anchor
    VisualFrameRenderer.drawFiducial(ctx, fiducials.topRight, size, false);
    VisualFrameRenderer.drawFiducial(ctx, fiducials.bottomRight, size, false);
    VisualFrameRenderer.drawFiducial(ctx, fiducials.bottomLeft, size, false);

    // 3. Draw Safe Frame around Matrix
    const matrixX = size * VisualFrameRenderer.MATRIX_INSET;
    const matrixY = size * VisualFrameRenderer.MATRIX_INSET;
    const matrixDimension = size * VisualFrameRenderer.MATRIX_SIZE_FRAC;

    // White reference border around matrix
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, size * 0.004);
    ctx.strokeRect(matrixX - 2, matrixY - 2, matrixDimension + 4, matrixDimension + 4);

    // 4. Draw 16x16 Color Matrix
    const cellSize = matrixDimension / MATRIX_SIZE;

    for (let r = 0; r < MATRIX_SIZE; r++) {
      for (let c = 0; c < MATRIX_SIZE; c++) {
        const idx = r * MATRIX_SIZE + c;
        const colorIdx = (cellGrid[idx] || 0) as ColorIndexValue;
        const rgb = palette[colorIdx] || palette[0];

        const cx = matrixX + c * cellSize;
        const cy = matrixY + r * cellSize;

        ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        ctx.fillRect(cx, cy, Math.ceil(cellSize), Math.ceil(cellSize));
      }
    }
  }

  /**
   * Draws a standard QR-style 7x7 module nested square finder pattern
   * Ratio along any horizontal, vertical, or diagonal scanline through center:
   * 1 White : 1 Dark : 3 Center (White/Cyan) : 1 Dark : 1 White  (1:1:3:1:1)
   */
  private static drawFiducial(
    ctx: CanvasRenderingContext2D,
    centerFrac: Point2D,
    canvasSize: number,
    isTopLeft: boolean
  ): void {
    const cx = Math.round(centerFrac.x * canvasSize);
    const cy = Math.round(centerFrac.y * canvasSize);

    // Module size M: 7 modules wide total = ~10.5% of canvasSize
    const M = Math.max(2, Math.round(canvasSize * 0.015));
    const halfW = 3.5 * M;

    // 1. Outer 7x7 module square (White)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - halfW, cy - halfW, 7 * M, 7 * M);

    // 2. Inner 5x5 module square (Dark background)
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(cx - 2.5 * M, cy - 2.5 * M, 5 * M, 5 * M);

    // 3. Center 3x3 module core (Cyan for TL anchor, White for TR/BR/BL)
    ctx.fillStyle = isTopLeft ? '#00f0ff' : '#ffffff';
    ctx.fillRect(cx - 1.5 * M, cy - 1.5 * M, 3 * M, 3 * M);
  }
}
