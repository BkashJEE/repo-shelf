import { execFile } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
) => Promise<RunResult>;

/**
 * Runs a command and never throws on a non-zero exit code. Spawn failures
 * (command missing) resolve with code 127 so callers can treat every
 * outcome uniformly.
 */
export const execRunner: Runner = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 10_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? ((err as { code: number }).code)
            : (err as NodeJS.ErrnoException).code === 'ENOENT'
              ? 127
              : 1;
          resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? err.message) });
          return;
        }
        resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

export async function git(runner: Runner, cwd: string, args: string[]): Promise<string | null> {
  const r = await runner('git', args, { cwd });
  if (r.code !== 0) return null;
  return r.stdout.trim();
}
