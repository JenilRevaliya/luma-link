/**
 * LumaLink Optical Receiver Interface
 * Features gap-aware segmented progress bar, initial pickup detection,
 * transmission telemetry, and multi-format reconstruction (Image, Text, Image+Caption)
 */

import { VisionPipeline } from '../../packages/decoder/vision-pipeline';
import { ColorCalibrator } from '../../packages/calibration/color-calib';
import { PacketReassembler, type ReassembledResult, type ReassemblyProgress } from '../../packages/decoder/reassembler';
import { soundManager } from '../../components/audio-cues';
import type { Point2D, QuadCorners } from '../../packages/protocol/types';

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
        <!-- Camera Viewport Column -->
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

        <!-- Telemetry, Segmented Progress Bar & Results Column -->
        <div class="glass-panel receiver-status-panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="icon-pulse">✦</span> LINK TELEMETRY & REASSEMBLY
            </div>
            <span class="badge badge-cyan" id="rx-session-badge">SESSION: --</span>
          </div>

          <!-- Live Data Packet Banner -->
          <div class="packet-live-banner" id="packet-live-banner">
            <div class="banner-col">
              <span class="banner-lbl">CURRENT DATA PACKET</span>
              <span class="banner-val font-mono text-cyan" id="rx-live-packet-idx">WAITING FOR FRAMES</span>
            </div>
            <div class="banner-col">
              <span class="banner-lbl">CHANNEL STATUS</span>
              <span class="banner-val font-mono" id="rx-channel-status">STANDBY</span>
            </div>
          </div>

          <!-- Segmented / Gap-Aware Progress Section -->
          <div class="progress-section">
            <div class="progress-labels">
              <span class="text-muted">Transmission Progress (Fountain Reassembly)</span>
              <span class="font-mono text-cyan" id="rx-packet-count">0 / 0 (0%)</span>
            </div>

            <!-- Segmented Visual Track Canvas -->
            <div class="segmented-track-wrapper">
              <canvas id="segmented-progress-canvas" width="600" height="24"></canvas>
              <!-- Marker for Initial Pickup Point -->
              <div class="pickup-marker" id="pickup-marker" style="display: none;">
                <span class="marker-arrow">▲</span>
                <span class="marker-label" id="pickup-marker-label">PICKED UP AT PKT #0</span>
              </div>
            </div>

            <!-- Head Gap / Loop Status Notice -->
            <div class="head-gap-notice" id="head-gap-notice" style="display: none;">
              <span class="notice-icon">ℹ</span>
              <span id="head-gap-text">Waiting for loop 2 to backfill missing head...</span>
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

          <!-- Reconstructed Result Card: Photo Mode -->
          <div class="received-image-card" id="received-image-card" style="display: none;">
            <div class="received-card-header">
              <span class="badge badge-success">✓ PHOTO RECONSTRUCTED</span>
              <span class="badge badge-accent" id="res-size-badge">0 KB</span>
            </div>
            <div class="received-image-wrapper">
              <img id="received-image-img" alt="Reconstructed Optical Image" />
            </div>
            <div class="received-card-meta" id="received-card-meta">
              <span>Resolution: 384×384</span>
              <span>AES-GCM Authenticated ✓</span>
            </div>
            <div id="received-caption-box" class="received-caption-box" style="display: none;"></div>
            <a class="btn btn-primary btn-block" id="btn-download-image" download="lumalink_received.webp">
              ⤓ SAVE RECONSTRUCTED IMAGE
            </a>
          </div>

          <!-- Reconstructed Result Card: Text / Note Mode -->
          <div class="received-text-card" id="received-text-card" style="display: none;">
            <div class="received-card-header">
              <span class="badge badge-success">✓ TEXT DECODED</span>
              <span class="badge badge-accent" id="res-text-size-badge">0 BYTES</span>
            </div>
            <div class="terminal-text-container">
              <pre id="received-text-content"></pre>
            </div>
            <div class="received-card-meta">
              <span id="text-meta-chars">0 characters</span>
              <span class="text-emerald">AES-GCM Authenticated ✓</span>
            </div>
            <button class="btn btn-primary btn-block" id="btn-copy-text">
              📋 COPY TO CLIPBOARD
            </button>
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
              <span class="metric-label">Pickup Point</span>
              <span class="metric-val text-cyan" id="metric-pickup">NONE</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Fountain Loop</span>
              <span class="metric-val text-emerald" id="metric-loop">LOOP 1</span>
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
    const copyBtn = this.container.querySelector('#btn-copy-text') as HTMLButtonElement;

    startBtn.addEventListener('click', () => this.startCamera());
    stopBtn.addEventListener('click', () => this.stopCamera());
    resetBtn.addEventListener('click', () => this.resetState());

    soundBtn.addEventListener('click', () => {
      soundManager.enabled = !soundManager.enabled;
      soundBtn.textContent = soundManager.enabled ? '🔊 SOUND: ON' : '🔇 SOUND: OFF';
    });

    copyBtn.addEventListener('click', () => {
      const text = (this.container.querySelector('#received-text-content') as HTMLElement).textContent || '';
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✓ COPIED TO CLIPBOARD!';
        setTimeout(() => {
          copyBtn.textContent = '📋 COPY TO CLIPBOARD';
        }, 2000);
      });
    });

    // Setup Reassembler Callbacks
    this.reassembler.onProgress = (prog) => this.handleProgress(prog);
    this.reassembler.onComplete = (res) => this.handleComplete(res);
    this.reassembler.onError = (err) => console.warn('Reassembly error:', err);
  }

  public async startCamera(): Promise<void> {
    try {
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
      console.warn('Camera initiation fallback:', err);
      (this.container.querySelector('#rx-state-text') as HTMLElement).textContent = 'CAMERA ACCESS BLOCKED / UNAVAILABLE';
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

    // Calculate targeting reticle bounds in camera image coordinates
    let searchBounds: { x: number; y: number; width: number; height: number } | undefined = undefined;
    const viewportWrapper = this.container.querySelector('.camera-viewport-wrapper') as HTMLElement | null;
    const reticleEl = this.container.querySelector('#targeting-reticle') as HTMLElement | null;

    if (viewportWrapper && reticleEl && !overrideCorners) {
      const vw = this.cameraCanvas.width;
      const vh = this.cameraCanvas.height;
      const wrapperRect = viewportWrapper.getBoundingClientRect();
      const reticleRect = reticleEl.getBoundingClientRect();

      if (wrapperRect.width > 0 && wrapperRect.height > 0) {
        const videoAspect = vw / vh;
        const wrapperAspect = wrapperRect.width / wrapperRect.height;
        let displayedW: number;
        let displayedH: number;
        let displayedL: number;
        let displayedT: number;

        if (wrapperAspect > videoAspect) {
          displayedH = wrapperRect.height;
          displayedW = displayedH * videoAspect;
          displayedL = (wrapperRect.width - displayedW) / 2;
          displayedT = 0;
        } else {
          displayedW = wrapperRect.width;
          displayedH = displayedW / videoAspect;
          displayedL = 0;
          displayedT = (wrapperRect.height - displayedH) / 2;
        }

        const scale = vw / displayedW;
        const rx = (reticleRect.left - (wrapperRect.left + displayedL)) * scale;
        const ry = (reticleRect.top - (wrapperRect.top + displayedT)) * scale;
        const rw = reticleRect.width * scale;
        const rh = reticleRect.height * scale;

        searchBounds = {
          x: Math.round(rx),
          y: Math.round(ry),
          width: Math.round(rw),
          height: Math.round(rh),
        };
      }
    }

    // Run Vision Pipeline
    const result = this.pipeline.processFrame(imgData, overrideCorners, searchBounds);

    // Update state badge & channel indicator
    this.updateStateUI(result.state, result.decodedFrame !== null);

    // Update channel metrics
    (this.container.querySelector('#metric-calibrated') as HTMLElement).textContent = this.calibrator.isCalibrated ? 'YES' : 'PENDING';
    (this.container.querySelector('#metric-confidence') as HTMLElement).textContent = `${Math.round(result.averageConfidence * 100)}%`;

    // Draw reticle tracking overlay (framed around matrixCorners)
    this.drawReticleOverlay(result.corners, result.matrixCorners);

    // If valid frame was decoded, update live telemetry and ingest
    if (result.decodedFrame) {
      const hdr = result.decodedFrame.header;
      (this.container.querySelector('#rx-live-packet-idx') as HTMLElement).textContent =
        `PKT #${hdr.packetIndex} / ${hdr.totalPackets} (SEQ: ${hdr.sequenceNum})`;
      (this.container.querySelector('#rx-channel-status') as HTMLElement).textContent = 'STREAMING ACTIVE ✓';

      this.reassembler.ingestFrame(result.decodedFrame);
      soundManager.playPacketTick();
    }
  }

  private drawReticleOverlay(corners: QuadCorners | null, matrixCorners: QuadCorners | null): void {
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

    // 1. Draw glowing green box framed tightly around the 16x16 color matrix
    const m = matrixCorners || corners;
    ctx.save();
    ctx.strokeStyle = '#00e676';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(0, 230, 118, 0.6)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(m.topLeft.x, m.topLeft.y);
    ctx.lineTo(m.topRight.x, m.topRight.y);
    ctx.lineTo(m.bottomRight.x, m.bottomRight.y);
    ctx.lineTo(m.bottomLeft.x, m.bottomLeft.y);
    ctx.closePath();
    ctx.stroke();

    // Subtle matrix fill
    ctx.fillStyle = 'rgba(0, 230, 118, 0.05)';
    ctx.fill();

    // 2. Corner HUD brackets on matrix boundary
    const drawBracket = (p: Point2D, dirX: number, dirY: number) => {
      const len = 14;
      ctx.beginPath();
      ctx.moveTo(p.x + dirX * len, p.y);
      ctx.lineTo(p.x, p.y);
      ctx.lineTo(p.x, p.y + dirY * len);
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 3.5;
      ctx.stroke();
    };
    drawBracket(m.topLeft, 1, 1);
    drawBracket(m.topRight, -1, 1);
    drawBracket(m.bottomRight, -1, -1);
    drawBracket(m.bottomLeft, 1, -1);

    // 3. Draw Outer Fiducial Target Bullseyes
    const fiducials = [
      { pt: corners.topLeft, color: '#00e5ff' },     // Top-Left (distinct cyan)
      { pt: corners.topRight, color: '#00e676' },    // Top-Right
      { pt: corners.bottomRight, color: '#00e676' }, // Bottom-Right
      { pt: corners.bottomLeft, color: '#00e676' },  // Bottom-Left
    ];

    for (const f of fiducials) {
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.pt.x, f.pt.y, 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(f.pt.x, f.pt.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private updateStateUI(state: string, isTransmitting: boolean): void {
    const dot = this.container.querySelector('#rx-status-dot') as HTMLElement;
    const text = this.container.querySelector('#rx-state-text') as HTMLElement;
    const hint = this.container.querySelector('#reticle-hint') as HTMLElement;

    dot.className = 'status-dot';

    if (isTransmitting) {
      dot.classList.add('status-active');
      text.textContent = 'TRANSMISSION IN PROGRESS';
      hint.textContent = 'OPTICAL STREAM SYNCHRONIZED';
      return;
    }

    switch (state) {
      case 'SEARCHING':
        dot.classList.add('status-searching');
        text.textContent = 'SEARCHING FOR OPTICAL MATRIX';
        hint.textContent = 'ALIGN SENDER SCREEN INSIDE BRACKETS';
        break;
      case 'FOUND':
      case 'DETECTED':
        dot.classList.add('status-locking');
        text.textContent = 'LUMALINK DETECTED • LOCKING';
        hint.textContent = 'FIDUCIALS ACQUIRED • HOLD STEADY';
        break;
      case 'CALIBRATING':
        dot.classList.add('status-calibrating');
        text.textContent = 'CALIBRATING COLOR CENTROIDS';
        hint.textContent = 'SAMPLING AMBIENT LIGHTING';
        break;
      case 'RECEIVING':
        dot.classList.add('status-active');
        text.textContent = 'TRANSMITTING / RECEIVING';
        hint.textContent = 'STREAM SYNCHRONIZED';
        break;
    }
  }

  private handleProgress(prog: ReassemblyProgress): void {
    (this.container.querySelector('#rx-session-badge') as HTMLElement).textContent = `SESSION: #${prog.sessionId.toString(16).toUpperCase()}`;
    (this.container.querySelector('#rx-packet-count') as HTMLElement).textContent = `${prog.receivedCount} / ${prog.totalPackets} (${prog.percent}%)`;
    (this.container.querySelector('#metric-loop') as HTMLElement).textContent = `LOOP ${prog.loopCount}`;

    if (prog.initialPickupIndex !== null) {
      (this.container.querySelector('#metric-pickup') as HTMLElement).textContent = `PKT #${prog.initialPickupIndex}`;
    }

    // Render Segmented Canvas Progress Bar
    this.renderSegmentedProgressBar(prog);

    // Update Pickup Marker Position
    const marker = this.container.querySelector('#pickup-marker') as HTMLElement;
    const markerLabel = this.container.querySelector('#pickup-marker-label') as HTMLElement;
    if (prog.initialPickupIndex !== null && prog.totalPackets > 0) {
      marker.style.display = 'flex';
      const pickupPct = (prog.initialPickupIndex / prog.totalPackets) * 100;
      marker.style.left = `${Math.min(95, Math.max(5, pickupPct))}%`;
      markerLabel.textContent = `PICKED UP AT PKT #${prog.initialPickupIndex}`;
    }

    // Update Head Gap Notice
    const gapNotice = this.container.querySelector('#head-gap-notice') as HTMLElement;
    const gapText = this.container.querySelector('#head-gap-text') as HTMLElement;
    if (prog.missingHeadCount > 0 && prog.isWaitingForLoop) {
      gapNotice.style.display = 'flex';
      gapText.textContent = `Head gap: Packets #0–#${prog.initialPickupIndex! - 1} pending. Currently receiving rest of stream... will automatically complete in Loop 2!`;
    } else {
      gapNotice.style.display = 'none';
    }

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

  private renderSegmentedProgressBar(prog: ReassemblyProgress): void {
    const canvas = this.container.querySelector('#segmented-progress-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const total = prog.totalPackets || 1;
    const segWidth = w / total;

    // Draw base track
    ctx.fillStyle = '#10131a';
    ctx.fillRect(0, 0, w, h);

    // Draw individual segments
    for (let i = 0; i < total; i++) {
      const x = i * segWidth;
      const isReceived = prog.receivedMap[i];

      if (isReceived) {
        ctx.fillStyle = '#00e676'; // Vibrant emerald
        ctx.fillRect(x, 0, Math.ceil(segWidth), h);
      } else {
        // Empty / pending gap: subtle hatched or dark bar
        ctx.fillStyle = '#181c26';
        ctx.fillRect(x, 0, Math.ceil(segWidth), h);
      }

      // 1px segment divider if not too dense
      if (total < 100) {
        ctx.strokeStyle = '#0a0c10';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }

    // Current pointer sweep line
    if (prog.currentPacketIndex >= 0 && prog.totalPackets > 0) {
      const curX = prog.currentPacketIndex * segWidth;
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(curX, 0, Math.max(3, segWidth), h);
    }
  }

  private handleComplete(res: ReassembledResult): void {
    soundManager.playCompletionChime();

    // Hide gap notice
    (this.container.querySelector('#head-gap-notice') as HTMLElement).style.display = 'none';

    if (res.isText) {
      // Show Text Card
      const textCard = this.container.querySelector('#received-text-card') as HTMLElement;
      const textContent = this.container.querySelector('#received-text-content') as HTMLElement;
      const textSizeBadge = this.container.querySelector('#res-text-size-badge') as HTMLElement;
      const metaChars = this.container.querySelector('#text-meta-chars') as HTMLElement;

      textContent.textContent = res.textContent || '';
      textSizeBadge.textContent = `${res.totalBytes} BYTES`;
      metaChars.textContent = `${res.textContent?.length || 0} characters • Packets: ${res.totalPackets}`;

      textCard.style.display = 'block';
      textCard.scrollIntoView({ behavior: 'smooth' });
    } else {
      // Show Image Card (or Image+Caption)
      const card = this.container.querySelector('#received-image-card') as HTMLElement;
      const img = this.container.querySelector('#received-image-img') as HTMLImageElement;
      const downloadBtn = this.container.querySelector('#btn-download-image') as HTMLAnchorElement;
      const sizeBadge = this.container.querySelector('#res-size-badge') as HTMLElement;
      const meta = this.container.querySelector('#received-card-meta') as HTMLElement;
      const captionBox = this.container.querySelector('#received-caption-box') as HTMLElement;

      if (res.dataUrl) {
        img.src = res.dataUrl;
        downloadBtn.href = res.dataUrl;
        downloadBtn.download = `lumalink_${res.sessionId.toString(16)}.webp`;
      }

      sizeBadge.textContent = `${(res.totalBytes / 1024).toFixed(1)} KB`;

      meta.innerHTML = `
        <span>Resolution: ${res.width}×${res.height}</span>
        <span>Packets: ${res.totalPackets}</span>
        <span>ECC Corrections: ${res.totalCorrectedErrors}</span>
        <span class="text-emerald">AES-GCM Authenticated ✓</span>
      `;

      if (res.hasCaption && res.captionText) {
        captionBox.style.display = 'block';
        captionBox.textContent = `Attached Caption: "${res.captionText}"`;
      } else {
        captionBox.style.display = 'none';
      }

      card.style.display = 'block';
      card.scrollIntoView({ behavior: 'smooth' });
    }
  }

  public resetState(): void {
    this.calibrator.reset();
    this.reassembler.reset();
    (this.container.querySelector('#rx-packet-count') as HTMLElement).textContent = '0 / 0 (0%)';
    (this.container.querySelector('#packet-map-grid') as HTMLElement).innerHTML = '';
    (this.container.querySelector('#received-image-card') as HTMLElement).style.display = 'none';
    (this.container.querySelector('#received-text-card') as HTMLElement).style.display = 'none';
    (this.container.querySelector('#pickup-marker') as HTMLElement).style.display = 'none';
    (this.container.querySelector('#head-gap-notice') as HTMLElement).style.display = 'none';
    (this.container.querySelector('#rx-live-packet-idx') as HTMLElement).textContent = 'WAITING FOR FRAMES';
    (this.container.querySelector('#rx-channel-status') as HTMLElement).textContent = 'STANDBY';

    // Clear segmented progress canvas
    const canvas = this.container.querySelector('#segmented-progress-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  public getPipeline(): VisionPipeline {
    return this.pipeline;
  }
}
