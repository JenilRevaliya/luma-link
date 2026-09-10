/**
 * LumaLink Continuous Fountain Packet Reassembler and Session Manager
 * Features gap-aware packet tracking, pickup location detection, and multi-format payloads (Image, Text, Image+Caption)
 */

import { FrameType, type DecodedFrame, type SessionMetadata, type PayloadMimeType } from '../protocol/types';
import { CryptoEngine } from '../crypto/aes-gcm';
import { crc32 } from '../protocol/crc32';

export interface MissingRange {
  start: number;
  end: number;
}

export interface ReassemblyProgress {
  sessionId: number;
  totalPackets: number;
  receivedCount: number;
  percent: number;
  receivedMap: boolean[];
  totalBytesEstimate: number;
  lastSequence: number;
  initialPickupIndex: number | null;
  currentPacketIndex: number;
  loopCount: number;
  missingRanges: MissingRange[];
  missingHeadCount: number;
  isWaitingForLoop: boolean;
}

export interface ReassembledResult {
  sessionId: number;
  data: Uint8Array;
  dataUrl?: string;
  textContent?: string;
  isText: boolean;
  hasCaption: boolean;
  captionText?: string;
  mimeType: PayloadMimeType;
  width: number;
  height: number;
  totalPackets: number;
  totalBytes: number;
  totalCorrectedErrors: number;
}

export class PacketReassembler {
  private currentSessionId: number | null = null;
  private totalPackets = 0;
  private receivedPackets = new Map<number, Uint8Array>();
  private metadata: SessionMetadata | null = null;
  private totalCorrectedErrors = 0;
  private isComplete = false;
  private cryptoKey: CryptoKey | null = null;

  // Gap & Fountain loop tracking
  private initialPickupIndex: number | null = null;
  private currentPacketIndex = 0;
  private lastObservedPacketIdx = -1;
  private loopCount = 1;

  public onProgress?: (progress: ReassemblyProgress) => void;
  public onComplete?: (result: ReassembledResult) => void;
  public onError?: (error: Error) => void;

  public reset(): void {
    this.currentSessionId = null;
    this.totalPackets = 0;
    this.receivedPackets.clear();
    this.metadata = null;
    this.totalCorrectedErrors = 0;
    this.isComplete = false;
    this.cryptoKey = null;
    this.initialPickupIndex = null;
    this.currentPacketIndex = 0;
    this.lastObservedPacketIdx = -1;
    this.loopCount = 1;
  }

  /**
   * Ingests a validated decoded optical frame
   */
  public async ingestFrame(frame: DecodedFrame): Promise<void> {
    if (this.isComplete) return;

    const { header, payload, correctedErrors } = frame;
    this.totalCorrectedErrors += correctedErrors;

    // Session tracking
    if (this.currentSessionId === null) {
      this.currentSessionId = header.sessionId;
    } else if (this.currentSessionId !== header.sessionId) {
      // New session detected from transmitter
      if (header.frameType === FrameType.START || this.receivedPackets.size === 0) {
        this.reset();
        this.currentSessionId = header.sessionId;
      } else {
        return; // Ignore frames from old session
      }
    }

    if (header.totalPackets > 0) {
      this.totalPackets = header.totalPackets;
    }

    // Handle Frame Types
    if (header.frameType === FrameType.START) {
      await this.handleStartFrame(payload, header.sessionId, header.totalPackets);
    } else if (header.frameType === FrameType.DATA) {
      const idx = header.packetIndex;
      this.currentPacketIndex = idx;

      // Track first packet received upon locking
      if (this.initialPickupIndex === null) {
        this.initialPickupIndex = idx;
      }

      // Loop detection (e.g. index wrapped around)
      if (this.lastObservedPacketIdx !== -1 && idx < this.lastObservedPacketIdx) {
        this.loopCount++;
      }
      this.lastObservedPacketIdx = idx;

      if (!this.receivedPackets.has(idx)) {
        this.receivedPackets.set(idx, payload);
      }
    }

    this.notifyProgress(header.sequenceNum);

    // Check if reassembly is complete
    if (this.totalPackets > 0 && this.receivedPackets.size >= this.totalPackets && this.metadata) {
      await this.finalizeReassembly();
    }
  }

  private async handleStartFrame(payload: Uint8Array, sessionId: number, totalPackets: number): Promise<void> {
    if (payload.length < 21) return; // Minimum start payload

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const totalBytes = view.getUint32(0, false);
    const mimeCode = payload[4];
    const width = view.getUint16(5, false);
    const height = view.getUint16(7, false);
    const checksum = view.getUint32(9, false);

    const iv = payload.slice(13, 25); // 12 bytes IV
    let keyBytes: Uint8Array | undefined;

    if (payload.length >= 41) {
      keyBytes = payload.slice(25, 41); // 16 bytes Key
      try {
        this.cryptoKey = await CryptoEngine.importKey(keyBytes);
      } catch (err) {
        console.warn('Failed to import embedded crypto key:', err);
      }
    }

    let mimeType: PayloadMimeType = 'image/webp';
    if (mimeCode === 1) mimeType = 'image/webp';
    else if (mimeCode === 2) mimeType = 'image/jpeg';
    else if (mimeCode === 3) mimeType = 'text/plain';
    else if (mimeCode === 4) mimeType = 'application/json';
    else if (mimeCode === 5) mimeType = 'multipart/image+text';

    this.metadata = {
      sessionId,
      totalBytes,
      mimeType,
      width,
      height,
      totalPackets,
      checksum,
      iv,
      keyBytes,
    };
  }

