import path from 'node:path';
import type { ShelfConfigEntry } from './types.js';

function norm(p: string): string {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** True when p resolves to a direct child of one of the shelf roots. */
export function insideShelves(p: string, shelves: ShelfConfigEntry[]): boolean {
  if (!p) return false;
  const target = norm(p);
  const parent = norm(path.dirname(target));
  return shelves.some((s) => s.path && norm(s.path) === parent);
}

/** Find the shelf entry whose root is the direct parent of p, or null. */
export function shelfOf(p: string, shelves: ShelfConfigEntry[]): ShelfConfigEntry | null {
  if (!p) return null;
  const parent = norm(path.dirname(norm(p)));
  return shelves.find((s) => s.path && norm(s.path) === parent) ?? null;
}

/**
 * Resolve a user-supplied relative directory against a repo root. Returns the
 * absolute path when it stays strictly inside the repo, otherwise null.
 */
export function resolveInsideRepo(repoPath: string, rel: string): string | null {
  if (typeof rel !== 'string' || !rel.trim()) return null;
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const root = path.resolve(repoPath);
  const full = path.resolve(root, rel);
  const rootN = norm(root) + path.sep;
  const fullN = norm(full);
  if (!fullN.startsWith(rootN)) return null;
  return full;
}

export const NAME_RE = /^[A-Za-z0-9._-]+$/;

export function validRepoName(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 100 &&
    NAME_RE.test(name) &&
    name !== '.' &&
    name !== '..'
  );
}
