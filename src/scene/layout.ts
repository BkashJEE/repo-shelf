import type { Repo } from '../types';
import { bookHeight, bookThickness } from '../derive';

export const SHELF_W = 14;
export const ROW_H = 4.2;
export const PLANK_T = 0.18;
export const BOOK_DEPTH = 1.85;
export const GAP = 0.06;
export const SIDE_PAD = 0.45;
export const USABLE_W = SHELF_W - SIDE_PAD * 2;
export const FRAME_T = 0.35;

/** World y of the top surface of shelf row i's plank. */
export function plankTopY(row: number): number {
  return -row * ROW_H - 1.9;
}

/** World y the camera should look at for row i. */
export function rowCenterY(row: number): number {
  return -row * ROW_H;
}

export interface BookSlot {
  repo: Repo;
  x: number;
  width: number;
  height: number;
}

export function layoutRow(repos: Repo[]): { slots: BookSlot[]; totalWidth: number } {
  let cursor = 0;
  const slots: BookSlot[] = [];
  for (const repo of repos) {
    // Link books have no disk footprint: size them by popularity instead.
    const stars = repo.github?.stars ?? 0;
    const width = repo.virtual ? bookThickness(stars * 40 + 400) : bookThickness(repo.sizeKB);
    const height = repo.virtual ? bookHeight(stars * 4 + 60) : bookHeight(repo.commitCount);
    slots.push({ repo, x: cursor + width / 2, width, height });
    cursor += width + GAP;
  }
  const totalWidth = Math.max(0, cursor - GAP);
  return { slots, totalWidth };
}

/** Which shelf row a world-space y falls in, or -1 when outside all rows. */
export function rowAtY(y: number, rowCount: number): number {
  for (let i = 0; i < rowCount; i++) {
    const top = plankTopY(i) + ROW_H - PLANK_T;
    const bottom = plankTopY(i) - PLANK_T;
    if (y <= top && y >= bottom) return i;
  }
  return -1;
}
