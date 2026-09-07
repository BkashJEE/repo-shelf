# Repo Shelf Implementation Plan

**Goal:** A local web app that renders every git repo on this machine as a book on a 3D bookshelf and lets the user move, rename, add folders to, and open repos.

**Architecture:** Express 5 API on `127.0.0.1:4877` scans configured root folders (shelves) for git repos, enriches with GitHub metadata via `gh`, performs filesystem actions, and pushes changes over SSE. Vite + React 19 + React Three Fiber renders the bookcase; a zustand store holds state; plain CSS overlay provides search, filters, detail panel and dialogs.

**Tech Stack:** Node 24, TypeScript 5.9, Express 5, tsx, vitest 5, React 19, @react-three/fiber 9, @react-three/drei 10, three 0.185, zustand 5, Vite 8, Playwright 1.63.

**Spec:** `docs/design/spec.md`

## Global Constraints

- Server binds `127.0.0.1` only; reject non-loopback requests with 403.
- Every mutating route validates the resolved path lies inside a configured shelf, else 400 `outside_shelves`.
- Default config: shelves Developer, Documents, Home (`C:\Users\you`), `staleAfterDays: 90`, `githubCacheHours: 24`.
- Scanner is one level deep; root itself never a repo.
- `.cache/` gitignored; holds `github.json` and `actions.log`.
- Error JSON shape: `{ error: string, code: string }`.
- Rename regex `^[A-Za-z0-9._-]+$`, max 100 chars, not `.` or `..`.
- UI copy: wordmark "repo shelf.", eyebrow "A COLLECTION, ONE REPO AT A TIME", headline "The repo shelf.", subline "Click any book to take a closer look."
- Colors: page `#f6f4ee`, ink `#1d1c19`, muted `#7a776f`, accent `#3f5f4a`.
- Commit after every task with a conventional prefix.

---

## File Structure

```
package.json, tsconfig.json, tsconfig.server.json, vite.config.ts, vitest.config.ts, playwright.config.ts, index.html
shelf.config.json               # created by server on first run
server/types.ts                 # Shelf, Repo, ShelfConfig, ActionLog types
server/config.ts                # loadConfig(file), saveConfig, defaultConfig()
server/git.ts                   # runGit(cwd,args) with timeout; injectable runner type
server/scanner.ts               # scanShelf(shelf, runner) -> Repo[]; scanAll(config)
server/walk.ts                  # sizeAndLanguage(dir) -> {sizeKB, languageGuess}
server/github.ts                # GitHubEnricher(cacheFile, runner): enrich(repo), available()
server/pathguard.ts             # insideShelves(path, shelves), insideRepo(base, rel)
server/actions.ts               # moveRepo, renameRepo, mkdirInRepo, openRepo
server/audit.ts                 # appendAudit(file, entry)
server/events.ts                # SSE hub: subscribe(res), broadcast(event, data)
server/app.ts                   # createApp(deps) -> express app (testable)
server/index.ts                 # boot: load config, scan, listen, serve dist in prod
src/types.ts                    # re-export of server/types (import from ../server/types)
src/derive.ts                   # bookHeight, bookThickness, bookColor, isStale, hasGoldBand, hasRedTab, matches, relativeTime
src/api.ts                      # getState, rescan, actions, subscribeEvents
src/store.ts                    # zustand store
src/scene/{Scene,Bookcase,Shelf,Book,CameraRig,spineTexture}.tsx|ts
src/ui/{Header,Hero,SearchBar,FilterChips,DetailPanel,Dialogs,Toasts}.tsx
src/App.tsx, src/main.tsx, src/styles.css
tests/server/{helpers,config,scanner,pathguard,actions,github,audit,app}.test.ts
tests/derive.test.ts
tests/e2e/shelf.spec.ts
```

---

### Task 1: Project scaffold + config module

**Files:** `package.json`, `tsconfig.json`, `tsconfig.server.json`, `vitest.config.ts`, `server/types.ts`, `server/config.ts`, `tests/server/config.test.ts`

