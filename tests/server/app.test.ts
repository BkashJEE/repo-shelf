import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { makeTempRoot, makeRepo, rm } from './helpers';
import { createApp, type AppHandle } from '../../server/app';
import { saveConfig, shelfId } from '../../server/config';
import { GitHubEnricher } from '../../server/github';
import type { Runner } from '../../server/git';
import type { AppState } from '../../server/types';

let tmp: string;
let rootA: string;
let rootB: string;
let handle: AppHandle;
let base: string;
let server: import('node:http').Server;

const noGh: Runner = async (cmd, args, opts) => {
  if (cmd === 'gh') return { code: 1, stdout: '', stderr: 'not logged in' };
  const { execRunner } = await import('../../server/git');
  return execRunner(cmd, args, opts);
};

beforeAll(async () => {
  tmp = await makeTempRoot('repo-shelf-app-');
  rootA = path.join(tmp, 'A');
  rootB = path.join(tmp, 'B');
  fs.mkdirSync(rootA);
  fs.mkdirSync(rootB);
  await makeRepo(rootA, 'one', { commits: 2 });
  await makeRepo(rootA, 'two', { dirty: true });
  await makeRepo(rootB, 'three');
  const configFile = path.join(tmp, 'shelf.config.json');
  saveConfig(configFile, {
    shelves: [
      { label: 'A', path: rootA },
      { label: 'B', path: rootB },
      { label: 'Reads', hidden: true, links: [{ slug: 'octocat/Hello-World' }] },
    ],
    staleAfterDays: 90,
    githubCacheHours: 24,
  });
  const cacheDir = path.join(tmp, '.cache');
  handle = await createApp({
    configFile,
    cacheDir,
    runner: noGh,
    enricher: new GitHubEnricher(path.join(cacheDir, 'github.json'), noGh),
    spawn: (() => {
      const child = {
        once(ev: string, fn: () => void) {
          if (ev === 'spawn') setTimeout(fn, 0);
          return child;
        },
        unref() {},
      };
      return child;
    }) as never,
  });
  await new Promise<void>((resolve) => {
    server = handle.app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  handle.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rm(tmp);
});

async function getState(): Promise<AppState> {
  const r = await fetch(`${base}/api/state`);
  return (await r.json()) as AppState;
}

async function post(route: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

describe('GET /api/state', () => {
  it('returns shelves in config order, repos, github availability, and config', async () => {
    const s = await getState();
    expect(s.shelves.map((x) => x.label)).toEqual(['A', 'B', 'Reads']);
    expect(s.shelves[0].repoCount).toBe(2);
    expect(s.shelves[2]).toMatchObject({ kind: 'links', hidden: true, repoCount: 1 });
    expect(s.repos.map((r) => r.name).sort()).toEqual(['Hello-World', 'one', 'three', 'two']);
    expect(s.github).toEqual({ available: false, login: null });
    expect(s.config.staleAfterDays).toBe(90);
  });
});

describe('repo actions over HTTP', () => {
  it('mkdir creates a folder and rescans', async () => {
    const s = await getState();
    const one = s.repos.find((r) => r.name === 'one')!;
    const r = await post('/api/repo/mkdir', { repoId: one.id, relDir: 'docs/guide', gitkeep: true });
    expect(r.status).toBe(200);
    expect(fs.existsSync(path.join(rootA, 'one', 'docs', 'guide', '.gitkeep'))).toBe(true);
    const log = fs.readFileSync(path.join(tmp, '.cache', 'actions.log'), 'utf8');
    expect(log).toContain('"action":"mkdir"');
  });

  it('rename rejects bad names with the error shape', async () => {
    const s = await getState();
    const one = s.repos.find((r) => r.name === 'one')!;
    const r = await post('/api/repo/rename', { repoId: one.id, newName: 'bad name' });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: expect.any(String), code: 'invalid_name' });
  });

  it('move refuses dirty without force, then moves with force and updates state', async () => {
    let s = await getState();
    const two = s.repos.find((r) => r.name === 'two')!;
    const b = s.shelves.find((x) => x.label === 'B')!;
    const refused = await post('/api/repo/move', { repoId: two.id, targetShelfId: b.id });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('dirty');
    const ok = await post('/api/repo/move', { repoId: two.id, targetShelfId: b.id, force: true });
    expect(ok.status).toBe(200);
    expect(fs.existsSync(path.join(rootB, 'two'))).toBe(true);
    s = await getState();
    expect(s.repos.find((r) => r.name === 'two')!.shelfId).toBe(b.id);
    expect(s.shelves.find((x) => x.label === 'B')!.repoCount).toBe(2);
  });

  it('open with a bogus target returns 400, unknown repo 404', async () => {
    const s = await getState();
    const one = s.repos.find((r) => r.name === 'one')!;
    expect((await post('/api/repo/open', { repoId: one.id, target: 'nope' })).status).toBe(400);
    expect((await post('/api/repo/open', { repoId: 'zzz', target: 'code' })).status).toBe(404);
    expect((await post('/api/repo/open', { repoId: one.id, target: 'code' })).status).toBe(200);
  });
});

describe('shelves', () => {
  it('adds a shelf, rejects missing paths and duplicates, removes without touching disk', async () => {
    const rootC = path.join(tmp, 'C');
    fs.mkdirSync(rootC);
    await makeRepo(rootC, 'four');
    const missing = await post('/api/shelves', { label: 'X', path: path.join(tmp, 'nope') });
    expect(missing.status).toBe(400);
    expect(missing.json.code).toBe('path_missing');
    const added = await post('/api/shelves', { label: 'C', path: rootC });
    expect(added.status).toBe(200);
    expect(added.json.shelves.map((x: { label: string }) => x.label)).toEqual(['A', 'B', 'Reads', 'C']);
    const dup = await post('/api/shelves', { label: 'C again', path: rootC });
    expect(dup.status).toBe(409);
    const cfg = JSON.parse(fs.readFileSync(path.join(tmp, 'shelf.config.json'), 'utf8'));
    expect(cfg.shelves).toHaveLength(4);

    const del = await fetch(`${base}/api/shelves/${shelfId(rootC)}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const s = await getState();
    expect(s.shelves.map((x) => x.label)).toEqual(['A', 'B', 'Reads']);
    expect(fs.existsSync(path.join(rootC, 'four', '.git'))).toBe(true);
  });
});

describe('POST /api/repo/clone', () => {
  it('refuses a link book without a git remote and reports 400 virtual for local actions', async () => {
    const s = await getState();
    const hello = s.repos.find((r) => r.name === 'Hello-World')!;
    const a = s.shelves.find((x) => x.label === 'A')!;
    expect(hello.virtual).toBe(true);
    const mk = await post('/api/repo/mkdir', { repoId: hello.id, relDir: 'x' });
    expect(mk.status).toBe(400);
    expect(mk.json.code).toBe('virtual');
    // clone of a real GitHub URL is not attempted in tests; a bad shelf id is enough to prove routing
    const bad = await post('/api/repo/clone', { repoId: hello.id, targetShelfId: 'nope' });
    expect(bad.status).toBe(404);
    expect(a.kind).toBe('disk');
  });
});

describe('pages and create', () => {
  it('serves README, files, commits and branches for a disk repo', async () => {
    const s = await getState();
    const one = s.repos.find((r) => r.name === 'one')!;
    const r = await fetch(`${base}/api/repo/${one.id}/pages`);
    expect(r.status).toBe(200);
    const pages = (await r.json()) as any;
    expect(pages.source).toBe('disk');
    expect(pages.readme).toContain('# one');
    expect(pages.files.map((f: { name: string }) => f.name)).toContain('README.md');
    expect(pages.commits.length).toBeGreaterThanOrEqual(2);
    expect(pages.branches).toContain('main');
    expect(pages.issues).toEqual([]);
    expect((await fetch(`${base}/api/repo/nope/pages`)).status).toBe(404);
  });

  it('creates a repo on a shelf and lists it', async () => {
    const s = await getState();
    const a = s.shelves.find((x) => x.label === 'A')!;
    const bad = await post('/api/repo/create', { shelfId: a.id, name: 'bad name' });
    expect(bad.status).toBe(400);
    const ok = await post('/api/repo/create', { shelfId: a.id, name: 'brand-new', description: 'made from the shelf' });
    expect(ok.status).toBe(200);
    expect(fs.existsSync(path.join(rootA, 'brand-new', '.git'))).toBe(true);
    const after = await getState();
    const created = after.repos.find((r) => r.name === 'brand-new')!;
    expect(created.commitCount).toBe(1);
    expect(created.shelfId).toBe(a.id);
    const log = fs.readFileSync(path.join(tmp, '.cache', 'actions.log'), 'utf8');
    expect(log).toContain('"action":"create"');
  });
});

describe('SSE', () => {
  it('streams state:changed after a rescan', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    await post('/api/rescan', {});
    let text = '';
    const deadline = Date.now() + 5000;
    while (!text.includes('event: state:changed') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    ctrl.abort();
    expect(text).toContain('event: state:changed');
  });
});
