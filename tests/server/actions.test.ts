import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempRoot, makeRepo, rm } from './helpers';
import { scanRepo } from '../../server/scanner';
import { shelfId } from '../../server/config';
import { ActionError, moveRepo, renameRepo, mkdirInRepo, openRepo, cloneRepo, setVisibility, setArchived, deleteGitHubRepo, createRepo } from '../../server/actions';
import { linkRepo } from '../../server/scanner';
import { appendAudit, readAudit } from '../../server/audit';
import type { Runner } from '../../server/git';
import type { Repo } from '../../server/types';

let rootA: string;
let rootB: string;
let shelves: { label: string; path: string }[];

beforeEach(async () => {
  rootA = await makeTempRoot('repo-shelf-act-a-');
  rootB = await makeTempRoot('repo-shelf-act-b-');
  shelves = [
    { label: 'A', path: rootA },
    { label: 'B', path: rootB },
  ];
});
afterEach(() => {
  rm(rootA);
  rm(rootB);
});

async function repoAt(dir: string, root: string) {
  return scanRepo(dir, shelfId(root));
}

async function expectAction(p: Promise<unknown>, status: number, code: string) {
  await expect(p).rejects.toBeInstanceOf(ActionError);
  try {
    await p;
  } catch (e) {
    expect((e as ActionError).status).toBe(status);
    expect((e as ActionError).code).toBe(code);
  }
}

describe('moveRepo', () => {
  it('moves a clean repo to the other shelf', async () => {
    const dir = await makeRepo(rootA, 'clean');
    const repo = await repoAt(dir, rootA);
    const r = await moveRepo(repo, shelves[1], shelves);
    expect(r.newPath).toBe(path.join(rootB, 'clean'));
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(path.join(rootB, 'clean', '.git'))).toBe(true);
  });

  it('refuses when target exists', async () => {
    const dir = await makeRepo(rootA, 'dup');
    await makeRepo(rootB, 'dup');
    const repo = await repoAt(dir, rootA);
    await expectAction(moveRepo(repo, shelves[1], shelves), 409, 'exists');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('refuses a dirty repo unless forced', async () => {
    const dir = await makeRepo(rootA, 'dirty', { dirty: true });
    const repo = await repoAt(dir, rootA);
    expect(repo.dirtyCount).toBe(1);
    await expectAction(moveRepo(repo, shelves[1], shelves), 409, 'dirty');
    expect(fs.existsSync(dir)).toBe(true);
    const r = await moveRepo(repo, shelves[1], shelves, { force: true });
    expect(fs.existsSync(r.newPath)).toBe(true);
  });

  it('refuses same shelf and unconfigured paths', async () => {
    const dir = await makeRepo(rootA, 'same');
    const repo = await repoAt(dir, rootA);
    await expectAction(moveRepo(repo, shelves[0], shelves), 400, 'same_shelf');
    await expectAction(moveRepo(repo, { label: 'X', path: path.join(rootB, 'nested') }, shelves), 400, 'outside_shelves');
    const outsider = { ...repo, path: path.join(rootA, 'deeper', 'same') };
    await expectAction(moveRepo(outsider, shelves[1], shelves), 400, 'outside_shelves');
  });
});

describe('renameRepo', () => {
  it('renames the folder', async () => {
    const dir = await makeRepo(rootA, 'old-name');
    const repo = await repoAt(dir, rootA);
    const r = await renameRepo(repo, 'new-name', shelves);
    expect(r.newPath).toBe(path.join(rootA, 'new-name'));
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(r.newPath)).toBe(true);
  });

  it('rejects invalid names, same name, and collisions', async () => {
    const dir = await makeRepo(rootA, 'one');
    await makeRepo(rootA, 'two');
    const repo = await repoAt(dir, rootA);
    await expectAction(renameRepo(repo, 'bad name', shelves), 400, 'invalid_name');
    await expectAction(renameRepo(repo, '..', shelves), 400, 'invalid_name');
    await expectAction(renameRepo(repo, 'one', shelves), 400, 'same_name');
    await expectAction(renameRepo(repo, 'two', shelves), 409, 'exists');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('renames on GitHub first and updates origin when alsoGitHub', async () => {
    const dir = await makeRepo(rootA, 'gh', { remote: 'https://github.com/me/gh.git' });
    const repo = await repoAt(dir, rootA);
    const calls: string[][] = [];
    const runner: Runner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: '', stderr: '' };
    };
    const r = await renameRepo(repo, 'gh2', shelves, { alsoGitHub: true, runner, ghLogin: 'me' });
    expect(calls[0]).toEqual(['gh', 'repo', 'rename', 'gh2', '-R', 'me/gh', '--yes']);
    expect(calls[1]).toEqual(['git', 'remote', 'set-url', 'origin', 'https://github.com/me/gh2.git']);
    expect(r.newRemoteUrl).toBe('https://github.com/me/gh2.git');
    expect(fs.existsSync(r.newPath)).toBe(true);
  });

  it('rewrites ssh remotes too', async () => {
    const dir = await makeRepo(rootA, 'sshy', { remote: 'git@github.com:me/sshy.git' });
    const repo = await repoAt(dir, rootA);
    const runner: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const r = await renameRepo(repo, 'sshy2', shelves, { alsoGitHub: true, runner, ghLogin: 'me' });
    expect(r.newRemoteUrl).toBe('git@github.com:me/sshy2.git');
  });

  it('leaves the folder untouched when the GitHub rename fails or user is not owner', async () => {
    const dir = await makeRepo(rootA, 'gh', { remote: 'https://github.com/me/gh.git' });
    const repo = await repoAt(dir, rootA);
    const failing: Runner = async () => ({ code: 1, stdout: '', stderr: 'nope' });
    await expectAction(
      renameRepo(repo, 'gh2', shelves, { alsoGitHub: true, runner: failing, ghLogin: 'me' }),
      502,
      'github_rename_failed',
    );
    await expectAction(
      renameRepo(repo, 'gh2', shelves, { alsoGitHub: true, runner: failing, ghLogin: 'someoneelse' }),
      403,
      'not_owner',
    );
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(rootA, 'gh2'))).toBe(false);
  });
});

