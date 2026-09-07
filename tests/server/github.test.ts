import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempRoot, rm } from './helpers';
import { GitHubEnricher } from '../../server/github';
import type { Runner } from '../../server/git';
import type { Repo } from '../../server/types';

let tmp: string;
beforeEach(async () => {
  tmp = await makeTempRoot('repo-shelf-gh-');
});
afterEach(() => rm(tmp));

const sample = {
  description: 'A thing',
  language: 'TypeScript',
  stargazers_count: 7,
  topics: ['a', 'b'],
  private: true,
  fork: false,
  pushed_at: '2026-09-01T00:00:00Z',
  html_url: 'https://github.com/me/thing',
};

function fakeGh(opts: { authed?: boolean; login?: string; calls?: string[][] }): Runner {
  return async (cmd, args) => {
    opts.calls?.push([cmd, ...args]);
    if (cmd !== 'gh') return { code: 1, stdout: '', stderr: 'unexpected' };
    if (args[0] === 'auth') return { code: opts.authed === false ? 1 : 0, stdout: '', stderr: '' };
    if (args[0] === 'api' && args[1] === 'user') return { code: 0, stdout: `${opts.login ?? 'me'}\n`, stderr: '' };
    if (args[0] === 'api' && args[1].startsWith('repos/')) {
      return { code: 0, stdout: JSON.stringify(sample), stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unknown' };
  };
}

function repo(slug: string | null): Repo {
  return {
    id: 'x',
    name: 'thing',
    path: path.join(tmp, 'thing'),
    shelfId: 's',
    virtual: false,
    linkUrl: null,
    branch: 'main',
    lastCommitAt: null,
    commitCount: 1,
    dirtyCount: 0,
    sizeKB: 1,
    languageGuess: null,
    remoteUrl: slug ? `https://github.com/${slug}.git` : null,
    owner: slug ? slug.split('/')[0] : null,
    repoSlug: slug,
    github: null,
  };
}

describe('GitHubEnricher', () => {
  it('is unavailable when gh auth fails and never calls the API', async () => {
    const calls: string[][] = [];
    const e = new GitHubEnricher(path.join(tmp, 'gh.json'), fakeGh({ authed: false, calls }), 24);
    await e.init();
    expect(e.available()).toBe(false);
    expect(await e.enrich(repo('me/thing'))).toBeNull();
    expect(calls.some((c) => c[1] === 'api' && c[2]?.startsWith('repos/'))).toBe(false);
  });

  it('maps gh api output to GitHubMeta and resolves login', async () => {
    const e = new GitHubEnricher(path.join(tmp, 'gh.json'), fakeGh({ login: 'octocat' }), 24);
    await e.init();
    expect(e.available()).toBe(true);
    expect(e.login()).toBe('octocat');
    const meta = await e.enrich(repo('me/thing'));
    expect(meta).toMatchObject({
      description: 'A thing',
      language: 'TypeScript',
      stars: 7,
      topics: ['a', 'b'],
      isPrivate: true,
      isFork: false,
      htmlUrl: 'https://github.com/me/thing',
    });
    expect(meta!.fetchedAt).toMatch(/^\d{4}-/);
    expect(fs.existsSync(path.join(tmp, 'gh.json'))).toBe(true);
  });

  it('serves from cache while fresh and refetches when expired', async () => {
    const calls: string[][] = [];
    let now = new Date('2026-09-07T00:00:00Z');
    const file = path.join(tmp, 'gh.json');
    const e = new GitHubEnricher(file, fakeGh({ calls }), 24, () => now);
    await e.init();
    await e.enrich(repo('me/thing'));
    const apiCalls = () => calls.filter((c) => c[1] === 'api' && c[2]?.startsWith('repos/')).length;
    expect(apiCalls()).toBe(1);

    // new instance loads the cache from disk
    const e2 = new GitHubEnricher(file, fakeGh({ calls }), 24, () => now);
    await e2.init();
    await e2.enrich(repo('me/thing'));
    expect(apiCalls()).toBe(1);

    now = new Date('2026-09-09T00:00:00Z');
    await e2.enrich(repo('me/thing'));
    expect(apiCalls()).toBe(2);
  });

  it('skips repos without a GitHub slug and reports updates in enrichAll', async () => {
    const e = new GitHubEnricher(path.join(tmp, 'gh.json'), fakeGh({}), 24);
    await e.init();
    const updated: Repo[] = [];
    await e.enrichAll([repo(null), repo('me/thing')], (r) => updated.push(r));
    expect(updated).toHaveLength(1);
    expect(updated[0].github?.stars).toBe(7);
  });
});
