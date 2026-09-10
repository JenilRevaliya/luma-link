/**
 * LumaLink Optical Sender Interface
 * Supports Photo, Text, and Photo+Caption transmission with live scanning beam visualization
 */

import { VisualFrameRenderer } from '../../packages/encoder/visual-frame';
import { ImageCropper, type CropMode } from '../../packages/image/cropper';
import { ImageCompressor } from '../../packages/image/compressor';
import { PacketStreamGenerator, type PreparedStream } from '../../packages/encoder/stream';
import { SAMPLE_PRESETS, SAMPLE_TEXT_PRESETS } from '../../components/sample-images';
import { FrameType, type PayloadMimeType } from '../../packages/protocol/types';
import { debugLogger } from '../../packages/debug/debug-logger';

export type SenderInputMode = 'photo' | 'text' | 'photo-caption';

export class SenderApp {
  private container: HTMLElement;
  private inputMode: SenderInputMode = 'photo';

  // Photo state
  private currentImage: HTMLImageElement | HTMLCanvasElement | null = null;
  private cropMode: CropMode = 'center-crop';
  private targetResolution = 128;
  private quality = 0.72;

  // Text state
  private currentText = '';

  private fps = 10;
  private preparedStream: PreparedStream | null = null;
  private currentFrameIndex = 0;
  private loopCount = 1;
  private isTransmitting = false;
  private animTimer: number | null = null;
  private lastFrameTime = 0;

