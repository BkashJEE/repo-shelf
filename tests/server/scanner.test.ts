import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempRoot, makeRepo, rm } from './helpers';
import { scanShelf, scanAll, parseRemote, repoId, linkRepo, githubRepo } from '../../server/scanner';
import { shelfId } from '../../server/config';
import type { Runner } from '../../server/git';

let root: string;
beforeAll(async () => {
  root = await makeTempRoot('repo-shelf-scan-');
  await makeRepo(root, 'alpha', { commits: 3, remote: 'https://github.com/someone/alpha.git' });
  await makeRepo(root, 'beta', {
    commits: 1,
    dirty: true,
    files: { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n', 'x.py': 'print(1)\n' },
  });
  fs.mkdirSync(path.join(root, 'plain-folder'));
  fs.writeFileSync(path.join(root, 'loose-file.txt'), 'x');
  // empty repo: git init, no commits
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty });
  // root itself has a .git dir but must not become a book
  fs.mkdirSync(path.join(root, '.git'));
});
afterAll(() => rm(root));

describe('scanShelf', () => {
  it('finds git repos one level deep and ignores plain folders, files, and the root', async () => {
    const { shelf, repos } = await scanShelf({ label: 'T', path: root });
    expect(shelf.id).toBe(shelfId(root));
    expect(shelf.repoCount).toBe(3);
    expect(repos.map((r) => r.name)).toEqual(['alpha', 'beta', 'empty']);
    for (const r of repos) expect(r.shelfId).toBe(shelf.id);
  });

  it('reads branch, commit count, last commit date, dirty count, and remote', async () => {
    const { repos } = await scanShelf({ label: 'T', path: root });
    const alpha = repos.find((r) => r.name === 'alpha')!;
    expect(alpha.branch).toBe('main');
    expect(alpha.commitCount).toBe(3);
    expect(alpha.lastCommitAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(alpha.dirtyCount).toBe(0);
    expect(alpha.remoteUrl).toBe('https://github.com/someone/alpha.git');
    expect(alpha.owner).toBe('someone');
    expect(alpha.repoSlug).toBe('someone/alpha');
    expect(alpha.id).toBe(repoId(alpha.path));

    const beta = repos.find((r) => r.name === 'beta')!;
    expect(beta.dirtyCount).toBe(1);
    expect(beta.remoteUrl).toBeNull();
    expect(beta.languageGuess).toBe('TypeScript');
    expect(beta.sizeKB).toBeGreaterThanOrEqual(0);
  });

  it('handles a repo with no commits', async () => {
    const { repos } = await scanShelf({ label: 'T', path: root });
    const empty = repos.find((r) => r.name === 'empty')!;
    expect(empty.commitCount).toBe(0);
    expect(empty.lastCommitAt).toBeNull();
    expect(empty.error).toBeUndefined();
  });

  it('still lists a repo when git fails, with an error field', async () => {
    const failing: Runner = async () => ({ code: 128, stdout: '', stderr: 'boom' });
    const { repos } = await scanShelf({ label: 'T', path: root }, failing);
    expect(repos).toHaveLength(3);
    expect(repos[0].error).toBe('git_failed');
    expect(repos[0].commitCount).toBe(0);
  });
});

describe('scanAll', () => {
  it('scans every shelf and flattens repos', async () => {
    const other = await makeTempRoot('repo-shelf-scan2-');
    await makeRepo(other, 'gamma');
    try {
      const { shelves, repos } = await scanAll({
        shelves: [
          { label: 'A', path: root },
          { label: 'B', path: other },
        ],
        staleAfterDays: 90,
        githubCacheHours: 24,
      });
      expect(shelves.map((s) => s.label)).toEqual(['A', 'B']);
      expect(repos.map((r) => r.name)).toEqual(['alpha', 'beta', 'empty', 'gamma']);
    } finally {
      rm(other);
    }
  });
});

describe('link shelves', () => {
  it('turns links into virtual books with GitHub slugs parsed', async () => {
    const { shelf, repos } = await scanShelf({
      label: 'Reads',
      hidden: true,
      links: [{ slug: 'octocat/Hello-World' }, { url: 'https://example.com/docs/guide', name: 'Guide' }],
    });
    expect(shelf).toMatchObject({ kind: 'links', path: null, hidden: true, repoCount: 2 });
    expect(repos[0]).toMatchObject({
      name: 'Hello-World',
      virtual: true,
      path: '',
      repoSlug: 'octocat/Hello-World',
      owner: 'octocat',
      remoteUrl: 'https://github.com/octocat/Hello-World.git',
      linkUrl: 'https://github.com/octocat/Hello-World',
    });
    expect(repos[1]).toMatchObject({ name: 'Guide', virtual: true, repoSlug: null, remoteUrl: null, linkUrl: 'https://example.com/docs/guide' });
    expect(linkRepo({ slug: 'a/b' }, 's').id).toBe(linkRepo({ slug: 'A/B' }, 's').id);
  });
});

describe('parseRemote', () => {
  it('parses https, https+.git, ssh, and rejects non-GitHub', () => {
    expect(parseRemote('https://github.com/o/r')).toEqual({ owner: 'o', repoSlug: 'o/r' });
    expect(parseRemote('https://github.com/o/r.git')).toEqual({ owner: 'o', repoSlug: 'o/r' });
    expect(parseRemote('git@github.com:o/r.git')).toEqual({ owner: 'o', repoSlug: 'o/r' });
    expect(parseRemote('ssh://git@github.com/o/r.git')).toEqual({ owner: 'o', repoSlug: 'o/r' });
    expect(parseRemote('https://gitlab.com/o/r.git')).toEqual({ owner: null, repoSlug: null });
    expect(parseRemote(null)).toEqual({ owner: null, repoSlug: null });
  });
});

describe('GitHub account shelves', () => {
  const items = [
    { nameWithOwner: 'me/zeta', name: 'zeta', visibility: 'PUBLIC', isArchived: false, isFork: false, description: 'Z', primaryLanguage: { name: 'Go' }, stargazerCount: 3, pushedAt: '2026-09-01T00:00:00Z', url: 'https://github.com/me/zeta', repositoryTopics: [{ name: 'cli' }], diskUsage: 120 },
    { nameWithOwner: 'me/alpha', name: 'alpha', visibility: 'PRIVATE', isArchived: true, isFork: true, description: null, primaryLanguage: null, stargazerCount: 0, pushedAt: '2026-08-01T00:00:00Z', url: 'https://github.com/me/alpha', repositoryTopics: null, diskUsage: null },
  ] as const;
  const lister = async () => items.map((i) => ({ ...i, repositoryTopics: i.repositoryTopics ? [...i.repositoryTopics] : null }));

  it('maps list items to virtual books with visibility, archive, fork, and metadata', () => {
    const r = githubRepo({ ...items[0], repositoryTopics: [{ name: 'cli' }] }, 's');
    expect(r).toMatchObject({ name: 'zeta', virtual: true, visibility: 'public', archived: false, repoSlug: 'me/zeta', owner: 'me', sizeKB: 120, languageGuess: 'Go' });
    expect(r.github).toMatchObject({ stars: 3, topics: ['cli'], isPrivate: false, htmlUrl: 'https://github.com/me/zeta' });
    const p = githubRepo({ ...items[1], repositoryTopics: null }, 's');
    expect(p).toMatchObject({ visibility: 'private', archived: true });
    expect(p.github?.isFork).toBe(true);
  });

  it('filters by the shelf visibility and sorts by name', async () => {
    const pub = await scanShelf({ label: 'Pub', github: 'me', visibility: 'public' }, undefined, lister);
    expect(pub.shelf.kind).toBe('github');
    expect(pub.repos.map((r) => r.name)).toEqual(['zeta']);
    const all = await scanShelf({ label: 'All', github: 'me', visibility: 'all' }, undefined, lister);
    expect(all.repos.map((r) => r.name)).toEqual(['alpha', 'zeta']);
    const none = await scanShelf({ label: 'Off', github: 'me' });
    expect(none.repos).toEqual([]);
  });
});
