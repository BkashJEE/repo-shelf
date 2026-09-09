import fs from 'node:fs/promises';
import path from 'node:path';
import type { Repo, RepoPages, PageCommit, PageIssue, PageFile } from './types.js';
import { execRunner, type Runner } from './git.js';

const PAGE_TTL_MS = 5 * 60 * 1000;
const README_NAMES = ['README.md', 'readme.md', 'Readme.md', 'README.MD', 'README', 'README.txt', 'README.rst'];
const MAX_README = 200_000;

async function ghJson<T>(runner: Runner, route: string): Promise<T | null> {
  const r = await runner('gh', ['api', route], { timeoutMs: 30_000 });
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return null;
  }
}

async function diskReadme(dir: string): Promise<string | null> {
  for (const name of README_NAMES) {
    try {
      const text = await fs.readFile(path.join(dir, name), 'utf8');
      return text.slice(0, MAX_README);
    } catch {
      /* try next */
    }
  }
  return null;
}

async function diskFiles(dir: string): Promise<PageFile[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.name !== '.git')
      .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }) as PageFile)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      .slice(0, 200);
  } catch {
    return [];
  }
}

async function diskCommits(dir: string, runner: Runner): Promise<PageCommit[]> {
  const r = await runner('git', ['log', '-40', '--format=%H%x1f%an%x1f%cI%x1f%s'], { cwd: dir });
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => l.includes('\x1f'))
    .map((l) => {
      const [sha, author, date, message] = l.split('\x1f');
      return { sha, author, date, message };
    });
}

async function diskBranches(dir: string, runner: Runner): Promise<string[]> {
  const r = await runner('git', ['branch', '--format=%(refname:short)'], { cwd: dir });
  if (r.code !== 0) return [];
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 100);
}

interface GhIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  updated_at: string;
  user: { login: string } | null;
  labels?: { name: string }[];
  pull_request?: unknown;
  draft?: boolean;
}

function toIssue(i: GhIssue): PageIssue {
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    url: i.html_url,
    updatedAt: i.updated_at,
    author: i.user?.login ?? '',
    labels: (i.labels ?? []).map((l) => l.name),
    draft: Boolean(i.draft),
  };
}

async function githubExtras(slug: string, runner: Runner, ghOk: boolean): Promise<Pick<RepoPages, 'issues' | 'pulls'>> {
  if (!ghOk) return { issues: [], pulls: [] };
  const [issuesRaw, pullsRaw] = await Promise.all([
    ghJson<GhIssue[]>(runner, `repos/${slug}/issues?state=open&per_page=40`),
    ghJson<GhIssue[]>(runner, `repos/${slug}/pulls?state=open&per_page=40`),
  ]);
  return {
    issues: (issuesRaw ?? []).filter((i) => !i.pull_request).map(toIssue),
    pulls: (pullsRaw ?? []).map(toIssue),
  };
}

interface GhCommit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string } | null;
}
interface GhContent {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
}
interface GhReadme {
  content: string;
  encoding: string;
}

/** Everything the open book shows: README, files, commits, branches, issues, pull requests. */
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Turn a LinkEntry.doc reference into a raw URL. */
export function docRawUrl(doc: string): string {
  const m = doc.match(/^([\w.-]+\/[\w.-]+):(.+)$/);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/HEAD/${m[2].replace(/^\/+/, '')}`;
  return doc;
}

/** Where a human can read or edit the source. */
export function docSourceUrl(doc: string): string {
  const m = doc.match(/^([\w.-]+\/[\w.-]+):(.+)$/);
  if (m) return `https://github.com/${m[1]}/blob/HEAD/${m[2].replace(/^\/+/, '')}`;
  return doc;
}

export interface CleanDoc {
  title: string | null;
  description: string | null;
  markdown: string;
}

/**
 * Make Docusaurus / MDX markdown readable as plain markdown: front matter out,
 * imports and JSX embeds out, admonitions turned into quotes.
 */
