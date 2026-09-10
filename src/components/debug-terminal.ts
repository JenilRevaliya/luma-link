/**
 * LumaLink Skeuomorphic Optical Debug Machine & Cyber Terminal
 * Interactive CRT instrument console, live telemetry, snapshot pipeline trace, and one-click diagnostic dump
 */

import { debugLogger, type LogEntry } from '../packages/debug/debug-logger';
import type { VisionPipeline, PipelineTrace } from '../packages/decoder/vision-pipeline';
import type { ReceiverApp } from '../apps/receiver/receiver-ui';
import type { SenderApp } from '../apps/sender/sender-ui';

export class DebugTerminal {
  private container!: HTMLElement;
  private logStreamEl!: HTMLElement;
  private triggerBtn!: HTMLElement;
  private isOpen = false;
  private autoScroll = true;
  private activeFilter: string = 'ALL';

  private receiverApp?: ReceiverApp;
  private senderApp?: SenderApp;

  constructor() {
    this.createDOM();
    this.bindEvents();
    this.renderInitialLogs();
  }

  public setApps(receiver: ReceiverApp, sender: SenderApp): void {
    this.receiverApp = receiver;
    this.senderApp = sender;
  }

  private createDOM(): void {
    // 1. Floating Toggle Button (visible at bottom-right of viewport)
    this.triggerBtn = document.createElement('button');
    this.triggerBtn.id = 'debug-terminal-trigger';
    this.triggerBtn.className = 'debug-terminal-trigger-btn';
    this.triggerBtn.innerHTML = `
      <span class="trigger-icon">📟</span>
      <span class="trigger-label">DEBUG MACHINE</span>
      <span class="trigger-badge" id="debug-log-count">0</span>
    `;
    document.body.appendChild(this.triggerBtn);

    // 2. Terminal Overlay Container
    this.container = document.createElement('div');
    this.container.id = 'debug-terminal-modal';
    this.container.className = 'debug-terminal-modal';
    this.container.style.display = 'none';

    this.container.innerHTML = `
      <div class="debug-terminal-backdrop" id="debug-backdrop"></div>
      <div class="debug-terminal-chassis">
        <!-- CRT Monitor Bezel Header -->
        <div class="terminal-bezel-header">
          <div class="terminal-branding">
            <span class="terminal-led led-pulse"></span>
            <span class="terminal-title">LUMALINK OPTICAL DEBUG MACHINE [SYS V1.0]</span>
          </div>
          
          <div class="terminal-header-actions">
            <button class="btn btn-sm btn-primary" id="btn-copy-dump" title="Copy full diagnostic report to clipboard">
              📋 COPY ALL LOGS & DIAGNOSTICS
            </button>
            <button class="btn btn-sm btn-outline" id="btn-trace-snapshot" title="Run instant step-by-step pipeline diagnostic on current frame">
              📸 SNAPSHOT FRAME TRACE
            </button>
            <button class="btn btn-sm btn-outline" id="btn-toggle-hud" title="Toggle visual yellow sampling dots on receiver camera">
              🎯 SAMPLING HUD: OFF
            </button>
            <button class="btn btn-sm btn-ghost" id="btn-export-log" title="Download log file">
              💾 EXPORT
            </button>
            <button class="btn btn-sm btn-ghost" id="btn-clear-terminal" title="Clear console buffer">
              🧹 CLEAR
            </button>
            <button class="btn btn-sm btn-icon" id="btn-close-terminal" title="Close Terminal">
              ✕
            </button>
          </div>
        </div>

        <!-- Telemetry HUD Bar -->
        <div class="terminal-telemetry-hud">
          <div class="telemetry-box" id="hud-system">
            <span class="box-lbl">SYSTEM SECURITY</span>
            <span class="box-val font-mono" id="val-security-status">CHECKING...</span>
          </div>
          <div class="telemetry-box" id="hud-camera">
            <span class="box-lbl">CAMERA FEED</span>
            <span class="box-val font-mono" id="val-cam-status">INIT</span>
          </div>
          <div class="telemetry-box" id="hud-optical">
            <span class="box-lbl">OPTICAL TRACKING</span>
            <span class="box-val font-mono" id="val-tracking-status">SEARCHING</span>
          </div>
          <div class="telemetry-box" id="hud-packets">
            <span class="box-lbl">DATA REASSEMBLY</span>
            <span class="box-val font-mono" id="val-packets-status">0 / 0 PKTS</span>
          </div>
        </div>

        <!-- Filter Bar & Scroll Control -->
        <div class="terminal-controls-row">
          <div class="filter-pills" id="terminal-filter-pills">
            <button class="pill active" data-cat="ALL">ALL</button>
            <button class="pill" data-cat="SYS">SYS</button>
            <button class="pill" data-cat="TX">TX</button>
            <button class="pill" data-cat="CAM">CAM</button>
            <button class="pill" data-cat="VISION">VISION</button>
            <button class="pill" data-cat="CODEC">CODEC</button>
            <button class="pill" data-cat="RX">RX</button>
            <button class="pill pill-error" data-cat="ERRORS">ERRORS (<span id="err-counter">0</span>)</button>
          </div>

          <label class="autoscroll-toggle">
            <input type="checkbox" id="chk-autoscroll" checked />
            <span>AUTO-SCROLL</span>
          </label>
        </div>

        <!-- CRT Phosphor Output Screen -->
        <div class="terminal-crt-screen" id="terminal-crt-screen">
          <div class="terminal-scanlines"></div>
          <div class="terminal-log-stream" id="terminal-log-stream">
            <!-- Dynamic log lines injected here -->
          </div>
        </div>

        <!-- Status Footer -->
        <div class="terminal-footer">
          <div class="footer-help">
            <span class="font-mono text-cyan">TIP:</span> Point receiver camera inside central brackets. If on mobile HTTP, camera may be blocked by browser security.
          </div>
          <div class="footer-copy-feedback" id="copy-feedback-msg" style="display: none;">
            ✓ COPIED COMPLETE DIAGNOSTIC DUMP TO CLIPBOARD!
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.logStreamEl = this.container.querySelector('#terminal-log-stream') as HTMLElement;
  }

  private bindEvents(): void {
    // Open/close triggers
    this.triggerBtn.addEventListener('click', () => this.toggle());

    this.container.querySelector('#btn-close-terminal')?.addEventListener('click', () => this.close());
    this.container.querySelector('#debug-backdrop')?.addEventListener('click', () => this.close());

    // Keyboard shortcut (Escape to close, Ctrl+Shift+D or backtick to toggle)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        this.toggle();
      }
    });

    // Copy dump
    this.container.querySelector('#btn-copy-dump')?.addEventListener('click', async () => {
      await this.handleCopyDump();
    });

    // Export file
    this.container.querySelector('#btn-export-log')?.addEventListener('click', () => {
      debugLogger.downloadDumpFile();
    });

    // Clear
    this.container.querySelector('#btn-clear-terminal')?.addEventListener('click', () => {
      debugLogger.clear();
      this.logStreamEl.innerHTML = '';
      this.updateCounts();
    });

    // Frame Snapshot Trace
    this.container.querySelector('#btn-trace-snapshot')?.addEventListener('click', () => {
      this.handleSnapshotTrace();
    });

    // Toggle Sampling HUD
    const hudBtn = this.container.querySelector('#btn-toggle-hud') as HTMLButtonElement | null;
    if (hudBtn) {
      hudBtn.addEventListener('click', () => {
        if (this.receiverApp) {
          this.receiverApp.showSamplingHUD = !this.receiverApp.showSamplingHUD;
          hudBtn.textContent = this.receiverApp.showSamplingHUD ? '🎯 SAMPLING HUD: ON' : '🎯 SAMPLING HUD: OFF';
          debugLogger.info('VISION', `Sampling points visual overlay ${this.receiverApp.showSamplingHUD ? 'ENABLED' : 'DISABLED'}`);
        } else {
          debugLogger.warn('VISION', 'Receiver UI not connected to toggle sampling HUD');
        }
      });
    }

    // Auto-scroll toggle
    const chk = this.container.querySelector('#chk-autoscroll') as HTMLInputElement;
    if (chk) {
      chk.addEventListener('change', () => {
        this.autoScroll = chk.checked;
      });
    }

    // Filter pills
    const pills = this.container.querySelectorAll<HTMLButtonElement>('.filter-pills .pill');
    pills.forEach((p) => {
      p.addEventListener('click', () => {
        pills.forEach((pill) => pill.classList.remove('active'));
        p.classList.add('active');
        this.activeFilter = p.getAttribute('data-cat') || 'ALL';
        this.renderFilteredLogs();
      });
    });

    // Subscribe to logger
    debugLogger.subscribe((entry) => {
      this.appendLogEntry(entry);
      this.updateCounts();
      this.updateHud();
    });

    debugLogger.onClear(() => {
      this.logStreamEl.innerHTML = '';
      this.updateCounts();
    });

    // Periodic HUD update
    setInterval(() => {
      if (this.isOpen) {
        this.updateHud();
      }
    }, 500);
  }

  public open(): void {
    this.isOpen = true;
    this.container.style.display = 'flex';
    this.updateHud();
    this.scrollToBottom();
  }

  public close(): void {
    this.isOpen = false;
    this.container.style.display = 'none';
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private async handleCopyDump(): Promise<void> {
    const success = await debugLogger.copyDumpToClipboard();
    const feedback = this.container.querySelector('#copy-feedback-msg') as HTMLElement;
    if (feedback) {
      feedback.style.display = 'block';
      feedback.textContent = success
        ? '✓ COPIED COMPLETE DIAGNOSTIC DUMP TO CLIPBOARD!'
        : '⚠️ FAILED TO AUTO-COPY. CHECK CONSOLE.';
      setTimeout(() => {
        feedback.style.display = 'none';
      }, 3500);
    }
  }

  private handleSnapshotTrace(): void {
    debugLogger.info('SYS', 'Executing manual snapshot frame trace audit...');

    let imgData: ImageData | null = null;
    let overrideCorners: any = null;

    // Try receiver camera frame first
    if (this.receiverApp) {
      const rxAny = this.receiverApp as any;
      if (rxAny.externalFrameProvider) {
        imgData = rxAny.externalFrameProvider();
        if (rxAny.externalCornersProvider) {
          overrideCorners = rxAny.externalCornersProvider();
        }
      } else if (rxAny.cameraCanvas) {
        const ctx = rxAny.cameraCanvas.getContext('2d');
        if (ctx && rxAny.cameraCanvas.width > 0) {
          imgData = ctx.getImageData(0, 0, rxAny.cameraCanvas.width, rxAny.cameraCanvas.height);
        }
      }
    }

    // Fallback to sender canvas if receiver has no active frame
    if (!imgData && this.senderApp) {
      const canvas = this.senderApp.getCanvas();
      const ctx = canvas.getContext('2d');
      if (ctx && canvas.width > 0) {
        imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        debugLogger.info('SYS', 'Using Sender Canvas frame for snapshot audit');
      }
    }

    if (!imgData) {
      debugLogger.warn('SYS', 'No active camera frame or sender canvas available for snapshot audit. Start Camera or Transmission first.');
      return;
    }

    // Access pipeline
    const rxAny = this.receiverApp as any;
    const pipeline: VisionPipeline = rxAny?.pipeline;
    if (!pipeline) {
      debugLogger.error('SYS', 'VisionPipeline instance not found on ReceiverApp');
      return;
    }

    const trace: PipelineTrace = pipeline.traceFrame(imgData, overrideCorners);

    // Format trace report in terminal
    this.renderTraceReport(trace);
  }

  private renderTraceReport(trace: PipelineTrace): void {
    debugLogger.info('VISION', `SNAPSHOT FRAME AUTOPSY: ${trace.verdict}`);
    debugLogger.info('VISION', `Image: ${trace.imageStats.width}x${trace.imageStats.height} | Luma Min: ${trace.imageStats.minLuma}, Max: ${trace.imageStats.maxLuma}, Avg: ${trace.imageStats.avgLuma}`);
    debugLogger.info('VISION', `Corners Found: ${trace.cornersDetected ? 'YES' : 'NO'} | Homography: ${trace.homographySuccess ? 'OK' : 'FAILED'}`);
    debugLogger.info('SAMPLER', `Color Cell Distribution: Black=${trace.colorCounts.black}, Red=${trace.colorCounts.red}, Green=${trace.colorCounts.green}, Blue=${trace.colorCounts.blue}`);
    debugLogger.info('SAMPLER', `Dynamic Black Threshold: ${trace.dynamicBlackLuma} | Calibrated: ${trace.isCalibrated ? 'YES' : 'NO'}`);

    for (const rot of trace.rotations) {
      const statusTag = rot.crcMatch ? '✓ CRC PASS' : rot.magicMatch ? '⚠️ CRC FAIL' : '✗ NO MAGIC';
      debugLogger.info('CODEC', `Rot ${rot.rotationDeg}°: [${statusTag}] Magic: ${rot.magicHex} | RS Errs: ${rot.rsErrors} | ${rot.summary}`);
    }

    debugLogger.info('SYS', `DIAGNOSIS VERDICT: ${trace.verdict}`);
  }

  private renderInitialLogs(): void {
    const logs = debugLogger.getLogs();
    for (const log of logs) {
      this.appendLogEntry(log);
    }
    this.updateCounts();
    this.updateHud();
  }

  private renderFilteredLogs(): void {
    this.logStreamEl.innerHTML = '';
    const logs = debugLogger.getLogs();

    for (const log of logs) {
      if (this.matchesFilter(log)) {
        this.appendLogEntry(log, false);
      }
    }

    this.scrollToBottom();
  }

  private matchesFilter(entry: LogEntry): boolean {
    if (this.activeFilter === 'ALL') return true;
    if (this.activeFilter === 'ERRORS') return entry.level === 'ERROR' || entry.level === 'WARN';
    return entry.category === this.activeFilter;
  }

  private appendLogEntry(entry: LogEntry, shouldFilter = true): void {
    if (shouldFilter && !this.matchesFilter(entry)) {
      return;
    }

    const lineEl = document.createElement('div');
    lineEl.className = `terminal-line line-${entry.level.toLowerCase()} cat-${entry.category.toLowerCase()}`;

    let detailsStr = '';
    if (entry.details && Object.keys(entry.details).length > 0) {
      try {
        detailsStr = ` <span class="line-details">${JSON.stringify(entry.details)}</span>`;
      } catch {}
    }

    lineEl.innerHTML = `
      <span class="line-time">${entry.timeStr}</span>
      <span class="line-cat">[${entry.category}]</span>
      <span class="line-lvl">${entry.level}</span>
      <span class="line-msg">${this.escapeHtml(entry.message)}</span>
      ${detailsStr}
    `;

    this.logStreamEl.appendChild(lineEl);

    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    const crt = this.container.querySelector('#terminal-crt-screen');
    if (crt) {
      crt.scrollTop = crt.scrollHeight;
    }
  }

  private updateCounts(): void {
    const logs = debugLogger.getLogs();
    const countBadge = this.triggerBtn.querySelector('#debug-log-count') as HTMLElement;
    if (countBadge) {
      countBadge.textContent = String(logs.length);
    }

    const errCount = logs.filter((l) => l.level === 'ERROR' || l.level === 'WARN').length;
    const errCounter = this.container.querySelector('#err-counter') as HTMLElement;
    if (errCounter) {
      errCounter.textContent = String(errCount);
    }

    if (errCount > 0) {
      this.triggerBtn.classList.add('has-errors');
    } else {
      this.triggerBtn.classList.remove('has-errors');
    }
  }

  private updateHud(): void {
    const rx = debugLogger.getReceiverTelemetry();
    const tx = debugLogger.getSenderTelemetry();
    const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false;

    // Security HUD
    const secEl = this.container.querySelector('#val-security-status') as HTMLElement;
    if (secEl) {
      secEl.textContent = isSecure ? 'SECURE (HTTPS)' : '⚠️ INSECURE (HTTP)';
      secEl.className = `box-val font-mono ${isSecure ? 'text-green' : 'text-red'}`;
    }

    // Camera HUD
    const camEl = this.container.querySelector('#val-cam-status') as HTMLElement;
    if (camEl) {
      if (rx.isRunning) {
        camEl.textContent = `LIVE: ${rx.cameraResolution || 'ACTIVE'} (${rx.measuredFps} FPS)`;
        camEl.className = 'box-val font-mono text-cyan';
      } else {
        camEl.textContent = 'STOPPED';
        camEl.className = 'box-val font-mono text-muted';
      }
    }

    // Optical Tracking HUD
    const optEl = this.container.querySelector('#val-tracking-status') as HTMLElement;
    if (optEl) {
      const calibStr = rx.isCalibrated ? 'CALIB:YES' : 'CALIB:PENDING';
      optEl.textContent = `${rx.state} (${Math.round(rx.confidence * 100)}%) [${calibStr}]`;
      optEl.className = `box-val font-mono ${rx.state === 'RECEIVING' ? 'text-green' : rx.state === 'FOUND' ? 'text-amber' : 'text-cyan'}`;
    }

    // Packets HUD
    const pktEl = this.container.querySelector('#val-packets-status') as HTMLElement;
    if (pktEl) {
      if (tx.isTransmitting) {
        pktEl.textContent = `TX: PKT #${tx.currentFrameIndex}/${tx.totalPackets} (LOOP ${tx.loopCount}) [${tx.fps} FPS]`;
        pktEl.className = 'box-val font-mono text-green';
      } else if (rx.totalPackets > 0) {
        pktEl.textContent = `RX: ${rx.receivedPacketsCount} / ${rx.totalPackets} PKTS (ECC: ${rx.eccCorrectionsCount})`;
        pktEl.className = 'box-val font-mono text-cyan';
      } else {
        pktEl.textContent = 'STANDBY';
        pktEl.className = 'box-val font-mono text-muted';
      }
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
