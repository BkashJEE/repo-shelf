import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { insideShelves, resolveInsideRepo, shelfOf, validRepoName } from '../../server/pathguard';

// Absolute on every platform (C:\... on Windows, /tmp/... elsewhere).
const ROOT = path.resolve(os.tmpdir(), 'repo-shelf-guard');
const A = path.join(ROOT, 'a');
const B = path.join(ROOT, 'b');
const shelves = [
  { label: 'A', path: A },
  { label: 'B', path: B + path.sep },
];
const win = process.platform === 'win32';

describe('insideShelves', () => {
  it('accepts a direct child of a shelf, with or without trailing slash on the shelf', () => {
    expect(insideShelves(path.join(A, 'repo'), shelves)).toBe(true);
    expect(insideShelves(path.join(B, 'repo'), shelves)).toBe(true);
  });
  it('is case-insensitive on Windows only', () => {
    const upper = path.join(A.toUpperCase(), 'repo');
    expect(insideShelves(upper, shelves)).toBe(win);
  });
  it('rejects the shelf root itself, grandchildren, outsiders, and empty paths', () => {
    expect(insideShelves(A, shelves)).toBe(false);
    expect(insideShelves(path.join(A, 'repo', 'sub'), shelves)).toBe(false);
    expect(insideShelves(path.join(ROOT, 'other', 'repo'), shelves)).toBe(false);
    expect(insideShelves('', shelves)).toBe(false);
  });
  it('shelfOf returns the matching shelf', () => {
    expect(shelfOf(path.join(B, 'x'), shelves)?.label).toBe('B');
    expect(shelfOf(path.join(ROOT, 'nope', 'x'), shelves)).toBeNull();
    expect(shelfOf('', shelves)).toBeNull();
  });
});

describe('resolveInsideRepo', () => {
  const repo = path.join(A, 'repo');
  it('resolves simple and nested relative paths', () => {
    expect(resolveInsideRepo(repo, 'docs')).toBe(path.join(repo, 'docs'));
    expect(resolveInsideRepo(repo, 'src/lib/util')).toBe(path.join(repo, 'src', 'lib', 'util'));
  });
  it('rejects traversal, absolute paths, empty, and the repo root itself', () => {
    expect(resolveInsideRepo(repo, '../x')).toBeNull();
    expect(resolveInsideRepo(repo, 'docs/../../x')).toBeNull();
    expect(resolveInsideRepo(repo, path.join(repo, 'x'))).toBeNull();
    expect(resolveInsideRepo(repo, '/x')).toBeNull();
    expect(resolveInsideRepo(repo, 'C:/x')).toBeNull();
    expect(resolveInsideRepo(repo, '')).toBeNull();
    expect(resolveInsideRepo(repo, '.')).toBeNull();
  });
});

describe('validRepoName', () => {
  it('accepts sane names and rejects bad ones', () => {
    expect(validRepoName('my-repo_v2.0')).toBe(true);
    expect(validRepoName('a')).toBe(true);
    expect(validRepoName('')).toBe(false);
    expect(validRepoName('.')).toBe(false);
    expect(validRepoName('..')).toBe(false);
    expect(validRepoName('has space')).toBe(false);
    expect(validRepoName('slash/name')).toBe(false);
    expect(validRepoName('x'.repeat(101))).toBe(false);
  });
});
