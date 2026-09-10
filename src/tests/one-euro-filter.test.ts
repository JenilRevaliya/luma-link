import { describe, it, expect } from 'vitest';
import { OneEuroFilter, OneEuroPointFilter, OneEuroQuadFilter } from '../packages/decoder/one-euro-filter';

describe('OneEuroFilter Optical Tracking Smoother', () => {
  it('filters out high-frequency jitter when stationary', () => {
    const filter = new OneEuroFilter(0.8, 0.015);
    const center = 100.0;
    const noisySamples = [
      center,
      center + 2.5,
      center - 2.1,
      center + 3.0,
      center - 1.8,
      center + 2.2,
      center - 2.7,
      center + 1.9,
    ];

    let t = 1000;
    const filtered: number[] = [];
    for (const val of noisySamples) {
      filtered.push(filter.filter(val, t));
      t += 33.3; // 30 FPS
    }

    // Filtered deviation from center should be significantly smaller than raw noise
    const maxRawDev = Math.max(...noisySamples.map((v) => Math.abs(v - center)));
    const maxFiltDev = Math.max(...filtered.slice(2).map((v) => Math.abs(v - center)));

    expect(maxRawDev).toBe(3.0);
    expect(maxFiltDev).toBeLessThan(1.5);
  });

  it('smooths 4-corner quad coordinates without lag during motion', () => {
    const quadFilter = new OneEuroQuadFilter();
    let t = 1000;

    const quad1 = {
      topLeft: { x: 50, y: 50 },
      topRight: { x: 350, y: 50 },
      bottomRight: { x: 350, y: 350 },
      bottomLeft: { x: 50, y: 350 },
    };

    const out1 = quadFilter.filter(quad1, t);
    expect(out1.topLeft.x).toBe(50);
    expect(out1.topRight.x).toBe(350);

    // Fast movement (delta = 50px in 33ms)
    t += 33.3;
    const quad2 = {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 400, y: 100 },
      bottomRight: { x: 400, y: 400 },
      bottomLeft: { x: 100, y: 400 },
    };

    const out2 = quadFilter.filter(quad2, t);
    // Under high velocity, filter should adaptively track with responsiveness
    expect(out2.topLeft.x).toBeGreaterThan(65);
  });

  it('filters 2D points accurately', () => {
    const pointFilter = new OneEuroPointFilter();
    const pt1 = pointFilter.filter({ x: 200, y: 150 }, 1000);
    expect(pt1.x).toBe(200);
    expect(pt1.y).toBe(150);

    const pt2 = pointFilter.filter({ x: 204, y: 152 }, 1033);
    expect(pt2.x).toBeGreaterThan(200);
    expect(pt2.x).toBeLessThan(204);
  });
});
