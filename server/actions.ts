import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import type { OpenTarget, Repo, ShelfConfigEntry } from './types.js';
import { execRunner, type Runner, type RunResult } from './git.js';
import { insideShelves, resolveInsideRepo, shelfOf, validRepoName } from './pathguard.js';

export class ActionError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

function exists(p: string): boolean {
  return fssync.existsSync(p);
}

function sameShelfPath(a: string, b: string): boolean {
  const n = (p: string) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return n(a) === n(b);
}

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(cur, e.name));
      else n++;
    }
  }
  return n;
}

function mapFsError(err: unknown, what: string): ActionError {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
    return new ActionError(
      423,
      'locked',
      `${what} is in use. Close editors, terminals, or processes using the folder and try again.`,
    );
  }
  if (code === 'ENOENT') return new ActionError(404, 'not_found', `${what} no longer exists.`);
  return new ActionError(500, 'fs_error', `${what}: ${(err as Error)?.message ?? String(err)}`);
}

function requireOnDisk(repo: Repo): void {
  if (repo.virtual || !repo.path) {
    throw new ActionError(400, 'virtual', 'This book is a link, not a folder yet. Clone it onto a shelf first.');
  }
}

function requireInsideShelves(repo: Repo, shelves: ShelfConfigEntry[]): void {
  requireOnDisk(repo);
  if (!insideShelves(repo.path, shelves)) {
    throw new ActionError(400, 'outside_shelves', 'Repo path is not inside a configured shelf.');
  }
  if (!exists(repo.path)) throw new ActionError(404, 'not_found', 'Repo folder no longer exists.');
}

export interface MoveResult {
  newPath: string;
}

export async function moveRepo(
  repo: Repo,
  target: ShelfConfigEntry,
  shelves: ShelfConfigEntry[],
  opts: { force?: boolean } = {},
): Promise<MoveResult> {
  requireInsideShelves(repo, shelves);
  if (!target.path) throw new ActionError(400, 'link_shelf', 'Books cannot be moved onto a link shelf.');
  const source = shelfOf(repo.path, shelves);
  if (!source || sameShelfPath(source.path!, target.path)) {
    throw new ActionError(400, 'same_shelf', 'Repo is already on that shelf.');
  }
  if (!shelves.some((s) => s.path && sameShelfPath(s.path, target.path!))) {
    throw new ActionError(400, 'outside_shelves', 'Target shelf is not configured.');
  }
  const newPath = path.join(path.resolve(target.path), repo.name);
  if (exists(newPath)) {
    throw new ActionError(409, 'exists', `"${repo.name}" already exists on the target shelf.`);
  }
  if (repo.dirtyCount > 0 && !opts.force) {
    throw new ActionError(
      409,
      'dirty',
      `Repo has ${repo.dirtyCount} uncommitted change${repo.dirtyCount === 1 ? '' : 's'}.`,
    );
  }
  try {
    await fs.rename(repo.path, newPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.cp(repo.path, newPath, { recursive: true, errorOnExist: true, force: false });
      const [a, b] = await Promise.all([countFiles(repo.path), countFiles(newPath)]);
      if (a !== b) {
        await fs.rm(newPath, { recursive: true, force: true });
        throw new ActionError(500, 'copy_mismatch', 'Cross-drive copy verification failed; source left untouched.');
      }
      await fs.rm(repo.path, { recursive: true, force: true });
    } else {
      throw mapFsError(err, `"${repo.name}"`);
    }
  }
  return { newPath };
}

export interface RenameResult {
  newPath: string;
  newRemoteUrl?: string;
}

