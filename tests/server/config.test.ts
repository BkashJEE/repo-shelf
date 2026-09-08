import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig, entryId, isLinkShelf, isGithubShelf, loadConfig, saveConfig, shelfId } from '../../server/config';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-shelf-cfg-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const HOME = path.join('C:', 'Users', 'X');

describe('defaultConfig', () => {
  it('has Developer, Documents, Home shelves under the given home, plus link shelves', () => {
    const cfg = defaultConfig(HOME);
    expect(cfg.shelves.slice(0, 3).map((s) => s.label)).toEqual(['Developer', 'Documents', 'Home']);
    expect(cfg.shelves.filter(isLinkShelf).map((s) => s.label)).toEqual(['Hermes Agent', 'Secret · Hermes Skills']);
    expect(cfg.shelves.filter(isGithubShelf).map((s) => s.visibility)).toEqual(['public', 'private']);
    expect(cfg.shelves.find((s) => s.hidden)?.label).toBe('Secret · Hermes Skills');
    expect(cfg.shelves[0].path).toBe(path.join(HOME, 'Developer'));
    expect(cfg.shelves[2].path).toBe(HOME);
    expect(cfg.staleAfterDays).toBe(90);
    expect(cfg.githubCacheHours).toBe(24);
  });
});

describe('loadConfig', () => {
  it('writes the default config when the file is missing', () => {
    const file = path.join(tmp, 'shelf.config.json');
    fs.mkdirSync(path.join(tmp, 'Developer'));
    fs.mkdirSync(path.join(tmp, 'Documents'));
    const cfg = loadConfig(file, tmp);
    expect(fs.existsSync(file)).toBe(true);
    expect(cfg.shelves.filter((s) => s.path)).toHaveLength(3);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).shelves).toHaveLength(7);
  });

  it('drops default shelves whose folder does not exist on first boot', () => {
    const file = path.join(tmp, 'shelf.config.json');
    fs.mkdirSync(path.join(tmp, 'Developer'));
    const cfg = loadConfig(file, tmp);
    expect(cfg.shelves.filter((s) => s.path).map((s) => s.label)).toEqual(['Developer', 'Home']);
  });

  it('throws shelf_path_missing when a configured path does not exist', () => {
    const file = path.join(tmp, 'shelf.config.json');
    saveConfig(file, {
      shelves: [{ label: 'Nope', path: path.join(tmp, 'does-not-exist') }],
      staleAfterDays: 90,
      githubCacheHours: 24,
    });
    expect(() => loadConfig(file, tmp)).toThrow(/shelf_path_missing/);
  });

  it('fills missing numeric fields with defaults', () => {
    const file = path.join(tmp, 'shelf.config.json');
    fs.writeFileSync(file, JSON.stringify({ shelves: [{ label: 'T', path: tmp }] }));
    const cfg = loadConfig(file, tmp);
    expect(cfg.staleAfterDays).toBe(90);
    expect(cfg.githubCacheHours).toBe(24);
  });
});

describe('link shelves', () => {
  it('parses links, rejects bad ones, and gives stable ids', () => {
    const file = path.join(tmp, 'shelf.config.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        shelves: [
          { label: 'T', path: tmp },
          { label: 'Reads', hidden: true, links: [{ slug: 'octocat/Hello-World' }, { url: 'https://example.com/x', name: 'X' }] },
        ],
      }),
    );
    const cfg = loadConfig(file, tmp);
    expect(cfg.shelves[1]).toEqual({ label: 'Reads', hidden: true, links: [{ slug: 'octocat/Hello-World' }, { url: 'https://example.com/x', name: 'X' }] });
    expect(entryId(cfg.shelves[1])).toBe(entryId({ label: 'reads', links: [] }));
    expect(entryId(cfg.shelves[1])).not.toBe(entryId(cfg.shelves[0]));
    fs.writeFileSync(file, JSON.stringify({ shelves: [{ label: 'Bad', links: [{ url: 'http://insecure' }] }] }));
    expect(() => loadConfig(file, tmp)).toThrow(/invalid_link/);
  });
});

describe('shelfId', () => {
  it('is stable, 12 chars, and case-insensitive on the path', () => {
    const a = shelfId(path.join(HOME, 'Developer'));
    const b = shelfId(path.join(HOME, 'Developer').toLowerCase());
    expect(a).toBe(b);
    expect(a).toHaveLength(12);
    expect(shelfId(path.join(HOME, 'Documents'))).not.toBe(a);
  });
});

describe('GitHub shelves in config', () => {
  it('normalizes github entries and gives distinct ids per visibility', () => {
    const file = path.join(tmp, 'shelf.config.json');
    fs.writeFileSync(file, JSON.stringify({ shelves: [{ github: 'me' }, { label: 'Priv', github: 'me', visibility: 'private' }, { github: 'octocat', visibility: 'bogus' }] }));
    const cfg = loadConfig(file, tmp);
    expect(cfg.shelves[0]).toEqual({ label: 'GitHub · me', github: 'me', visibility: 'all' });
    expect(cfg.shelves[1]).toEqual({ label: 'Priv', github: 'me', visibility: 'private' });
    expect(cfg.shelves[2]).toEqual({ label: 'GitHub · octocat', github: 'octocat', visibility: 'all' });
    expect(entryId(cfg.shelves[0])).not.toBe(entryId(cfg.shelves[1]));
    expect(entryId(cfg.shelves[1])).toBe(entryId({ label: 'x', github: 'ME', visibility: 'private' }));
  });
});
