import { describe, it, expect } from 'vitest';
import { layoutRow, rowOverflow, panOffset, ROW_STEP, USABLE_W, CLIP_X, SHELF_W } from '../src/scene/layout';
import { MAX_THICKNESS, MIN_THICKNESS } from '../src/derive';
import type { Repo } from '../src/types';

function repo(id: string, over: Partial<Repo> = {}): Repo {
  return {
    id,
    name: id,
    path: `C:\\x\\${id}`,
    shelfId: 's1',
    virtual: false,
    linkUrl: null,
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

describe('layoutRow', () => {
  it('is empty for no repos', () => {
    expect(layoutRow([]).slots).toEqual([]);
    expect(layoutRow([]).totalWidth).toBe(0);
  });

  it('sizes and spaces books contiguously from x=0', () => {
    const { slots, totalWidth } = layoutRow([repo('a', { sizeKB: 1e12 }), repo('b', { sizeKB: 1e12 })]);
    expect(slots).toHaveLength(2);
    expect(slots[0].x).toBeCloseTo(slots[0].width / 2, 5);
    expect(slots[1].x).toBeCloseTo(slots[0].width + 0.05 + slots[1].width / 2, 5);
    expect(totalWidth).toBeCloseTo(slots[0].width + 0.05 + slots[1].width, 5);
  });
});

describe('rowOverflow', () => {
  it('is 0 when the row fits the usable width', () => {
    expect(rowOverflow([])).toBe(0);
    expect(rowOverflow([repo('a'), repo('b'), repo('c')])).toBe(0);
  });

  it('grows past 0 once many books exceed the shelf', () => {
    const many = Array.from({ length: 30 }, (_, i) => repo(`r${i}`, { sizeKB: 1e12 }));
    expect(rowOverflow(many)).toBeGreaterThan(0);
    expect(rowOverflow(many)).toBeCloseTo(layoutRow(many).totalWidth - USABLE_W, 5);
  });
});

describe('panOffset', () => {
  it('moves one step toward the right tail and clamps at the overflow', () => {
    expect(panOffset(0, 1, 10)).toBe(ROW_STEP);
    expect(panOffset(ROW_STEP, 1, 99)).toBe(ROW_STEP * 2);
    expect(panOffset(8, 1, 10)).toBe(10);
    expect(panOffset(10, 1, 10)).toBe(10);
  });

  it('moves one step back and never goes negative', () => {
    expect(panOffset(ROW_STEP * 2, -1, 99)).toBe(ROW_STEP);
    expect(panOffset(0, -1, 99)).toBe(0);
  });

  it('is a no-op on a row that fits', () => {
    expect(panOffset(0, 1, 0)).toBe(0);
    expect(panOffset(0, -1, 0)).toBe(0);
  });
});

describe('constants', () => {
  it('uses a sane pan step and a clip line inside the shelf ends', () => {
    expect(ROW_STEP).toBeGreaterThan(0);
    expect(ROW_STEP).toBeLessThan(USABLE_W);
    expect(CLIP_X).toBe(SHELF_W / 2 - 0.05);
    expect(MAX_THICKNESS).toBeGreaterThan(0);
    expect(MIN_THICKNESS).toBeGreaterThan(0);
  });
});