export async function renameRepo(
  repo: Repo,
  newName: string,
  shelves: ShelfConfigEntry[],
  opts: { alsoGitHub?: boolean; runner?: Runner; ghLogin?: string | null } = {},
): Promise<RenameResult> {
  requireInsideShelves(repo, shelves);
  if (!validRepoName(newName)) {
    throw new ActionError(
      400,
      'invalid_name',
      'Name may only contain letters, numbers, dots, dashes and underscores (max 100).',
    );
  }
  if (newName === repo.name) throw new ActionError(400, 'same_name', 'That is already the repo name.');
  const newPath = path.join(path.dirname(repo.path), newName);
  if (exists(newPath)) throw new ActionError(409, 'exists', `"${newName}" already exists on this shelf.`);

  let newRemoteUrl: string | undefined;
  if (opts.alsoGitHub) {
    const runner = opts.runner ?? execRunner;
    if (!repo.repoSlug || !repo.owner) {
      throw new ActionError(400, 'no_github', 'Repo has no GitHub remote.');
    }
    if (!opts.ghLogin || opts.ghLogin.toLowerCase() !== repo.owner.toLowerCase()) {
      throw new ActionError(403, 'not_owner', 'Only repos owned by your GitHub account can be renamed on GitHub.');
    }
    const r = await runner('gh', ['repo', 'rename', newName, '-R', repo.repoSlug, '--yes'], { timeoutMs: 30_000 });
    if (r.code !== 0) {
      throw new ActionError(502, 'github_rename_failed', `GitHub rename failed: ${r.stderr.trim() || r.stdout.trim()}`);
    }
    newRemoteUrl = repo.remoteUrl!.replace(/\/[^/]+?(\.git)?$/, (m, git) => `/${newName}${git ?? ''}`);
    if (repo.remoteUrl!.startsWith('git@')) {
      newRemoteUrl = repo.remoteUrl!.replace(/:([^/]+)\/[^/]+?(\.git)?$/, (m, o, git) => `:${o}/${newName}${git ?? ''}`);
    }
    const set = await runner('git', ['remote', 'set-url', 'origin', newRemoteUrl], { cwd: repo.path });
    if (set.code !== 0) {
      throw new ActionError(500, 'remote_update_failed', `GitHub renamed but updating origin failed: ${set.stderr}`);
    }
  }

  try {
    await fs.rename(repo.path, newPath);
  } catch (err) {
    throw mapFsError(err, `"${repo.name}"`);
  }
  return { newPath, newRemoteUrl };
}

export async function mkdirInRepo(
  repo: Repo,
  relDir: string,
  opts: { gitkeep?: boolean } = {},
): Promise<{ created: string }> {
  requireOnDisk(repo);
  if (!exists(repo.path)) throw new ActionError(404, 'not_found', 'Repo folder no longer exists.');
  const full = resolveInsideRepo(repo.path, relDir);
  if (!full) throw new ActionError(400, 'traversal', 'Folder path must stay inside the repo.');
  if (exists(full)) throw new ActionError(409, 'exists', 'That folder already exists.');
  try {
    await fs.mkdir(full, { recursive: true });
    if (opts.gitkeep) await fs.writeFile(path.join(full, '.gitkeep'), '');
  } catch (err) {
    throw mapFsError(err, 'Folder');
  }
  return { created: full };
}

export type Spawner = typeof nodeSpawn;

