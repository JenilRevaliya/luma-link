/**
 * LumaLink Optical Sender Interface
 */

import { VisualFrameRenderer } from '../../packages/encoder/visual-frame';
import { ImageCropper, type CropMode } from '../../packages/image/cropper';
import { ImageCompressor } from '../../packages/image/compressor';
import { PacketStreamGenerator, type PreparedStream } from '../../packages/encoder/stream';
import { SAMPLE_PRESETS } from '../../components/sample-images';
import { FrameType } from '../../packages/protocol/types';

export class SenderApp {
  private container: HTMLElement;
  private currentImage: HTMLImageElement | HTMLCanvasElement | null = null;
  private cropMode: CropMode = 'center-crop';
  private targetResolution = 384;
  private quality = 0.78;
  private fps = 24;

  private preparedStream: PreparedStream | null = null;
  private currentFrameIndex = 0;
  private loopCount = 1;
  private isTransmitting = false;
  private animTimer: number | null = null;
  private lastFrameTime = 0;

  private canvas!: HTMLCanvasElement;
  private progressBarEl!: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = `
      <div class="sender-view">
        <div class="glass-panel sender-controls-panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="icon-pulse">✦</span> SENDER CONFIGURATION
            </div>
            <span class="badge badge-accent">STAGE 1: INPUT</span>
          </div>

          <!-- Upload Dropzone -->
          <div class="dropzone" id="sender-dropzone">
            <input type="file" id="sender-file-input" accept="image/*" style="display:none;" />
            <div class="dropzone-content">
              <div class="upload-icon">⇪</div>
              <div class="dropzone-text">
                <strong>Click or Drop Image</strong>
                <span>Supports JPG, PNG, WebP (or paste from clipboard)</span>
              </div>
            </div>
          </div>

          <!-- Sample Presets -->
          <div class="presets-row">
            <span class="text-muted">Or load sample:</span>
            ${SAMPLE_PRESETS.map(
              (p) => `<button class="btn btn-sm btn-outline preset-btn" data-id="${p.id}">${p.name}</button>`
            ).join('')}
          </div>

          <!-- Compression & Crop Controls -->
          <div class="controls-grid">
            <div class="control-group">
              <label class="control-label">Resolution Preset</label>
              <select class="select-input" id="resolution-select">
                <option value="256">256 × 256 (Ultra-Fast ~5KB, ~3s)</option>
                <option value="384" selected>384 × 384 (Standard ~15KB, ~8s)</option>
                <option value="512">512 × 512 (HQ ~35KB, ~18s)</option>
              </select>
            </div>

            <div class="control-group">
              <label class="control-label">Aspect Conversion</label>
              <div class="btn-group">
                <button class="btn btn-sm btn-primary crop-btn active" data-mode="center-crop">Center Crop</button>
                <button class="btn btn-sm btn-outline crop-btn" data-mode="fit">Fit / Letterbox</button>
              </div>
            </div>

            <div class="control-group">
              <div class="slider-header">
                <label class="control-label">Modulation Rate (FPS)</label>
                <span class="slider-value" id="fps-display">${this.fps} FPS</span>
              </div>
              <input type="range" class="range-slider" id="fps-slider" min="8" max="60" value="${this.fps}" step="2" />
            </div>

            <div class="control-group">
              <div class="slider-header">
                <label class="control-label">WebP Quality</label>
                <span class="slider-value" id="quality-display">78%</span>
              </div>
              <input type="range" class="range-slider" id="quality-slider" min="40" max="95" value="78" step="5" />
            </div>
          </div>

          <!-- Payload Summary -->
          <div class="stream-summary-card" id="stream-summary">
            <div class="summary-item">
              <span class="label">Compressed Size</span>
              <span class="value" id="summary-size">-- KB</span>
            </div>
            <div class="summary-item">
              <span class="label">Total Packets</span>
              <span class="value" id="summary-packets">--</span>
            </div>
            <div class="summary-item">
              <span class="label">Est. Transfer</span>
              <span class="value" id="summary-est">-- s</span>
            </div>
            <div class="summary-item">
              <span class="label">Security</span>
              <span class="value text-cyan">AES-GCM-128</span>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="action-buttons-row">
            <button class="btn btn-primary btn-lg" id="btn-start-tx" disabled>
              ▶ START TRANSMISSION
            </button>
            <button class="btn btn-outline btn-lg" id="btn-pause-tx" disabled>
              ❚❚ PAUSE
            </button>
            <button class="btn btn-ghost" id="btn-fullscreen">
              ⛶ FULLSCREEN
            </button>
          </div>
        </div>

        <!-- Optical Screen Transmitter Panel -->
        <div class="glass-panel sender-display-panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="status-dot status-live" id="tx-status-dot"></span> OPTICAL TRANSMITTER
            </div>
            <div class="telemetry-badges">
              <span class="badge badge-outline" id="session-badge">SESSION: --</span>
              <span class="badge badge-accent" id="loop-badge">LOOP 1</span>
            </div>
          </div>

          <div class="optical-canvas-wrapper" id="canvas-wrapper">
            <canvas id="optical-canvas" width="640" height="640"></canvas>
            <div class="screen-watermark">LUMALINK OPTICAL AIRGAP</div>
          </div>

          <!-- Progress and Telemetry -->
          <div class="tx-telemetry-hud" id="tx-hud">
            <div class="progress-bar-container">
              <div class="progress-bar-fill" id="tx-progress-bar" style="width: 0%;"></div>
            </div>
            <div class="telemetry-stats">
              <span id="telemetry-frame-type">FRAME: READY</span>
              <span id="telemetry-packet-idx">PACKET: 0 / 0</span>
              <span id="telemetry-bitrate">0.0 kbps</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    // Load default preset initially
    this.loadPreset(SAMPLE_PRESETS[0].id);
  }

  private bindEvents(): void {
    const fileInput = this.container.querySelector('#sender-file-input') as HTMLInputElement;
    const dropzone = this.container.querySelector('#sender-dropzone') as HTMLElement;

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.loadFile(file);
    });

    // Drag & Drop
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) this.loadFile(file);
    });

    // Clipboard Paste
    window.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) this.loadFile(file);
          break;
        }
      }
    });

    // Preset buttons
    this.container.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-id')!;
        this.loadPreset(id);
      });
    });

    // Resolution & Crop Mode
    const resSelect = this.container.querySelector('#resolution-select') as HTMLSelectElement;
    resSelect.addEventListener('change', () => {
      this.targetResolution = parseInt(resSelect.value, 10);
      this.processAndPrepare();
    });

    this.container.querySelectorAll('.crop-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.container.querySelectorAll('.crop-btn').forEach((b) => b.classList.remove('active'));
        const el = e.currentTarget as HTMLElement;
        el.classList.add('active');
        this.cropMode = el.getAttribute('data-mode') as CropMode;
        this.processAndPrepare();
      });
    });

    // Sliders
    const fpsSlider = this.container.querySelector('#fps-slider') as HTMLInputElement;
    const fpsDisplay = this.container.querySelector('#fps-display') as HTMLElement;
    fpsSlider.addEventListener('input', () => {
      this.fps = parseInt(fpsSlider.value, 10);
      fpsDisplay.textContent = `${this.fps} FPS`;
    });

    const qSlider = this.container.querySelector('#quality-slider') as HTMLInputElement;
    const qDisplay = this.container.querySelector('#quality-display') as HTMLElement;
    qSlider.addEventListener('input', () => {
      this.quality = parseInt(qSlider.value, 10) / 100;
      qDisplay.textContent = `${Math.round(this.quality * 100)}%`;
      this.processAndPrepare();
    });

    // Buttons
    const startBtn = this.container.querySelector('#btn-start-tx') as HTMLButtonElement;
    const pauseBtn = this.container.querySelector('#btn-pause-tx') as HTMLButtonElement;
    const fullBtn = this.container.querySelector('#btn-fullscreen') as HTMLButtonElement;

    startBtn.addEventListener('click', () => this.startTransmission());
    pauseBtn.addEventListener('click', () => this.pauseTransmission());

    fullBtn.addEventListener('click', () => {
      const wrapper = this.container.querySelector('#canvas-wrapper') as HTMLElement;
      if (!document.fullscreenElement) {
        wrapper.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    this.canvas = this.container.querySelector('#optical-canvas') as HTMLCanvasElement;
    this.progressBarEl = this.container.querySelector('#tx-progress-bar') as HTMLElement;
  }

  private loadFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        this.currentImage = img;
        this.processAndPrepare();
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  private loadPreset(id: string): void {
    const preset = SAMPLE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    this.currentImage = preset.generate();
    this.processAndPrepare();
  }

  private async processAndPrepare(): Promise<void> {
    if (!this.currentImage) return;

    // Crop to square
    const croppedCanvas = ImageCropper.cropToSquare(
      this.currentImage,
      this.targetResolution,
      this.cropMode
    );

    // Compress
    const compressed = await ImageCompressor.compressCanvas(croppedCanvas, this.quality);

    // Update summary UI
    (this.container.querySelector('#summary-size') as HTMLElement).textContent = `${(
      compressed.byteSize / 1024
    ).toFixed(1)} KB`;
    (this.container.querySelector('#summary-packets') as HTMLElement).textContent = String(
      compressed.totalPackets
    );
    (this.container.querySelector('#summary-est') as HTMLElement).textContent = `~${(
      (compressed.totalPackets + 4) /
      this.fps
    ).toFixed(1)} s`;

    // Prepare packet stream
    this.preparedStream = await PacketStreamGenerator.prepareStream({
      data: compressed.data,
      mimeType: compressed.mimeType,
      width: compressed.width,
      height: compressed.height,
      encrypt: true,
    });

    (this.container.querySelector('#session-badge') as HTMLElement).textContent = `SESSION: #${this.preparedStream.sessionId.toString(16).toUpperCase()}`;

