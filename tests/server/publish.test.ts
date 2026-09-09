import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempRoot, rm } from './helpers';
import { buildStaticSite, publishSite, sanitizeForPublish } from '../../server/publish';
import { ActionError } from '../../server/actions';
import type { AppState, Repo, Shelf } from '../../server/types';
import type { Runner } from '../../server/git';

let tmp: string;
beforeEach(async () => {
  tmp = await makeTempRoot('repo-shelf-pub-');
});
afterEach(() => rm(tmp));

function repo(over: Partial<Repo>): Repo {
  return {
    id: over.id ?? 'x',
    name: 'thing',
    path: 'C:/secret/thing',
    shelfId: 's1',
    virtual: false,
    linkUrl: null,
    visibility: null,
    archived: false,
    createdAt: null,
    branch: 'main',
    lastCommitAt: null,
    commitCount: 3,
    dirtyCount: 5,
    sizeKB: 10,
    languageGuess: 'Go',
    remoteUrl: null,
    owner: null,
    repoSlug: null,
    github: null,
    ...over,
  };
}

const shelves: Shelf[] = [
  { id: 's1', label: 'Work', path: 'C:/secret', kind: 'disk', hidden: false, repoCount: 3 },
  { id: 's2', label: 'Secret', path: null, kind: 'links', hidden: true, repoCount: 1 },
  { id: 's3', label: 'Reads', path: null, kind: 'links', hidden: false, repoCount: 1 },
];
const state: AppState = {
  shelves,
  repos: [
    repo({ id: 'pub', visibility: 'public', repoSlug: 'me/pub', remoteUrl: 'https://github.com/me/pub.git' }),
    repo({ id: 'priv', visibility: 'private', repoSlug: 'me/priv' }),
    repo({ id: 'local', visibility: null }),
    repo({ id: 'arch', visibility: 'public', repoSlug: 'me/arch', archived: true }),
    repo({ id: 'hidden-link', shelfId: 's2', virtual: true, linkUrl: 'https://x' }),
    repo({ id: 'link', shelfId: 's3', virtual: true, linkUrl: 'https://example.com', path: '' }),
  ],
  github: { available: true, login: 'me' },
  config: { staleAfterDays: 90 },
};

describe('sanitizeForPublish', () => {
  it('keeps only public repos and visible shelves, strips paths and dirty state', () => {
    const out = sanitizeForPublish(state, 'me');
    expect(out.repos.map((r) => r.id).sort()).toEqual(['link', 'pub']);
    for (const r of out.repos) {
      expect(r.path).toBe('');
      expect(r.dirtyCount).toBe(0);
    }
    expect(out.repos.find((r) => r.id === 'pub')!.linkUrl).toBe('https://github.com/me/pub');
    expect(out.shelves.map((s) => s.label)).toEqual(['Work', 'Reads']);
    expect(out.shelves.every((s) => s.path === null)).toBe(true);
    expect(out.shelves[0].repoCount).toBe(1);
  });
});

describe('buildStaticSite', () => {
  function fakeDist(): string {
    const dist = path.join(tmp, 'dist-static');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>repo shelf.</title></head><body><script src="./assets/app.js"></script></body></html>');
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), '// app');
    fs.writeFileSync(path.join(dist, 'server.cjs'), '// must not ship');
    return dist;
  }

  it('copies the build, embeds sanitized data and pages, and never ships the server', async () => {
    const out = path.join(tmp, 'site');
    const r = await buildStaticSite(state, {
      staticDist: fakeDist(),
      outDir: out,
      owner: 'me',
      pagesFor: async (repo) => ({ readme: `# ${repo.name}`, files: [], commits: [], branches: ['main'], issues: [], pulls: [], source: 'github', fetchedAt: '' }),
    });
    expect(r).toMatchObject({ repos: 2, shelves: 2, withPages: 2 });
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(html).toContain('<script src="./shelf-data.js"></script>');
    expect(html).toContain("<title>me's repo shelf</title>");
    const data = fs.readFileSync(path.join(out, 'shelf-data.js'), 'utf8');
    expect(data.startsWith('window.__SHELF_STATIC = ')).toBe(true);
    expect(data).not.toContain('C:/secret');
    expect(data).not.toContain('priv');
    expect(data).toContain('"readme":"# thing"');
    expect(fs.existsSync(path.join(out, 'assets', 'app.js'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'server.cjs'))).toBe(false);
    expect(fs.existsSync(path.join(out, '.nojekyll'))).toBe(true);
  });

  it('refuses when nothing is public or the static build is missing', async () => {
    await expect(buildStaticSite({ ...state, repos: [repo({ id: 'p', visibility: 'private' })] }, { staticDist: fakeDist(), outDir: path.join(tmp, 'o'), owner: 'me' })).rejects.toMatchObject({ code: 'nothing_public' });
    await expect(buildStaticSite(state, { staticDist: path.join(tmp, 'nope'), outDir: path.join(tmp, 'o2'), owner: 'me' })).rejects.toBeInstanceOf(ActionError);
  });
});

describe('publishSite', () => {
  it('inits a repo in the site folder, creates the GitHub repo with --push, and enables Pages', async () => {
    const dir = path.join(tmp, 'site');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    const calls: string[][] = [];
    const runner: Runner = async (cmd, args, opts) => {
      if (cmd === 'gh') {
        calls.push([cmd, ...args]);
        if (args[0] === 'repo' && args[1] === 'view') return { code: 1, stdout: '', stderr: 'not found' };
        return { code: 0, stdout: '', stderr: '' };
      }
      const { execRunner } = await import('../../server/git');
      return execRunner(cmd, args, opts);
    };
    const r = await publishSite(dir, 'Me', 'my-shelf', runner);
    expect(r).toMatchObject({ created: true, repoUrl: 'https://github.com/Me/my-shelf', pagesUrl: 'https://me.github.io/my-shelf/' });
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(true);
    expect(calls.some((c) => c[1] === 'repo' && c[2] === 'create' && c.includes('--public') && c.includes('--push'))).toBe(true);
    expect(calls.some((c) => c[1] === 'api' && c.includes('repos/Me/my-shelf/pages'))).toBe(true);
    await expect(publishSite(dir, null, 'x', runner)).rejects.toMatchObject({ code: 'gh_unavailable' });
    await expect(publishSite(dir, 'Me', 'bad name', runner)).rejects.toMatchObject({ code: 'invalid_name' });
  });
});
