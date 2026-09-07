import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import type { AppState, OpenTarget, Repo, Shelf, ShelfConfig, ShelfConfigEntry } from './types.js';
import { entryId, loadConfig, saveConfig, validateShelfPaths } from './config.js';
import { execRunner, type Runner } from './git.js';
import { scanAll, scanShelf } from './scanner.js';
import { GitHubEnricher } from './github.js';
import { ActionError, cloneRepo, mkdirInRepo, moveRepo, openRepo, renameRepo, type Spawner } from './actions.js';
import { appendAudit } from './audit.js';
import { EventHub } from './events.js';

export interface AppDeps {
  configFile: string;
  cacheDir: string;
  runner?: Runner;
  enricher?: GitHubEnricher;
  spawn?: Spawner;
  staticDir?: string;
  home?: string;
}

export interface AppHandle {
  app: express.Express;
  state: () => AppState;
  rescan: (shelfId?: string) => Promise<void>;
  hub: EventHub;
  close: () => void;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function loopbackOnly(req: Request, res: Response, next: NextFunction): void {
  const addr = req.socket.remoteAddress ?? '';
  if (!LOOPBACK.has(addr)) {
    res.status(403).json({ error: 'Local access only.', code: 'forbidden' });
    return;
  }
  next();
}

export async function createApp(deps: AppDeps): Promise<AppHandle> {
  const runner = deps.runner ?? execRunner;
  const spawn = deps.spawn ?? nodeSpawn;
  const auditFile = path.join(deps.cacheDir, 'actions.log');
  const enricher = deps.enricher ?? new GitHubEnricher(path.join(deps.cacheDir, 'github.json'), runner);
  await enricher.init();

  let config: ShelfConfig = loadConfig(deps.configFile, deps.home);
  let shelves: Shelf[] = [];
  let repos: Repo[] = [];
  const hub = new EventHub();

  const state = (): AppState => ({
    shelves,
    repos,
    github: { available: enricher.available(), login: enricher.login() },
    config: { staleAfterDays: config.staleAfterDays },
  });

  function entryById(id: string): ShelfConfigEntry | undefined {
    return config.shelves.find((s) => entryId(s) === id);
  }

  function enrichInBackground(targets: Repo[]): void {
    if (!enricher.available()) return;
    void enricher.enrichAll(targets, (updated) => {
      const i = repos.findIndex((r) => r.id === updated.id);
      if (i >= 0) {
        repos[i] = { ...repos[i], github: updated.github };
        hub.broadcast('repo:update', repos[i]);
      }
    });
  }

  async function rescan(onlyShelf?: string): Promise<void> {
    if (onlyShelf) {
      const entry = entryById(onlyShelf);
      if (!entry) return;
      const { shelf, repos: fresh } = await scanShelf(entry, runner);
      shelves = shelves.map((s) => (s.id === shelf.id ? shelf : s));
      const keepGithub = new Map(repos.filter((r) => r.github).map((r) => [r.repoSlug, r.github]));
      repos = [
        ...repos.filter((r) => r.shelfId !== shelf.id),
        ...fresh.map((r) => ({ ...r, github: (r.repoSlug && keepGithub.get(r.repoSlug)) || null })),
      ];
      enrichInBackground(fresh.filter((r) => r.repoSlug && !keepGithub.has(r.repoSlug)));
    } else {
      // A full rescan re-reads shelf.config.json so edits made by hand show up without a restart.
      try {
        config = loadConfig(deps.configFile, deps.home);
      } catch (err) {
        throw new ActionError(400, 'bad_config', err instanceof Error ? err.message : String(err));
      }
      const result = await scanAll(config, runner);
      const keepGithub = new Map(repos.filter((r) => r.github).map((r) => [r.repoSlug, r.github]));
      shelves = result.shelves;
      repos = result.repos.map((r) => ({ ...r, github: (r.repoSlug && keepGithub.get(r.repoSlug)) || null }));
      enrichInBackground(repos.filter((r) => r.repoSlug && !r.github));
    }
    // Keep shelf order identical to config order.
    const order = new Map(config.shelves.map((s, i) => [entryId(s), i]));
    shelves.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  await rescan();

  const app = express();
  app.disable('x-powered-by');
  app.use(loopbackOnly);
  app.use(express.json({ limit: '64kb' }));

  const api = express.Router();

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  function requireRepo(req: Request): Repo {
    const id = typeof req.body?.repoId === 'string' ? req.body.repoId : '';
    const repo = repos.find((r) => r.id === id);
    if (!repo) throw new ActionError(404, 'not_found', 'Unknown repo. Rescan and try again.');
    return repo;
  }

  async function audited<T>(
    action: string,
    repo: Repo,
    params: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      const out = await fn();
      await appendAudit(auditFile, { action, repoId: repo.id, path: repo.path, params, ok: true });
      return out;
    } catch (err) {
      await appendAudit(auditFile, {
        action,
        repoId: repo.id,
        path: repo.path,
        params,
        ok: false,
        error: err instanceof Error ? `${(err as ActionError).code ?? 'error'}: ${err.message}` : String(err),
      });
      throw err;
    }
  }

  api.get('/state', (_req, res) => {
    res.json(state());
  });

  api.post(
    '/rescan',
    wrap(async (req, res) => {
      const id = typeof req.body?.shelfId === 'string' ? req.body.shelfId : undefined;
      await rescan(id);
      hub.broadcast('state:changed', { reason: 'rescan' });
      res.json({ shelves, repos });
    }),
  );

  api.get('/events', (_req, res) => {
    hub.subscribe(res);
  });

  api.get('/shelves', (_req, res) => {
    res.json(shelves);
  });

  api.post(
    '/shelves',
    wrap(async (req, res) => {
      const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
      const p = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
      if (!p) throw new ActionError(400, 'invalid_path', 'Shelf path is required.');
      const entry: ShelfConfigEntry = { label: label || path.basename(path.resolve(p)), path: path.resolve(p) };
      try {
        validateShelfPaths([entry]);
      } catch {
        throw new ActionError(400, 'path_missing', `Folder not found: ${entry.path}`);
      }
      if (config.shelves.some((s) => entryId(s) === entryId(entry))) {
        throw new ActionError(409, 'exists', 'That folder is already a shelf.');
      }
      config = { ...config, shelves: [...config.shelves, entry] };
      saveConfig(deps.configFile, config);
      const { shelf, repos: fresh } = await scanShelf(entry, runner);
      shelves = [...shelves, shelf];
      repos = [...repos, ...fresh];
      enrichInBackground(fresh);
      hub.broadcast('state:changed', { reason: 'shelf:add' });
      res.json(state());
    }),
  );

  api.delete(
    '/shelves/:id',
    wrap(async (req, res) => {
      const id = req.params.id as string;
      if (!entryById(id)) throw new ActionError(404, 'not_found', 'Unknown shelf.');
      config = { ...config, shelves: config.shelves.filter((s) => entryId(s) !== id) };
      saveConfig(deps.configFile, config);
      shelves = shelves.filter((s) => s.id !== id);
      repos = repos.filter((r) => r.shelfId !== id);
      hub.broadcast('state:changed', { reason: 'shelf:remove' });
      res.json(state());
    }),
  );

  api.post(
    '/repo/move',
    wrap(async (req, res) => {
      const repo = requireRepo(req);
      const targetId = typeof req.body?.targetShelfId === 'string' ? req.body.targetShelfId : '';
      const target = entryById(targetId);
      if (!target) throw new ActionError(404, 'not_found', 'Unknown target shelf.');
      const force = req.body?.force === true;
      const result = await audited('move', repo, { targetShelfId: targetId, force }, () =>
        moveRepo(repo, target, config.shelves, { force }),
      );
      await rescan(repo.shelfId);
      await rescan(targetId);
      hub.broadcast('state:changed', { reason: 'move' });
      res.json({ ok: true, newPath: result.newPath, state: state() });
    }),
  );

  api.post(
    '/repo/rename',
    wrap(async (req, res) => {
      const repo = requireRepo(req);
      const newName = typeof req.body?.newName === 'string' ? req.body.newName.trim() : '';
      const alsoGitHub = req.body?.alsoGitHub === true;
      const result = await audited('rename', repo, { newName, alsoGitHub }, () =>
        renameRepo(repo, newName, config.shelves, { alsoGitHub, runner, ghLogin: enricher.login() }),
      );
      await rescan(repo.shelfId);
      hub.broadcast('state:changed', { reason: 'rename' });
      res.json({ ok: true, newPath: result.newPath, newRemoteUrl: result.newRemoteUrl ?? null, state: state() });
    }),
  );

  api.post(
    '/repo/mkdir',
    wrap(async (req, res) => {
      const repo = requireRepo(req);
      const relDir = typeof req.body?.relDir === 'string' ? req.body.relDir.trim() : '';
      const gitkeep = req.body?.gitkeep === true;
      const result = await audited('mkdir', repo, { relDir, gitkeep }, () => mkdirInRepo(repo, relDir, { gitkeep }));
      await rescan(repo.shelfId);
      hub.broadcast('state:changed', { reason: 'mkdir' });
      res.json({ ok: true, created: result.created, state: state() });
    }),
  );

  api.post(
    '/repo/clone',
    wrap(async (req, res) => {
      const repo = requireRepo(req);
      const targetId = typeof req.body?.targetShelfId === 'string' ? req.body.targetShelfId : '';
      const target = entryById(targetId);
      if (!target) throw new ActionError(404, 'not_found', 'Unknown target shelf.');
      const result = await audited('clone', repo, { targetShelfId: targetId }, () => cloneRepo(repo, target, runner));
      await rescan(targetId);
      hub.broadcast('state:changed', { reason: 'clone' });
      res.json({ ok: true, newPath: result.newPath, state: state() });
    }),
  );

  api.post(
    '/repo/open',
    wrap(async (req, res) => {
      const repo = requireRepo(req);
      const target = req.body?.target as OpenTarget;
      await audited('open', repo, { target }, () => openRepo(repo, target, spawn));
      res.json({ ok: true });
    }),
  );

  app.use('/api', api);

  if (deps.staticDir && fs.existsSync(deps.staticDir)) {
    app.use(express.static(deps.staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(deps.staticDir!, 'index.html'));
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.', code: 'not_found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ActionError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/JSON/i.test(message) && /parse|token|Unexpected/i.test(message)) {
      res.status(400).json({ error: 'Malformed JSON body.', code: 'bad_json' });
      return;
    }
    console.error('[repo-shelf] unhandled', err);
    res.status(500).json({ error: message, code: 'internal' });
  });

  return { app, state, rescan, hub, close: () => hub.close() };
}