describe('mkdirInRepo', () => {
  it('creates simple, nested, and gitkeep folders', async () => {
    const dir = await makeRepo(rootA, 'mk');
    const repo = await repoAt(dir, rootA);
    const a = await mkdirInRepo(repo, 'docs');
    expect(fs.statSync(a.created).isDirectory()).toBe(true);
    const b = await mkdirInRepo(repo, 'src/lib/deep', { gitkeep: true });
    expect(fs.existsSync(path.join(b.created, '.gitkeep'))).toBe(true);
  });

  it('rejects traversal and existing folders', async () => {
    const dir = await makeRepo(rootA, 'mk2');
    const repo = await repoAt(dir, rootA);
    await expectAction(mkdirInRepo(repo, '../escape'), 400, 'traversal');
    expect(fs.existsSync(path.join(rootA, 'escape'))).toBe(false);
    await mkdirInRepo(repo, 'dup');
    await expectAction(mkdirInRepo(repo, 'dup'), 409, 'exists');
  });
});

describe('openRepo', () => {
  it('spawns the right program per target and refuses unknown github urls', async () => {
    const dir = await makeRepo(rootA, 'op');
    const repo = await repoAt(dir, rootA);
    const spawned: string[] = [];
    const fakeSpawn = ((cmd: string, args: string[]) => {
      spawned.push([cmd, ...args].join(' '));
      const listeners: Record<string, () => void> = {};
      const child = {
        once(ev: string, fn: () => void) {
          listeners[ev] = fn;
          if (ev === 'spawn') setTimeout(fn, 0);
          return child;
        },
        unref() {},
      };
      return child;
    }) as unknown as typeof import('node:child_process').spawn;
    await openRepo(repo, 'code', fakeSpawn, 'win32');
    await openRepo(repo, 'explorer', fakeSpawn, 'win32');
    expect(spawned[0]).toBe(`code "${dir}"`);
    expect(spawned[1]).toBe(`explorer "${dir}"`);
    await openRepo(repo, 'explorer', fakeSpawn, 'darwin');
    await openRepo(repo, 'explorer', fakeSpawn, 'linux');
    expect(spawned[2]).toBe(`open "${dir}"`);
    expect(spawned[3]).toBe(`xdg-open "${dir}"`);
    await expectAction(openRepo(repo, 'github', fakeSpawn), 400, 'no_github');
    const withGh = { ...repo, github: { htmlUrl: 'https://evil.example/x' } as never };
    await expectAction(openRepo(withGh, 'github', fakeSpawn), 400, 'no_github');
  });
});

