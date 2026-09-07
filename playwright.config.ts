import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

/** Fixture root shared with tests/e2e/global-setup.ts. */
export const E2E_ROOT = path.join(os.tmpdir(), 'repo-shelf-e2e');
export const E2E_CONFIG = path.join(E2E_ROOT, 'shelf.config.json');
export const E2E_CACHE = path.join(E2E_ROOT, '.cache');
export const API_PORT = 4879;
export const WEB_PORT = 5179;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // Fixture is (re)built by the same command so the API can never boot against a stale one.
      command: `npx tsx tests/e2e/global-setup.ts --run && npx cross-env SHELF_CONFIG="${E2E_CONFIG}" SHELF_CACHE="${E2E_CACHE}" SHELF_PORT=${API_PORT} npx tsx server/index.ts`,
      url: `http://127.0.0.1:${API_PORT}/api/state`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx cross-env PORT=${WEB_PORT} SHELF_API=http://127.0.0.1:${API_PORT} npx vite --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
