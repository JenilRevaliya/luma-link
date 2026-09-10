/**
 * Standard IEEE 802.3 CRC32 Implementation
 */
const CRC_TABLE: Uint32Array = new Uint32Array(256);

// Precompute CRC table
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * Calculates 32-bit CRC over Uint8Array slice
 */
export function crc32(data: Uint8Array, start = 0, end: number = data.length): number {
  let crc = 0xFFFFFFFF;
  for (let i = start; i < end; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
