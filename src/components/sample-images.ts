/**
 * Procedural High-Resolution Sample Images for instant testing
 */

export interface SamplePreset {
  id: string;
  name: string;
  generate: () => HTMLCanvasElement;
}

export const SAMPLE_PRESETS: SamplePreset[] = [
  {
    id: 'cyberpunk-badge',
    name: 'Cyberpunk Crest',
    generate: () => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 512;
      const ctx = c.getContext('2d')!;

      // Deep space gradient
      const grad = ctx.createLinearGradient(0, 0, 512, 512);
      grad.addColorStop(0, '#0a0d1a');
      grad.addColorStop(0.5, '#1e113a');
      grad.addColorStop(1, '#052b36');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);

      // Glowing concentric geometry
      ctx.save();
      ctx.translate(256, 256);

      // Outer neon ring
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 6;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(0, 0, 180, 0, Math.PI * 2);
      ctx.stroke();

      // Hexagon
      ctx.strokeStyle = '#ff0077';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#ff0077';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        const x = 120 * Math.cos(ang);
        const y = 120 * Math.sin(ang);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();

      // Central core
      const coreGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, 70);
      coreGrad.addColorStop(0, '#ffffff');
      coreGrad.addColorStop(0.4, '#00ff88');
      coreGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 70, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Cyber text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('LUMALINK V1', 256, 450);

      return c;
    },
  },
  {
    id: 'aurora-landscape',
    name: 'Aurora Borealis',
    generate: () => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 512;
      const ctx = c.getContext('2d')!;

      // Night sky
      ctx.fillStyle = '#050811';
      ctx.fillRect(0, 0, 512, 512);

      // Stars
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 90; i++) {
        const x = (i * 37) % 512;
        const y = (i * 43) % 320;
        const r = (i % 3 === 0) ? 2 : 1;
        ctx.fillRect(x, y, r, r);
      }

      // Aurora waves
      const grad = ctx.createLinearGradient(0, 80, 512, 380);
      grad.addColorStop(0, 'rgba(0, 255, 136, 0.7)');
      grad.addColorStop(0.4, 'rgba(0, 200, 255, 0.8)');
      grad.addColorStop(0.8, 'rgba(168, 85, 247, 0.6)');
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 240);
      ctx.bezierCurveTo(120, 100, 280, 300, 512, 140);
      ctx.lineTo(512, 360);
      ctx.bezierCurveTo(340, 420, 180, 260, 0, 340);
      ctx.closePath();
      ctx.fill();

      // Mountain silhouette
      ctx.fillStyle = '#0a101d';
      ctx.beginPath();
      ctx.moveTo(0, 512);
      ctx.lineTo(0, 380);
      ctx.lineTo(140, 290);
      ctx.lineTo(260, 370);
      ctx.lineTo(390, 260);
      ctx.lineTo(512, 390);
      ctx.lineTo(512, 512);
      ctx.closePath();
      ctx.fill();

      return c;
    },
  },
  {
    id: 'quantum-sphere',
    name: 'Quantum Core',
    generate: () => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 512;
      const ctx = c.getContext('2d')!;

      ctx.fillStyle = '#09090c';
      ctx.fillRect(0, 0, 512, 512);

      const rad = ctx.createRadialGradient(256, 256, 20, 256, 256, 220);
      rad.addColorStop(0, '#ffd700');
      rad.addColorStop(0.3, '#ff4500');
      rad.addColorStop(0.7, '#800080');
      rad.addColorStop(1, '#09090c');

      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(256, 256, 220, 0, Math.PI * 2);
      ctx.fill();

      // Orbital rings
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(256, 256, 200, 60, Math.PI / 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(256, 256, 200, 60, -Math.PI / 4, 0, Math.PI * 2);
      ctx.stroke();

      return c;
    },
  },
];

export interface TextPreset {
  id: string;
  name: string;
  text: string;
}

export const SAMPLE_TEXT_PRESETS: TextPreset[] = [
  {
    id: 'confidential-note',
    name: 'Classified Note',
    text: 'LUMALINK AIRGAP OPTICAL PROTOCOL\n\nTransfer Mode: Screen-to-Camera\nPayload: AES-GCM 128-bit encrypted\nAuthentication: Verified Tag\nNetwork Status: Offline (Air-Gapped)\nDate: September 2026',
  },
  {
    id: 'wifi-credentials',
    name: 'Wi-Fi Credentials',
    text: 'NETWORK: LumaLink_Secure_5G\nPASSWORD: x9!vQ#882_AlphaZero\nSECURITY: WPA3-Personal\nGATEWAY: 192.168.1.1',
  },
  {
    id: 'crypto-key',
    name: 'JSON Token',
    text: '{"protocol":"LumaLink-v1","key_id":"0x882A","status":"authenticated","created":1789000000}',
  },
];
