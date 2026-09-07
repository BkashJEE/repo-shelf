import type { Repo } from './types';

export const MIN_HEIGHT = 1.6;
export const MAX_HEIGHT = 3.4;
export const MIN_THICKNESS = 0.16;
export const MAX_THICKNESS = 0.62;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Spine height in scene units; grows with commit count on a log scale. */
export function bookHeight(commitCount: number): number {
  const n = Math.max(0, commitCount || 0);
  return clamp(MIN_HEIGHT + 0.9 * Math.log10(1 + n), MIN_HEIGHT, MAX_HEIGHT);
}

/** Spine thickness in scene units; grows with size on disk on a log scale. */
export function bookThickness(sizeKB: number): number {
  const kb = Math.max(0, sizeKB || 0);
  return clamp(MIN_THICKNESS + 0.12 * Math.log10(1 + kb), MIN_THICKNESS, MAX_THICKNESS);
}

export function languageOf(r: Repo): string {
  return r.github?.language ?? r.languageGuess ?? 'Unknown';
}

export const LANGUAGE_PALETTE: Record<string, string> = {
  TypeScript: '#2f5d8a',
  JavaScript: '#c9a227',
  Python: '#3b6e8f',
  Rust: '#a3452f',
  Go: '#2a8a8a',
  Swift: '#d0632a',
  Kotlin: '#7a4fbf',
  Java: '#8a5a2a',
  'C#': '#5a3f8a',
  'C++': '#8a3f5a',
  C: '#4f5b66',
  Ruby: '#a12d2d',
  PHP: '#5a6aa8',
  HTML: '#c25a3a',
  CSS: '#3a6fb0',
  Markdown: '#6b6b5f',
  Shell: '#4a6b3a',
  PowerShell: '#2f4f8a',
  Lua: '#2f3f8a',
  Dart: '#2a7f9f',
  Vue: '#3f8f6a',
  Svelte: '#c94a2a',
  'Pine Script': '#2f6f5a',
  'Jupyter Notebook': '#c9722a',
  Unknown: '#6f6a5f',
};

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable color per language: palette entry, else a hashed hue at fixed S/L. */
export function bookColor(language: string): string {
  const hit = LANGUAGE_PALETTE[language];
  if (hit) return hit;
  const hue = hashString(language) % 360;
  return `hsl(${hue} 42% 42%)`;
}

export function isStale(r: Repo, staleAfterDays: number, now: Date = new Date()): boolean {
  if (r.virtual) return false;
  if (!r.lastCommitAt) return true;
  const ms = now.getTime() - new Date(r.lastCommitAt).getTime();
  return ms > staleAfterDays * 24 * 3600 * 1000;
}

export function hasGoldBand(r: Repo): boolean {
  return (r.github?.stars ?? 0) > 0;
}

export function hasRedTab(r: Repo): boolean {
  return r.dirtyCount > 0;
}

export type Filter = 'all' | `lang:${string}` | 'remote' | 'dirty' | 'stale';

export function matches(
  r: Repo,
  query: string,
  filter: Filter,
  shelfId: string,
  staleAfterDays: number,
  now: Date = new Date(),
): boolean {
  if (shelfId !== 'all' && r.shelfId !== shelfId) return false;
  if (filter.startsWith('lang:')) {
    if (languageOf(r) !== filter.slice(5)) return false;
  } else if (filter === 'remote') {
    if (!r.remoteUrl && !r.linkUrl) return false;
  } else if (filter === 'dirty') {
    if (r.dirtyCount === 0) return false;
  } else if (filter === 'stale') {
    if (!isStale(r, staleAfterDays, now)) return false;
  }
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    r.name,
    r.path,
    r.github?.description ?? '',
    languageOf(r),
    r.branch ?? '',
    r.repoSlug ?? '',
    ...(r.github?.topics ?? []),
  ]
    .join('\n')
    .toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const days = Math.floor((now.getTime() - then) / (24 * 3600 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

const ACRONYMS = new Set(['ai', 'api', 'ui', 'ux', 'cli', 'sdk', 'os', 'gpt', 'llm', 'mcp', 'js', 'ts', 'css', 'html', 'http', 'sql', 'db', 'aws', 'gcp', 'ios', 'pr', 'ci', 'cd', 'vr', 'ar', 'ml', 'nlp', 'ocr', 'pdf', 'url', 'id', 'io', 'md', 'tv', 'x', 'hud', 'gif', 'mp4', 'rss', 'seo', 'crm', 'erp', 'wip']);

/**
 * Human title for a repo folder name: splits on dashes, underscores, dots and
 * camelCase, capitalises words, upper-cases common acronyms.
 * "hermes-pocket" -> "Hermes Pocket", "HermesAgent" -> "Hermes Agent", "tradingview-mcp" -> "Tradingview MCP".
 */
export function displayName(name: string): string {
  const spaced = name
    .replace(/[-_.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  if (!spaced) return name;
  return spaced
    .split(/\s+/)
    .map((w) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (/^v\d/.test(lower)) return lower;
      if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export function formatSize(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** Languages present in the repo set, most common first, ties alphabetical. */
export function languageCounts(repos: Repo[]): { language: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of repos) {
    const l = languageOf(r);
    m.set(l, (m.get(l) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
}
