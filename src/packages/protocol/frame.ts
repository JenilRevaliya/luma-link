/**
 * LumaLink Frame Serialization and Deserialization
 */

import {
  MAGIC_0,
  MAGIC_1,
  PROTOCOL_VERSION,
  HEADER_SIZE,
  ECC_PARITY_SIZE,
  MAX_PAYLOAD_SIZE,
  TOTAL_FRAME_BYTES,
  DATA_BLOCK_SIZE,
  type FrameHeader,
  type DecodedFrame,
  type FrameTypeValue,
} from './types';
import { crc32 } from './crc32';
import { ReedSolomon } from '../error-correction/reed-solomon';

const rsCodec = new ReedSolomon(ECC_PARITY_SIZE);

export class FrameCodec {
  /**
   * Serializes a frame into an exact 64-byte optical frame with CRC32 and Reed-Solomon ECC
   */
  public static encodeFrame(
    header: Omit<FrameHeader, 'magic0' | 'magic1' | 'version' | 'payloadLength'>,
    payload: Uint8Array = new Uint8Array(0)
  ): Uint8Array {
    if (payload.length > MAX_PAYLOAD_SIZE) {
      throw new Error(`Payload length ${payload.length} exceeds maximum ${MAX_PAYLOAD_SIZE}`);
    }

    const frame = new Uint8Array(TOTAL_FRAME_BYTES);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

    // 1. Header (10 bytes)
    frame[0] = MAGIC_0;
    frame[1] = MAGIC_1;
    frame[2] = PROTOCOL_VERSION;
    frame[3] = header.frameType;
    view.setUint16(4, header.sessionId, false); // Big endian
    frame[6] = header.sequenceNum & 0xFF;
    frame[7] = header.packetIndex & 0xFF;
    frame[8] = header.totalPackets & 0xFF;
    frame[9] = payload.length & 0xFF;

    // 2. Payload (42 bytes, padded with 0)
    if (payload.length > 0) {
      frame.set(payload, HEADER_SIZE);
    }

    // 3. CRC32 (4 bytes) over header + payload (bytes 0 to 51)
    const crc = crc32(frame, 0, HEADER_SIZE + MAX_PAYLOAD_SIZE);
    view.setUint32(HEADER_SIZE + MAX_PAYLOAD_SIZE, crc, false); // bytes 52..55

    // 4. Reed-Solomon Parity (8 bytes) computed over DATA_BLOCK_SIZE (56 bytes)
    const dataBlock = frame.subarray(0, DATA_BLOCK_SIZE);
    const parity = rsCodec.encode(dataBlock);
    frame.set(parity, DATA_BLOCK_SIZE); // bytes 56..63

    return frame;
  }

