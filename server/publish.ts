import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import type { AppState, Repo, RepoPages, Shelf } from './types.js';
import { execRunner, type Runner } from './git.js';
import { ActionError } from './actions.js';

/** The data a published (static, read-only) shelf ships with. No paths, no private repos, no dirty state. */
export interface StaticShelfData {
  owner: string | null;
  title: string;
  generatedAt: string;
  sourceUrl: string;
  shelves: Shelf[];
  repos: Repo[];
  pages: Record<string, RepoPages>;
}

export const PROJECT_URL = 'https://github.com/BkashJEE/repo-shelf';

function isPublic(r: Repo): boolean {
  if (r.visibility === 'private' || r.archived) return false;
  if (r.virtual) return true; // link books and public GitHub books
  return r.visibility === 'public' && Boolean(r.repoSlug);
}

/** Keep only what is safe to put on the public internet. */
export function sanitizeForPublish(state: AppState, owner: string | null): Pick<StaticShelfData, 'shelves' | 'repos'> {
  const hidden = new Set(state.shelves.filter((s) => s.hidden).map((s) => s.id));
  const repos = state.repos
    .filter((r) => !hidden.has(r.shelfId))
    .filter(isPublic)
    .map<Repo>((r) => ({
    ...r,
    path: '',
    dirtyCount: 0,
    error: undefined,
    linkUrl: r.linkUrl ?? (r.repoSlug ? `https://github.com/${r.repoSlug}` : null),
  }));
  const keep = new Set(repos.map((r) => r.shelfId));
  const shelves = state.shelves
    .filter((s) => !s.hidden && keep.has(s.id))
    .map<Shelf>((s) => ({ ...s, path: null, repoCount: repos.filter((r) => r.shelfId === s.id).length }));
  void owner;
  return { shelves, repos };
}

export interface BuildOptions {
  /** Folder with the `vite build --base ./` output (index.html + assets/). */
  staticDist: string;
  outDir: string;
  owner: string | null;
  title?: string;
  /** Resolve README/commits for a repo; omit to publish without pages. */
  pagesFor?: (repo: Repo) => Promise<RepoPages | null>;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.name !== 'server.cjs') await fs.copyFile(s, d);
  }
}

