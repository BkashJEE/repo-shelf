import type { Repo } from '../types';
import { bookHeight, bookThickness } from '../derive';

export const SHELF_W = 14;
export const ROW_H = 4.2;
export const PLANK_T = 0.18;
export const BOOK_DEPTH = 1.5;
export const GAP = 0.05;
export const SIDE_PAD = 0.45;
export const USABLE_W = SHELF_W - SIDE_PAD * 2;
export const FRAME_T = 0.35;
/** How far one pan action (arrow button or arrow key) moves a row, in scene units. */
export const ROW_STEP = USABLE_W * 0.6;
/** Books are clipped at the shelf ends so a long row never spills past the frame. */
export const CLIP_X = SHELF_W / 2 - 0.05;

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

/** How much a row of repos overflows the usable shelf width, in scene units (0 when it fits). */
export function rowOverflow(repos: Repo[]): number {
  return Math.max(0, layoutRow(repos).totalWidth - USABLE_W);
}

/**
 * Clamp a pan offset one step toward a row end. `dir` is +1 to reveal the
 * right-hand tail of the row, -1 to go back toward the start.
 */
export function panOffset(offset: number, dir: 1 | -1, overflow: number): number {
  return Math.min(overflow, Math.max(0, offset + dir * ROW_STEP));
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
