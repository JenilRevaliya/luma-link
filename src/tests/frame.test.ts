import { describe, it, expect } from 'vitest';
import { FrameCodec } from '../packages/protocol/frame';
import { FrameType, TOTAL_FRAME_BYTES } from '../packages/protocol/types';

describe('FrameCodec', () => {
  it('should encode and decode a frame cleanly', () => {
    const payload = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const raw = FrameCodec.encodeFrame({
      frameType: FrameType.DATA,
      sessionId: 0xA1B2,
      sequenceNum: 42,
      packetIndex: 5,
      totalPackets: 20,
    }, payload);

    expect(raw.length).toBe(TOTAL_FRAME_BYTES);

    const decoded = FrameCodec.decodeFrame(raw);
    expect(decoded).not.toBeNull();
    expect(decoded!.header.frameType).toBe(FrameType.DATA);
    expect(decoded!.header.sessionId).toBe(0xA1B2);
    expect(decoded!.header.sequenceNum).toBe(42);
    expect(decoded!.header.packetIndex).toBe(5);
    expect(decoded!.header.totalPackets).toBe(20);
    expect(decoded!.payload).toEqual(payload);
    expect(decoded!.correctedErrors).toBe(0);
    expect(decoded!.validCrc).toBe(true);
  });

  it('should correct byte errors using Reed-Solomon in decodeFrame', () => {
    const payload = new Uint8Array(32).fill(0x7E);
    const raw = FrameCodec.encodeFrame({
      frameType: FrameType.DATA,
      sessionId: 0x1234,
      sequenceNum: 1,
      packetIndex: 0,
      totalPackets: 1,
    }, payload);

    // Corrupt 3 random bytes in the transmission
    const corrupted = new Uint8Array(raw);
    corrupted[5] ^= 0xFF;  // Header corruption
    corrupted[20] ^= 0x55; // Payload corruption
    corrupted[60] ^= 0xAA; // Parity corruption

    const decoded = FrameCodec.decodeFrame(corrupted);
    expect(decoded).not.toBeNull();
    expect(decoded!.correctedErrors).toBe(3);
    expect(decoded!.header.sessionId).toBe(0x1234);
    expect(decoded!.payload).toEqual(payload);
    expect(decoded!.validCrc).toBe(true);
  });
});
