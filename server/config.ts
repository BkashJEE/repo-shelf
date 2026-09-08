import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { LinkEntry, ShelfConfig, ShelfConfigEntry } from './types.js';

export const DEFAULT_STALE_DAYS = 90;
export const DEFAULT_GITHUB_CACHE_HOURS = 24;

/** Curated public repos worth a look. Shown as a link shelf; clone any of them onto a disk shelf. */
export const FEATURED_SHELF: ShelfConfigEntry = {
  label: 'Hermes Agent',
  links: [
    { slug: 'NousResearch/hermes-agent' },
    { slug: 'nesquena/hermes-webui' },
    { slug: 'BkashJEE/hermes-agent-dock' },
  ],
};

/** Revealed by typing "hermes" anywhere in the app. */
export const SECRET_SHELF: ShelfConfigEntry = {
  label: 'Secret · Hermes Skills',
  hidden: true,
  links: [
    { name: 'Hermes Skills', url: 'https://github.com/NousResearch/hermes-agent/tree/main/skills' },
    { name: 'Hermes Docs', url: 'https://github.com/NousResearch/hermes-agent/tree/main/docs' },
    { name: 'Hermes Plugins', url: 'https://github.com/NousResearch/hermes-agent/tree/main/plugins' },
  ],
};

export function defaultConfig(home: string = os.homedir()): ShelfConfig {
  return {
    shelves: [
      { label: 'Developer', path: path.join(home, 'Developer') },
      { label: 'Documents', path: path.join(home, 'Documents') },
      { label: 'Home', path: home },
      GITHUB_PUBLIC_SHELF,
      GITHUB_PRIVATE_SHELF,
      FEATURED_SHELF,
      SECRET_SHELF,
    ],
    staleAfterDays: DEFAULT_STALE_DAYS,
    githubCacheHours: DEFAULT_GITHUB_CACHE_HOURS,
  };
}

export function isLinkShelf(e: ShelfConfigEntry): boolean {
  return Array.isArray(e.links);
}

export function isGithubShelf(e: ShelfConfigEntry): boolean {
  return typeof e.github === 'string' && e.github.trim() !== '';
}

/** Any shelf whose books are not folders on disk. */
export function isVirtualShelf(e: ShelfConfigEntry): boolean {
  return isLinkShelf(e) || isGithubShelf(e);
}

export const GITHUB_PUBLIC_SHELF: ShelfConfigEntry = { label: 'GitHub · public', github: 'me', visibility: 'public' };
export const GITHUB_PRIVATE_SHELF: ShelfConfigEntry = { label: 'GitHub · private', github: 'me', visibility: 'private' };

export function shelfId(p: string): string {
  const norm = path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 12);
}

/** Stable id for any shelf entry: disk shelves hash their path, link shelves their label. */
export function entryId(e: ShelfConfigEntry): string {
  if (isGithubShelf(e)) {
    return crypto.createHash('sha1').update(`github:${e.github!.toLowerCase()}:${e.visibility ?? 'all'}`).digest('hex').slice(0, 12);
  }
  if (isLinkShelf(e)) return crypto.createHash('sha1').update(`links:${e.label.toLowerCase()}`).digest('hex').slice(0, 12);
  return shelfId(e.path!);
}

function normalizeLink(l: Partial<LinkEntry>): LinkEntry {
  const out: LinkEntry = {};
  if (typeof l.slug === 'string' && /^[\w.-]+\/[\w.-]+$/.test(l.slug.trim())) out.slug = l.slug.trim();
  if (typeof l.url === 'string' && /^https:\/\//.test(l.url.trim())) out.url = l.url.trim();
  if (typeof l.name === 'string' && l.name.trim()) out.name = l.name.trim();
  if (!out.slug && !out.url) throw new Error('invalid_link: each link needs a slug or an https url');
  return out;
}

function normalizeEntry(e: Partial<ShelfConfigEntry>): ShelfConfigEntry {
  if (e && typeof e.github === 'string' && e.github.trim()) {
    const vis = e.visibility === 'public' || e.visibility === 'private' ? e.visibility : 'all';
    const github = e.github.trim();
    const label = typeof e.label === 'string' && e.label.trim() ? e.label.trim() : `GitHub · ${vis === 'all' ? github : vis}`;
    return { label, github, visibility: vis, ...(e.hidden ? { hidden: true } : {}) };
  }
  if (e && Array.isArray(e.links)) {
    const label = typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Links';
    return { label, links: e.links.map(normalizeLink), ...(e.hidden ? { hidden: true } : {}) };
  }
  if (!e || typeof e.path !== 'string' || !e.path.trim()) {
    throw new Error('invalid_shelf: every shelf needs a path or a links list');
  }
  const p = path.resolve(e.path);
  return {
    label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : path.basename(p) || p,
    path: p,
    ...(e.hidden ? { hidden: true } : {}),
  };
}

export function validateShelfPaths(shelves: ShelfConfigEntry[]): void {
  for (const s of shelves) {
    if (isVirtualShelf(s)) continue;
    if (!s.path || !fs.existsSync(s.path) || !fs.statSync(s.path).isDirectory()) {
      throw new Error(`shelf_path_missing: ${s.path}`);
    }
  }
}

export function loadConfig(file: string, home: string = os.homedir()): ShelfConfig {
  if (!fs.existsSync(file)) {
    const cfg = defaultConfig(home);
    // Only keep default disk shelves that actually exist so first boot never fails.
    cfg.shelves = cfg.shelves.filter((s) => isVirtualShelf(s) || fs.existsSync(s.path!));
    saveConfig(file, cfg);
    return cfg;
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ShelfConfig>;
  const shelves = Array.isArray(raw.shelves) ? raw.shelves.map(normalizeEntry) : [];
  const cfg: ShelfConfig = {
    shelves,
    staleAfterDays: typeof raw.staleAfterDays === 'number' ? raw.staleAfterDays : DEFAULT_STALE_DAYS,
    githubCacheHours:
      typeof raw.githubCacheHours === 'number' ? raw.githubCacheHours : DEFAULT_GITHUB_CACHE_HOURS,
  };
  validateShelfPaths(cfg.shelves);
  return cfg;
}

export function saveConfig(file: string, cfg: ShelfConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}
