/** A book on a link shelf: a GitHub repo (`slug`) or any URL. Not on disk until cloned. */
export interface LinkEntry {
  slug?: string; // "owner/name"
  url?: string; // any https URL, used when there is no slug
  name?: string; // display name override
}

export interface ShelfConfigEntry {
  label: string;
  /** Root folder scanned one level deep. Absent for link shelves. */
  path?: string;
  /** Curated remote repos. Present for link shelves. */
  links?: LinkEntry[];
  /** Hidden until the user reveals it (type "hermes" in the app). */
  hidden?: boolean;
}

export interface ShelfConfig {
  shelves: ShelfConfigEntry[];
  staleAfterDays: number;
  githubCacheHours: number;
}

export type ShelfKind = 'disk' | 'links';

export interface Shelf {
  id: string;
  label: string;
  path: string | null;
  kind: ShelfKind;
  hidden: boolean;
  repoCount: number;
}

export interface GitHubMeta {
  description: string | null;
  language: string | null;
  stars: number;
  topics: string[];
  isPrivate: boolean;
  isFork: boolean;
  pushedAt: string;
  htmlUrl: string;
  fetchedAt: string;
}

export interface Repo {
  id: string;
  name: string;
  path: string; // '' for virtual (link) books
  shelfId: string;
  virtual: boolean;
  linkUrl: string | null;
  branch: string | null;
  lastCommitAt: string | null;
  commitCount: number;
  dirtyCount: number;
  sizeKB: number;
  languageGuess: string | null;
  remoteUrl: string | null;
  owner: string | null;
  repoSlug: string | null;
  github: GitHubMeta | null;
  error?: string;
}

export interface AppState {
  shelves: Shelf[];
  repos: Repo[];
  github: { available: boolean; login: string | null };
  config: { staleAfterDays: number };
}

export interface ApiError {
  error: string;
  code: string;
}

export type OpenTarget = 'code' | 'terminal' | 'explorer' | 'github';

export interface AuditEntry {
  ts: string;
  action: string;
  repoId: string;
  path: string;
  params: unknown;
  ok: boolean;
  error?: string;
}