describe('virtual books', () => {
  it('refuse move, rename, mkdir, and local open; allow opening the link', async () => {
    const v = linkRepo({ slug: 'octocat/Hello-World' }, 'links');
    await expectAction(moveRepo(v, shelves[1], shelves), 400, 'virtual');
    await expectAction(renameRepo(v, 'x', shelves), 400, 'virtual');
    await expectAction(mkdirInRepo(v, 'docs'), 400, 'virtual');
    const spawned: string[] = [];
    const fakeSpawn = ((cmd: string, args: string[]) => {
      spawned.push([cmd, ...args].join(' '));
      const child = {
        once(ev: string, fn: () => void) {
          if (ev === 'spawn') setTimeout(fn, 0);
          return child;
        },
        unref() {},
      };
      return child;
    }) as unknown as typeof import('node:child_process').spawn;
    await expectAction(openRepo(v, 'code', fakeSpawn, 'win32'), 400, 'virtual');
    await openRepo(v, 'github', fakeSpawn, 'darwin');
    expect(spawned[0]).toBe('open "https://github.com/octocat/Hello-World"');
  });
});

describe('cloneRepo', () => {
  it('clones a remote into a disk shelf and refuses collisions and link shelves', async () => {
    const src = await makeRepo(rootA, 'origin-repo', { commits: 2 });
    const v = { ...linkRepo({ slug: 'someone/origin-repo' }, 'links'), remoteUrl: `file://${src.replace(/\\/g, '/')}` };
    const r = await cloneRepo(v, shelves[1]);
    expect(r.newPath).toBe(path.join(rootB, 'origin-repo'));
    expect(fs.existsSync(path.join(rootB, 'origin-repo', '.git'))).toBe(true);
    await expectAction(cloneRepo(v, shelves[1]), 409, 'exists');
    await expectAction(cloneRepo(v, { label: 'L', links: [] }), 400, 'link_shelf');
    await expectAction(cloneRepo({ ...v, remoteUrl: null, linkUrl: 'https://example.com/page' }, shelves[1]), 400, 'no_remote');
    const bad = { ...v, name: 'ghost', remoteUrl: `file://${rootA.replace(/\\/g, '/')}/does-not-exist` };
    await expectAction(cloneRepo(bad, shelves[1]), 502, 'clone_failed');
    expect(fs.existsSync(path.join(rootB, 'ghost'))).toBe(false);
  });
});

describe('audit', () => {
  it('appends one JSON line per entry and reads them back', async () => {
    const file = path.join(rootA, '.cache', 'actions.log');
    await appendAudit(file, { action: 'move', repoId: 'r1', path: 'p', params: { to: 'B' }, ok: true });
    await appendAudit(file, { action: 'rename', repoId: 'r1', path: 'p', params: {}, ok: false, error: 'exists' });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const entries = await readAudit(file);
    expect(entries[0].action).toBe('move');
    expect(entries[0].ts).toMatch(/^\d{4}-/);
    expect(entries[1].error).toBe('exists');
  });
});

describe('GitHub account actions', () => {
  const ghBook = (over: Partial<Repo> = {}): Repo => ({
    id: 'g1',
    name: 'thing',
    path: '',
    shelfId: 's',
    virtual: true,
    linkUrl: 'https://github.com/me/thing',
    visibility: 'public',
    archived: false,
    createdAt: null,
    doc: null,
    summary: null,
    branch: null,
    lastCommitAt: null,
    commitCount: 0,
    dirtyCount: 0,
    sizeKB: 0,
    languageGuess: null,
    remoteUrl: 'https://github.com/me/thing.git',
    owner: 'me',
    repoSlug: 'me/thing',
    github: null,
    ...over,
  });
  const record = (): { calls: string[][]; runner: Runner } => {
    const calls: string[][] = [];
    return { calls, runner: async (cmd, args) => (calls.push([cmd, ...args]), { code: 0, stdout: '', stderr: '' }) };
  };

  it('changes visibility with the gh flag that accepts consequences, only for the owner', async () => {
    const { calls, runner } = record();
    await setVisibility(ghBook(), 'private', runner, 'ME');
    expect(calls[0]).toEqual(['gh', 'repo', 'edit', 'me/thing', '--visibility', 'private', '--accept-visibility-change-consequences']);
    await expectAction(setVisibility(ghBook(), 'public', runner, 'me'), 400, 'same_visibility');
    await expectAction(setVisibility(ghBook(), 'private', runner, 'someone'), 403, 'not_owner');
    await expectAction(setVisibility(ghBook(), 'private', runner, null), 401, 'gh_unavailable');
  });

  it('archives and unarchives', async () => {
    const { calls, runner } = record();
    await setArchived(ghBook(), true, runner, 'me');
    expect(calls[0]).toEqual(['gh', 'repo', 'archive', 'me/thing', '--yes']);
    await setArchived(ghBook({ archived: true }), false, runner, 'me');
    expect(calls[1]).toEqual(['gh', 'repo', 'unarchive', 'me/thing', '--yes']);
    await expectAction(setArchived(ghBook(), false, runner, 'me'), 400, 'same_state');
  });

  it('deletes only with the exact name typed, only virtual books, and explains a missing scope', async () => {
    const { calls, runner } = record();
    await expectAction(deleteGitHubRepo(ghBook(), 'thin', runner, 'me'), 400, 'confirm_mismatch');
    await expectAction(deleteGitHubRepo(ghBook({ virtual: false, path: 'C:/x' }), 'thing', runner, 'me'), 400, 'has_clone');
    await deleteGitHubRepo(ghBook(), 'thing', runner, 'me');
    expect(calls[0]).toEqual(['gh', 'repo', 'delete', 'me/thing', '--yes']);
    const noScope: Runner = async () => ({ code: 1, stdout: '', stderr: 'HTTP 403: Must have admin rights... delete_repo scope' });
    await expectAction(deleteGitHubRepo(ghBook(), 'thing', noScope, 'me'), 403, 'scope');
  });
});

