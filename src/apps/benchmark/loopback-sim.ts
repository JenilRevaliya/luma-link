/**
 * Optical Channel & Loopback Link Simulator
 * Simulates real-world physical transmission distortions:
 * perspective angle, distance scaling, motion blur, ambient color temperature, and sensor noise
 */

import type { QuadCorners } from '../../packages/protocol/types';
import { CornerFinder } from '../../packages/decoder/corner-finder';

export interface ChannelDistortionSettings {
  tiltAngleX: number; // -30 to +30 degrees
  tiltAngleY: number; // -30 to +30 degrees
  colorTemperature: number; // 2500K (warm) to 9000K (cool)
  ambientLightLevel: number; // 0.6 to 1.4
  sensorNoiseAmount: number; // 0 to 40
  blurRadius: number; // 0 to 4 px
}

export class LoopbackSimulator {
  private simCanvas: HTMLCanvasElement;
  private simCtx: CanvasRenderingContext2D;
  public settings: ChannelDistortionSettings = {
    tiltAngleX: 8,
    tiltAngleY: 6,
    colorTemperature: 5500, // Daylight
    ambientLightLevel: 1.0,
    sensorNoiseAmount: 4,
    blurRadius: 0,
  };

  constructor(width = 800, height = 800) {
    this.simCanvas = document.createElement('canvas');
    this.simCanvas.width = width;
    this.simCanvas.height = height;
    this.simCtx = this.simCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  /**
   * Captures the sender canvas, applies optical channel distortions, and returns simulated ImageData
   */
  public generateSimulatedFrame(sourceCanvas: HTMLCanvasElement): {
    imageData: ImageData;
    simulatedCorners: QuadCorners;
  } {
    const w = this.simCanvas.width;
    const h = this.simCanvas.height;
    const ctx = this.simCtx;

    // 1. Ambient lighting background
    ctx.fillStyle = '#10141f';
    ctx.fillRect(0, 0, w, h);

    // 2. Perspective distortion & transformation
    ctx.save();
    ctx.translate(w / 2, h / 2);

    // Apply perspective skew
    const skewX = (this.settings.tiltAngleX * Math.PI) / 180;
    const skewY = (this.settings.tiltAngleY * Math.PI) / 180;
    ctx.transform(1, Math.tan(skewY * 0.5), Math.tan(skewX * 0.5), 1, 0, 0);

    const drawW = w * 0.85;
    const drawH = h * 0.85;
    ctx.drawImage(sourceCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // 3. Extract pixels and apply channel noise & color temperature
    const imgData = ctx.getImageData(0, 0, w, h);
    this.applyChannelDistortions(imgData);
    ctx.putImageData(imgData, 0, 0);

    // 4. Calculate simulated fiducial corners in distorted frame
    const tiltOffset = this.settings.tiltAngleX * 2.5;
    const simulatedCorners = CornerFinder.createSimulatedCorners(w, h, tiltOffset, this.settings.tiltAngleY * 2.5);

    return {
      imageData: imgData,
      simulatedCorners,
    };
  }

  private applyChannelDistortions(imgData: ImageData): void {
    const { data } = imgData;
    const noise = this.settings.sensorNoiseAmount;
    const ambient = this.settings.ambientLightLevel;

    // Color temperature shift (approximate Kelvin balance)
    // Warm (<5500K): boost red, decrease blue
    // Cool (>5500K): boost blue, decrease red
    const tempDelta = (this.settings.colorTemperature - 5500) / 3500;
    const redGain = Math.max(0.6, 1.0 - tempDelta * 0.25);
    const blueGain = Math.max(0.6, 1.0 + tempDelta * 0.25);

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      // Lighting and temperature
      r = r * ambient * redGain;
      g = g * ambient;
      b = b * ambient * blueGain;

      // Sensor shot noise
      if (noise > 0) {
        const n = (Math.random() - 0.5) * noise * 2;
        r += n;
        g += n;
        b += n;
      }

      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
    }
  }

  public getCanvas(): HTMLCanvasElement {
    return this.simCanvas;
  }
}