/** Write a self-contained site: the built UI plus `shelf-data.js` that the app reads in static mode. */
export async function buildStaticSite(state: AppState, opts: BuildOptions): Promise<{ dir: string; repos: number; shelves: number; withPages: number }> {
  if (!fssync.existsSync(path.join(opts.staticDist, 'index.html'))) {
    throw new ActionError(500, 'no_static_build', `Static UI build not found at ${opts.staticDist}. Run "npm run build:static".`);
  }
  const { shelves, repos } = sanitizeForPublish(state, opts.owner);
  if (repos.length === 0) throw new ActionError(400, 'nothing_public', 'No public repos to publish. Public GitHub repos and link shelves are included.');
  await fs.rm(opts.outDir, { recursive: true, force: true });
  await copyDir(opts.staticDist, opts.outDir);

  const pages: Record<string, RepoPages> = {};
  if (opts.pagesFor) {
    for (const r of repos) {
      try {
        const p = await opts.pagesFor(r);
        if (p) pages[r.id] = { ...p, readme: p.readme ? p.readme.slice(0, 30_000) : null, commits: p.commits.slice(0, 20), files: p.files.slice(0, 60) };
      } catch {
        /* a repo without pages is fine */
      }
    }
  }
  const data: StaticShelfData = {
    owner: opts.owner,
    title: opts.title ?? (opts.owner ? `${opts.owner}'s repo shelf` : 'repo shelf'),
    generatedAt: new Date().toISOString(),
    sourceUrl: PROJECT_URL,
    shelves,
    repos,
    pages,
  };
  const js = `window.__SHELF_STATIC = ${JSON.stringify(data)};\n`;
  await fs.writeFile(path.join(opts.outDir, 'shelf-data.js'), js, 'utf8');
  const indexFile = path.join(opts.outDir, 'index.html');
  let html = await fs.readFile(indexFile, 'utf8');
  html = html.replace('<head>', `<head>\n    <script src="./shelf-data.js"></script>`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(data.title)}</title>`);
  html = html.replace('</head>', `    <meta name="description" content="${escapeHtml(`${repos.length} repos on a 3D bookshelf. Made with repo shelf.`)}" />\n  </head>`);
  await fs.writeFile(indexFile, html, 'utf8');
  await fs.writeFile(path.join(opts.outDir, '.nojekyll'), '', 'utf8');
  await fs.writeFile(path.join(opts.outDir, 'README.md'), `# ${data.title}\n\nA 3D bookshelf of my public repos, published from [repo shelf](${PROJECT_URL}).\n`, 'utf8');
  return { dir: opts.outDir, repos: repos.length, shelves: shelves.length, withPages: Object.keys(pages).length };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const SITE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface PublishResult {
  repoUrl: string;
  pagesUrl: string;
  created: boolean;
  dir: string;
}

/** Push a built site folder to a public GitHub repo and turn on GitHub Pages. */
export async function publishSite(dir: string, login: string | null, repoName: string, runner: Runner = execRunner): Promise<PublishResult> {
  if (!login) throw new ActionError(401, 'gh_unavailable', 'GitHub CLI is not signed in. Run `gh auth login` first.');
  if (!SITE_NAME_RE.test(repoName)) throw new ActionError(400, 'invalid_name', 'Repo name may only contain letters, numbers, dots, dashes and underscores.');
  const slug = `${login}/${repoName}`;
  const g = async (args: string[]) => {
    const r = await runner('git', args, { cwd: dir, timeoutMs: 120_000 });
    if (r.code !== 0) throw new ActionError(500, 'git_failed', `git ${args[0]} failed: ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}`);
    return r;
  };
  await fs.rm(path.join(dir, '.git'), { recursive: true, force: true });
  await g(['init', '-q', '-b', 'main']);
  await g(['add', '-A']);
  await g(['-c', 'user.useConfigOnly=false', 'commit', '-q', '-m', `Publish repo shelf ${new Date().toISOString().slice(0, 10)}`]);

  const exists = (await runner('gh', ['repo', 'view', slug, '--json', 'name'], { timeoutMs: 30_000 })).code === 0;
  if (exists) {
    await g(['remote', 'add', 'origin', `https://github.com/${slug}.git`]);
    await g(['push', '--force', '-u', 'origin', 'main']);
  } else {
    const r = await runner('gh', ['repo', 'create', slug, '--public', '--source', dir, '--remote', 'origin', '--push', '--description', 'My repos on a 3D bookshelf, published from repo shelf'], { timeoutMs: 120_000 });
    if (r.code !== 0) {
      throw new ActionError(502, 'github_failed', `Creating ${slug} failed: ${(r.stderr || r.stdout).trim().split('\n').filter(Boolean).pop() ?? 'unknown error'}`);
    }
  }
  // Turn on Pages from the main branch root. 409 means it is already on.
  const pages = await runner('gh', ['api', '-X', 'POST', `repos/${slug}/pages`, '-f', 'build_type=legacy', '-f', 'source[branch]=main', '-f', 'source[path]=/'], { timeoutMs: 30_000 });
  if (pages.code !== 0 && !/409|already/i.test(pages.stderr + pages.stdout)) {
    // Not fatal: the repo is pushed; Pages can be enabled by hand.
    console.warn('[repo-shelf] could not enable Pages automatically:', (pages.stderr || pages.stdout).trim().split('\n').pop());
  }
  return { repoUrl: `https://github.com/${slug}`, pagesUrl: `https://${login.toLowerCase()}.github.io/${repoName}/`, created: !exists, dir };
}
