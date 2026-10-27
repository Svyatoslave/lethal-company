import QRCode from 'qrcode';

export interface LabelSpec {
  header: string;
  code: string;
  url: string;
  title: string;
  subtitle?: string;
  footer: string;
}

export const qrDataUrl = (text: string) =>
  QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 360, color: { dark: '#000000', light: '#ffffff' } });

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}…`;
  }
  return lines;
}

/** Renders a print-ready label (white card, black QR) to PNG. 600 px wide ≈ 5 cm at 300 dpi. */
export async function renderLabel(spec: LabelSpec): Promise<Blob> {
  await document.fonts.ready;
  const W = 600;
  const pad = 28;
  const mono = "'JetBrains Mono', Consolas, monospace";
  const sans = "'IBM Plex Sans Condensed', Arial, sans-serif";

  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `600 30px ${sans}`;
  const titleLines = wrap(probe, spec.title, W - pad * 2, 2);
  probe.font = `400 22px ${sans}`;
  const subLines = spec.subtitle ? wrap(probe, spec.subtitle, W - pad * 2, 4) : [];
  const H = 70 + (W - pad * 2) + 24 + titleLines.length * 38 + (subLines.length ? 10 + subLines.length * 29 : 0) + 64;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, 58);
  ctx.fillStyle = '#fff';
  ctx.font = `800 24px ${mono}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(spec.header, pad, 30);
  ctx.textAlign = 'right';
  ctx.fillText(spec.code, W - pad, 30);

  const img = new Image();
  img.src = await qrDataUrl(spec.url);
  await img.decode();
  ctx.imageSmoothingEnabled = false;
  const qrSize = W - pad * 2;
  let y = 70;
  ctx.drawImage(img, pad, y, qrSize, qrSize);
  y += qrSize + 24;

  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `600 30px ${sans}`;
  for (const l of titleLines) {
    ctx.fillText(l, W / 2, y);
    y += 38;
  }
  if (subLines.length) {
    y += 10;
    ctx.font = `400 22px ${sans}`;
    ctx.fillStyle = '#333';
    for (const l of subLines) {
      ctx.fillText(l, W / 2, y);
      y += 29;
    }
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(pad, H - 52, W - pad * 2, 2);
  ctx.font = `600 16px ${mono}`;
  ctx.fillText(spec.footer, W / 2, H - 38);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG render failed'))), 'image/png'));
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 40);
