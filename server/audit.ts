import fs from 'node:fs/promises';
import path from 'node:path';
import type { AuditEntry } from './types.js';

export async function appendAudit(file: string, entry: Omit<AuditEntry, 'ts'>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const line: AuditEntry = { ts: new Date().toISOString(), ...entry };
  await fs.appendFile(file, JSON.stringify(line) + '\n', 'utf8');
}

export async function readAudit(file: string): Promise<AuditEntry[]> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as AuditEntry);
  } catch {
    return [];
  }
}