  private canvas!: HTMLCanvasElement;
  private progressBarEl!: HTMLElement;
  private laserBeamEl!: HTMLElement;
  private scanProgressTextEl!: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = `
      <div class="sender-view">
        <div class="glass-panel sender-controls-panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="status-dot status-active"></span> SENDER CONFIGURATION
            </div>
            <span class="badge badge-accent">STAGE 1: INPUT</span>
          </div>

          <!-- Payload Mode Selector (Tactile Rocker) -->
          <div class="payload-mode-selector">
            <button class="btn btn-sm btn-outline mode-toggle-btn active" data-mode="photo">
              📷 PHOTO
            </button>
            <button class="btn btn-sm btn-outline mode-toggle-btn" data-mode="text">
              📝 TEXT / NOTE
            </button>
            <button class="btn btn-sm btn-outline mode-toggle-btn" data-mode="photo-caption">
              📷+📝 PHOTO + CAPTION
            </button>
          </div>

          <!-- Photo Input Section -->
          <div id="section-photo-input">
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

            <div class="presets-row">
              <span class="text-muted">Image presets:</span>
              ${SAMPLE_PRESETS.map(
                (p) => `<button class="btn btn-sm btn-outline preset-btn" data-id="${p.id}">${p.name}</button>`
              ).join('')}
            </div>

            <div class="controls-grid">
              <div class="control-group">
                <label class="control-label">Resolution Preset</label>
                <select class="select-input" id="resolution-select">
                  <option value="128" selected>128 × 128 (Ultra-Fast ~2KB, ~3s)</option>
                  <option value="192">192 × 192 (Standard ~5KB, ~8s)</option>
                  <option value="256">256 × 256 (Detailed ~12KB, ~20s)</option>
                  <option value="384">384 × 384 (High-Res ~25KB, ~45s)</option>
                </select>
              </div>

              <div class="control-group">
                <label class="control-label">Aspect Conversion</label>
                <div class="btn-group">
                  <button class="btn btn-sm btn-primary crop-btn active" data-mode="center-crop">Center Crop</button>
                  <button class="btn btn-sm btn-outline crop-btn" data-mode="fit">Fit / Pad</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Text Input Section (Hidden in photo mode) -->
          <div id="section-text-input" style="display: none;">
            <div class="control-group">
              <label class="control-label">Confidential Text / Secret Note</label>
              <textarea
                class="skeuo-textarea"
                id="sender-text-area"
                rows="4"
                placeholder="Type confidential note, private key, credentials, or JSON payload to transmit optically..."
              ></textarea>
            </div>

            <div class="presets-row">
              <span class="text-muted">Text presets:</span>
              ${SAMPLE_TEXT_PRESETS.map(
                (p) => `<button class="btn btn-sm btn-outline text-preset-btn" data-id="${p.id}">${p.name}</button>`
              ).join('')}
            </div>
          </div>

          <!-- Caption Input for Photo+Caption Mode -->
          <div id="section-caption-input" style="display: none;">
            <div class="control-group">
              <label class="control-label">Attached Caption</label>
              <input
                type="text"
                class="select-input"
                id="sender-caption-input"
                placeholder="Optional caption attached to image..."
                maxlength="120"
              />
            </div>
          </div>

          <!-- Modulation & Quality Tuning -->
          <div class="controls-grid">
            <div class="control-group">
              <div class="slider-header">
                <label class="control-label">Modulation Rate (FPS)</label>
                <span class="slider-value" id="fps-display">${this.fps} FPS</span>
              </div>
              <input type="range" class="range-slider" id="fps-slider" min="4" max="30" value="${this.fps}" step="1" />
              <div class="presets-row" style="margin-top: 0.4rem;">
                <button class="btn btn-xs btn-outline fps-preset-btn" data-fps="8">8 FPS (Safe)</button>
                <button class="btn btn-xs btn-outline fps-preset-btn" data-fps="10">10 FPS (Optimal)</button>
                <button class="btn btn-xs btn-outline fps-preset-btn" data-fps="12">12 FPS (Turbo)</button>
                <button class="btn btn-xs btn-outline fps-preset-btn" data-fps="15">15 FPS (Max)</button>
              </div>
            </div>

            <div class="control-group" id="group-quality-slider">
              <div class="slider-header">
                <label class="control-label">Compression Quality</label>
                <span class="slider-value" id="quality-display">78%</span>
              </div>
              <input type="range" class="range-slider" id="quality-slider" min="40" max="95" value="78" step="5" />
            </div>
          </div>

          <!-- Summary Readout -->
          <div class="stream-summary-card" id="stream-summary">
            <div class="summary-item">
              <span class="label">Payload Size</span>
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
              <span class="label">Encryption</span>
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
            <button class="btn btn-outline" id="btn-step-tx" disabled title="Step 1 optical frame at a time to test camera locking without motion blur">
              ⏭ STEP FRAME
            </button>
            <button class="btn btn-ghost" id="btn-fullscreen">
              ⛶ FULLSCREEN
            </button>
          </div>
        </div>

        <!-- Optical Screen Transmitter & Live Beam Visualizer -->
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

          <!-- Live Beaming Preview Monitor Card -->
          <div class="transmission-monitor-card" id="tx-monitor-card">
            <div class="monitor-header">
              <span class="text-xs text-muted">LIVE TRANSMISSION MONITOR</span>
              <span class="text-xs text-cyan font-mono" id="scan-progress-text">READY</span>
            </div>
            <div class="monitor-display-area" id="monitor-display-area">
              <!-- Image Preview or Text Preview -->
              <img id="monitor-img-preview" alt="Payload Preview" style="display:none;" />
              <div id="monitor-text-preview" class="monitor-text-view" style="display:none;"></div>
              <!-- Animated Optical Scanline Laser Beam -->
              <div class="transmission-laser-beam" id="transmission-laser-beam"></div>
            </div>
          </div>

          <!-- Optical Matrix Frame Screen -->
          <div class="optical-canvas-wrapper" id="canvas-wrapper">
            <canvas id="optical-canvas" width="640" height="640"></canvas>
            <div class="screen-watermark">LUMALINK OPTICAL AIRGAP</div>
          </div>

          <!-- Progress & Readout -->
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
    // Default load initial preset
    this.loadPreset(SAMPLE_PRESETS[0].id);
  }

  private bindEvents(): void {
    // Mode toggles
    this.container.querySelectorAll('.mode-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.container.querySelectorAll('.mode-toggle-btn').forEach((b) => b.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        this.setInputMode(target.getAttribute('data-mode') as SenderInputMode);
      });
    });

    // File input
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

    // Clipboard paste
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

    // Image Presets
    this.container.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-id')!;
        this.loadPreset(id);
      });
    });

    // Text Presets
    this.container.querySelectorAll('.text-preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-id')!;
        const p = SAMPLE_TEXT_PRESETS.find((tp) => tp.id === id);
        if (p) {
          const area = this.container.querySelector('#sender-text-area') as HTMLTextAreaElement;
          area.value = p.text;
          this.currentText = p.text;
          this.processAndPrepare();
        }
      });
    });

    // Textarea input change
    const textArea = this.container.querySelector('#sender-text-area') as HTMLTextAreaElement;
    textArea.addEventListener('input', () => {
      this.currentText = textArea.value;
      this.processAndPrepare();
    });

    // Caption input change
    const captionInput = this.container.querySelector('#sender-caption-input') as HTMLInputElement;
    captionInput.addEventListener('input', () => {
      this.processAndPrepare();
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

    // FPS Presets
    this.container.querySelectorAll<HTMLButtonElement>('.fps-preset-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const val = parseInt(b.getAttribute('data-fps') || '10', 10);
        this.fps = val;
        fpsSlider.value = String(val);
        fpsDisplay.textContent = `${val} FPS`;
        debugLogger.info('TX', `Modulation rate switched to ${val} FPS`);
      });
    });

    // Buttons
    const startBtn = this.container.querySelector('#btn-start-tx') as HTMLButtonElement;
    const pauseBtn = this.container.querySelector('#btn-pause-tx') as HTMLButtonElement;
    const stepBtn = this.container.querySelector('#btn-step-tx') as HTMLButtonElement;
    const fullBtn = this.container.querySelector('#btn-fullscreen') as HTMLButtonElement;

    startBtn.addEventListener('click', () => this.startTransmission());
    pauseBtn.addEventListener('click', () => this.pauseTransmission());
    stepBtn.addEventListener('click', () => this.stepFrame());

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
    this.laserBeamEl = this.container.querySelector('#transmission-laser-beam') as HTMLElement;
    this.scanProgressTextEl = this.container.querySelector('#scan-progress-text') as HTMLElement;
  }

  private setInputMode(mode: SenderInputMode): void {
    this.inputMode = mode;
    const photoSection = this.container.querySelector('#section-photo-input') as HTMLElement;
    const textSection = this.container.querySelector('#section-text-input') as HTMLElement;
    const captionSection = this.container.querySelector('#section-caption-input') as HTMLElement;
    const qualityGroup = this.container.querySelector('#group-quality-slider') as HTMLElement;

    if (mode === 'photo') {
      photoSection.style.display = 'block';
      textSection.style.display = 'none';
      captionSection.style.display = 'none';
      qualityGroup.style.display = 'flex';
      if (!this.currentImage) {
        this.loadPreset(SAMPLE_PRESETS[0].id);
      }
    } else if (mode === 'text') {
      photoSection.style.display = 'none';
      textSection.style.display = 'block';
      captionSection.style.display = 'none';
      qualityGroup.style.display = 'none';
      if (!this.currentText) {
        const area = this.container.querySelector('#sender-text-area') as HTMLTextAreaElement;
        area.value = SAMPLE_TEXT_PRESETS[0].text;
        this.currentText = area.value;
      }
    } else {
      // Photo + Caption
      photoSection.style.display = 'block';
      textSection.style.display = 'none';
      captionSection.style.display = 'block';
      qualityGroup.style.display = 'flex';
      if (!this.currentImage) {
        this.loadPreset(SAMPLE_PRESETS[0].id);
      }
    }

    this.processAndPrepare();
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
    const imgPreview = this.container.querySelector('#monitor-img-preview') as HTMLImageElement;
    const textPreview = this.container.querySelector('#monitor-text-preview') as HTMLElement;

    let payloadBytes: Uint8Array;
    let mimeType: PayloadMimeType;
    let previewWidth = 0;
    let previewHeight = 0;

    if (this.inputMode === 'text') {
      const text = this.currentText || 'Empty text payload';
      payloadBytes = new TextEncoder().encode(text);
      mimeType = 'text/plain';

      imgPreview.style.display = 'none';
      textPreview.style.display = 'block';
      textPreview.textContent = text;
    } else if (this.inputMode === 'photo-caption') {
      if (!this.currentImage) return;

      const cropped = ImageCropper.cropToSquare(this.currentImage, this.targetResolution, this.cropMode);
      const compressed = await ImageCompressor.compressCanvas(cropped, this.quality);

      const caption = (this.container.querySelector('#sender-caption-input') as HTMLInputElement).value || '';
      const captionBytes = new TextEncoder().encode(caption);

      // Pack 2 bytes text length + text bytes + image bytes
      const totalLen = 2 + captionBytes.length + compressed.data.length;
      payloadBytes = new Uint8Array(totalLen);
      const view = new DataView(payloadBytes.buffer);
      view.setUint16(0, captionBytes.length, false);
      payloadBytes.set(captionBytes, 2);
      payloadBytes.set(compressed.data, 2 + captionBytes.length);

      mimeType = 'multipart/image+text';
      previewWidth = compressed.width;
      previewHeight = compressed.height;

      imgPreview.style.display = 'block';
      imgPreview.src = compressed.dataUrl;
      textPreview.style.display = caption ? 'block' : 'none';
      textPreview.textContent = `Caption: ${caption}`;
    } else {
      // Standard Photo
      if (!this.currentImage) return;

      const cropped = ImageCropper.cropToSquare(this.currentImage, this.targetResolution, this.cropMode);
      const compressed = await ImageCompressor.compressCanvas(cropped, this.quality);

      payloadBytes = compressed.data;
      mimeType = compressed.mimeType;
      previewWidth = compressed.width;
      previewHeight = compressed.height;

      imgPreview.style.display = 'block';
      imgPreview.src = compressed.dataUrl;
      textPreview.style.display = 'none';
    }

    // Update summary UI
    (this.container.querySelector('#summary-size') as HTMLElement).textContent = `${(
      payloadBytes.length / 1024
    ).toFixed(1)} KB`;

    // Prepare optical stream
    this.preparedStream = await PacketStreamGenerator.prepareStream({
      data: payloadBytes,
      mimeType,
      width: previewWidth,
      height: previewHeight,
      encrypt: true,
    });

    (this.container.querySelector('#summary-packets') as HTMLElement).textContent = String(
      this.preparedStream.totalPackets
    );
    (this.container.querySelector('#summary-est') as HTMLElement).textContent = `~${(
      (this.preparedStream.totalPackets + 4) /
      this.fps
    ).toFixed(1)} s`;

    (this.container.querySelector('#session-badge') as HTMLElement).textContent = `SESSION: #${this.preparedStream.sessionId.toString(16).toUpperCase()}`;