**Interfaces produced:**
```ts
// server/types.ts
export interface ShelfConfigEntry { label: string; path: string }
export interface ShelfConfig { shelves: ShelfConfigEntry[]; staleAfterDays: number; githubCacheHours: number }
export interface Shelf { id: string; label: string; path: string; repoCount: number }
export interface GitHubMeta { description: string|null; language: string|null; stars: number; topics: string[]; isPrivate: boolean; isFork: boolean; pushedAt: string; htmlUrl: string; fetchedAt: string }
export interface Repo { id: string; name: string; path: string; shelfId: string; branch: string|null; lastCommitAt: string|null; commitCount: number; dirtyCount: number; sizeKB: number; languageGuess: string|null; remoteUrl: string|null; owner: string|null; repoSlug: string|null; github: GitHubMeta|null; error?: string }
export interface AppState { shelves: Shelf[]; repos: Repo[]; github: { available: boolean }; config: { staleAfterDays: number } }
// server/config.ts
export function defaultConfig(home?: string): ShelfConfig
export function loadConfig(file: string): ShelfConfig   // writes default if missing; throws Error('shelf_path_missing: <path>') if a path doesn't exist
export function saveConfig(file: string, cfg: ShelfConfig): void
export function shelfId(path: string): string           // sha1(path.resolve(path).toLowerCase()).slice(0,12)
```

- [ ] Step 1: `npm init -y`, install deps: `react react-dom @react-three/fiber @react-three/drei three zustand express` and dev `typescript@^5.9 tsx vite @vitejs/plugin-react vitest @playwright/test concurrently @types/express @types/three @types/react @types/react-dom @types/node`.
- [ ] Step 2: Write `tests/server/config.test.ts`: default written when file missing (assert file exists and 3 shelves); loading with a nonexistent shelf path throws `shelf_path_missing`; `shelfId` stable and case-insensitive.
- [ ] Step 3: Run `npx vitest run tests/server/config.test.ts` → fails (module missing).
- [ ] Step 4: Implement `server/types.ts`, `server/config.ts`.
- [ ] Step 5: Tests pass. Commit `chore: scaffold project and config module`.

### Task 2: git runner, walk, scanner

**Files:** `server/git.ts`, `server/walk.ts`, `server/scanner.ts`, `tests/server/helpers.ts`, `tests/server/scanner.test.ts`

**Interfaces produced:**
```ts
// server/git.ts
export type Runner = (cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>
export const execRunner: Runner   // child_process.execFile, never throws on nonzero
// server/walk.ts
export async function sizeAndLanguage(dir: string): Promise<{ sizeKB: number; languageGuess: string|null }>
// server/scanner.ts
export async function scanShelf(entry: ShelfConfigEntry, runner?: Runner): Promise<{ shelf: Shelf; repos: Repo[] }>
export async function scanAll(cfg: ShelfConfig, runner?: Runner): Promise<{ shelves: Shelf[]; repos: Repo[] }>
export function parseRemote(url: string|null): { owner: string|null; repoSlug: string|null }
// tests/server/helpers.ts
export async function makeTempRoot(): Promise<string>
export async function makeRepo(root: string, name: string, opts?: { commits?: number; dirty?: boolean; remote?: string; files?: Record<string,string> }): Promise<string>
```

- [ ] Tests: finds 2 repos + ignores plain dir; root with own `.git` not listed; branch/commitCount/dirtyCount/remote correct; empty repo (no commits) gives count 0 and null date; `parseRemote` handles https, https with .git, ssh `git@github.com:o/r.git`, non-GitHub → nulls; runner failure → repo listed with `error`.
- [ ] Implement. Extension→language map: ts/tsx TypeScript, js/jsx JavaScript, py Python, rs Rust, go Go, swift Swift, kt Kotlin, java Java, cs C#, cpp/cc/h C++, c C, rb Ruby, php PHP, html HTML, css CSS, md Markdown, sh Shell, ps1 PowerShell, lua Lua, dart Dart, vue Vue, svelte Svelte. Skip dirs `.git node_modules dist build target .venv venv __pycache__`. Cap 20 000 files. Concurrency 8 via simple pool.
- [ ] Commit `feat(server): scanner with git metadata and language guess`.

### Task 3: pathguard, audit, actions

**Files:** `server/pathguard.ts`, `server/audit.ts`, `server/actions.ts`, tests for each.

