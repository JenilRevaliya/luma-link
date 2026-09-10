# 📡 LumaLink: High-Speed Optical Data-Transfer Protocol

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vercel Compatible](https://img.shields.io/badge/Vercel-Compatible-black.svg)](vercel.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8%2B-3178C6.svg)](tsconfig.json)
[![Vite](https://img.shields.io/badge/Bundler-Vite-646CFF.svg)](package.json)

**LumaLink** is an air-gapped, camera-to-screen optical data transfer protocol and browser suite. It transfers compressed, encrypted images and binary payloads between devices using high-speed dynamic 4-color matrix modulation instead of static QR codes.

---

## ✦ Key Highlights

- **Dynamic Color Matrix**: Modulates $16 \times 16$ optical cells (256 symbols/frame) across 4 calibrated colors (Black `00`, Red `01`, Green `10`, Blue `11`), yielding 512 raw bits per optical frame.
- **Continuous Fountain Looping**: Streams packets in a continuous loop. The receiver can lock in at any packet, collects chunks in a bitset map, and reconstructs the image the instant all unique packets arrive.
- **Forward Error Correction (Reed-Solomon $GF(2^8)$)**: Recovers up to 4 corrupted bytes (up to 16 cell flips) per 64-byte frame, backed by IEEE 802.3 CRC32 integrity checks.
- **Homography & Perspective Correction**: 4 corner concentric fiducials allow Direct Linear Transform (DLT) 2D projective homography to warp skewed camera angles back to square coordinates.
- **Sub-Pixel Center-Kernel Sampling**: Avoids cell boundary bleeding and chromatic aberration by sampling only the central 25% of each optical cell.
- **Adaptive Lighting Calibration**: Dedicated calibration frames train color centroids in real-time, adapting to warm/cool ambient room lighting and display gamuts.
- **Authenticated Encryption**: 128-bit AES-GCM via Web Cryptography API ensures confidentiality and message integrity.
- **Minimal Tactile Skeuomorphic UI**: Matte powder-coated industrial chassis with physical 3D pressable buttons, mechanical rocker switches, recessed faders, and jewel status LEDs.
- **100% Client-Side & Air-Gapped**: Runs entirely in the browser using HTML5 Canvas, `getUserMedia()`, and Web Audio API. Zero backend or cloud dependencies required.
- **Vercel Ready**: Includes `vercel.json` and optimized single-page application production bundling.

---

## 🛠 Architecture

```
luma-link/
├── packages/
│   ├── protocol/          # 64-byte frame framing, headers, magic bytes & CRC32
│   ├── encoder/           # 16x16 matrix mapping, corner fiducials, fountain stream generator
│   ├── decoder/           # DLT homography, corner detector, sub-pixel sampler, reassembler
│   ├── error-correction/  # Galois Field GF(2^8) Reed-Solomon encoder & decoder
│   ├── calibration/       # Color centroid clustering & Euclidean classifier
│   ├── crypto/            # AES-GCM authenticated encryption & decryption
│   └── image/             # Square cropper (center vs fit) & adaptive WebP downscaler
├── apps/
│   ├── sender/            # Transmission controller, image dropper, FPS ticker, canvas HUD
│   ├── receiver/          # Rear camera manager, holographic reticle, packet bitset map
│   └── benchmark/         # Optical channel simulator, BER calculator, constellation plot
├── components/            # Web Audio API ticks & chimes, procedural test image presets
└── styles/                # Minimal skeuomorphic industrial design system
```

---

## 🚀 Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/JenilRevaliya/luma-link.git
cd luma-link

# Install dependencies
npm install

# Run local development server
npm run dev -- --host
```

Open `http://localhost:5173/` in your browser.

### Running Tests

```bash
npm test
```

### Production Build

```bash
npm run build
```

---

## 📱 How to Test

### 1. Two-Device Physical Transfer (Laptop Screen → Mobile Camera)
1. **Transmitter (Laptop)**:
   - Navigate to `http://localhost:5173/` (or click **SENDER**).
   - Drop an image or select a preset (e.g. *Cyberpunk Crest*).
   - Select resolution (e.g. `256×256` for ~3s transfer or `384×384`).
   - Click **▶ START TRANSMISSION** (or **⛶ FULLSCREEN**).
2. **Receiver (Mobile Phone)**:
   - Connect phone to the same local Wi-Fi / hotspot.
   - Open `http://<your-local-ip>:5173/#receiver`.
   - Grant rear camera permission (`facingMode: "environment"`).
   - Align the camera with the transmitter screen inside the reticle brackets.
   - Watch the state machine automatically progress:
     $$\text{SEARCHING} \rightarrow \text{LOCKING} \rightarrow \text{CALIBRATING} \rightarrow \text{RECEIVING} \rightarrow \text{✓ RECONSTRUCTION COMPLETE}$$
   - Download the verified image with one click.

### 2. Single-Device Virtual Optical Link Simulator
1. Open the **LINK SIMULATOR** tab.
2. Click **▶ START VIRTUAL OPTICAL LINK**.
3. Adjust real-time channel impairment controls:
   - **Perspective Tilt (Pitch/Yaw)**
   - **Camera Sensor Noise (SNR)**
   - **Ambient Color Temperature (2800K - 8500K)**
4. Monitor live **Bit Error Rate (BER)**, **Effective Bitrate**, and the **4-QAM Chromaticity Constellation Plot**.

---

## 📜 Protocol Frame Layout (64 Bytes)

```
┌───────────┬──────────────┬─────────────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬───────────────┐
│ MAGIC(2B) │ PROTO_VER(1B)│ FRAME_TYP(1B│ SESSION_ID(2B│ SEQ_NUM(1B)  │ PKT_IDX(1B)  │ TOTAL_PKT(1B)│ PAYLOAD(42B) │ CRC32(4B)+ECC │
│ 0x4C 0x4D │     0x01     │    enum     │    uint16    │    uint8     │    uint8     │    uint8     │  Data chunk  │ 8B RS Parity  │
└───────────┴──────────────┴─────────────┴──────────────┴──────────────┴──────────────┴──────────────┴──────────────┴───────────────┘
```

---

## 📄 License

MIT License © 2026 Jenil Soni (JenilRevaliya)