function detached(spawn: Spawner, cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: true,
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function openRepo(
  repo: Repo,
  target: OpenTarget,
  spawn: Spawner = nodeSpawn,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const q = (p: string) => `"${p}"`;
  const win = platform === 'win32';
  const mac = platform === 'darwin';
  if (repo.virtual) {
    if (target !== 'github') throw new ActionError(400, 'virtual', 'This book is a link. Clone it to open it locally.');
    const url = repo.linkUrl;
    if (!url || !/^https:\/\//.test(url)) throw new ActionError(400, 'no_github', 'No link known for this book.');
    if (win) await detached(spawn, 'start', ['""', q(url)]);
    else await detached(spawn, mac ? 'open' : 'xdg-open', [q(url)]);
    return;
  }
  if (!exists(repo.path)) throw new ActionError(404, 'not_found', 'Repo folder no longer exists.');
  try {
    switch (target) {
      case 'code':
        await detached(spawn, 'code', [q(repo.path)]);
        return;
      case 'terminal':
        if (win) {
          try {
            await detached(spawn, 'wt', ['-d', q(repo.path)]);
          } catch {
            await detached(spawn, 'start', ['""', 'powershell', '-NoExit', '-Command', `Set-Location '${repo.path}'`]);
          }
        } else if (mac) {
          await detached(spawn, 'open', ['-a', 'Terminal', q(repo.path)]);
        } else {
          try {
            await detached(spawn, 'x-terminal-emulator', [], repo.path);
          } catch {
            await detached(spawn, 'gnome-terminal', ['--working-directory', q(repo.path)]);
          }
        }
        return;
      case 'explorer':
        await detached(spawn, win ? 'explorer' : mac ? 'open' : 'xdg-open', [q(repo.path)]);
        return;
      case 'github': {
        const url = repo.github?.htmlUrl ?? (repo.repoSlug ? `https://github.com/${repo.repoSlug}` : null);
        if (!url || !/^https:\/\/github\.com\//.test(url)) {
          throw new ActionError(400, 'no_github', 'No GitHub page known for this repo.');
        }
        if (win) await detached(spawn, 'start', ['""', q(url)]);
        else await detached(spawn, mac ? 'open' : 'xdg-open', [q(url)]);
        return;
      }
      default:
        throw new ActionError(400, 'bad_target', `Unknown open target "${String(target)}".`);
    }
  } catch (err) {
    if (err instanceof ActionError) throw err;
    throw new ActionError(500, 'open_failed', (err as Error).message);
  }
}

export interface CloneResult {
  newPath: string;
}

/** `git clone` a book's remote into a disk shelf. Works for link books and for any repo with a GitHub remote. */
export async function cloneRepo(
  repo: Repo,
  target: ShelfConfigEntry,
  runner: Runner = execRunner,
): Promise<CloneResult> {
  const url = repo.remoteUrl ?? (repo.linkUrl && /\.git$/.test(repo.linkUrl) ? repo.linkUrl : null);
  if (!url) throw new ActionError(400, 'no_remote', 'This book has no git remote to clone. Open its link instead.');
  if (!/^(https:\/\/|git@|ssh:\/\/|file:\/\/)/.test(url)) throw new ActionError(400, 'bad_remote', 'Unsupported remote URL.');
  if (!target.path) throw new ActionError(400, 'link_shelf', 'Choose a folder shelf to clone into.');
  if (!exists(target.path)) throw new ActionError(404, 'not_found', 'Target shelf folder does not exist.');
  const name = repo.name.replace(/[^A-Za-z0-9._-]/g, '-');
  const dest = path.join(path.resolve(target.path), name);
  if (exists(dest)) throw new ActionError(409, 'exists', `"${name}" already exists on that shelf.`);
  const r = await runner('git', ['clone', '--', url, dest], { timeoutMs: 10 * 60 * 1000 });
  if (r.code !== 0) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined);
    throw new ActionError(502, 'clone_failed', `git clone failed: ${(r.stderr || r.stdout).trim().split('\n').pop() ?? 'unknown error'}`);
  }
  return { newPath: dest };
}

function requireOwnedOnGitHub(repo: Repo, login: string | null): string {
  if (!repo.repoSlug || !repo.owner) throw new ActionError(400, 'no_github', 'This book is not a GitHub repo.');
  if (!login) throw new ActionError(401, 'gh_unavailable', 'GitHub CLI is not signed in. Run `gh auth login`.');
  if (repo.owner.toLowerCase() !== login.toLowerCase()) {
    throw new ActionError(403, 'not_owner', `Only repos owned by ${login} can be changed from here.`);
  }
  return repo.repoSlug;
}

function ghFailure(what: string, r: RunResult): ActionError {
  const text = (r.stderr || r.stdout).trim();
  if (/delete_repo/.test(text)) {
    return new ActionError(
      403,
      'scope',
      'Your gh token lacks the delete_repo scope. Run `gh auth refresh -h github.com -s delete_repo` and try again.',
    );
  }
  const last = text.split('\n').filter(Boolean).pop() ?? 'unknown error';
  return new ActionError(502, 'github_failed', `${what} failed: ${last}`);
}

export async function setVisibility(
  repo: Repo,
  visibility: 'public' | 'private',
  runner: Runner = execRunner,
  login: string | null = null,
): Promise<void> {
  const slug = requireOwnedOnGitHub(repo, login);
  if (visibility !== 'public' && visibility !== 'private') throw new ActionError(400, 'bad_visibility', 'Visibility must be public or private.');
  if (repo.visibility === visibility) throw new ActionError(400, 'same_visibility', `Repo is already ${visibility}.`);
  const r = await runner('gh', ['repo', 'edit', slug, '--visibility', visibility, '--accept-visibility-change-consequences'], { timeoutMs: 60_000 });
  if (r.code !== 0) throw ghFailure('Changing visibility', r);
}

