import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { createApp, type AppHandle } from './app.js';

/**
 * Project root. Set SHELF_ROOT when the server runs from a bundle (the desktop
 * widget does this); otherwise derive it from this file's location.
 */
function resolveRoot(): string {
  if (process.env.SHELF_ROOT) return path.resolve(process.env.SHELF_ROOT);
  try {
    const url = import.meta.url;
    if (url) return path.resolve(path.dirname(fileURLToPath(url)), '..');
  } catch {
    /* bundled as CommonJS */
  }
  return process.cwd();
}

const projectRoot = resolveRoot();
const PORT = Number.parseInt(process.env.SHELF_PORT ?? '4877', 10);
const HOST = '127.0.0.1';
const configFile = process.env.SHELF_CONFIG ?? path.join(projectRoot, 'shelf.config.json');
const cacheDir = process.env.SHELF_CACHE ?? path.join(projectRoot, '.cache');
const distDir = path.join(projectRoot, 'dist');
const serveStatic = process.env.NODE_ENV === 'production' || process.argv.includes('--serve');

let handle: AppHandle | null = null;
let server: Server | null = null;

async function main(): Promise<void> {
  const started = Date.now();
  try {
    handle = await createApp({
      configFile,
      cacheDir,
      staticDir: serveStatic && fs.existsSync(distDir) ? distDir : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[repo-shelf] failed to start: ${msg}`);
    if (msg.startsWith('shelf_path_missing')) {
      console.error(`[repo-shelf] fix or remove that shelf in ${configFile}`);
    }
    process.exit(1);
  }
  const s = handle.state();
  server = handle.app.listen(PORT, HOST, () => {
    console.log(
      `[repo-shelf] http://${HOST}:${PORT}  ${s.repos.length} repos on ${s.shelves.length} shelves  ` +
        `github:${s.github.available ? s.github.login : 'off'}  (${Date.now() - started}ms)`,
    );
    if (serveStatic && !fs.existsSync(distDir)) {
      console.warn('[repo-shelf] dist/ not found, run `npm run build` first for production mode');
    }
  });
}

/** Stop the HTTP server and event stream. Used by the desktop widget on quit. */
export function close(): void {
  handle?.close();
  server?.close();
  handle = null;
  server = null;
}

const shutdown = () => {
  close();
  setTimeout(() => process.exit(0), 300).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void main();
