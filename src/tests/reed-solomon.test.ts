import { describe, it, expect } from 'vitest';
import { ReedSolomon } from '../packages/error-correction/reed-solomon';

describe('ReedSolomon GF(2^8)', () => {
  it('should encode and decode without errors', () => {
    const rs = new ReedSolomon(8);
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const parity = rs.encode(data);
    expect(parity.length).toBe(8);

    const fullMsg = new Uint8Array([...data, ...parity]);
    const corrected = rs.decode(fullMsg);
    expect(corrected).toBe(0);
    expect(fullMsg.slice(0, 10)).toEqual(data);
  });

  it('should correct up to 4 byte errors with 8 parity bytes', () => {
    const rs = new ReedSolomon(8);
    const originalData = new Uint8Array(56);
    for (let i = 0; i < 56; i++) {
      originalData[i] = (i * 7 + 13) & 0xFF;
    }

    const parity = rs.encode(originalData);
    const fullMsg = new Uint8Array(64);
    fullMsg.set(originalData, 0);
    fullMsg.set(parity, 56);

    // Corrupt 4 bytes (positions 3, 15, 38, 59)
    const corrupted = new Uint8Array(fullMsg);
    corrupted[3] ^= 0x55;
    corrupted[15] ^= 0xAA;
    corrupted[38] ^= 0x3C;
    corrupted[59] ^= 0xF0;

    const errorsCorrected = rs.decode(corrupted);
    expect(errorsCorrected).toBe(4);
    expect(corrupted).toEqual(fullMsg);
  });

  it('should report -1 for uncorrectable errors (> 4 errors)', () => {
    const rs = new ReedSolomon(8);
    const originalData = new Uint8Array(56).fill(42);
    const parity = rs.encode(originalData);
    const corrupted = new Uint8Array([...originalData, ...parity]);

    // Corrupt 5 bytes
    corrupted[2] ^= 0x11;
    corrupted[8] ^= 0x22;
    corrupted[14] ^= 0x33;
    corrupted[20] ^= 0x44;
    corrupted[26] ^= 0x55;

    const res = rs.decode(corrupted);
    expect(res).toBe(-1);
  });
});