export function cleanDoc(raw: string): CleanDoc {
  let text = raw.replace(/\r\n/g, '\n');
  let title: string | null = null;
  let description: string | null = null;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const t = line.match(/^title:\s*(.+)$/);
      const d = line.match(/^description:\s*(.+)$/);
      if (t) title = t[1].trim().replace(/^["']|["']$/g, '');
      if (d) description = d[1].trim().replace(/^["']|["']$/g, '');
    }
    text = text.slice(fm[0].length);
  }
  text = text
    .replace(/^import\s.+$/gm, '')
    .replace(/^export\s.+$/gm, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/g, '')
    .replace(/<div[^>]*style=\{\{[\s\S]*?<\/div>/g, '')
    .replace(/<\/?(Tabs|TabItem|details|summary)[^>]*>/g, '')
    .replace(/^:::(\w+)\s*(.*)$/gm, (_m, kind: string, label: string) => `> **${(label || kind).trim()}**`)
    .replace(/^:::\s*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!title) {
    const h1 = text.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }
  return { title, description, markdown: text };
}

async function fetchDoc(doc: string, fetcher: Fetcher): Promise<CleanDoc | null> {
  try {
    const r = await fetcher(docRawUrl(doc));
    if (!r.ok) return null;
    const raw = await r.text();
    return cleanDoc(raw.slice(0, MAX_README));
  } catch {
    return null;
  }
}

export async function buildPages(
  repo: Repo,
  runner: Runner = execRunner,
  ghOk = false,
  fetcher: Fetcher = (url) => fetch(url) as Promise<{ ok: boolean; status: number; text: () => Promise<string> }>,
): Promise<RepoPages> {
  const now = new Date().toISOString();
  if (repo.doc) {
    const d = await fetchDoc(repo.doc, fetcher);
    return {
      readme: d ? d.markdown : null,
      files: [],
      commits: [],
      branches: [],
      issues: [],
      pulls: [],
      source: d ? 'doc' : 'none',
      fetchedAt: now,
    };
  }
  if (!repo.virtual && repo.path) {
    const [readme, files, commits, branches, extras] = await Promise.all([
      diskReadme(repo.path),
      diskFiles(repo.path),
      diskCommits(repo.path, runner),
      diskBranches(repo.path, runner),
      repo.repoSlug ? githubExtras(repo.repoSlug, runner, ghOk) : Promise.resolve({ issues: [], pulls: [] }),
    ]);
    return { readme, files, commits, branches, ...extras, source: 'disk', fetchedAt: now };
  }
  if (!repo.repoSlug || !ghOk) {
    return { readme: null, files: [], commits: [], branches: [], issues: [], pulls: [], source: 'none', fetchedAt: now };
  }
  const slug = repo.repoSlug;
  const [readmeRaw, contents, commitsRaw, branchesRaw, extras] = await Promise.all([
    ghJson<GhReadme>(runner, `repos/${slug}/readme`),
    ghJson<GhContent[]>(runner, `repos/${slug}/contents`),
    ghJson<GhCommit[]>(runner, `repos/${slug}/commits?per_page=40`),
    ghJson<{ name: string }[]>(runner, `repos/${slug}/branches?per_page=100`),
    githubExtras(slug, runner, ghOk),
  ]);
  const readme =
    readmeRaw && readmeRaw.encoding === 'base64'
      ? Buffer.from(readmeRaw.content.replace(/\n/g, ''), 'base64').toString('utf8').slice(0, MAX_README)
      : null;
  const files: PageFile[] = (Array.isArray(contents) ? contents : [])
    .map((c) => ({ name: c.name, type: c.type === 'dir' ? 'dir' : 'file' }) as PageFile)
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  const commits: PageCommit[] = (commitsRaw ?? []).map((c) => ({
    sha: c.sha,
    author: c.author?.login ?? c.commit.author?.name ?? '',
    date: c.commit.author?.date ?? '',
    message: c.commit.message.split('\n')[0],
  }));
  return { readme, files, commits, branches: (branchesRaw ?? []).map((b) => b.name), ...extras, source: 'github', fetchedAt: now };
}

export class PagesCache {
  private map = new Map<string, { at: number; pages: RepoPages; key: string }>();
  constructor(private ttlMs = PAGE_TTL_MS) {}

  async get(repo: Repo, build: () => Promise<RepoPages>): Promise<RepoPages> {
    // The cache key changes when the repo's content likely changed (last commit, dirty count, path).
    const key = `${repo.path}|${repo.lastCommitAt}|${repo.dirtyCount}|${repo.github?.pushedAt ?? ''}`;
    const hit = this.map.get(repo.id);
    if (hit && hit.key === key && Date.now() - hit.at < this.ttlMs) return hit.pages;
    const pages = await build();
    this.map.set(repo.id, { at: Date.now(), pages, key });
    return pages;
  }

  clear(): void {
    this.map.clear();
  }
}
