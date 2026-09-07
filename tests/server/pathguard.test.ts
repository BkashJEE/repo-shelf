import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { insideShelves, resolveInsideRepo, shelfOf, validRepoName } from '../../server/pathguard';

const shelves = [
  { label: 'A', path: path.join('C:', 'work', 'a') },
  { label: 'B', path: path.join('C:', 'work', 'b') + path.sep },
];

describe('insideShelves', () => {
  it('accepts a direct child of a shelf, case-insensitively, with or without trailing slash', () => {
    expect(insideShelves(path.join('C:', 'work', 'a', 'repo'), shelves)).toBe(true);
    expect(insideShelves(path.join('c:', 'WORK', 'b', 'repo'), shelves)).toBe(true);
  });
  it('rejects the shelf root itself, grandchildren, and outsiders', () => {
    expect(insideShelves(path.join('C:', 'work', 'a'), shelves)).toBe(false);
    expect(insideShelves(path.join('C:', 'work', 'a', 'repo', 'sub'), shelves)).toBe(false);
    expect(insideShelves(path.join('C:', 'other', 'repo'), shelves)).toBe(false);
  });
  it('shelfOf returns the matching shelf', () => {
    expect(shelfOf(path.join('C:', 'work', 'b', 'x'), shelves)?.label).toBe('B');
    expect(shelfOf(path.join('C:', 'nope', 'x'), shelves)).toBeNull();
  });
});

describe('resolveInsideRepo', () => {
  const repo = path.join('C:', 'work', 'a', 'repo');
  it('resolves simple and nested relative paths', () => {
    expect(resolveInsideRepo(repo, 'docs')).toBe(path.join(repo, 'docs'));
    expect(resolveInsideRepo(repo, 'src/lib/util')).toBe(path.join(repo, 'src', 'lib', 'util'));
  });
  it('rejects traversal, absolute paths, empty, and the repo root itself', () => {
    expect(resolveInsideRepo(repo, '../x')).toBeNull();
    expect(resolveInsideRepo(repo, 'docs/../../x')).toBeNull();
    expect(resolveInsideRepo(repo, path.join('C:', 'work', 'a', 'repo', 'x'))).toBeNull();
    expect(resolveInsideRepo(repo, '/x')).toBeNull();
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
