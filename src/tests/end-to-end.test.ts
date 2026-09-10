import { describe, it, expect } from 'vitest';
import { PacketStreamGenerator } from '../packages/encoder/stream';
import { PacketReassembler, type ReassembledResult } from '../packages/decoder/reassembler';
import { FrameCodec } from '../packages/protocol/frame';
import { MatrixMapper } from '../packages/encoder/matrix';

describe('End-to-End Optical Protocol Reassembly', () => {
  it('should stream, packetize, encrypt, reassemble and decrypt arbitrary payloads', async () => {
    // 500 bytes of sample binary data
    const sampleData = new Uint8Array(500);
    for (let i = 0; i < 500; i++) {
      sampleData[i] = (i * 17 + 3) & 0xFF;
    }

    const stream = await PacketStreamGenerator.prepareStream({
      data: sampleData,
      mimeType: 'image/webp',
      width: 128,
      height: 128,
      encrypt: true,
    });

    expect(stream.frames.length).toBeGreaterThan(10);

    const reassembler = new PacketReassembler();
    let result: ReassembledResult | null = null;

    reassembler.onComplete = (res) => {
      result = res;
    };

    // Feed frames in out-of-order / arbitrary loop order (simulating connecting mid-transmission)
    // First feed START frame
    const startFrame = stream.frames.find(f => f.type === 3)!;
    const decodedStart = FrameCodec.decodeFrame(startFrame.rawBytes)!;
    await reassembler.ingestFrame(decodedStart);

    // Feed DATA frames
    const dataFrames = stream.frames.filter(f => f.type === 4);
    for (const df of dataFrames) {
      // Simulate conversion to matrix and back (optical roundtrip)
      const matrix = df.cellGrid;
      const roundtripBytes = MatrixMapper.matrixToBytes(matrix);
      const decoded = FrameCodec.decodeFrame(roundtripBytes);
      expect(decoded).not.toBeNull();
      await reassembler.ingestFrame(decoded!);
    }

    expect(result).not.toBeNull();
    expect(result!.totalBytes).toBe(500);
    expect(result!.data).toEqual(sampleData);
    expect(result!.width).toBe(128);
    expect(result!.height).toBe(128);
    expect(result!.mimeType).toBe('image/webp');
  });
});
