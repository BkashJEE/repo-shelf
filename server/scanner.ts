import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { LinkEntry, Repo, Shelf, ShelfConfig, ShelfConfigEntry } from './types.js';
import { execRunner, git, type Runner } from './git.js';
import { entryId, isGithubShelf, isLinkShelf } from './config.js';
import type { GhListItem, RepoLister } from './github.js';
import { sizeAndLanguage } from './walk.js';

export const SCAN_CONCURRENCY = 8;

export function repoId(p: string): string {
  const norm = path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

/** Parse a git remote URL into GitHub owner / "owner/name" when it is a GitHub remote. */
export function parseRemote(url: string | null): { owner: string | null; repoSlug: string | null } {
  if (!url) return { owner: null, repoSlug: null };
  const m =
    url.match(/^(?:https?:\/\/|git@|ssh:\/\/git@)github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i) ??
    null;
  if (!m) return { owner: null, repoSlug: null };
  return { owner: m[1], repoSlug: `${m[1]}/${m[2]}` };
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

export async function scanRepo(dir: string, shelf: string, runner: Runner = execRunner): Promise<Repo> {
  const base: Repo = {
    id: repoId(dir),
    name: path.basename(dir),
    path: dir,
    shelfId: shelf,
    virtual: false,
    linkUrl: null,
    visibility: null,
    archived: false,
    branch: null,
    lastCommitAt: null,
    commitCount: 0,
    dirtyCount: 0,
    sizeKB: 0,
    languageGuess: null,
    remoteUrl: null,
    owner: null,
    repoSlug: null,
    github: null,
  };
  try {
    const [branch, lastCommit, count, status, remote, walk] = await Promise.all([
      git(runner, dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(runner, dir, ['log', '-1', '--format=%cI']),
      git(runner, dir, ['rev-list', '--count', 'HEAD']),
      git(runner, dir, ['status', '--porcelain']),
      git(runner, dir, ['remote', 'get-url', 'origin']),
      sizeAndLanguage(dir),
    ]);
    if (branch === null && status === null) {
      // git itself failed for this directory (corrupt .git, git missing, timeout)
      base.error = 'git_failed';
    }
    base.branch = branch && branch !== 'HEAD' ? branch : branch;
    base.lastCommitAt = lastCommit || null;
    base.commitCount = count ? Number.parseInt(count, 10) || 0 : 0;
    base.dirtyCount = status ? status.split(/\r?\n/).filter((l) => l.trim()).length : 0;
    base.remoteUrl = remote || null;
    const parsed = parseRemote(base.remoteUrl);
    base.owner = parsed.owner;
    base.repoSlug = parsed.repoSlug;
    base.sizeKB = walk.sizeKB;
    base.languageGuess = walk.languageGuess;
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
  }
  return base;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function listRepoDirs(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => path.join(root, e.name));
  const flags = await Promise.all(dirs.map(isGitRepo));
  return dirs.filter((_, i) => flags[i]).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** A book that exists only as a link (GitHub slug or URL). Cloning it turns it into a disk repo. */
export function linkRepo(link: LinkEntry, shelf: string): Repo {
  const url = link.url ?? `https://github.com/${link.slug}`;
  const parsed = parseRemote(link.slug ? `https://github.com/${link.slug}` : url);
  const name = link.name ?? (link.slug ? link.slug.split('/')[1] : url.replace(/^https:\/\//, '').split('/').filter(Boolean).pop() ?? url);
  return {
    id: crypto.createHash('sha1').update(`link:${url.toLowerCase()}`).digest('hex').slice(0, 16),
    name,
    path: '',
    shelfId: shelf,
    virtual: true,
    linkUrl: url,
    visibility: null,
    archived: false,
    branch: null,
    lastCommitAt: null,
    commitCount: 0,
    dirtyCount: 0,
    sizeKB: 0,
    languageGuess: null,
    remoteUrl: parsed.repoSlug ? `https://github.com/${parsed.repoSlug}.git` : null,
    owner: parsed.owner,
    repoSlug: parsed.repoSlug,
    github: null,
  };
}

/** A book for one of the account's GitHub repos. Everything GitHub knows is filled in up front. */
export function githubRepo(item: GhListItem, shelf: string, now: Date = new Date()): Repo {
  const slug = item.nameWithOwner;
  const [owner] = slug.split('/');
  const vis = item.visibility === 'PRIVATE' || item.visibility === 'INTERNAL' ? 'private' : 'public';
  return {
    id: crypto.createHash('sha1').update(`gh:${slug.toLowerCase()}`).digest('hex').slice(0, 16),
    name: item.name,
    path: '',
    shelfId: shelf,
    virtual: true,
    linkUrl: item.url,
    visibility: vis,
    archived: Boolean(item.isArchived),
    branch: null,
    lastCommitAt: item.pushedAt ?? null,
    commitCount: 0,
    dirtyCount: 0,
    sizeKB: item.diskUsage ?? 0,
    languageGuess: item.primaryLanguage?.name ?? null,
    remoteUrl: `https://github.com/${slug}.git`,
    owner,
    repoSlug: slug,
    github: {
      description: item.description ?? null,
      language: item.primaryLanguage?.name ?? null,
      stars: item.stargazerCount ?? 0,
      topics: (item.repositoryTopics ?? []).map((t) => t.name),
      isPrivate: vis === 'private',
      isFork: Boolean(item.isFork),
      pushedAt: item.pushedAt,
      htmlUrl: item.url,
      fetchedAt: now.toISOString(),
    },
  };
}

const noLister: RepoLister = async () => [];

export async function scanShelf(
  entry: ShelfConfigEntry,
  runner: Runner = execRunner,
  lister: RepoLister = noLister,
): Promise<{ shelf: Shelf; repos: Repo[] }> {
  const id = entryId(entry);
  if (isGithubShelf(entry)) {
    const items = await lister(entry.github!);
    const want = entry.visibility ?? 'all';
    const repos = items
      .filter((it) => want === 'all' || (it.visibility === 'PUBLIC' ? 'public' : 'private') === want)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((it) => githubRepo(it, id));
    return { shelf: { id, label: entry.label, path: null, kind: 'github', hidden: Boolean(entry.hidden), repoCount: repos.length }, repos };
  }
  if (isLinkShelf(entry)) {
    const repos = (entry.links ?? []).map((l) => linkRepo(l, id));
    return { shelf: { id, label: entry.label, path: null, kind: 'links', hidden: Boolean(entry.hidden), repoCount: repos.length }, repos };
  }
  const dirs = await listRepoDirs(entry.path!);
  const repos = await pool(dirs, SCAN_CONCURRENCY, (d) => scanRepo(d, id, runner));
  return {
    shelf: { id, label: entry.label, path: path.resolve(entry.path!), kind: 'disk', hidden: Boolean(entry.hidden), repoCount: repos.length },
    repos,
  };
}

export async function scanAll(
  cfg: ShelfConfig,
  runner: Runner = execRunner,
  lister: RepoLister = noLister,
): Promise<{ shelves: Shelf[]; repos: Repo[] }> {
  const results = await Promise.all(cfg.shelves.map((s) => scanShelf(s, runner, lister)));
  return { shelves: results.map((r) => r.shelf), repos: results.flatMap((r) => r.repos) };
}
