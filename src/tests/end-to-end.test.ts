import { describe, it, expect } from 'vitest';
import { PacketStreamGenerator } from '../packages/encoder/stream';
import { PacketReassembler, type ReassembledResult, type ReassemblyProgress } from '../packages/decoder/reassembler';
import { FrameCodec } from '../packages/protocol/frame';
import { MatrixMapper } from '../packages/encoder/matrix';

describe('End-to-End Optical Protocol Reassembly', () => {
  it('should stream, packetize, encrypt, reassemble and decrypt arbitrary payloads', async () => {
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

    // Feed START frame first
    const startFrame = stream.frames.find((f) => f.type === 3)!;
    const decodedStart = FrameCodec.decodeFrame(startFrame.rawBytes)!;
    await reassembler.ingestFrame(decodedStart);

    // Feed DATA frames
    const dataFrames = stream.frames.filter((f) => f.type === 4);
    for (const df of dataFrames) {
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

  it('should transfer text messages and secret notes with AES-GCM encryption', async () => {
    const textMessage = 'Top secret air-gapped optical transmission via LumaLink 2026.';
    const textBytes = new TextEncoder().encode(textMessage);

    const stream = await PacketStreamGenerator.prepareStream({
      data: textBytes,
      mimeType: 'text/plain',
      encrypt: true,
    });

    const reassembler = new PacketReassembler();
    let result: ReassembledResult | null = null;
    reassembler.onComplete = (res) => {
      result = res;
    };

    // Feed all frames
    for (const frame of stream.frames) {
      if (frame.type === 1 || frame.type === 2 || frame.type === 5) continue; // Skip discovery/calib/end for reassembler
      const decoded = FrameCodec.decodeFrame(frame.rawBytes);
      if (decoded) {
        await reassembler.ingestFrame(decoded);
      }
    }

    expect(result).not.toBeNull();
    expect(result!.isText).toBe(true);
    expect(result!.textContent).toBe(textMessage);
  });

  it('should handle mid-stream pickup and complete remaining gaps upon looping', async () => {
    // Generate a stream of ~15 packets
    const data = new Uint8Array(600);
    for (let i = 0; i < 600; i++) data[i] = i % 256;

    const stream = await PacketStreamGenerator.prepareStream({
      data,
      mimeType: 'application/json',
      encrypt: true,
    });

    const reassembler = new PacketReassembler();
    let result: ReassembledResult | null = null;
    const progressHistory: ReassemblyProgress[] = [];

    reassembler.onProgress = (p) => progressHistory.push(p);
    reassembler.onComplete = (res) => {
      result = res;
    };

    // Feed START frame so metadata is known
    const startFrame = stream.frames.find((f) => f.type === 3)!;
    await reassembler.ingestFrame(FrameCodec.decodeFrame(startFrame.rawBytes)!);

    const dataFrames = stream.frames.filter((f) => f.type === 4);
    const totalDataPackets = dataFrames.length;

    // Simulate joining mid-stream at packet 8 (packets 0..7 missed)
    const midIndex = Math.floor(totalDataPackets / 2);
    for (let i = midIndex; i < totalDataPackets; i++) {
      const decoded = FrameCodec.decodeFrame(dataFrames[i].rawBytes)!;
      await reassembler.ingestFrame(decoded);
    }

    // Mid-stream verification: result should NOT be complete yet
    expect(result).toBeNull();
    const midProgress = progressHistory[progressHistory.length - 1];
    expect(midProgress.initialPickupIndex).toBe(midIndex);
    expect(midProgress.missingHeadCount).toBe(midIndex);
    expect(midProgress.percent).toBeLessThan(100);

    // Now simulate loop 2: sender wraps around and delivers missing head (packets 0 to midIndex - 1)
    for (let i = 0; i < midIndex; i++) {
      const decoded = FrameCodec.decodeFrame(dataFrames[i].rawBytes)!;
      await reassembler.ingestFrame(decoded);
    }

    // Now reassembly MUST be 100% complete!
    expect(result).not.toBeNull();
    expect(result!.totalBytes).toBe(600);
    expect(result!.data).toEqual(data);
  });
});
