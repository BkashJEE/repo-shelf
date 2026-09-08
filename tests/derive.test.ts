import { describe, it, expect } from 'vitest';
import {
  bookHeight,
  bookThickness,
  bookColor,
  isStale,
  hasGoldBand,
  hasRedTab,
  matches,
  relativeTime,
  formatSize,
  displayName,
  languageCounts,
  languageOf,
  MIN_HEIGHT,
  MAX_HEIGHT,
  MIN_THICKNESS,
  MAX_THICKNESS,
} from '../src/derive';
import type { Repo } from '../src/types';

const NOW = new Date('2026-09-07T12:00:00Z');

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: 'id',
    name: 'name',
    path: 'C:\\x\\name',
    shelfId: 's1',
    virtual: false,
    linkUrl: null,
    visibility: null,
    archived: false,
    branch: 'main',
    lastCommitAt: '2026-09-01T00:00:00Z',
    commitCount: 10,
    dirtyCount: 0,
    sizeKB: 100,
    languageGuess: 'Python',
    remoteUrl: null,
    owner: null,
    repoSlug: null,
    github: null,
    ...over,
  };
}

describe('dimensions', () => {
  it('bookHeight clamps and grows with commits', () => {
    expect(bookHeight(0)).toBe(MIN_HEIGHT);
    expect(bookHeight(-5)).toBe(MIN_HEIGHT);
    expect(bookHeight(9)).toBeCloseTo(2.5, 5);
    expect(bookHeight(1_000_000)).toBe(MAX_HEIGHT);
    expect(bookHeight(100)).toBeGreaterThan(bookHeight(10));
  });
  it('bookThickness clamps and grows with size', () => {
    expect(bookThickness(0)).toBe(MIN_THICKNESS);
    expect(bookThickness(999)).toBeCloseTo(0.52, 2);
    expect(bookThickness(1e12)).toBe(MAX_THICKNESS);
  });
});

describe('bookColor', () => {
  it('uses the palette for known languages and a stable hashed hue otherwise', () => {
    expect(bookColor('TypeScript')).toBe('#2f5d8a');
    const a = bookColor('Zig');
    expect(a).toMatch(/^hsl\(\d+ 42% 42%\)$/);
    expect(bookColor('Zig')).toBe(a);
    expect(bookColor('Nim')).not.toBe(a);
  });
});

describe('flags', () => {
  it('isStale respects threshold and missing dates', () => {
    expect(isStale(repo(), 90, NOW)).toBe(false);
    expect(isStale(repo({ lastCommitAt: '2026-01-01T00:00:00Z' }), 90, NOW)).toBe(true);
    expect(isStale(repo({ lastCommitAt: null }), 90, NOW)).toBe(true);
  });
  it('gold band needs stars, red tab needs dirty files', () => {
    expect(hasGoldBand(repo())).toBe(false);
    expect(hasGoldBand(repo({ github: { stars: 3 } as never }))).toBe(true);
    expect(hasRedTab(repo())).toBe(false);
    expect(hasRedTab(repo({ dirtyCount: 2 }))).toBe(true);
  });
  it('languageOf prefers GitHub language over the guess', () => {
    expect(languageOf(repo())).toBe('Python');
    expect(languageOf(repo({ github: { language: 'Rust' } as never }))).toBe('Rust');
    expect(languageOf(repo({ languageGuess: null }))).toBe('Unknown');
  });
});

