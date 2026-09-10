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

    // 2. Draw 4 Corner Fiducial Markers
    const fiducials = VisualFrameRenderer.getFiducialCenters();
    VisualFrameRenderer.drawFiducial(ctx, fiducials.topLeft, size, true); // TL has unique orientation anchor
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
   * Draws a concentric multi-ring fiducial marker
   */
  private static drawFiducial(
    ctx: CanvasRenderingContext2D,
    centerFrac: Point2D,
    canvasSize: number,
    isTopLeft: boolean
  ): void {
    const cx = centerFrac.x * canvasSize;
    const cy = centerFrac.y * canvasSize;
    const rOuter = canvasSize * 0.055;
    const rMid = canvasSize * 0.038;
    const rInner = canvasSize * 0.022;

    // Outer white ring
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.fill();

    // Dark ring
    ctx.fillStyle = '#0a0a0f';
    ctx.beginPath();
    ctx.arc(cx, cy, rMid, 0, Math.PI * 2);
    ctx.fill();

    // Center bullseye
    ctx.fillStyle = isTopLeft ? '#00f0ff' : '#ffffff'; // Unique cyan tint for TL orientation
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fill();

    if (isTopLeft) {
      // Inner dark dot for TL anchor
      ctx.fillStyle = '#0a0a0f';
      ctx.beginPath();
      ctx.arc(cx, cy, rInner * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
