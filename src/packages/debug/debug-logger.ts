/**
 * LumaLink Centralized Optical Debug Logger & Diagnostic Engine
 * Captures chronological events, telemetry state, and generates full diagnostic reports
 */

export type LogCategory = 'SYS' | 'TX' | 'CAM' | 'VISION' | 'SAMPLER' | 'CODEC' | 'RX';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export interface LogEntry {
  id: number;
  timestamp: number;
  timeStr: string;
  category: LogCategory;
  level: LogLevel;
  message: string;
  details?: Record<string, any>;
}

export interface SenderTelemetry {
  isTransmitting: boolean;
  fps: number;
  currentFrameIndex: number;
  totalFrames: number;
  loopCount: number;
  sessionId?: number;
  totalPackets?: number;
  payloadBytes?: number;
  mimeType?: string;
  lastFrameType?: string;
}

export interface ReceiverTelemetry {
  isRunning: boolean;
  cameraResolution?: string;
  measuredFps: number;
  state: string;
  isCalibrated: boolean;
  confidence: number;
  consecutiveLocks: number;
  orientation: number;
  lastDecodedPacket?: string;
  receivedPacketsCount: number;
  totalPackets: number;
  missingPacketsCount: number;
  eccCorrectionsCount: number;
  lastCrcError?: string;
}

class DebugLoggerService {
  private logs: LogEntry[] = [];
  private maxLogs = 1500;
  private nextId = 1;
  private listeners: ((entry: LogEntry) => void)[] = [];
  private clearListeners: (() => void)[] = [];

  private senderTelemetry: SenderTelemetry = {
    isTransmitting: false,
    fps: 15,
    currentFrameIndex: 0,
    totalFrames: 0,
    loopCount: 0,
  };

  private receiverTelemetry: ReceiverTelemetry = {
    isRunning: false,
    measuredFps: 0,
    state: 'SEARCHING',
    isCalibrated: false,
    confidence: 0,
    consecutiveLocks: 0,
    orientation: 0,
    receivedPacketsCount: 0,
    totalPackets: 0,
    missingPacketsCount: 0,
    eccCorrectionsCount: 0,
  };

  constructor() {
    this.logSystemInit();
  }

  private logSystemInit(): void {
    const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false;
    const protocol = typeof window !== 'undefined' ? window.location.protocol : 'unknown:';
    const host = typeof window !== 'undefined' ? window.location.host : 'unknown';

    this.info('SYS', `LumaLink Optical Engine v1.0 Initialized on ${protocol}//${host}`);
    this.info('SYS', `Context Security: ${isSecure ? 'SECURE (HTTPS / Localhost)' : 'INSECURE (Plain HTTP)'}`);

    if (!isSecure && typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      this.warn(
        'SYS',
        `Running on insecure origin (${window.location.origin}). Mobile browsers (Chrome/Safari) WILL BLOCK camera getUserMedia! Deploy to Vercel (HTTPS) or use localhost for physical camera tests.`
      );
    }

    if (typeof navigator !== 'undefined') {
      const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      this.info('SYS', `Camera API Availability: ${hasMedia ? 'SUPPORTED' : 'UNAVAILABLE / BLOCKED'}`);
    }
  }

  public subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public onClear(listener: () => void): () => void {
    this.clearListeners.push(listener);
    return () => {
      this.clearListeners = this.clearListeners.filter((l) => l !== listener);
    };
  }

