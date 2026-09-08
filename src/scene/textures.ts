import * as THREE from 'three';
import type { Repo } from '../types';
import { bookColor, displayName, hasGoldBand, hasRedTab, isStale, languageOf } from '../derive';
import type { Theme } from '../themes';

const cache = new Map<string, { key: string; spine: THREE.CanvasTexture; cover: THREE.CanvasTexture }>();

function visualKey(r: Repo, staleDays: number): string {
  return [r.name, languageOf(r), r.dirtyCount > 0, r.github?.stars ?? 0, r.virtual ? 'link' : isStale(r, staleDays), r.github?.description ?? '', r.visibility, r.archived].join('|');
}

function desaturate(hex: string, amount = 0.55): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * (1 - amount), Math.min(0.8, hsl.l + 0.18));
  return `#${c.getHexString()}`;
}

function darken(hex: string, amount = 0.25): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, hsl.l * (1 - amount)));
  return `#${c.getHexString()}`;
}

export function baseColor(r: Repo, staleDays: number): string {
  const c = bookColor(languageOf(r));
  if (r.virtual) return c;
  return isStale(r, staleDays) ? desaturate(c) : c;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startPx: number, minPx: number, family: string, weight = 600): number {
  let px = startPx;
  while (px > minPx) {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 2;
  }
  return px;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

const SERIF = '"Manrope", "Inter", system-ui, sans-serif';
const SANS = '"Inter", system-ui, sans-serif';

function drawSpine(r: Repo, staleDays: number): HTMLCanvasElement {
  const W = 256;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const color = baseColor(r, staleDays);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  // subtle cloth texture: horizontal hairlines
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  // spine rounding: soft highlight down the middle
  const hl = ctx.createLinearGradient(0, 0, W, 0);
  hl.addColorStop(0, 'rgba(255,255,255,0)');
  hl.addColorStop(0.5, 'rgba(255,255,255,0.10)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, W, H);
  // edge shading
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.28)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(0.88, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // decorative bands top and bottom
  ctx.fillStyle = 'rgba(246,244,238,0.85)';
  ctx.fillRect(28, 52, W - 56, 4);
  ctx.fillRect(28, H - 56, W - 56, 4);
  // raised bands like a bound spine
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (const y of [H * 0.2, H * 0.8]) ctx.fillRect(0, y, W, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (const y of [H * 0.2 - 3, H * 0.8 - 3]) ctx.fillRect(0, y, W, 3);

  if (hasGoldBand(r)) {
    ctx.fillStyle = '#d9b545';
    ctx.fillRect(0, 80, W, 20);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 100, W, 4);
  }
  if (hasRedTab(r)) {
    ctx.fillStyle = '#c8352b';
    ctx.beginPath();
    ctx.moveTo(W - 60, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, 60);
    ctx.closePath();
    ctx.fill();
  }

  // title, rotated to read top to bottom
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f6f4ee';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  const title = displayName(r.name);
  const px = fitText(ctx, title, H - 340, 80, 32, SERIF, 700);
  ctx.font = `700 ${px}px ${SERIF}`;
  ctx.fillText(title, 0, -8);
  ctx.shadowBlur = 0;
  ctx.font = `500 30px ${SANS}`;
  ctx.fillStyle = 'rgba(246,244,238,0.7)';
  const foot = r.virtual ? (r.repoSlug ? (r.visibility === 'private' ? '🔒 PRIVATE' : 'PUBLIC  ↗') : 'LINK  ↗') : languageOf(r).toUpperCase();
  ctx.fillText(foot, 0, px / 2 + 32);
  if (r.archived) {
    ctx.font = `700 22px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('ARCHIVED', 0, -px / 2 - 34);
  }
  ctx.restore();
  if (r.virtual) {
    // dotted border: this book is not on disk yet
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = 'rgba(246,244,238,0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.setLineDash([]);
  }

  return canvas;
}

function drawCover(r: Repo, staleDays: number): HTMLCanvasElement {
  const W = 768;
  const H = 1152;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const color = baseColor(r, staleDays);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  // spine-side shadow
  const g = ctx.createLinearGradient(0, 0, 90, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 90, H);
  // board edge highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  // frame
  ctx.strokeStyle = 'rgba(246,244,238,0.7)';
  ctx.lineWidth = 4;
  ctx.strokeRect(70, 70, W - 140, H - 140);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(246,244,238,0.75)';
  ctx.font = `500 30px ${SANS}`;
  ctx.fillText(r.virtual ? (r.repoSlug ? (r.visibility === 'private' ? '🔒 PRIVATE ON GITHUB' : 'PUBLIC ON GITHUB') : 'LINK  ↗') : languageOf(r).toUpperCase(), W / 2, 165);

  ctx.fillStyle = '#f6f4ee';
  ctx.textBaseline = 'top';
  const title = displayName(r.name);
  let px = 90;
  ctx.font = `700 ${px}px ${SERIF}`;
  let lines = wrap(ctx, title, W - 210);
  while (lines.length > 3 && px > 44) {
    px -= 8;
    ctx.font = `700 ${px}px ${SERIF}`;
    lines = wrap(ctx, title, W - 210);
  }
  let y = 255;
  for (const line of lines.slice(0, 3)) {
    ctx.fillText(line, W / 2, y);
    y += px * 1.15;
  }

  const desc = r.github?.description ?? '';
  if (desc) {
    ctx.font = `400 33px ${SANS}`;
    ctx.fillStyle = 'rgba(246,244,238,0.85)';
    const dl = wrap(ctx, desc, W - 225).slice(0, 5);
    y += 45;
    for (const line of dl) {
      ctx.fillText(line, W / 2, y);
      y += 45;
    }
  }

  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 33px ${SANS}`;
  ctx.fillStyle = 'rgba(246,244,238,0.8)';
  const foot: string[] = [];
  if (r.commitCount) foot.push(`${r.commitCount} commits`);
  if (r.github?.stars) foot.push(`★ ${r.github.stars.toLocaleString()}`);
  if (r.dirtyCount) foot.push(`${r.dirtyCount} uncommitted`);
  if (r.virtual) foot.push('not cloned yet');
  ctx.fillText(foot.join('  ·  '), W / 2, H - 165);

  if (hasGoldBand(r)) {
    ctx.fillStyle = '#d9b545';
    ctx.fillRect(0, 90, W, 21);
  }
  return canvas;
}

function makeTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

export function bookTextures(r: Repo, staleDays: number): { spine: THREE.CanvasTexture; cover: THREE.CanvasTexture } {
  const key = visualKey(r, staleDays);
  const hit = cache.get(r.id);
  if (hit && hit.key === key) return hit;
  if (hit) {
    hit.spine.dispose();
    hit.cover.dispose();
  }
  const entry = { key, spine: makeTexture(drawSpine(r, staleDays)), cover: makeTexture(drawCover(r, staleDays)) };
  cache.set(r.id, entry);
  return entry;
}

export function sideColor(r: Repo, staleDays: number): string {
  return darken(baseColor(r, staleDays), 0.3);
}

let edgeTex: THREE.CanvasTexture | null = null;
/** Cream page stack with fine lines, used on the three exposed page edges. */
export function pageEdgeTexture(): THREE.CanvasTexture {
  if (edgeTex) return edgeTex;
  const W = 64;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#efe7d3';
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) {
    ctx.fillStyle = `rgba(120,100,70,${0.10 + Math.random() * 0.14})`;
    ctx.fillRect(0, y, W, 1);
  }
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.18)');
  g.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  edgeTex = makeTexture(canvas);
  edgeTex.wrapS = THREE.RepeatWrapping;
  edgeTex.wrapT = THREE.RepeatWrapping;
  return edgeTex;
}

let woodTex: THREE.CanvasTexture | null = null;
export function woodTexture(): THREE.CanvasTexture {
  if (woodTex) return woodTex;
  const W = 512;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#b9b0a4';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 120; i++) {
    const y = Math.random() * H;
    ctx.strokeStyle = `rgba(60,50,40,${0.12 + Math.random() * 0.22})`;
    ctx.lineWidth = 0.5 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 32) ctx.lineTo(x, y + Math.sin(x / 40 + i) * 2.5);
    ctx.stroke();
  }
  const t = makeTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  woodTex = t;
  return t;
}

const backTexCache = new Map<string, THREE.CanvasTexture>();
export function backPanelTexture(theme: Theme): THREE.CanvasTexture {
  const hit = backTexCache.get(theme.id);
  if (hit) return hit;
  const W = 512;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(W / 2, H * 0.45, 20, W / 2, H / 2, W * 0.75);
  g.addColorStop(0, theme.scene.back[0]);
  g.addColorStop(0.6, theme.scene.back[1]);
  g.addColorStop(1, theme.scene.back[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H);
  const tex = makeTexture(canvas);
  backTexCache.set(theme.id, tex);
  return tex;
}
