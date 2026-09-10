/**
 * Image Compressor & Adaptive Optical Transfer Profiler
 */

import { MAX_PAYLOAD_SIZE } from '../protocol/types';

export interface CompressedImageResult {
  data: Uint8Array;
  mimeType: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  byteSize: number;
  totalPackets: number;
  dataUrl: string;
  transferEstimates: {
    fps15Seconds: number;
    fps30Seconds: number;
    fps60Seconds: number;
  };
}

export class ImageCompressor {
  /**
   * Compresses a square canvas into WebP (or JPEG fallback)
   */
  public static async compressCanvas(
    canvas: HTMLCanvasElement,
    quality = 0.80,
    preferredMime: 'image/webp' | 'image/jpeg' = 'image/webp'
  ): Promise<CompressedImageResult> {
    // 1. Try encoding with preferred format
    let blob = await ImageCompressor.canvasToBlob(canvas, preferredMime, quality);
    let chosenMime = preferredMime;

    // 2. If the resulting blob is large (>16KB) or Safari produced oversized WebP,
    // test JPEG which has high compression efficiency for optical camera transfer
    if (blob.size > 16000 && preferredMime === 'image/webp') {
      try {
        const jpegBlob = await ImageCompressor.canvasToBlob(canvas, 'image/jpeg', Math.min(quality, 0.72));
        if (jpegBlob.size < blob.size) {
          blob = jpegBlob;
          chosenMime = 'image/jpeg';
        }
      } catch {
        // Fallback to original blob
      }
    }

    // 3. If still above 26KB, apply adaptive compression to ensure fast optical transfer (<25s)
    if (blob.size > 26000) {
      try {
        const compBlob = await ImageCompressor.canvasToBlob(canvas, 'image/jpeg', 0.58);
        if (compBlob.size < blob.size) {
          blob = compBlob;
          chosenMime = 'image/jpeg';
        }
      } catch {
        // Fallback to original blob
      }
    }

    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const byteSize = data.length;
    const totalPackets = Math.ceil(byteSize / MAX_PAYLOAD_SIZE);

    // Frame transmission estimates (including handshake frames: ~4 frames overhead)
    const totalFrames = totalPackets + 4;
    const fps15Seconds = parseFloat((totalFrames / 15).toFixed(1));
    const fps30Seconds = parseFloat((totalFrames / 30).toFixed(1));
    const fps60Seconds = parseFloat((totalFrames / 60).toFixed(1));

    const dataUrl = canvas.toDataURL(chosenMime, quality);

    return {
      data,
      mimeType: chosenMime,
      width: canvas.width,
      height: canvas.height,
      byteSize,
      totalPackets,
      dataUrl,
      transferEstimates: {
        fps15Seconds,
        fps30Seconds,
        fps60Seconds,
      },
    };
  }

  private static canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error(`Failed to encode canvas to ${mime}`));
        },
        mime,
        quality
      );
    });
  }
}
