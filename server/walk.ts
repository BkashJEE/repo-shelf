import fs from 'node:fs/promises';
import path from 'node:path';

export const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.turbo',
  'out',
]);

export const EXT_LANGUAGE: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  swift: 'Swift',
  kt: 'Kotlin',
  java: 'Java',
  cs: 'C#',
  cpp: 'C++',
  cc: 'C++',
  hpp: 'C++',
  h: 'C',
  c: 'C',
  rb: 'Ruby',
  php: 'PHP',
  html: 'HTML',
  css: 'CSS',
  scss: 'CSS',
  md: 'Markdown',
  sh: 'Shell',
  bash: 'Shell',
  ps1: 'PowerShell',
  lua: 'Lua',
  dart: 'Dart',
  vue: 'Vue',
  svelte: 'Svelte',
  pine: 'Pine Script',
};

export const MAX_FILES = 20_000;

export interface WalkResult {
  sizeKB: number;
  languageGuess: string | null;
  fileCount: number;
  truncated: boolean;
}

/**
 * Single directory walk that reports total size (KB) and the most common
 * source language by file-extension count. Skips vendored / build dirs and
 * stops counting after MAX_FILES so a huge tree can't stall the scan.
 */
export async function sizeAndLanguage(dir: string): Promise<WalkResult> {
  let bytes = 0;
  let files = 0;
  let truncated = false;
  const counts = new Map<string, number>();
  const stack: string[] = [dir];

  while (stack.length && !truncated) {
    const current = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(path.join(current, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      files += 1;
      if (files > MAX_FILES) {
        truncated = true;
        break;
      }
      const full = path.join(current, e.name);
      try {
        const st = await fs.stat(full);
        bytes += st.size;
      } catch {
        /* unreadable file, ignore */
      }
      const ext = path.extname(e.name).slice(1).toLowerCase();
      const lang = EXT_LANGUAGE[ext];
      // Markdown is documentation, only wins when nothing else exists.
      if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestN = 0;
  for (const [lang, n] of counts) {
    if (lang === 'Markdown') continue;
    if (n > bestN) {
      best = lang;
      bestN = n;
    }
  }
  if (!best && counts.has('Markdown')) best = 'Markdown';

  return { sizeKB: Math.round(bytes / 1024), languageGuess: best, fileCount: files, truncated };
}
