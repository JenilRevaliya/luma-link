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
    const mimeType = preferredMime;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to encode canvas to blob'));
        },
        mimeType,
        quality
      );
    });

    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const byteSize = data.length;
    const totalPackets = Math.ceil(byteSize / MAX_PAYLOAD_SIZE);

    // Frame transmission estimates (including handshake frames: ~4 frames overhead)
    const totalFrames = totalPackets + 4;
    const fps15Seconds = parseFloat((totalFrames / 15).toFixed(1));
    const fps30Seconds = parseFloat((totalFrames / 30).toFixed(1));
    const fps60Seconds = parseFloat((totalFrames / 60).toFixed(1));

    const dataUrl = canvas.toDataURL(mimeType, quality);

    return {
      data,
      mimeType,
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
}
