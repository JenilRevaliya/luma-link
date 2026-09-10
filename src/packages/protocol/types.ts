/**
 * LumaLink Protocol Types and Constants
 */

export const MAGIC_0 = 0x4C; // 'L'
export const MAGIC_1 = 0x4D; // 'M'
export const PROTOCOL_VERSION = 0x01;

export const MATRIX_SIZE = 16; // 16x16 cells
export const TOTAL_CELLS = MATRIX_SIZE * MATRIX_SIZE; // 256 cells
export const BITS_PER_CELL = 2; // 4 colors
export const TOTAL_FRAME_BYTES = (TOTAL_CELLS * BITS_PER_CELL) / 8; // 64 bytes

export const HEADER_SIZE = 10;
export const CRC_SIZE = 4;
export const ECC_PARITY_SIZE = 8;
export const MAX_PAYLOAD_SIZE = TOTAL_FRAME_BYTES - HEADER_SIZE - CRC_SIZE - ECC_PARITY_SIZE; // 42 bytes
export const DATA_BLOCK_SIZE = HEADER_SIZE + MAX_PAYLOAD_SIZE + CRC_SIZE; // 56 bytes (protected by ECC)

export const FrameType = {
  DISCOVERY: 0x01,
  CALIBRATION: 0x02,
  START: 0x03,
  DATA: 0x04,
  END: 0x05,
  BENCHMARK: 0x06,
} as const;

export type FrameTypeValue = (typeof FrameType)[keyof typeof FrameType];

export interface FrameHeader {
  magic0: number; // 0x4C
  magic1: number; // 0x4D
  version: number; // 0x01
  frameType: FrameTypeValue;
  sessionId: number; // 16-bit
  sequenceNum: number; // 8-bit monotonic
  packetIndex: number; // 8-bit (0..totalPackets-1)
  totalPackets: number; // 8-bit
  payloadLength: number; // 8-bit (0..MAX_PAYLOAD_SIZE)
}

export interface DecodedFrame {
  header: FrameHeader;
  payload: Uint8Array;
  validCrc: boolean;
  correctedErrors: number;
  rawBytes: Uint8Array;
}

export const ColorIndex = {
  BLACK: 0, // 0b00
  RED: 1,   // 0b01
  GREEN: 2, // 0b10
  BLUE: 3,  // 0b11
} as const;

export type ColorIndexValue = (typeof ColorIndex)[keyof typeof ColorIndex];

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export const DEFAULT_PALETTE: Record<ColorIndexValue, RGBColor> = {
  [ColorIndex.BLACK]: { r: 18, g: 18, b: 20 },
  [ColorIndex.RED]:   { r: 245, g: 45, b: 65 },
  [ColorIndex.GREEN]: { r: 35, g: 215, b: 95 },
  [ColorIndex.BLUE]:  { r: 30, g: 130, b: 255 },
};

export const REFERENCE_WHITE: RGBColor = { r: 250, g: 250, b: 250 };
export const REFERENCE_BLACK: RGBColor = { r: 15, g: 15, b: 18 };

export type PayloadMimeType =
  | 'image/webp'
  | 'image/jpeg'
  | 'text/plain'
  | 'application/json'
  | 'multipart/image+text'
  | 'application/octet-stream';

export interface SessionMetadata {
  sessionId: number;
  totalBytes: number;
  mimeType: PayloadMimeType;
  width: number;
  height: number;
  totalPackets: number;
  checksum: number;
  iv: Uint8Array;
  keyBytes?: Uint8Array;
}

export type ReceiverState =
  | 'IDLE'
  | 'SEARCHING'
  | 'DETECTED'
  | 'CALIBRATING'
  | 'TRANSMITTING'
  | 'COMPLETE'
  | 'ERROR';

export interface Point2D {
  x: number;
  y: number;
}

export interface QuadCorners {
  topLeft: Point2D;
  topRight: Point2D;
  bottomRight: Point2D;
  bottomLeft: Point2D;
}
