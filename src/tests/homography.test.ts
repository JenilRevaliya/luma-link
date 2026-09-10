import { describe, it, expect } from 'vitest';
import { Homography } from '../packages/decoder/homography';
import type { Point2D } from '../packages/protocol/types';

describe('Homography', () => {
  it('should map unit square coordinates accurately under perspective distortion', () => {
    const src: Point2D[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];

    // Distorted quad in camera view
    const dst: Point2D[] = [
      { x: 120, y: 140 },
      { x: 580, y: 100 },
      { x: 620, y: 550 },
      { x: 80, y: 510 },
    ];

    const H = Homography.from4Points(src, dst);
    expect(H).not.toBeNull();

    // Verify all 4 corner mappings
    for (let i = 0; i < 4; i++) {
      const mapped = H!.transform(src[i].x, src[i].y);
      expect(mapped.x).toBeCloseTo(dst[i].x, 1);
      expect(mapped.y).toBeCloseTo(dst[i].y, 1);
    }

    // Invert and check reverse mapping
    const Hinv = H!.invert();
    expect(Hinv).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const rev = Hinv!.transform(dst[i].x, dst[i].y);
      expect(rev.x).toBeCloseTo(src[i].x, 2);
      expect(rev.y).toBeCloseTo(src[i].y, 2);
    }
  });
});