  public log(
    category: LogCategory,
    level: LogLevel,
    message: string,
    details?: Record<string, any>
  ): void {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(
      now.getMilliseconds()
    ).padStart(3, '0')}`;

    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: now.getTime(),
      timeStr,
      category,
      level,
      message,
      details,
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Also mirror to native devtools console
    const tag = `[${timeStr}] [${category}]`;
    if (level === 'ERROR') {
      console.error(tag, message, details || '');
    } else if (level === 'WARN') {
      console.warn(tag, message, details || '');
    } else if (level === 'SUCCESS') {
      console.log(`%c${tag} ${message}`, 'color: #00e676; font-weight: bold;', details || '');
    } else {
      console.log(tag, message, details || '');
    }

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (err) {
        console.error('DebugLogger listener error:', err);
      }
    }
  }

  public debug(category: LogCategory, message: string, details?: Record<string, any>): void {
    this.log(category, 'DEBUG', message, details);
  }

  public info(category: LogCategory, message: string, details?: Record<string, any>): void {
    this.log(category, 'INFO', message, details);
  }

  public warn(category: LogCategory, message: string, details?: Record<string, any>): void {
    this.log(category, 'WARN', message, details);
  }

  public error(category: LogCategory, message: string, details?: Record<string, any>): void {
    this.log(category, 'ERROR', message, details);
  }

  public success(category: LogCategory, message: string, details?: Record<string, any>): void {
    this.log(category, 'SUCCESS', message, details);
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public clear(): void {
    this.logs = [];
    for (const l of this.clearListeners) {
      try {
        l();
      } catch {}
    }
    this.info('SYS', 'Debug console buffer cleared');
  }

  public updateSenderTelemetry(telemetry: Partial<SenderTelemetry>): void {
    this.senderTelemetry = { ...this.senderTelemetry, ...telemetry };
  }

  public updateReceiverTelemetry(telemetry: Partial<ReceiverTelemetry>): void {
    this.receiverTelemetry = { ...this.receiverTelemetry, ...telemetry };
  }

  public getSenderTelemetry(): SenderTelemetry {
    return { ...this.senderTelemetry };
  }

  public getReceiverTelemetry(): ReceiverTelemetry {
    return { ...this.receiverTelemetry };
  }

  /**
   * Generates a comprehensive structured diagnostic dump of the entire application state
   */
  public generateFullDiagnosticDump(): string {
    const isClient = typeof window !== 'undefined';
    const now = new Date();

    const env = {
      timestamp: now.toISOString(),
      userAgent: isClient ? navigator.userAgent : 'node',
      isSecureContext: isClient ? window.isSecureContext : false,
      location: isClient ? window.location.href : '',
      screen: isClient ? `${window.screen.width}x${window.screen.height} (DPR: ${window.devicePixelRatio})` : '',
      viewport: isClient ? `${window.innerWidth}x${window.innerHeight}` : '',
      cryptoAvailable: isClient ? !!window.crypto?.subtle : false,
      mediaDeviceAvailable: isClient ? !!navigator.mediaDevices?.getUserMedia : false,
    };

    const lines: string[] = [
      '================================================================================',
      '                     LUMALINK OPTICAL DEBUG MACHINE DIAGNOSTIC DUMP             ',
      '================================================================================',
      `Generated at: ${env.timestamp}`,
      `Origin:       ${env.location}`,
      `Security:     ${env.isSecureContext ? 'SECURE (HTTPS / localhost)' : '⚠️ INSECURE (HTTP) - Camera may be blocked on mobile!'}`,
      `User Agent:   ${env.userAgent}`,
      `Screen / DPR: ${env.screen}`,
      `Viewport:     ${env.viewport}`,
      `Web Crypto:   ${env.cryptoAvailable ? 'Available' : 'NOT Available'}`,
      `Camera API:   ${env.mediaDeviceAvailable ? 'Available' : 'NOT Available'}`,
      '',
      '--------------------------------------------------------------------------------',
      '                             TRANSMITTER (SENDER) STATE                         ',
      '--------------------------------------------------------------------------------',
      `Is Transmitting:      ${this.senderTelemetry.isTransmitting ? 'YES (ACTIVE)' : 'NO (STOPPED/PAUSED)'}`,
      `FPS Setting:          ${this.senderTelemetry.fps} FPS`,
      `Session ID:           #${(this.senderTelemetry.sessionId || 0).toString(16).toUpperCase()}`,
      `Total Data Packets:   ${this.senderTelemetry.totalPackets || 0}`,
      `Total Frames in Loop: ${this.senderTelemetry.totalFrames || 0}`,
      `Current Frame Index:  ${this.senderTelemetry.currentFrameIndex}`,
      `Loop Count:           ${this.senderTelemetry.loopCount}`,
      `Payload Size:         ${this.senderTelemetry.payloadBytes || 0} bytes`,
      `MIME Type:            ${this.senderTelemetry.mimeType || 'none'}`,
      `Last Rendered Frame:  ${this.senderTelemetry.lastFrameType || 'none'}`,
      '',
      '--------------------------------------------------------------------------------',
      '                             RECEIVER (CAMERA) STATE                            ',
      '--------------------------------------------------------------------------------',
      `Camera Running:       ${this.receiverTelemetry.isRunning ? 'YES' : 'NO'}`,
      `Camera Resolution:    ${this.receiverTelemetry.cameraResolution || 'UNKNOWN'}`,
      `Measured Camera FPS:  ${this.receiverTelemetry.measuredFps} FPS`,
      `Pipeline State:       ${this.receiverTelemetry.state}`,
      `Calibrated:           ${this.receiverTelemetry.isCalibrated ? 'YES (ADAPTED)' : 'NO (PENDING)'}`,
      `Tracking Confidence:  ${Math.round(this.receiverTelemetry.confidence * 100)}%`,
      `Consecutive Locks:    ${this.receiverTelemetry.consecutiveLocks}`,
      `Locked Orientation:   ${this.receiverTelemetry.orientation * 90}°`,
      `Packets Reassembled:  ${this.receiverTelemetry.receivedPacketsCount} / ${this.receiverTelemetry.totalPackets}`,
      `Missing Packets:      ${this.receiverTelemetry.missingPacketsCount}`,
      `ECC Corrections:      ${this.receiverTelemetry.eccCorrectionsCount}`,
      `Last Decoded Packet:  ${this.receiverTelemetry.lastDecodedPacket || 'NONE'}`,
      `Last CRC / RS Issue:  ${this.receiverTelemetry.lastCrcError || 'NONE'}`,
      '',
      '--------------------------------------------------------------------------------',
      `                             RECENT CHRONOLOGICAL LOGS (${this.logs.length} entries)            `,
      '--------------------------------------------------------------------------------',
    ];

    for (const log of this.logs) {
      const lvl = log.level.padEnd(7, ' ');
      const cat = `[${log.category}]`.padEnd(9, ' ');
      let line = `[${log.timeStr}] ${lvl} ${cat} ${log.message}`;
      if (log.details && Object.keys(log.details).length > 0) {
        line += ` | details: ${JSON.stringify(log.details)}`;
      }
      lines.push(line);
    }

    lines.push('================================================================================');
    lines.push('                               END OF DIAGNOSTIC DUMP                           ');
    lines.push('================================================================================');

    return lines.join('\n');
  }

  /**
   * Copies the full diagnostic dump to the user's clipboard
   */
  public async copyDumpToClipboard(): Promise<boolean> {
    const dump = this.generateFullDiagnosticDump();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(dump);
        this.success('SYS', 'Diagnostic dump copied to clipboard via Clipboard API');
        return true;
      }
    } catch (err) {
      console.warn('Clipboard API failed, falling back to execCommand:', err);
    }

    // Fallback using textarea execCommand
    try {
      const el = document.createElement('textarea');
      el.value = dump;
      el.setAttribute('readonly', '');
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      const success = document.execCommand('copy');
      document.body.removeChild(el);
      if (success) {
        this.success('SYS', 'Diagnostic dump copied to clipboard via fallback execCommand');
        return true;
      }
    } catch (err) {
      this.error('SYS', 'Failed to copy diagnostic dump to clipboard', { error: String(err) });
    }

    return false;
  }

  /**
   * Downloads the diagnostic dump as a text file
   */
  public downloadDumpFile(): void {
    const dump = this.generateFullDiagnosticDump();
    const blob = new Blob([dump], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lumalink-debug-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.success('SYS', `Diagnostic dump downloaded: ${a.download}`);
  }
}

export const debugLogger = new DebugLoggerService();
