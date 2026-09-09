import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { useShelf } from '../store';
import { languageCounts } from '../derive';
import { themeById } from '../themes';

interface R3fHandle {
  gl: { domElement: HTMLCanvasElement; render: (scene: unknown, camera: unknown) => void };
  scene: unknown;
  camera: unknown;
  advance: (timestamp: number, runGlobalEffects?: boolean) => void;
  invalidate: () => void;
}

function handle(): R3fHandle {
  const h = (window as unknown as { __r3f?: R3fHandle }).__r3f;
  if (!h) throw new Error('The 3D scene is not ready yet.');
  return h;
}

/**
 * Let React commit the store change (one macrotask), then force frames so the
 * camera and books sit at their targets (store.instant makes every ease snap).
 */
async function settle(h: R3fHandle, steps = 2): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
  let t = performance.now();
  for (let i = 0; i < steps; i++) {
    t += 1000;
    h.invalidate();
    h.advance(t, true);
  }
}

export interface Caption {
  title: string;
  subtitle: string;
}

export function shelfCaption(): Caption {
  const st = useShelf.getState();
  const langs = languageCounts(st.repos)
    .slice(0, 3)
    .map((l) => l.language)
    .filter((l) => l !== 'Unknown');
  const owner = st.githubLogin;
  return {
    title: owner ? `${owner}'s repo shelf` : 'My repo shelf',
    subtitle: `${st.repos.length} repos · ${st.shelves.length} shelves${langs.length ? ` · ${langs.join(', ')}` : ''}`,
  };
}

const SANS = '"Inter", system-ui, sans-serif';
const HEAD = '"Manrope", "Inter", system-ui, sans-serif';

/** Compose the WebGL frame with a caption bar into a 2D canvas of the requested width. */
export function composeFrame(width: number, caption: Caption, extra?: string): HTMLCanvasElement {
  const h = handle();
  const src = h.gl.domElement;
  const theme = themeById(useShelf.getState().themeId);
  const scale = width / src.width;
  const sceneH = Math.round(src.height * scale);
  const bar = Math.round(width * 0.11);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = sceneH + bar;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = theme.scene.background;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, width, sceneH);
  // caption bar
  ctx.fillStyle = theme.ui.paper;
  ctx.fillRect(0, sceneH, width, bar);
  ctx.fillStyle = theme.ui.line;
  ctx.fillRect(0, sceneH, width, 1);
  const pad = Math.round(width * 0.035);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.ui.ink;
  ctx.font = `700 ${Math.round(bar * 0.34)}px ${HEAD}`;
  ctx.fillText(caption.title, pad, sceneH + bar * 0.36);
  ctx.fillStyle = theme.ui.muted;
  ctx.font = `500 ${Math.round(bar * 0.2)}px ${SANS}`;
  ctx.fillText(extra ?? caption.subtitle, pad, sceneH + bar * 0.7);
  // watermark
  ctx.textAlign = 'right';
  ctx.fillStyle = theme.ui.muted;
  ctx.font = `600 ${Math.round(bar * 0.2)}px ${SANS}`;
  ctx.fillText('made with repo shelf', width - pad, sceneH + bar * 0.5);
  // three little spines as a logo
  const sx = width - pad - ctx.measureText('made with repo shelf').width - bar * 0.55;
  const colors = ['#3f5f4a', '#a3452f', '#c9a227'];
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(sx + i * bar * 0.13, sceneH + bar * 0.32, bar * 0.09, bar * 0.36);
  });
  return out;
}

/** Zoom out so every shelf is in frame; returns a function that restores the previous view. */
async function frameWholeCase(h: R3fHandle): Promise<() => Promise<void>> {
  const st = useShelf.getState();
  const before = { zoom: st.zoom, orbit: { ...st.orbit }, scrollRow: st.scrollRow, selected: st.selectedRepoId, focus: st.focus };
  const n = Math.max(1, st.shelves.length);
  st.setInstant(true);
  st.select(null);
  st.setFocus(null);
  st.setScrollRow(0);
  // 1.7 rows' worth of zoom per shelf leaves a margin above the crown and below the base
  st.setZoom(Math.min(1, 1.7 / n));
  await settle(h, 3);
  return async () => {
    const s = useShelf.getState();
    s.setInstant(false);
    s.setZoom(before.zoom);
    s.setOrbit(before.orbit.yaw, before.orbit.pitch);
    s.setScrollRow(before.scrollRow);
    s.setFocus(before.focus);
    if (before.selected) s.select(before.selected);
    await settle(h, 2);
    h.invalidate();
  };
}