    // Enable Start & Step buttons
    const startBtn = this.container.querySelector('#btn-start-tx') as HTMLButtonElement;
    const stepBtn = this.container.querySelector('#btn-step-tx') as HTMLButtonElement;
    startBtn.disabled = false;
    stepBtn.disabled = false;

    debugLogger.success('TX', `Prepared optical stream session #${this.preparedStream.sessionId.toString(16).toUpperCase()} (${this.preparedStream.totalPackets} pkts, ${payloadBytes.length} bytes, ${mimeType})`);

    debugLogger.updateSenderTelemetry({
      isTransmitting: false,
      fps: this.fps,
      currentFrameIndex: 0,
      totalFrames: this.preparedStream.frames.length,
      loopCount: this.loopCount,
      sessionId: this.preparedStream.sessionId,
      totalPackets: this.preparedStream.totalPackets,
      payloadBytes: payloadBytes.length,
      mimeType,
      lastFrameType: 'DISCOVERY',
    });

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

    debugLogger.info('TX', `Optical transmission active at ${this.fps} FPS (Interval: ${(1000 / this.fps).toFixed(0)} ms/frame)`);
    debugLogger.updateSenderTelemetry({ isTransmitting: true });

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

    debugLogger.info('TX', `Optical transmission paused at frame #${this.currentFrameIndex}`);
    debugLogger.updateSenderTelemetry({ isTransmitting: false });
  }

  public stepFrame(): void {
    if (!this.preparedStream) return;

    if (this.isTransmitting) {
      this.pauseTransmission();
    }

    this.renderNextFrame();
    const prevIdx = (this.currentFrameIndex - 1 + this.preparedStream.frames.length) % this.preparedStream.frames.length;
    const f = this.preparedStream.frames[prevIdx];
    debugLogger.info('TX', `Stepped single frame #${prevIdx}/${this.preparedStream.frames.length} (Type: ${f.type})`);
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

    // Animate optical scanning laser beam across preview
    if (this.laserBeamEl) {
      this.laserBeamEl.style.top = `${pct}%`;
      this.scanProgressTextEl.textContent = `BEAMING PKT #${frame.packetIndex} (${pct}%)`;
    }

    const bitrate = ((512 * this.fps) / 1000).toFixed(1);
    (this.container.querySelector('#telemetry-bitrate') as HTMLElement).textContent = `${bitrate} kbps`;

    debugLogger.updateSenderTelemetry({
      currentFrameIndex: this.currentFrameIndex,
      lastFrameType: `${typeStr} (#${frame.packetIndex})`,
    });

    // Advance frame index
    this.currentFrameIndex++;
    if (this.currentFrameIndex >= this.preparedStream.frames.length) {
      const resumeIdx = this.preparedStream.loopStartIndex ?? 0;
      this.currentFrameIndex = resumeIdx;
      this.loopCount++;
      (this.container.querySelector('#loop-badge') as HTMLElement).textContent = `LOOP ${this.loopCount}`;
      debugLogger.info('TX', `Completed stream loop #${this.loopCount - 1}. Looping to packet stream frame #${resumeIdx} (skipping redundant discovery/calibration).`);
      debugLogger.updateSenderTelemetry({ loopCount: this.loopCount });
    }
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public getPreparedStream(): PreparedStream | null {
    return this.preparedStream;
  }
}