  private async finalizeReassembly(): Promise<void> {
    if (this.isComplete || !this.metadata) return;
    this.isComplete = true;

    try {
      // Concatenate all packets in order [0..totalPackets-1]
      let totalCiphertextBytes = 0;
      for (let i = 0; i < this.totalPackets; i++) {
        const pkt = this.receivedPackets.get(i);
        if (!pkt) {
          throw new Error(`Missing packet ${i} during finalization`);
        }
        totalCiphertextBytes += pkt.length;
      }

      const combinedCiphertext = new Uint8Array(totalCiphertextBytes);
      let offset = 0;
      for (let i = 0; i < this.totalPackets; i++) {
        const pkt = this.receivedPackets.get(i)!;
        combinedCiphertext.set(pkt, offset);
        offset += pkt.length;
      }

      // Decrypt payload
      let decryptedBytes: Uint8Array;
      if (this.cryptoKey) {
        decryptedBytes = await CryptoEngine.decrypt(
          combinedCiphertext,
          this.cryptoKey,
          this.metadata.iv
        );
      } else {
        decryptedBytes = combinedCiphertext;
      }

      // Verify checksum if available
      if (this.metadata.checksum !== 0) {
        const calcCrc = crc32(decryptedBytes);
        if (calcCrc !== this.metadata.checksum) {
          console.warn(`CRC mismatch: calculated ${calcCrc} vs metadata ${this.metadata.checksum}`);
        }
      }

      // Process payload depending on mime type
      let dataUrl: string | undefined;
      let textContent: string | undefined;
      let captionText: string | undefined;
      const isText = this.metadata.mimeType === 'text/plain' || this.metadata.mimeType === 'application/json';
      const hasCaption = this.metadata.mimeType === 'multipart/image+text';

      if (isText) {
        textContent = new TextDecoder('utf-8').decode(decryptedBytes);
      } else if (hasCaption) {
        // Format: 2 bytes text length (big endian), text bytes, remaining image bytes
        const view = new DataView(decryptedBytes.buffer, decryptedBytes.byteOffset, decryptedBytes.byteLength);
        const textLen = view.getUint16(0, false);
        const textBytes = decryptedBytes.subarray(2, 2 + textLen);
        const imageBytes = decryptedBytes.subarray(2 + textLen);

        captionText = new TextDecoder('utf-8').decode(textBytes);
        const blob = new Blob([imageBytes as unknown as BlobPart], { type: 'image/webp' });
        dataUrl = URL.createObjectURL(blob);
      } else {
        // Standard Image
        const blob = new Blob([decryptedBytes as unknown as BlobPart], { type: this.metadata.mimeType });
        dataUrl = URL.createObjectURL(blob);
      }

      const result: ReassembledResult = {
        sessionId: this.metadata.sessionId,
        data: decryptedBytes,
        dataUrl,
        textContent,
        isText,
        hasCaption,
        captionText,
        mimeType: this.metadata.mimeType,
        width: this.metadata.width,
        height: this.metadata.height,
        totalPackets: this.totalPackets,
        totalBytes: decryptedBytes.length,
        totalCorrectedErrors: this.totalCorrectedErrors,
      };

      this.onComplete?.(result);
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private notifyProgress(lastSeq: number): void {
    const total = this.totalPackets || 1;
    const count = this.receivedPackets.size;
    const percent = Math.min(100, Math.round((count / total) * 100));

    const receivedMap: boolean[] = new Array(total).fill(false);
    for (let i = 0; i < total; i++) {
      if (this.receivedPackets.has(i)) {
        receivedMap[i] = true;
      }
    }

    // Compute missing ranges
    const missingRanges: MissingRange[] = [];
    let inGap = false;
    let gapStart = 0;

    for (let i = 0; i < total; i++) {
      if (!receivedMap[i]) {
        if (!inGap) {
          inGap = true;
          gapStart = i;
        }
      } else {
        if (inGap) {
          missingRanges.push({ start: gapStart, end: i - 1 });
          inGap = false;
        }
      }
    }
    if (inGap) {
      missingRanges.push({ start: gapStart, end: total - 1 });
    }

    // Check if waiting for beginning of file in loop 2
    let missingHeadCount = 0;
    if (this.initialPickupIndex !== null && this.initialPickupIndex > 0) {
      for (let i = 0; i < this.initialPickupIndex; i++) {
        if (!receivedMap[i]) missingHeadCount++;
      }
    }

    const isWaitingForLoop = missingHeadCount > 0 && this.currentPacketIndex >= (this.initialPickupIndex || 0);

    this.onProgress?.({
      sessionId: this.currentSessionId || 0,
      totalPackets: total,
      receivedCount: count,
      percent,
      receivedMap,
      totalBytesEstimate: this.metadata?.totalBytes || 0,
      lastSequence: lastSeq,
      initialPickupIndex: this.initialPickupIndex,
      currentPacketIndex: this.currentPacketIndex,
      loopCount: this.loopCount,
      missingRanges,
      missingHeadCount,
      isWaitingForLoop,
    });
  }
}
