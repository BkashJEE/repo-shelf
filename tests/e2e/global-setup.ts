import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { E2E_ROOT, E2E_CONFIG, E2E_CACHE } from '../../playwright.config';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'E2E',
      GIT_AUTHOR_EMAIL: 'e2e@example.com',
      GIT_COMMITTER_NAME: 'E2E',
      GIT_COMMITTER_EMAIL: 'e2e@example.com',
    },
  });
}

function repo(root: string, name: string, commits: number): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
  fs.writeFileSync(path.join(dir, 'index.ts'), 'export {};\n');
  for (let i = 0; i < commits; i++) {
    fs.writeFileSync(path.join(dir, `c${i}.txt`), `${i}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', `commit ${i}`]);
  }
}

export default function globalSetup(): void {
  buildFixture();
}

export function buildFixture(): void {
  fs.rmSync(E2E_ROOT, { recursive: true, force: true });
  const a = path.join(E2E_ROOT, 'ShelfA');
  const b = path.join(E2E_ROOT, 'ShelfB');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  fs.mkdirSync(E2E_CACHE, { recursive: true });
  repo(a, 'alpha', 3);
  repo(a, 'beta', 1);
  repo(b, 'gamma', 2);
  fs.mkdirSync(path.join(a, 'not-a-repo'));
  fs.writeFileSync(
    E2E_CONFIG,
    JSON.stringify(
      {
        shelves: [
          { label: 'Alpha Shelf', path: a },
          { label: 'Beta Shelf', path: b },
        ],
        staleAfterDays: 90,
        githubCacheHours: 24,
      },
      null,
      2,
    ),
  );
}

// Also runnable directly (the API web server does this before booting, so the server never scans a stale fixture).
if (process.argv.includes('--run')) {
  buildFixture();
  console.log(`[e2e] fixture ready at ${E2E_ROOT}`);
}
