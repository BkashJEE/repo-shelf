/** A book on a link shelf: a GitHub repo (`slug`) or any URL. Not on disk until cloned. */
export interface LinkEntry {
  slug?: string; // "owner/name"
  url?: string; // any https URL, used when there is no slug
  name?: string; // display name override
  /** Markdown source for a guide book: "owner/repo:path/to/file.md" (fetched raw) or an https URL to a .md file. */
  doc?: string;
  /** One-line blurb shown on the cover and the page. */
  description?: string;
}

export interface ShelfConfigEntry {
  label: string;
  /** Root folder scanned one level deep. Absent for link shelves. */
  path?: string;
  /** Curated remote repos. Present for link shelves. */
  links?: LinkEntry[];
  /** Hidden until the user reveals it (type "hermes" in the app). */
  hidden?: boolean;
  /** GitHub account shelf: 'me' (the gh login) or a login. Lists that account's repos via gh. */
  github?: string;
  /** Which repos of the account to show. Default 'all'. */
  visibility?: 'public' | 'private' | 'all';
}

export interface ShelfConfig {
  shelves: ShelfConfigEntry[];
  staleAfterDays: number;
  githubCacheHours: number;
}

export type ShelfKind = 'disk' | 'links' | 'github';

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
  /** GitHub visibility when known (github books always, disk books after enrichment). */
  visibility: 'public' | 'private' | null;
  archived: boolean;
  /** First commit (disk) or GitHub creation date. Drives the rewind animation. */
  createdAt: string | null;
  /** Guide books: where the markdown comes from (see LinkEntry.doc). */
  doc: string | null;
  /** Blurb for link / guide books that have no GitHub description. */
  summary: string | null;
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

export interface PageCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export interface PageIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  updatedAt: string;
  author: string;
  labels: string[];
  draft: boolean;
}

export interface PageFile {
  name: string;
  type: 'file' | 'dir';
}

/** What the open book shows on its pages. */
export interface RepoPages {
  readme: string | null;
  files: PageFile[];
  commits: PageCommit[];
  branches: string[];
  issues: PageIssue[];
  pulls: PageIssue[];
  source: 'disk' | 'github' | 'doc' | 'none';
  fetchedAt: string;
}
