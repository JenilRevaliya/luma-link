/**
 * LumaLink Optical Receiver Interface
 */

import { VisionPipeline } from '../../packages/decoder/vision-pipeline';
import { ColorCalibrator } from '../../packages/calibration/color-calib';
import { PacketReassembler, type ReassembledResult, type ReassemblyProgress } from '../../packages/decoder/reassembler';
import { soundManager } from '../../components/audio-cues';
import type { QuadCorners } from '../../packages/protocol/types';

export class ReceiverApp {
  private container: HTMLElement;
  private videoEl!: HTMLVideoElement;
  private cameraCanvas!: HTMLCanvasElement;
  private reticleCanvas!: HTMLCanvasElement;
  private videoStream: MediaStream | null = null;
  private isRunning = false;
  private animFrameId: number | null = null;

  private calibrator: ColorCalibrator;
  private pipeline: VisionPipeline;
  private reassembler: PacketReassembler;

  private frameCounter = 0;
  private measuredFps = 0;
  private lastFpsCalcTime = 0;

  // External simulated frame provider for loopback simulator
  public externalFrameProvider?: () => ImageData | null;
  public externalCornersProvider?: () => QuadCorners | null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.calibrator = new ColorCalibrator();
    this.pipeline = new VisionPipeline(this.calibrator);
    this.reassembler = new PacketReassembler();
  }

  public render(): void {
    this.container.innerHTML = `
      <div class="receiver-view">
        <div class="glass-panel receiver-camera-panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="status-dot" id="rx-status-dot"></span>
              <span id="rx-state-text">SEARCHING OPTICAL LINK</span>
            </div>
            <div class="telemetry-badges">
              <span class="badge badge-accent" id="rx-fps-badge">0 FPS</span>
              <span class="badge badge-outline" id="rx-resolution-badge">CAMERA: INIT</span>
            </div>
          </div>

          <!-- Video Viewport with Holographic Reticle -->
          <div class="camera-viewport-wrapper">
            <video id="camera-video" playsinline muted autoplay></video>
            <canvas id="reticle-canvas"></canvas>
            <canvas id="processing-canvas" style="display:none;"></canvas>

            <div class="targeting-reticle" id="targeting-reticle">
              <div class="corner-bracket top-left"></div>
              <div class="corner-bracket top-right"></div>
              <div class="corner-bracket bottom-right"></div>
              <div class="corner-bracket bottom-left"></div>
              <div class="reticle-center-cross"></div>
              <div class="reticle-hint" id="reticle-hint">ALIGN SENDER SCREEN INSIDE BRACKETS</div>
            </div>
          </div>

          <!-- Camera Controls -->
          <div class="camera-actions-row">
            <button class="btn btn-primary" id="btn-start-cam">
              📷 START REAR CAMERA
            </button>
            <button class="btn btn-outline" id="btn-stop-cam" disabled>
              ⏹ STOP CAMERA
            </button>
            <button class="btn btn-ghost" id="btn-reset-rx">
              ↺ RESET LINK
            </button>
            <button class="btn btn-ghost" id="btn-toggle-sound">
              🔊 SOUND: ON
            </button>
          </div>
        </div>

        <!-- Telemetry & Received Data Panel -->
        <div class="glass-panel receiver-status-panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="icon-pulse">✦</span> LINK TELEMETRY & REASSEMBLY
            </div>
            <span class="badge badge-cyan" id="rx-session-badge">SESSION: --</span>
          </div>

          <!-- Progress Bar -->
          <div class="progress-section">
            <div class="progress-labels">
              <span class="text-muted">Packets Collected</span>
              <span class="font-mono text-cyan" id="rx-packet-count">0 / 0 (0%)</span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" id="rx-progress-bar" style="width: 0%;"></div>
            </div>
          </div>

          <!-- Packet Bitset Matrix Visualizer -->
          <div class="packet-map-container">
            <div class="packet-map-header">
              <span class="text-muted">Packet Reception Map</span>
              <span class="text-muted" id="rx-errors-fixed">0 ECC Corrections</span>
            </div>
            <div class="packet-map-grid" id="packet-map-grid">
              <!-- Dynamically populated tiles -->
            </div>
          </div>

          <!-- Decoded Image Result Card -->
          <div class="received-image-card" id="received-image-card" style="display: none;">
            <div class="received-card-header">
              <span class="badge badge-success">✓ RECONSTRUCTION COMPLETE</span>
              <span class="badge badge-accent" id="res-size-badge">0 KB</span>
            </div>
            <div class="received-image-wrapper">
              <img id="received-image-img" alt="Reconstructed LumaLink Transfer" />
            </div>
            <div class="received-card-meta" id="received-card-meta">
              <span>Resolution: 384×384</span>
              <span>AES-GCM Authenticated ✓</span>
            </div>
            <a class="btn btn-primary btn-block" id="btn-download-image" download="lumalink_received.webp">
              ⤓ SAVE RECONSTRUCTED IMAGE
            </a>
          </div>

          <!-- Live Channel Metrics -->
          <div class="channel-metrics-grid">
            <div class="metric-card">
              <span class="metric-label">Color Calibrated</span>
              <span class="metric-val text-emerald" id="metric-calibrated">NO</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Avg Confidence</span>
              <span class="metric-val" id="metric-confidence">0%</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Symbol Dist</span>
              <span class="metric-val" id="metric-dist">0.0</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Decrypted</span>
              <span class="metric-val text-cyan" id="metric-crypto">READY</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.videoEl = this.container.querySelector('#camera-video') as HTMLVideoElement;
    this.reticleCanvas = this.container.querySelector('#reticle-canvas') as HTMLCanvasElement;
    this.cameraCanvas = this.container.querySelector('#processing-canvas') as HTMLCanvasElement;

    const startBtn = this.container.querySelector('#btn-start-cam') as HTMLButtonElement;
    const stopBtn = this.container.querySelector('#btn-stop-cam') as HTMLButtonElement;
    const resetBtn = this.container.querySelector('#btn-reset-rx') as HTMLButtonElement;
    const soundBtn = this.container.querySelector('#btn-toggle-sound') as HTMLButtonElement;

    startBtn.addEventListener('click', () => this.startCamera());
    stopBtn.addEventListener('click', () => this.stopCamera());
    resetBtn.addEventListener('click', () => this.resetState());

    soundBtn.addEventListener('click', () => {
      soundManager.enabled = !soundManager.enabled;
      soundBtn.textContent = soundManager.enabled ? '🔊 SOUND: ON' : '🔇 SOUND: OFF';
    });

    // Setup Reassembler Callbacks
    this.reassembler.onProgress = (prog) => this.handleProgress(prog);
    this.reassembler.onComplete = (res) => this.handleComplete(res);
    this.reassembler.onError = (err) => console.warn('Reassembly error:', err);
  }

  public async startCamera(): Promise<void> {
    try {
      // Rear-facing camera with ideal 60fps and HD resolution constraints
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoStream = stream;
      this.videoEl.srcObject = stream;
      await this.videoEl.play();

      // Inspect actual track capabilities and settings
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const w = settings.width || 1280;
      const h = settings.height || 720;
      const rate = settings.frameRate ? `${settings.frameRate} FPS` : '60 FPS';

      (this.container.querySelector('#rx-resolution-badge') as HTMLElement).textContent = `${w}×${h} (${rate})`;
      (this.container.querySelector('#btn-start-cam') as HTMLButtonElement).disabled = true;
      (this.container.querySelector('#btn-stop-cam') as HTMLButtonElement).disabled = false;

      this.startProcessingLoop();
    } catch (err) {
      console.warn('Camera initiation failed (testing on non-mobile or blocked permissions):', err);
      (this.container.querySelector('#rx-state-text') as HTMLElement).textContent = 'CAMERA ACCESS BLOCKED / UNAVAILABLE';
      // Still start processing loop if external simulated frames are provided!
      if (this.externalFrameProvider) {
        this.startProcessingLoop();
      }
    }
  }

  public stopCamera(): void {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((t) => t.stop());
      this.videoStream = null;
    }
    this.videoEl.srcObject = null;

    (this.container.querySelector('#btn-start-cam') as HTMLButtonElement).disabled = false;
    (this.container.querySelector('#btn-stop-cam') as HTMLButtonElement).disabled = true;
    (this.container.querySelector('#rx-status-dot') as HTMLElement).className = 'status-dot';
    (this.container.querySelector('#rx-state-text') as HTMLElement).textContent = 'CAMERA STOPPED';
  }

  public startProcessingLoop(): void {
    this.isRunning = true;
    this.lastFpsCalcTime = performance.now();
    this.frameCounter = 0;
    this.processTick();
  }

  private processTick(): void {
    if (!this.isRunning) return;

    const now = performance.now();
    this.frameCounter++;

    if (now - this.lastFpsCalcTime >= 1000) {
      this.measuredFps = Math.round((this.frameCounter * 1000) / (now - this.lastFpsCalcTime));
      this.frameCounter = 0;
      this.lastFpsCalcTime = now;
      (this.container.querySelector('#rx-fps-badge') as HTMLElement).textContent = `${this.measuredFps} FPS`;
    }

    this.processSingleFrame();
    this.animFrameId = requestAnimationFrame(() => this.processTick());
  }

  public processSingleFrame(): void {
    let imgData: ImageData | null = null;
    let overrideCorners: QuadCorners | null = null;

    if (this.externalFrameProvider) {
      imgData = this.externalFrameProvider();
      if (this.externalCornersProvider) {
        overrideCorners = this.externalCornersProvider();
      }
    } else if (this.videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const vw = this.videoEl.videoWidth || 640;
      const vh = this.videoEl.videoHeight || 480;

      if (this.cameraCanvas.width !== vw || this.cameraCanvas.height !== vh) {
        this.cameraCanvas.width = vw;
        this.cameraCanvas.height = vh;
        this.reticleCanvas.width = vw;
        this.reticleCanvas.height = vh;
      }

      const ctx = this.cameraCanvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(this.videoEl, 0, 0, vw, vh);
        imgData = ctx.getImageData(0, 0, vw, vh);
      }
    }

    if (!imgData) return;

    // Run Vision Pipeline
    const result = this.pipeline.processFrame(imgData, overrideCorners);

    // Update state badge
    this.updateStateUI(result.state, result.corners !== null);

    // Update channel metrics
    (this.container.querySelector('#metric-calibrated') as HTMLElement).textContent = this.calibrator.isCalibrated ? 'YES' : 'PENDING';
    (this.container.querySelector('#metric-confidence') as HTMLElement).textContent = `${Math.round(result.averageConfidence * 100)}%`;
    (this.container.querySelector('#metric-dist') as HTMLElement).textContent = result.averageDistance.toFixed(1);

    // Draw reticle tracking overlay
    this.drawReticleOverlay(result.corners);

    // If a valid frame was decoded, ingest into reassembler
    if (result.decodedFrame) {
      this.reassembler.ingestFrame(result.decodedFrame);
      soundManager.playPacketTick();
    }
  }

  private drawReticleOverlay(corners: QuadCorners | null): void {
    const ctx = this.reticleCanvas.getContext('2d');
    if (!ctx) return;

    const w = this.reticleCanvas.width;
    const h = this.reticleCanvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!corners) {
      (this.container.querySelector('#targeting-reticle') as HTMLElement).classList.remove('locked');
      return;
    }

    (this.container.querySelector('#targeting-reticle') as HTMLElement).classList.add('locked');

    // Draw polygon connecting detected corners
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(corners.topLeft.x, corners.topLeft.y);
    ctx.lineTo(corners.topRight.x, corners.topRight.y);
    ctx.lineTo(corners.bottomRight.x, corners.bottomRight.y);
    ctx.lineTo(corners.bottomLeft.x, corners.bottomLeft.y);
    ctx.closePath();
    ctx.stroke();

    // Corner target circles
    const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
    pts.forEach((p, idx) => {
      ctx.fillStyle = idx === 0 ? '#00f0ff' : '#00ff88';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private updateStateUI(state: string, _hasCorners: boolean): void {
    const dot = this.container.querySelector('#rx-status-dot') as HTMLElement;
    const text = this.container.querySelector('#rx-state-text') as HTMLElement;
    const hint = this.container.querySelector('#reticle-hint') as HTMLElement;

    dot.className = 'status-dot';

    switch (state) {
      case 'SEARCHING':
        dot.classList.add('status-searching');
        text.textContent = 'SEARCHING FOR OPTICAL MATRIX';
        hint.textContent = 'POINT REAR CAMERA AT SENDER DISPLAY';
        break;
      case 'FOUND':
        dot.classList.add('status-locking');
        text.textContent = 'LUMALINK DETECTED • LOCKING';
        hint.textContent = 'HOLD STEADY...';
        break;
      case 'CALIBRATING':
        dot.classList.add('status-calibrating');
        text.textContent = 'CALIBRATING COLOR CENTROIDS';
        hint.textContent = 'SAMPLING AMBIENT LIGHTING';
        break;
      case 'RECEIVING':
        dot.classList.add('status-active');
        text.textContent = 'RECEIVING STREAMED PACKETS';
        hint.textContent = 'SYNCHRONIZED';
        break;
    }
  }

  private handleProgress(prog: ReassemblyProgress): void {
    (this.container.querySelector('#rx-session-badge') as HTMLElement).textContent = `SESSION: #${prog.sessionId.toString(16).toUpperCase()}`;
    (this.container.querySelector('#rx-packet-count') as HTMLElement).textContent = `${prog.receivedCount} / ${prog.totalPackets} (${prog.percent}%)`;
    (this.container.querySelector('#rx-progress-bar') as HTMLElement).style.width = `${prog.percent}%`;

    // Render packet map grid
    const mapGrid = this.container.querySelector('#packet-map-grid') as HTMLElement;
    if (mapGrid.children.length !== prog.totalPackets) {
      mapGrid.innerHTML = '';
      for (let i = 0; i < prog.totalPackets; i++) {
        const tile = document.createElement('div');
        tile.className = 'packet-tile';
        tile.id = `pkt-tile-${i}`;
        mapGrid.appendChild(tile);
      }
    }

    prog.receivedMap.forEach((rec, idx) => {
      const tile = mapGrid.children[idx] as HTMLElement;
      if (tile) {
        if (rec) tile.classList.add('received');
        else tile.classList.remove('received');
      }
    });
  }

  private handleComplete(res: ReassembledResult): void {
    soundManager.playCompletionChime();

    const card = this.container.querySelector('#received-image-card') as HTMLElement;
    const img = this.container.querySelector('#received-image-img') as HTMLImageElement;
    const downloadBtn = this.container.querySelector('#btn-download-image') as HTMLAnchorElement;
    const sizeBadge = this.container.querySelector('#res-size-badge') as HTMLElement;
    const meta = this.container.querySelector('#received-card-meta') as HTMLElement;

    img.src = res.dataUrl;
    downloadBtn.href = res.dataUrl;
    downloadBtn.download = `lumalink_${res.sessionId.toString(16)}.webp`;
    sizeBadge.textContent = `${(res.totalBytes / 1024).toFixed(1)} KB`;

    meta.innerHTML = `
      <span>Resolution: ${res.width}×${res.height}</span>
      <span>Packets: ${res.totalPackets}</span>
      <span>ECC Corrections: ${res.totalCorrectedErrors}</span>
      <span class="text-emerald">AES-GCM Authenticated ✓</span>
    `;

    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
  }

  public resetState(): void {
    this.calibrator.reset();
    this.reassembler.reset();
    (this.container.querySelector('#rx-progress-bar') as HTMLElement).style.width = '0%';
    (this.container.querySelector('#rx-packet-count') as HTMLElement).textContent = '0 / 0 (0%)';
    (this.container.querySelector('#packet-map-grid') as HTMLElement).innerHTML = '';
    (this.container.querySelector('#received-image-card') as HTMLElement).style.display = 'none';
  }

  public getPipeline(): VisionPipeline {
    return this.pipeline;
  }
}