describe('createRepo', () => {
  const gitOnly: Runner = async (cmd, args, opts) => {
    if (cmd === 'gh') return { code: 1, stdout: '', stderr: 'gh should not be called' };
    const { execRunner } = await import('../../server/git');
    return execRunner(cmd, args, { ...opts, cwd: opts?.cwd });
  };

  it('git inits a new repo with README, .gitignore and one commit', async () => {
    const r = await createRepo(shelves[0], 'fresh-idea', { description: 'Try things' }, gitOnly, null);
    expect(r.path).toBe(path.join(rootA, 'fresh-idea'));
    expect(r.url).toBeNull();
    expect(fs.existsSync(path.join(r.path, '.git'))).toBe(true);
    expect(fs.readFileSync(path.join(r.path, 'README.md'), 'utf8')).toBe('# Fresh Idea\n\nTry things\n');
    expect(fs.existsSync(path.join(r.path, '.gitignore'))).toBe(true);
    const scanned = await scanRepo(r.path, 's');
    expect(scanned.commitCount).toBe(1);
    expect(scanned.branch).toBe('main');
    expect(scanned.dirtyCount).toBe(0);
  });

  it('rejects bad names, collisions, link shelves, and GitHub without a login', async () => {
    await expectAction(createRepo(shelves[0], 'bad name', {}, gitOnly, null), 400, 'invalid_name');
    await makeRepo(rootA, 'taken');
    await expectAction(createRepo(shelves[0], 'taken', {}, gitOnly, null), 409, 'exists');
    await expectAction(createRepo({ label: 'L', links: [] }, 'x', {}, gitOnly, null), 400, 'link_shelf');
    await expectAction(createRepo(shelves[0], 'x', { github: 'private' }, gitOnly, null), 401, 'gh_unavailable');
    expect(fs.existsSync(path.join(rootA, 'x'))).toBe(false);
  });

  it('creates on GitHub with gh repo create --push and reports a warning when that fails', async () => {
    const calls: string[][] = [];
    const runner: Runner = async (cmd, args, opts) => {
      if (cmd === 'gh') {
        calls.push([cmd, ...args]);
        return { code: 0, stdout: '', stderr: '' };
      }
      return gitOnly(cmd, args, opts);
    };
    const r = await createRepo(shelves[0], 'pushed', { github: 'private', description: 'd' }, runner, 'me');
    expect(r.url).toBe('https://github.com/me/pushed');
    expect(calls[0]).toEqual(['gh', 'repo', 'create', 'me/pushed', '--private', '--source', r.path, '--remote', 'origin', '--push', '--description', 'd']);
    const failing: Runner = async (cmd, args, opts) => (cmd === 'gh' ? { code: 1, stdout: '', stderr: 'HTTP 422: name already exists' } : gitOnly(cmd, args, opts));
    const r2 = await createRepo(shelves[0], 'pushed2', { github: 'public' }, failing, 'me');
    expect(r2.url).toBeNull();
    expect(r2.warning).toMatch(/name already exists/);
    expect(fs.existsSync(path.join(r2.path, '.git'))).toBe(true);
  });
});