/** A single captioned PNG with the whole bookcase in frame. */
export async function shelfiePng(width = 1600): Promise<string> {
  const h = handle();
  const restore = await frameWholeCase(h);
  try {
    return composeFrame(width, shelfCaption()).toDataURL('image/png');
  } finally {
    await restore();
  }
}

export interface GifOptions {
  width?: number;
  frames?: number;
  delayMs?: number;
  onProgress?: (done: number, total: number) => void;
}

async function encodeGif(frames: HTMLCanvasElement[], delayMs: number, onProgress?: (i: number, n: number) => void): Promise<Uint8Array> {
  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const c = frames[i];
    const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const palette = quantize(data, 256, { format: 'rgb444' });
    const index = applyPalette(data, palette, 'rgb444');
    gif.writeFrame(index, width, height, { palette, delay: delayMs, repeat: 0 });
    onProgress?.(i + 1, frames.length);
    // keep the UI responsive
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return gif.bytes();
}

/** Orbit the bookcase from left to right and back, captioned. */
export async function orbitGif(opts: GifOptions = {}): Promise<Uint8Array> {
  const width = opts.width ?? 720;
  const n = opts.frames ?? 40;
  const delay = opts.delayMs ?? 70;
  const h = handle();
  const restore = await frameWholeCase(h);
  const caption = shelfCaption();
  const frames: HTMLCanvasElement[] = [];
  try {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const yaw = Math.sin(t * Math.PI * 2) * 0.55; // ±31°
      const pitch = Math.cos(t * Math.PI * 2) * 0.08 + 0.05;
      useShelf.getState().setOrbit(yaw, pitch);
      await settle(h, 2);
      frames.push(composeFrame(width, caption));
      opts.onProgress?.(i + 1, n * 2);
    }
  } finally {
    await restore();
  }
  return encodeGif(frames, delay, (i, total) => opts.onProgress?.(n + i, total + n));
}

/** Books land on the shelves in the order the repos were created, with a year counter. */
export async function rewindGif(opts: GifOptions = {}): Promise<Uint8Array> {
  const width = opts.width ?? 720;
  const n = opts.frames ?? 48;
  const delay = opts.delayMs ?? 90;
  const h = handle();
  const st = useShelf.getState();
  const dates = st.repos.map((r) => (r.createdAt ? new Date(r.createdAt).getTime() : NaN)).filter((t) => Number.isFinite(t));
  if (!dates.length) throw new Error('No creation dates yet. Rescan once so git can report first commits.');
  const start = Math.min(...dates) - 24 * 3600 * 1000;
  const end = Date.now();
  const caption = shelfCaption();
  const frames: HTMLCanvasElement[] = [];
  const restore = await frameWholeCase(h);
  try {
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const eased = 1 - Math.pow(1 - t, 2);
      const cursor = start + (end - start) * eased;
      useShelf.getState().setTimeline(cursor);
      await settle(h, 2);
      const count = st.repos.filter((r) => r.createdAt && new Date(r.createdAt).getTime() <= cursor).length;
      const when = new Date(cursor);
      frames.push(composeFrame(width, caption, `${when.toLocaleString('en', { month: 'short' })} ${when.getFullYear()} · ${count} repos`));
      opts.onProgress?.(i + 1, n * 2);
    }
    // hold the final frame
    for (let i = 0; i < 8; i++) frames.push(frames[frames.length - 1]);
  } finally {
    useShelf.getState().setTimeline(null);
    await restore();
  }
  return encodeGif(frames, delay, (i, total) => opts.onProgress?.(n + i, total + n));
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(new Blob([bytes as BlobPart], { type: mime }));
  });
}

export function downloadDataUrl(dataUrl: string, name: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
