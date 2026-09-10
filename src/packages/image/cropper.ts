/**
 * Image Square Cropper and Aspect Transformer
 */

export type CropMode = 'center-crop' | 'fit';

export class ImageCropper {
  /**
   * Transforms an image into an exact square canvas
   */
  public static cropToSquare(
    img: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
    targetDimension: number,
    mode: CropMode = 'center-crop',
    backgroundColor = '#000000'
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = targetDimension;
    canvas.height = targetDimension;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to obtain canvas 2D context');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const srcW = img.width;
    const srcH = img.height;

    if (mode === 'center-crop') {
      const minDim = Math.min(srcW, srcH);
      const sx = (srcW - minDim) / 2;
      const sy = (srcH - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetDimension, targetDimension);
    } else {
      // Fit with letterboxing
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, targetDimension, targetDimension);

      const maxDim = Math.max(srcW, srcH);
      const scale = targetDimension / maxDim;
      const dw = srcW * scale;
      const dh = srcH * scale;
      const dx = (targetDimension - dw) / 2;
      const dy = (targetDimension - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    return canvas;
  }
}