**Interfaces produced:**
```ts
export function insideShelves(p: string, shelves: ShelfConfigEntry[]): boolean   // resolved p must be a direct child of a shelf path
export function resolveInsideRepo(repoPath: string, rel: string): string|null    // null on traversal
export function appendAudit(file: string, entry: { action: string; repoId: string; path: string; params: unknown; ok: boolean; error?: string }): Promise<void>
export class ActionError extends Error { constructor(public status: number, public code: string, message: string) }
export async function moveRepo(repo: Repo, target: ShelfConfigEntry, shelves: ShelfConfigEntry[], opts: { force?: boolean }): Promise<{ newPath: string }>
export async function renameRepo(repo: Repo, newName: string, shelves: ShelfConfigEntry[], opts: { alsoGitHub?: boolean; runner?: Runner; ghLogin?: string|null }): Promise<{ newPath: string; newRemoteUrl?: string }>
export async function mkdirInRepo(repo: Repo, relDir: string, opts: { gitkeep?: boolean }): Promise<{ created: string }>
export async function openRepo(repo: Repo, target: 'code'|'terminal'|'explorer'|'github', spawn?: typeof import('child_process').spawn): Promise<void>
```

- [ ] Tests: move happy; target exists 409 `exists`; dirty no force 409 `dirty`; dirty force ok; same shelf 400 `same_shelf`; outside shelves 400 `outside_shelves`. Rename happy; bad name 400 `invalid_name`; sibling 409 `exists`; alsoGitHub with mocked runner asserts `gh repo rename` args and `git remote set-url`; gh failure → local untouched. mkdir happy/nested/gitkeep/traversal 400/exists 409. Audit writes one JSON line per call.
- [ ] Implement. EXDEV fallback: `fs.cp(src,dst,{recursive:true})`, count files both sides, `fs.rm(src,{recursive:true})`. EPERM/EBUSY → 423 `locked`.
- [ ] Commit `feat(server): move, rename, mkdir, open actions with guards and audit`.

### Task 4: GitHub enricher

**Files:** `server/github.ts`, `tests/server/github.test.ts`

```ts
export class GitHubEnricher {
  constructor(cacheFile: string, runner: Runner, cacheHours: number)
  async init(): Promise<void>                 // checks `gh auth status`, loads cache, resolves login via `gh api user --jq .login`
  available(): boolean
  login(): string|null
  async enrich(repo: Repo): Promise<GitHubMeta|null>   // cache-first
  async enrichAll(repos: Repo[], onUpdate: (r: Repo) => void): Promise<void>  // concurrency 4
}
```
- [ ] Tests with fake runner: unavailable when auth fails; fetch maps `gh api repos/o/r` JSON (`description, language, stargazers_count, topics, private, fork, pushed_at, html_url`) to GitHubMeta; cache hit skips runner; expired cache refetches.
- [ ] Commit `feat(server): GitHub enrichment with cache`.

### Task 5: SSE hub + express app + boot

**Files:** `server/events.ts`, `server/app.ts`, `server/index.ts`, `tests/server/app.test.ts`

```ts
export function createApp(deps: { configFile: string; cacheDir: string; runner?: Runner; enricher?: GitHubEnricher; spawn?: typeof spawn }): Promise<{ app: express.Express; state: () => AppState; rescan: (shelfId?: string) => Promise<void> }>
```
Routes per spec. Loopback middleware: `req.socket.remoteAddress` in `['127.0.0.1','::1','::ffff:127.0.0.1']` else 403. After mutations: rescan affected shelves, broadcast `state:changed`, audit.
- [ ] Tests with supertest-free approach: start app on ephemeral port, `fetch` routes: `/api/state` shape; `POST /api/repo/mkdir` creates dir; `POST /api/repo/rename` bad name 400; `DELETE /api/shelves/:id` removes from config, disk untouched; `POST /api/shelves` with missing path 400.
- [ ] `server/index.ts`: `PORT=4877`, in production (`NODE_ENV=production` or `dist/` exists and `--serve`) serve `dist/` static with SPA fallback.
- [ ] Commit `feat(server): HTTP API, SSE, boot`.

### Task 6: Frontend derive + store + api

**Files:** `vite.config.ts`, `index.html`, `src/main.tsx`, `src/derive.ts`, `src/api.ts`, `src/store.ts`, `tests/derive.test.ts`

