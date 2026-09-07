import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_ROOT } from '../../playwright.config';

const A = path.join(E2E_ROOT, 'ShelfA');
const B = path.join(E2E_ROOT, 'ShelfB');

async function openBook(page: Page, name: string): Promise<void> {
  // The visually-hidden index mirrors the 3D books and is the accessible way to select one.
  await page.locator(`#book-index button[data-book="${name}"]`).dispatchEvent('click');
  await expect(page.locator('.panel .panel-slug')).toHaveText(name);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status.ok')).toBeVisible();
});

test('loads shelves and books from the fixture config', async ({ page }) => {
  await expect(page.locator('.hdr-stat').first()).toContainText('3');
  await expect(page.locator('.hdr-stat').nth(1)).toContainText('2');
  await expect(page.locator('#book-index button')).toHaveCount(3);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.plate').first()).toContainText('Alpha Shelf');
  await expect(page.locator('.plate').first()).toContainText('2 repos');
});

test('search narrows the visible set and clear restores it', async ({ page }) => {
  await page.keyboard.press('/');
  await page.keyboard.type('alp');
  await expect(page.locator('.chips-meta')).toContainText('1 repo found');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.chips-meta')).not.toContainText('found');
});

test('language chip filters', async ({ page }) => {
  await page.getByRole('button', { name: /^TypeScript/ }).click();
  await expect(page.locator('.chips-meta')).toContainText('3 repos found');
  await page.getByRole('button', { name: /^Dirty/ }).click();
  await expect(page.locator('.chips-meta')).toContainText('0 repos found');
});

test('opening a book shows its details and steps through neighbours', async ({ page }) => {
  await openBook(page, 'alpha');
  await expect(page.locator('.panel')).toContainText('Alpha Shelf');
  await expect(page.locator('.panel .facts')).toContainText('main');
  await expect(page.locator('.panel .facts')).toContainText('3');
  await page.getByRole('button', { name: 'Next repo' }).click();
  await expect(page.locator('.panel .panel-slug')).toHaveText('beta');
  await page.keyboard.press('Escape');
  await expect(page.locator('.panel')).toHaveCount(0);
});

test('new folder dialog creates the folder on disk', async ({ page }) => {
  await openBook(page, 'alpha');
  await page.getByRole('button', { name: 'New folder…' }).click();
  await page.getByPlaceholder('src/features/login').fill('docs/e2e-created');
  await page.getByRole('button', { name: 'Create folder' }).click();
  await expect(page.locator('.toast.success')).toContainText('Created docs/e2e-created');
  expect(fs.existsSync(path.join(A, 'alpha', 'docs', 'e2e-created', '.gitkeep'))).toBe(true);
});

test('rename dialog validates and renames on disk', async ({ page }) => {
  await openBook(page, 'beta');
  await page.getByRole('button', { name: 'Rename…' }).click();
  const input = page.locator('.modal input.field');
  await input.fill('bad name');
  await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  await input.fill('beta-renamed');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.locator('.toast.success')).toContainText('Renamed to beta-renamed');
  expect(fs.existsSync(path.join(A, 'beta-renamed', '.git'))).toBe(true);
  expect(fs.existsSync(path.join(A, 'beta'))).toBe(false);
  await expect(page.locator('#book-index button[data-book="beta-renamed"]')).toHaveCount(1);
});

test('move dialog moves the repo to the other shelf', async ({ page }) => {
  await openBook(page, 'gamma');
  await page.getByRole('button', { name: 'Move…' }).click();
  await expect(page.locator('.modal')).toContainText('Beta Shelf');
  await page.getByRole('button', { name: 'Move repo' }).click();
  await expect(page.locator('.toast.success')).toContainText('Moved gamma to Alpha Shelf');
  expect(fs.existsSync(path.join(A, 'gamma', '.git'))).toBe(true);
  expect(fs.existsSync(path.join(B, 'gamma'))).toBe(false);
  await expect(page.locator('.plate').first()).toContainText('3 repos');
});

test('shelves dialog lists shelves and rejects a missing folder', async ({ page }) => {
  await page.getByRole('button', { name: 'Shelves' }).click();
  await expect(page.locator('.shelf-list li')).toHaveCount(2);
  await page.getByPlaceholder('C:\\Users\\you\\Projects').fill(path.join(E2E_ROOT, 'nope'));
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.toast.error')).toContainText('Folder not found');
});
