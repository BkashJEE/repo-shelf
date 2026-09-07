import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export async function makeTempRoot(prefix = 'repo-shelf-'): Promise<string> {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function g(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim();
}

export interface MakeRepoOptions {
  commits?: number;
  dirty?: boolean;
  remote?: string;
  files?: Record<string, string>;
}

/** Creates a real git repo under root and returns its absolute path. */
export async function makeRepo(root: string, name: string, opts: MakeRepoOptions = {}): Promise<string> {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  g(dir, ['init', '-q', '-b', 'main']);
  const files = opts.files ?? { 'README.md': `# ${name}\n` };
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const commits = opts.commits ?? 1;
  for (let i = 0; i < commits; i++) {
    fs.writeFileSync(path.join(dir, `commit-${i}.txt`), `${i}\n`);
    g(dir, ['add', '-A']);
    g(dir, ['commit', '-q', '-m', `commit ${i}`]);
  }
  if (opts.remote) g(dir, ['remote', 'add', 'origin', opts.remote]);
  if (opts.dirty) fs.writeFileSync(path.join(dir, 'dirty.txt'), 'uncommitted\n');
  return dir;
}

export function rm(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}
