/**
 * LumaLink Continuous Fountain Packet Stream Generator
 * Generates an endless looped stream of optical frames for transmission
 */

import {
  FrameType,
  MAX_PAYLOAD_SIZE,
  type FrameTypeValue,
  type PayloadMimeType,
} from '../protocol/types';
import { FrameCodec } from '../protocol/frame';
import { MatrixMapper } from './matrix';
import { CryptoEngine } from '../crypto/aes-gcm';
import { crc32 } from '../protocol/crc32';

export interface TransmissionSource {
  data: Uint8Array;
  mimeType: PayloadMimeType;
  width?: number;
  height?: number;
  encrypt?: boolean;
}

export interface PreparedStream {
  sessionId: number;
  totalPackets: number;
  totalBytes: number;
  mimeType: PayloadMimeType;
  frames: {
    type: FrameTypeValue;
    packetIndex: number;
    rawBytes: Uint8Array;
    cellGrid: Uint8Array;
  }[];
  loopStartIndex: number; // Frame index to resume from on loops 2+ (skips discovery/calibration)
}

export class PacketStreamGenerator {
  /**
   * Prepares a complete packet stream for transmission
   */
  public static async prepareStream(source: TransmissionSource): Promise<PreparedStream> {
    const sessionId = (Math.floor(Math.random() * 0xFFFE) + 1) & 0xFFFF;
    const rawChecksum = crc32(source.data);

    let ciphertext: Uint8Array;
    let iv: Uint8Array = new Uint8Array(12);
    let keyBytes: Uint8Array = new Uint8Array(16);

    if (source.encrypt !== false) {
      const cryptoKey = await CryptoEngine.generateKey();
      iv = CryptoEngine.generateIV();
      keyBytes = await CryptoEngine.exportKey(cryptoKey);
      ciphertext = await CryptoEngine.encrypt(source.data, cryptoKey, iv);
    } else {
      ciphertext = source.data;
    }

    // Split ciphertext into chunks of MAX_PAYLOAD_SIZE (42 bytes)
    const totalPackets = Math.ceil(ciphertext.length / MAX_PAYLOAD_SIZE);
    const frames: PreparedStream['frames'] = [];
    let seq = 0;

    // 1. DISCOVERY FRAME
    const discPayload = new Uint8Array(4);
    const discView = new DataView(discPayload.buffer);
    discView.setUint16(0, totalPackets, false);
    discView.setUint16(2, ciphertext.length, false);

    const discBytes = FrameCodec.encodeFrame({
      frameType: FrameType.DISCOVERY,
      sessionId,
      sequenceNum: seq++,
      packetIndex: 0,
      totalPackets,
    }, discPayload);

    frames.push({
      type: FrameType.DISCOVERY,
      packetIndex: 0,
      rawBytes: discBytes,
      cellGrid: MatrixMapper.bytesToMatrix(discBytes),
    });

    // 2. CALIBRATION FRAME
    const calibGrid = MatrixMapper.generateCalibrationGrid();
    const calibBytes = MatrixMapper.matrixToBytes(calibGrid);
    frames.push({
      type: FrameType.CALIBRATION,
      packetIndex: 0,
      rawBytes: calibBytes,
      cellGrid: calibGrid,
    });

    // 3. START FRAME
    // Format: totalBytes (4B), mimeCode (1B), width (2B), height (2B), checksum (4B), iv (12B), key (16B) = 41B
    const startPayload = new Uint8Array(41);
    const startView = new DataView(startPayload.buffer);
    startView.setUint32(0, source.data.length, false);

    let mimeCode = 1;
    if (source.mimeType === 'image/webp') mimeCode = 1;
    else if (source.mimeType === 'image/jpeg') mimeCode = 2;
    else if (source.mimeType === 'text/plain') mimeCode = 3;
    else if (source.mimeType === 'application/json') mimeCode = 4;
    else if (source.mimeType === 'multipart/image+text') mimeCode = 5;

    startPayload[4] = mimeCode;
    startView.setUint16(5, source.width || 0, false);
    startView.setUint16(7, source.height || 0, false);
    startView.setUint32(9, rawChecksum, false);
    startPayload.set(iv, 13);
    startPayload.set(keyBytes, 25);

    const startBytes = FrameCodec.encodeFrame({
      frameType: FrameType.START,
      sessionId,
      sequenceNum: seq++,
      packetIndex: 0,
      totalPackets,
    }, startPayload);

    frames.push({
      type: FrameType.START,
      packetIndex: 0,
      rawBytes: startBytes,
      cellGrid: MatrixMapper.bytesToMatrix(startBytes),
    });

    // 4. DATA FRAMES
    for (let p = 0; p < totalPackets; p++) {
      const startOffset = p * MAX_PAYLOAD_SIZE;
      const endOffset = Math.min(ciphertext.length, startOffset + MAX_PAYLOAD_SIZE);
      const chunk = ciphertext.slice(startOffset, endOffset);

      const dataBytes = FrameCodec.encodeFrame({
        frameType: FrameType.DATA,
        sessionId,
        sequenceNum: seq++,
        packetIndex: p,
        totalPackets,
      }, chunk);

      frames.push({
        type: FrameType.DATA,
        packetIndex: p,
        rawBytes: dataBytes,
        cellGrid: MatrixMapper.bytesToMatrix(dataBytes),
      });
    }

    // 5. END FRAME
    const endBytes = FrameCodec.encodeFrame({
      frameType: FrameType.END,
      sessionId,
      sequenceNum: seq++,
      packetIndex: totalPackets,
      totalPackets,
    });

    frames.push({
      type: FrameType.END,
      packetIndex: totalPackets,
      rawBytes: endBytes,
      cellGrid: MatrixMapper.bytesToMatrix(endBytes),
    });

    return {
      sessionId,
      totalPackets,
      totalBytes: source.data.length,
      mimeType: source.mimeType,
      frames,
      loopStartIndex: 2, // Frame 2 is START metadata, skipping redundant discovery and calibration on loops 2+
    };
  }
}