  /**
   * Decodes and validates a 64-byte raw optical frame
   */
  public static decodeFrame(rawBytes: Uint8Array): DecodedFrame | null {
    if (rawBytes.length !== TOTAL_FRAME_BYTES) {
      return null;
    }

    const buffer = new Uint8Array(rawBytes);

    // 1. Reed-Solomon error correction
    const correctedErrors = rsCodec.decode(buffer);
    if (correctedErrors < 0) {
      return null; // Uncorrectable frame corruption
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // 2. Validate Magic & Protocol Version
    if (buffer[0] !== MAGIC_0 || buffer[1] !== MAGIC_1 || buffer[2] !== PROTOCOL_VERSION) {
      return null;
    }

    // 3. Validate CRC32
    const storedCrc = view.getUint32(HEADER_SIZE + MAX_PAYLOAD_SIZE, false);
    const calculatedCrc = crc32(buffer, 0, HEADER_SIZE + MAX_PAYLOAD_SIZE);
    const validCrc = storedCrc === calculatedCrc;

    if (!validCrc) {
      return null;
    }

    // 4. Parse Header
    const payloadLength = Math.min(buffer[9], MAX_PAYLOAD_SIZE);
    const header: FrameHeader = {
      magic0: buffer[0],
      magic1: buffer[1],
      version: buffer[2],
      frameType: buffer[3] as FrameTypeValue,
      sessionId: view.getUint16(4, false),
      sequenceNum: buffer[6],
      packetIndex: buffer[7],
      totalPackets: buffer[8],
      payloadLength,
    };

    // 5. Extract Payload
    const payload = buffer.slice(HEADER_SIZE, HEADER_SIZE + payloadLength);

    return {
      header,
      payload,
      validCrc,
      correctedErrors,
      rawBytes: buffer,
    };
  }

  /**
   * Diagnostically inspects a raw frame buffer, evaluating RS ECC, magic bytes, and CRC32
   */
  public static inspectFrame(rawBytes: Uint8Array): FrameInspection {
    if (rawBytes.length !== TOTAL_FRAME_BYTES) {
      return {
        isValid: false,
        length: rawBytes.length,
        magicMatch: false,
        magicHex: 'N/A',
        versionMatch: false,
        version: 0,
        rsCorrectedErrors: -1,
        crcMatch: false,
        storedCrcHex: '0x0',
        calcCrcHex: '0x0',
        summary: `Invalid frame byte length: ${rawBytes.length} (expected ${TOTAL_FRAME_BYTES})`,
      };
    }

    const buffer = new Uint8Array(rawBytes);
    const rsErrors = rsCodec.decode(buffer);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    const m0 = buffer[0];
    const m1 = buffer[1];
    const ver = buffer[2];
    const magicMatch = m0 === MAGIC_0 && m1 === MAGIC_1;
    const versionMatch = ver === PROTOCOL_VERSION;
    const magicHex = `0x${m0.toString(16).padStart(2, '0')} 0x${m1.toString(16).padStart(2, '0')}`;

    const storedCrc = view.getUint32(HEADER_SIZE + MAX_PAYLOAD_SIZE, false);
    const calcCrc = crc32(buffer, 0, HEADER_SIZE + MAX_PAYLOAD_SIZE);
    const crcMatch = storedCrc === calcCrc;
    const storedCrcHex = `0x${(storedCrc >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
    const calcCrcHex = `0x${(calcCrc >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;

    const typeNames: Record<number, string> = {
      1: 'DISCOVERY',
      2: 'CALIBRATION',
      3: 'START',
      4: 'DATA',
      5: 'END',
    };

    const typeCode = buffer[3] as FrameTypeValue;
    const typeName = typeNames[typeCode] || `TYPE_${typeCode}`;

    let summary = '';
    const isValid = magicMatch && versionMatch && crcMatch && rsErrors >= 0;

    if (isValid) {
      summary = `VALID ${typeName} frame (Pkt #${buffer[7]}/${buffer[8]}, Session #${view.getUint16(4, false).toString(16).toUpperCase()}, RS: ${rsErrors} errs)`;
    } else if (!magicMatch) {
      summary = `NO MAGIC: found [${magicHex}], expected [0x4C 0x4D] ('LM')`;
    } else if (!versionMatch) {
      summary = `VERSION MISMATCH: got ${ver}, expected ${PROTOCOL_VERSION}`;
    } else if (rsErrors < 0) {
      summary = `CORRUPT: RS ECC failed (>4 byte errors, uncorrectable)`;
    } else if (!crcMatch) {
      summary = `CRC MISMATCH: stored ${storedCrcHex} != calc ${calcCrcHex} (RS corrected: ${rsErrors})`;
    }

    return {
      isValid,
      length: buffer.length,
      magicMatch,
      magicHex,
      versionMatch,
      version: ver,
      rsCorrectedErrors: rsErrors,
      crcMatch,
      storedCrcHex,
      calcCrcHex,
      frameType: typeCode,
      frameTypeName: typeName,
      sessionId: view.getUint16(4, false),
      sequenceNum: buffer[6],
      packetIndex: buffer[7],
      totalPackets: buffer[8],
      payloadLength: buffer[9],
      summary,
    };
  }
}

export interface FrameInspection {
  isValid: boolean;
  length: number;
  magicMatch: boolean;
  magicHex: string;
  versionMatch: boolean;
  version: number;
  rsCorrectedErrors: number;
  crcMatch: boolean;
  storedCrcHex: string;
  calcCrcHex: string;
  frameType?: FrameTypeValue;
  frameTypeName?: string;
  sessionId?: number;
  sequenceNum?: number;
  packetIndex?: number;
  totalPackets?: number;
  payloadLength?: number;
  summary: string;
}