export async function setArchived(repo: Repo, archived: boolean, runner: Runner = execRunner, login: string | null = null): Promise<void> {
  const slug = requireOwnedOnGitHub(repo, login);
  if (repo.archived === archived) throw new ActionError(400, 'same_state', archived ? 'Repo is already archived.' : 'Repo is not archived.');
  const r = await runner('gh', ['repo', archived ? 'archive' : 'unarchive', slug, '--yes'], { timeoutMs: 60_000 });
  if (r.code !== 0) throw ghFailure(archived ? 'Archiving' : 'Unarchiving', r);
}

/** Deletes a GitHub repository. Irreversible. The caller must send the exact repo name as confirmation. */
export async function deleteGitHubRepo(repo: Repo, confirmName: string, runner: Runner = execRunner, login: string | null = null): Promise<void> {
  const slug = requireOwnedOnGitHub(repo, login);
  if (confirmName !== repo.name) throw new ActionError(400, 'confirm_mismatch', 'Type the repository name exactly to confirm deletion.');
  if (!repo.virtual) {
    throw new ActionError(400, 'has_clone', 'This book is a local clone. Delete the GitHub repo from its book on the GitHub shelf.');
  }
  const r = await runner('gh', ['repo', 'delete', slug, '--yes'], { timeoutMs: 60_000 });
  if (r.code !== 0) throw ghFailure('Deleting', r);
}

export interface CreateRepoOptions {
  description?: string;
  /** Also create the repo on GitHub under the signed-in account and push. */
  github?: 'public' | 'private' | null;
}

export interface CreateRepoResult {
  path: string;
  url: string | null;
  /** Set when the local repo was created but the GitHub step failed. */
  warning?: string;
}

/** `git init` a brand-new repo on a folder shelf, with a README and an initial commit. */
export async function createRepo(
  target: ShelfConfigEntry,
  name: string,
  opts: CreateRepoOptions = {},
  runner: Runner = execRunner,
  login: string | null = null,
): Promise<CreateRepoResult> {
  if (!validRepoName(name)) {
    throw new ActionError(400, 'invalid_name', 'Name may only contain letters, numbers, dots, dashes and underscores (max 100).');
  }
  if (!target.path) throw new ActionError(400, 'link_shelf', 'Choose a folder shelf to create the repo in.');
  if (!exists(target.path)) throw new ActionError(404, 'not_found', 'Target shelf folder does not exist.');
  if (opts.github && !login) throw new ActionError(401, 'gh_unavailable', 'GitHub CLI is not signed in. Run `gh auth login` or create the repo locally only.');
  const dest = path.join(path.resolve(target.path), name);
  if (exists(dest)) throw new ActionError(409, 'exists', `"${name}" already exists on that shelf.`);

  const description = (opts.description ?? '').trim();
  try {
    await fs.mkdir(dest, { recursive: true });
    const title = name.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    await fs.writeFile(path.join(dest, 'README.md'), `# ${title}\n${description ? `\n${description}\n` : ''}`, 'utf8');
    await fs.writeFile(path.join(dest, '.gitignore'), 'node_modules/\ndist/\n.env\n.DS_Store\nThumbs.db\n', 'utf8');
  } catch (err) {
    throw mapFsError(err, `"${name}"`);
  }
  const g = async (args: string[]) => {
    const r = await runner('git', args, { cwd: dest, timeoutMs: 60_000 });
    if (r.code !== 0) throw new ActionError(500, 'git_failed', `git ${args[0]} failed: ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}`);
    return r;
  };
  try {
    await g(['init', '-q', '-b', 'main']);
    await g(['add', '-A']);
    await g(['-c', 'user.useConfigOnly=false', 'commit', '-q', '-m', 'Initial commit']);
  } catch (err) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  if (!opts.github) return { path: dest, url: null };
  const args = ['repo', 'create', `${login}/${name}`, `--${opts.github}`, '--source', dest, '--remote', 'origin', '--push'];
  if (description) args.push('--description', description);
  const r = await runner('gh', args, { timeoutMs: 120_000 });
  if (r.code !== 0) {
    const last = (r.stderr || r.stdout).trim().split('\n').filter(Boolean).pop() ?? 'unknown error';
    return { path: dest, url: null, warning: `Created locally, but GitHub step failed: ${last}` };
  }
  return { path: dest, url: `https://github.com/${login}/${name}` };
}