describe('matches', () => {
  const r = repo({
    name: 'hermes-pocket',
    path: 'C:\\Users\\B\\Developer\\hermes-pocket',
    remoteUrl: 'https://github.com/b/hermes-pocket',
    repoSlug: 'b/hermes-pocket',
    github: {
      description: 'Pocket agent for phones',
      language: 'TypeScript',
      stars: 0,
      topics: ['agents', 'mobile'],
      isPrivate: false,
      isFork: false,
      pushedAt: '',
      htmlUrl: '',
      fetchedAt: '',
    },
  });
  it('matches query across name, description, topics, language, path, case-insensitively', () => {
    expect(matches(r, 'HERMES', 'all', 'all', 90, NOW)).toBe(true);
    expect(matches(r, 'phones', 'all', 'all', 90, NOW)).toBe(true);
    expect(matches(r, 'mobile', 'all', 'all', 90, NOW)).toBe(true);
    expect(matches(r, 'typescript', 'all', 'all', 90, NOW)).toBe(true);
    expect(matches(r, 'developer', 'all', 'all', 90, NOW)).toBe(true);
    expect(matches(r, 'pocket agents', 'all', 'all', 90, NOW)).toBe(true);
    expect(matches(r, 'nothing-here', 'all', 'all', 90, NOW)).toBe(false);
  });
  it('applies filters and shelf', () => {
    expect(matches(r, '', 'lang:TypeScript', 'all', 90, NOW)).toBe(true);
    expect(matches(r, '', 'lang:Python', 'all', 90, NOW)).toBe(false);
    expect(matches(r, '', 'remote', 'all', 90, NOW)).toBe(true);
    expect(matches(repo(), '', 'remote', 'all', 90, NOW)).toBe(false);
    expect(matches(r, '', 'dirty', 'all', 90, NOW)).toBe(false);
    expect(matches(repo({ dirtyCount: 1 }), '', 'dirty', 'all', 90, NOW)).toBe(true);
    expect(matches(r, '', 'stale', 'all', 90, NOW)).toBe(false);
    expect(matches(repo({ lastCommitAt: null }), '', 'stale', 'all', 90, NOW)).toBe(true);
    expect(matches(r, '', 'all', 's1', 90, NOW)).toBe(true);
    expect(matches(r, '', 'all', 's2', 90, NOW)).toBe(false);
  });
});

describe('displayName', () => {
  it('title-cases folder names and keeps acronyms', () => {
    expect(displayName('hermes-pocket')).toBe('Hermes Pocket');
    expect(displayName('screenpolish_releases')).toBe('Screenpolish Releases');
    expect(displayName('HermesAgent')).toBe('Hermes Agent');
    expect(displayName('tradingview-mcp')).toBe('Tradingview MCP');
    expect(displayName('x-algorithm-analysis')).toBe('X Algorithm Analysis');
    expect(displayName('ui-ux-pro-max-skill')).toBe('UI UX Pro Max Skill');
    expect(displayName('aiq')).toBe('Aiq');
    expect(displayName('Prashant Website')).toBe('Prashant Website');
    expect(displayName('repo.shelf.v2')).toBe('Repo Shelf v2');
    expect(displayName('TTS-engine')).toBe('TTS Engine');
  });
});

describe('formatting', () => {
  it('relativeTime buckets', () => {
    expect(relativeTime(null, NOW)).toBe('never');
    expect(relativeTime('2026-09-07T01:00:00Z', NOW)).toBe('today');
    expect(relativeTime('2026-09-06T01:00:00Z', NOW)).toBe('yesterday');
    expect(relativeTime('2026-09-01T00:00:00Z', NOW)).toBe('6 days ago');
    expect(relativeTime('2026-07-01T00:00:00Z', NOW)).toBe('2 months ago');
    expect(relativeTime('2024-07-01T00:00:00Z', NOW)).toBe('2 years ago');
  });
  it('formatSize', () => {
    expect(formatSize(512)).toBe('512 KB');
    expect(formatSize(2048)).toBe('2.0 MB');
    expect(formatSize(2048 * 1024)).toBe('2.0 GB');
  });
  it('languageCounts sorts by count then name', () => {
    const rows = languageCounts([repo(), repo({ languageGuess: 'Rust' }), repo({ languageGuess: 'Rust' }), repo({ languageGuess: 'Go' })]);
    expect(rows).toEqual([
      { language: 'Rust', count: 2 },
      { language: 'Go', count: 1 },
      { language: 'Python', count: 1 },
    ]);
  });
});