```ts
// derive.ts
export function bookHeight(commitCount: number): number      // 1.6 + 0.9*log10(1+n) clamp [1.6,3.4]
export function bookThickness(sizeKB: number): number        // 0.18 + 0.12*log10(1+kb) clamp [0.18,0.7]
export function languageOf(r: Repo): string                  // github.language ?? languageGuess ?? 'Unknown'
export function bookColor(language: string): string          // palette map else hsl(hash%360,45%,42%)
export function isStale(r: Repo, days: number, now?: Date): boolean
export function hasGoldBand(r: Repo): boolean
export function hasRedTab(r: Repo): boolean
export type Filter = 'all' | `lang:${string}` | 'remote' | 'dirty' | 'stale'
export function matches(r: Repo, q: string, f: Filter, shelfId: string, staleDays: number): boolean
export function relativeTime(iso: string|null, now?: Date): string   // 'never', 'today', '3 days ago', '2 months ago', '1 year ago'
```
Store fields per spec; `visibleRepos()` selector = repos filtered by matches, ordered by shelf order then name.
- [ ] Tests for every derive function incl. clamps, palette stability, matches across query/filter/shelf.
- [ ] Commit `feat(web): derive, store, api client`.

### Task 7: Scene — bookcase, shelves, books, camera

**Files:** `src/scene/*.tsx`, `src/scene/spineTexture.ts`, `src/App.tsx`, `src/styles.css`

- Layout constants: shelf width 14, plank thickness 0.18, row height 4.2, book base y = plank top, x start = -6.6, gap 0.05, overflow → row pan arrows (HTML) shifting `offsetX` in store per shelf.
- `spineTexture(repo, opts)` returns cached `THREE.CanvasTexture` 128×512: bg color, name rotated, language tag, gold band, red tab; `coverTexture(repo)` 512×768 for front.
- `Book`: `<group>` with `<mesh>` box `[thickness, height, 1.0]`, materials array: spine (−z face... use +z front face facing camera = spine), other faces plain darker color, cover on +x face. Animated with `useFrame` lerp toward target `{z, rotY, opacity}` from hovered/selected/dimmed/drag state; `invalidate()` while moving.
- Pointer: `onPointerOver/Out` set hovered; `onPointerDown` records start; `onPointerMove` on canvas with ≥8px → drag; `onPointerUp` → if drag and overShelf differs → `openDialog('move')`, else if no drag → select.
- `Shelf`: plank mesh + label `<Html center>` + back panel; raycast target for drag hover via `onPointerOver` on plank+panel setting `drag.overShelfId`.
- `CameraRig`: position `[0, -rowIndex*4.2, 9]`, lookAt same y; wheel → `scrollY` in store (clamped to shelves), keyboard ↑/↓; parallax ±2° from mouse; damped in `useFrame`.
- Canvas `frameloop="demand"`, `dpr=[1,2]`, no shadows, ambient + one directional + hemisphere light.
- [ ] Manually verify: `npm run dev`, all repos visible, hover slides, click rotates.
- [ ] Commit `feat(web): 3D bookcase scene`.

### Task 8: UI overlay — header, hero, search, filters, detail panel

**Files:** `src/ui/Header.tsx`, `Hero.tsx`, `SearchBar.tsx`, `FilterChips.tsx`, `DetailPanel.tsx`, `styles.css`

- `/` focuses search (ignore when in input), `Esc` clears/blur or closes panel.
- Detail panel per spec; prev/next iterate `visibleRepos()`.
- Open buttons call `api.open(repoId, target)`.
- [ ] Commit `feat(web): search, filters, detail panel`.

### Task 9: Dialogs, actions, shelves manager, toasts, SSE wiring

**Files:** `src/ui/Dialogs.tsx`, `Toasts.tsx`, store additions

- Move dialog: shows source shelf → target shelf, dirty count warning, `Move anyway` when 409 dirty returned; Rename: live regex validation, GitHub checkbox when `repo.github && repo.owner === state.githubLogin` (add `githubLogin` to `/api/state`); New folder: rel path + gitkeep; Shelves: list + remove + add form.
- Toast on success/error; SSE `state:changed` refetch; `repo:update` merge; reconnect backoff.
- [ ] Commit `feat(web): repo actions, shelf manager, toasts`.

### Task 10: E2E, README, prod mode, tag

**Files:** `playwright.config.ts`, `tests/e2e/shelf.spec.ts`, `README.md`

- Playwright `webServer` runs server with `SHELF_CONFIG=<tmp>/shelf.config.json` env pointing at fixture repos created in `globalSetup`, plus vite.
- Tests: header stats; N books (`[data-book]` count via `Html` labels or hidden DOM list `#book-index`); search dims; click opens panel with name; mkdir via dialog creates folder on disk.
- README: what, run, config, actions, safety.
- `npm run build && npm start` serves on 4877.
- [ ] Commit `docs: README and e2e`, tag `v0.1.0`.
