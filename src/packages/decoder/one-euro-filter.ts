/**
 * One Euro Filter for Jitter-Free Optical Tracking
 * Reference: Casiez, G., Roussel, N. and Vogel, D. (CHI 2012)
 *
 * Automatically adapts cutoff frequency based on target velocity:
 * - Low velocity (stationary/hand-held): heavy low-pass filtering removes high-frequency jitter
 * - High velocity (camera panning): higher cutoff eliminates lag
 */

import type { Point2D, QuadCorners } from '../protocol/types';

class LowPassFilter {
  private hatXPrev: number | null = null;

  public filter(x: number, alpha: number): number {
    if (this.hatXPrev === null) {
      this.hatXPrev = x;
      return x;
    }
    const hatX = alpha * x + (1.0 - alpha) * this.hatXPrev;
    this.hatXPrev = hatX;
    return hatX;
  }

  public last(): number | null {
    return this.hatXPrev;
  }

  public reset(): void {
    this.hatXPrev = null;
  }
}

export class OneEuroFilter {
  private minCutoff: number; // fcmin (Hz): minimum cutoff frequency
  private beta: number;      // beta: velocity coefficient
  private dCutoff: number;   // fcd (Hz): derivative cutoff frequency
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTime: number | null = null;

  constructor(minCutoff = 0.8, beta = 0.015, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  public filter(val: number, timestamp = performance.now()): number {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      return this.xFilter.filter(val, 1.0);
    }

    const dt = Math.max(0.001, (timestamp - this.lastTime) / 1000.0);
    this.lastTime = timestamp;

    const prevVal = this.xFilter.last() ?? val;
    const dx = (val - prevVal) / dt;
    const edx = this.dxFilter.filter(dx, this.alpha(this.dCutoff, dt));

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(val, this.alpha(cutoff, dt));
  }

  public reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

export class OneEuroPointFilter {
  private filterX: OneEuroFilter;
  private filterY: OneEuroFilter;

  constructor(minCutoff = 0.7, beta = 0.012) {
    this.filterX = new OneEuroFilter(minCutoff, beta);
    this.filterY = new OneEuroFilter(minCutoff, beta);
  }

  public filter(pt: Point2D, timestamp = performance.now()): Point2D {
    return {
      x: this.filterX.filter(pt.x, timestamp),
      y: this.filterY.filter(pt.y, timestamp),
    };
  }

  public reset(): void {
    this.filterX.reset();
    this.filterY.reset();
  }
}

export class OneEuroQuadFilter {
  private tl = new OneEuroPointFilter(0.65, 0.015);
  private tr = new OneEuroPointFilter(0.65, 0.015);
  private br = new OneEuroPointFilter(0.65, 0.015);
  private bl = new OneEuroPointFilter(0.65, 0.015);

  public filter(quad: QuadCorners, timestamp = performance.now()): QuadCorners {
    return {
      topLeft: this.tl.filter(quad.topLeft, timestamp),
      topRight: this.tr.filter(quad.topRight, timestamp),
      bottomRight: this.br.filter(quad.bottomRight, timestamp),
      bottomLeft: this.bl.filter(quad.bottomLeft, timestamp),
    };
  }

  public reset(): void {
    this.tl.reset();
    this.tr.reset();
    this.br.reset();
    this.bl.reset();
  }
}
