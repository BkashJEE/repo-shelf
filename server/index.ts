import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const PORT = Number.parseInt(process.env.SHELF_PORT ?? '4877', 10);
const HOST = '127.0.0.1';
const configFile = process.env.SHELF_CONFIG ?? path.join(projectRoot, 'shelf.config.json');
const cacheDir = process.env.SHELF_CACHE ?? path.join(projectRoot, '.cache');
const distDir = path.join(projectRoot, 'dist');
const serveStatic = process.env.NODE_ENV === 'production' || process.argv.includes('--serve');

async function main(): Promise<void> {
  const started = Date.now();
  let handle;
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
  const server = handle.app.listen(PORT, HOST, () => {
    console.log(
      `[repo-shelf] http://${HOST}:${PORT}  ${s.repos.length} repos on ${s.shelves.length} shelves  ` +
        `github:${s.github.available ? s.github.login : 'off'}  (${Date.now() - started}ms)`,
    );
    if (serveStatic && !fs.existsSync(distDir)) {
      console.warn('[repo-shelf] dist/ not found, run `npm run build` first for production mode');
    }
  });
  const shutdown = () => {
    handle.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