    // Enable Start button
    const startBtn = this.container.querySelector('#btn-start-tx') as HTMLButtonElement;
    startBtn.disabled = false;

    // Render initial discovery/idle frame
    if (this.preparedStream.frames.length > 0) {
      VisualFrameRenderer.renderToCanvas(this.canvas, this.preparedStream.frames[0].cellGrid);
    }
  }

  public startTransmission(): void {
    if (!this.preparedStream || this.isTransmitting) return;

    this.isTransmitting = true;
    (this.container.querySelector('#btn-start-tx') as HTMLButtonElement).disabled = true;
    (this.container.querySelector('#btn-pause-tx') as HTMLButtonElement).disabled = false;
    (this.container.querySelector('#tx-status-dot') as HTMLElement).classList.add('status-active');

    this.lastFrameTime = performance.now();
    this.tick();
  }

  public pauseTransmission(): void {
    this.isTransmitting = false;
    if (this.animTimer) {
      cancelAnimationFrame(this.animTimer);
      this.animTimer = null;
    }
    (this.container.querySelector('#btn-start-tx') as HTMLButtonElement).disabled = false;
    (this.container.querySelector('#btn-pause-tx') as HTMLButtonElement).disabled = true;
    (this.container.querySelector('#tx-status-dot') as HTMLElement).classList.remove('status-active');
  }

  private tick(): void {
    if (!this.isTransmitting || !this.preparedStream) return;

    const now = performance.now();
    const interval = 1000 / this.fps;

    if (now - this.lastFrameTime >= interval) {
      this.lastFrameTime = now;
      this.renderNextFrame();
    }

    this.animTimer = requestAnimationFrame(() => this.tick());
  }

  private renderNextFrame(): void {
    if (!this.preparedStream) return;

    const frame = this.preparedStream.frames[this.currentFrameIndex];
    VisualFrameRenderer.renderToCanvas(this.canvas, frame.cellGrid);

    // Update telemetry
    const typeNames: Record<number, string> = {
      [FrameType.DISCOVERY]: 'DISCOVERY',
      [FrameType.CALIBRATION]: 'CALIBRATION',
      [FrameType.START]: 'START METADATA',
      [FrameType.DATA]: 'DATA CHUNK',
      [FrameType.END]: 'LOOP END',
    };

    const typeStr = typeNames[frame.type] || 'FRAME';
    (this.container.querySelector('#telemetry-frame-type') as HTMLElement).textContent = `FRAME: ${typeStr}`;
    (this.container.querySelector('#telemetry-packet-idx') as HTMLElement).textContent = `PKT ${frame.packetIndex} / ${this.preparedStream.totalPackets}`;

    const pct = Math.round((this.currentFrameIndex / this.preparedStream.frames.length) * 100);
    this.progressBarEl.style.width = `${pct}%`;

    const bitrate = ((512 * this.fps) / 1000).toFixed(1);
    (this.container.querySelector('#telemetry-bitrate') as HTMLElement).textContent = `${bitrate} kbps`;

    // Advance frame index
    this.currentFrameIndex++;
    if (this.currentFrameIndex >= this.preparedStream.frames.length) {
      this.currentFrameIndex = 0;
      this.loopCount++;
      (this.container.querySelector('#loop-badge') as HTMLElement).textContent = `LOOP ${this.loopCount}`;
    }
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public getPreparedStream(): PreparedStream | null {
    return this.preparedStream;
  }
}
