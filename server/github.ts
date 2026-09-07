import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitHubMeta, Repo } from './types.js';
import { execRunner, type Runner } from './git.js';

const ENRICH_CONCURRENCY = 4;

interface CacheFile {
  entries: Record<string, GitHubMeta>;
}

interface GhRepoJson {
  description: string | null;
  language: string | null;
  stargazers_count: number;
  topics?: string[];
  private: boolean;
  fork: boolean;
  pushed_at: string;
  html_url: string;
}

export function toMeta(json: GhRepoJson, now: Date = new Date()): GitHubMeta {
  return {
    description: json.description ?? null,
    language: json.language ?? null,
    stars: json.stargazers_count ?? 0,
    topics: Array.isArray(json.topics) ? json.topics : [],
    isPrivate: Boolean(json.private),
    isFork: Boolean(json.fork),
    pushedAt: json.pushed_at,
    htmlUrl: json.html_url,
    fetchedAt: now.toISOString(),
  };
}

export class GitHubEnricher {
  private cache: Record<string, GitHubMeta> = {};
  private ready = false;
  private ok = false;
  private user: string | null = null;

  constructor(
    private cacheFile: string,
    private runner: Runner = execRunner,
    private cacheHours = 24,
    private now: () => Date = () => new Date(),
  ) {}

  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.cacheFile, 'utf8');
      const parsed = JSON.parse(raw) as CacheFile;
      this.cache = parsed.entries ?? {};
    } catch {
      this.cache = {};
    }
    const auth = await this.runner('gh', ['auth', 'status'], { timeoutMs: 15_000 });
    this.ok = auth.code === 0;
    if (this.ok) {
      const who = await this.runner('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 15_000 });
      this.user = who.code === 0 ? who.stdout.trim() || null : null;
      if (who.code !== 0) this.ok = false;
    }
    this.ready = true;
  }

  available(): boolean {
    return this.ready && this.ok;
  }

  login(): string | null {
    return this.user;
  }

  private fresh(meta: GitHubMeta): boolean {
    const age = this.now().getTime() - new Date(meta.fetchedAt).getTime();
    return age < this.cacheHours * 3600 * 1000;
  }

  cached(slug: string): GitHubMeta | null {
    const m = this.cache[slug];
    return m && this.fresh(m) ? m : null;
  }

  async enrich(repo: Repo): Promise<GitHubMeta | null> {
    if (!repo.repoSlug) return null;
    const hit = this.cached(repo.repoSlug);
    if (hit) return hit;
    if (!this.available()) return null;
    const r = await this.runner('gh', ['api', `repos/${repo.repoSlug}`], { timeoutMs: 20_000 });
    if (r.code !== 0) return null;
    let json: GhRepoJson;
    try {
      json = JSON.parse(r.stdout) as GhRepoJson;
    } catch {
      return null;
    }
    const meta = toMeta(json, this.now());
    this.cache[repo.repoSlug] = meta;
    await this.persist();
    return meta;
  }

  async enrichAll(repos: Repo[], onUpdate: (repo: Repo) => void): Promise<void> {
    const targets = repos.filter((r) => r.repoSlug);
    let next = 0;
    const workers = Array.from({ length: Math.min(ENRICH_CONCURRENCY, targets.length) }, async () => {
      while (next < targets.length) {
        const repo = targets[next++];
        const meta = await this.enrich(repo);
        if (meta) onUpdate({ ...repo, github: meta });
      }
    });
    await Promise.all(workers);
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    const data: CacheFile = { entries: this.cache };
    await fs.writeFile(this.cacheFile, JSON.stringify(data, null, 2), 'utf8');
  }
}
