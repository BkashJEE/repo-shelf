# Repo Shelf — Design Spec

Date: 2026-09-07
Status: Approved

## Purpose

A local desktop web app that shows every git repository on this machine as a book on a wooden bookshelf, rendered in 3D with React Three Fiber. Each root folder is one shelf. Each repo is one book. The user can search, filter, inspect a repo, and perform real filesystem actions on it: move it to another root folder, rename it, create a folder inside it, and open it in an editor, terminal, file explorer, or GitHub.

Visual reference: Linus Ekenstam's "shelf stories" bookshelf UI (cream paper background, serif headline, wooden shelves with spines facing out, click opens a detail card, search box with `/` shortcut, filter chips that empty the shelves of non-matching books).

## Non-goals (v1)

- Cloning new repos
- Deleting repos
- Commit, push, pull, branch operations
- Multi-user or remote access; the server binds to localhost only
- Mobile layout

## Architecture

Single package at `C:\Users\you\Developer\repo-shelf`.

```
repo-shelf/
  package.json          # scripts: dev (server + vite concurrently), build, test, test:e2e
  shelf.config.json     # user config: list of shelves (root folders)
  server/               # Node 24 + Express + TypeScript, run with tsx
    index.ts            # app bootstrap, port 4877, localhost only
    config.ts           # load/save shelf.config.json
    scanner.ts          # scan roots -> Repo[] (local git data only)
    github.ts           # enrich Repo with GitHub metadata via `gh`, cached
    actions.ts          # move, rename, mkdir, open
    events.ts           # SSE broadcaster
    audit.ts            # append-only .cache/actions.log
    routes.ts           # HTTP routes
  src/                  # Vite + React 18 + R3F + drei + zustand
    main.tsx
    App.tsx
    store.ts            # zustand: repos, shelves, filters, selection, drag state
    api.ts              # fetch wrappers + SSE subscription
    derive.ts           # pure functions: book dimensions, color, filter/search
    scene/
      Bookcase.tsx      # wood frame, shelf planks, labels
      Shelf.tsx         # one row; lays out books; drop target
      Book.tsx          # one book mesh with canvas spine texture; hover/click/drag
      Camera.tsx        # front-on camera, mouse parallax, scroll between shelves
    ui/
      Header.tsx        # title, stats
      SearchBar.tsx     # search input, `/` shortcut, shelf dropdown
      FilterChips.tsx   # All / languages / Has remote / Dirty / Stale
      DetailPanel.tsx   # repo detail card + action buttons
      Dialogs.tsx       # confirm move, rename form, mkdir form, shelf manager
      Toast.tsx
    styles.css
  tests/
    server/             # vitest, real temp git repos
    derive.test.ts      # vitest, pure functions
    e2e/                # playwright smoke
  .cache/               # gitignored: github.json, actions.log
```

Dev: `npm run dev` starts the API on `http://127.0.0.1:4877` and Vite on `http://127.0.0.1:5173` with `/api` proxied to the server. Build: `vite build` then the Express server serves `dist/` so `npm start` is one process.

## Configuration

`shelf.config.json`:

```json
{
  "shelves": [
    { "label": "Developer", "path": "C:\\Users\\you\\Developer" },
    { "label": "Documents", "path": "C:\\Users\\you\\Documents" },
    { "label": "Home",      "path": "C:\\Users\\you" }
  ],
  "staleAfterDays": 90,
  "githubCacheHours": 24
}
```

Shelf order in the file is shelf order on screen (top to bottom). If the file is missing the server writes this default. Shelves are editable from the UI (add or remove a root folder). A root folder is scanned one level deep: every immediate child directory that contains `.git` (dir or file) is a repo. The root itself is not treated as a repo even if it has `.git`.

## Data model

```ts
interface Shelf { id: string; label: string; path: string; repoCount: number }

interface Repo {
  id: string;            // sha1 of absolute path, stable across rescans
  name: string;          // directory name
  path: string;          // absolute path
  shelfId: string;
  // local git
  branch: string | null;
  lastCommitAt: string | null;   // ISO
  commitCount: number;
  dirtyCount: number;            // lines of `git status --porcelain`
  sizeKB: number;                // excluding .git and node_modules
  languageGuess: string | null;  // by file-extension count, top 1
  // remote
  remoteUrl: string | null;
  owner: string | null;          // parsed from remoteUrl when GitHub
  repoSlug: string | null;       // "owner/name" when GitHub
  // github enrichment (null until fetched)
  github: null | {
    description: string | null;
    language: string | null;
    stars: number;
    topics: string[];
    isPrivate: boolean;
    isFork: boolean;
    pushedAt: string;
    htmlUrl: string;
    fetchedAt: string;
  };
}
```

`language` shown in the UI is `github.language ?? languageGuess ?? "Unknown"`.

### Scanner

- Runs on startup and on demand (`POST /api/rescan`, optionally with `shelfId`).
- Per repo runs, with `cwd` set to the repo and a 10 s timeout each: `git rev-parse --abbrev-ref HEAD`, `git log -1 --format=%cI`, `git rev-list --count HEAD`, `git status --porcelain`, `git remote get-url origin`.
- A repo with no commits yet gets `commitCount 0`, `lastCommitAt null`, `branch` from `rev-parse` or null.
- Size and language guess come from one directory walk that skips `.git`, `node_modules`, `dist`, `build`, `target`, `.venv`, `venv`, `__pycache__`, and stops at 20 000 files.
- Repos are scanned in parallel with a concurrency of 8. A failing repo is still listed with nulls and an `error` string so the shelf never silently drops a book.

### GitHub enrichment

- After the local scan responds, the server enriches every repo with a GitHub `repoSlug` in the background using `gh api repos/{slug}` with concurrency 4.
- Results are cached in `.cache/github.json` keyed by slug with `fetchedAt`; entries younger than `githubCacheHours` are reused.
- If `gh` is not installed or not authenticated, enrichment is skipped and the UI shows a small notice; local data still works.
- Each enriched repo is pushed to the client over SSE as `repo:update`.

## API

All routes are JSON over `http://127.0.0.1:4877`. Any request from a non-loopback address is rejected. Every mutating route validates that `path` is inside one of the configured shelves after `path.resolve`; otherwise `400`.

| Method | Route | Body | Result |
|---|---|---|---|
| GET | `/api/state` | | `{ shelves, repos, github: { available: boolean } }` |
| POST | `/api/rescan` | `{ shelfId? }` | `{ shelves, repos }` |
| GET | `/api/events` | | SSE stream: `repo:update`, `state:changed`, `toast` |
| GET | `/api/shelves` | | `Shelf[]` |
| POST | `/api/shelves` | `{ label, path }` | adds a shelf, rescans it |
| DELETE | `/api/shelves/:id` | | removes the shelf from config only; nothing on disk changes |
| POST | `/api/repo/move` | `{ repoId, targetShelfId, force? }` | moves the directory |
| POST | `/api/repo/rename` | `{ repoId, newName, alsoGitHub? }` | renames the directory, optionally the GitHub repo |
| POST | `/api/repo/mkdir` | `{ repoId, relDir, gitkeep? }` | creates a folder inside the repo |
| POST | `/api/repo/open` | `{ repoId, target }` | `target` in `code`, `terminal`, `explorer`, `github` |

### Action rules

**move**
- Target path = `targetShelf.path / repo.name`.
- Refuse with `409` if the target already exists.
- Refuse with `409 dirty` if `dirtyCount > 0` and `force` is not true. The UI shows the count and offers "Move anyway".
- Refuse with `400` if source and target shelves are the same.
- Uses `fs.rename`. On `EXDEV` (different drive) falls back to recursive copy then delete of the source, copy verified by file count before delete.
- On `EPERM`/`EBUSY` (Windows file lock: open editor, terminal, running process) returns `423` with a message telling the user to close programs using the folder. Nothing is partially moved because `fs.rename` is atomic on the same volume.

**rename**
- `newName` must match `^[A-Za-z0-9._-]+$`, be at most 100 chars, and not be `.` or `..`.
- Refuse with `409` if a sibling with that name exists.
- If `alsoGitHub` is true: require `github` data present and `owner` equal to the `gh` login. Run `gh repo rename <newName> -R <slug> --yes`. On success run `git remote set-url origin <newUrl>` in the repo. GitHub rename happens first; if it fails the local rename is not performed and the error is returned.

**mkdir**
- `relDir` is resolved against the repo path. The result must start with the repo path plus a separator; otherwise `400 traversal`.
- Creates intermediate folders (`recursive: true`). If `gitkeep` is true writes an empty `.gitkeep` inside.
- Returns `409` if the folder already exists.

**open**
- `code`: spawn `code <path>` detached.
- `terminal`: try `wt -d <path>`, fall back to `powershell -NoExit -Command Set-Location '<path>'` in a new window.
- `explorer`: `explorer <path>`.
- `github`: requires `github.htmlUrl`; opens with `start "" <url>`.
- Never opens a URL that did not come from `gh api`.

Every mutating action appends one JSON line to `.cache/actions.log`: `{ ts, action, repoId, path, params, ok, error? }`. After a successful move, rename, or mkdir the server rescans the affected shelf or shelves and broadcasts `state:changed`.

## Frontend

### Store (zustand)

`repos`, `shelves`, `githubAvailable`, `query`, `activeFilter` (`all | lang:<name> | remote | dirty | stale`), `activeShelfId` (`all` or one shelf), `selectedRepoId`, `hoveredRepoId`, `drag` (`{ repoId, overShelfId } | null`), `dialog` (`null | move | rename | mkdir | shelves`), `toasts`.

Loads `/api/state` on mount, then subscribes to `/api/events`. `repo:update` merges one repo; `state:changed` refetches state.

### Derived visuals (pure, in `derive.ts`, unit tested)

- `bookHeight(commitCount)`: 1.6 + 0.9 × log10(1 + commitCount) clamped to [1.6, 3.4] scene units.
- `bookThickness(sizeKB)`: 0.18 + 0.12 × log10(1 + sizeKB) clamped to [0.18, 0.7].
- `bookColor(language)`: fixed palette map for the top 20 languages, fallback hashed hue at fixed saturation and lightness so unknown languages stay consistent.
- `isStale(repo, staleAfterDays)`: no commit or last commit older than the threshold. Stale books use a desaturated, lighter version of their color.
- `hasGoldBand(repo)`: `github.stars > 0`.
- `hasRedTab(repo)`: `dirtyCount > 0`.
- `matches(repo, query, filter, shelfId)`: query matches name, description, path, topics, language, case-insensitive; filter as defined above.

### Scene

- Canvas fills the viewport below the header, 3D over a cream page. Bookcase is a dark walnut frame with one plank per shelf; between planks a warm brown back panel with soft vignette.
- Camera is front-on, slight downward tilt. Mouse position drives a parallax of ±2°. Mouse wheel scrolls the camera vertically between shelves with damping. Keyboard: `↑`/`↓` also scroll by one shelf.
- Each shelf row lays its books left to right with a 0.05 gap, starting from the left edge. If books overflow the shelf width the row gets left/right arrows that pan the row.
- Each book is a box mesh. Spine texture is a `CanvasTexture` per book: language color background, repo name rotated 90°, small language tag at the bottom, gold band near the top when starred, red tab at top-right when dirty. Textures are built once per repo and cached by `repo.id` plus a hash of its visual inputs.
- Hover: book eases forward by 0.35 units; cursor becomes pointer; small HTML tooltip (drei `Html`) shows name and last commit.
- Click: book eases forward 1.2 units and rotates 90° so its front cover faces the camera; the front cover texture shows name, description, language, stars. The detail panel opens. Clicking elsewhere or pressing `Esc` closes and returns the book.
- Non-matching books (search or filter) sink 0.5 units back and fade to 15% opacity over 300 ms, so the shelf visually empties like the reference.
- Shelf label plate is centered on each plank: `Shelf 01 · Developer · 6 repos`.
- Drag: pointer down on a book plus 8 px of movement starts a drag. The book follows the pointer in front of the shelves. Shelf planks under the pointer highlight. Releasing over a different shelf opens the move confirmation dialog; releasing anywhere else snaps the book back.
- Performance: books are individual meshes (about 40 books is trivial). Shadows off. `frameloop="demand"` with invalidate on animation, so idle CPU stays low.

### UI overlay

- Header: book icon and "repo shelf." wordmark on the left; right side stats `N repos` and `M shelves`.
- Hero: eyebrow `A COLLECTION, ONE REPO AT A TIME`, headline "The repo shelf.", subline "Click any book to take a closer look."
- Search bar: icon, input, `/` hint, shelf dropdown (`All shelves` or one shelf). Pressing `/` anywhere focuses the input; `Esc` clears and blurs.
- Filter chips row: `All repos (N)`, one chip per language present (count shown), `Has remote`, `Dirty`, `Stale`. Single-select. `Clear filters ×` appears when anything is active; `N repos found` shows on the left.
- Detail panel (right, over the shelves, cream card, closes with ×): shelf eyebrow `FROM SHELF 02`, tag chips (language, private, fork, dirty, stale), name, description, path (click copies), grid of facts: branch, last commit (relative and absolute), commits, size, stars, topics. Buttons: `Open in VS Code`, `Terminal`, `Explorer`, `View on GitHub` (hidden when no GitHub data). Secondary actions: `Move…`, `Rename…`, `New folder…`. Footer `i / N` with prev and next arrows that step through the currently visible books.
- Dialogs: move (source and target shown, dirty warning with "Move anyway"), rename (input with live validation, checkbox "Also rename on GitHub" shown only when eligible), new folder (relative path input, `.gitkeep` checkbox), shelves manager (list with remove, add form with label and path).
- Toasts bottom-center for success and error, 4 s.
- Styling: cream `#f6f4ee` page, ink `#1d1c19`, muted `#7a776f`, accent green `#3f5f4a` for primary buttons, serif headline (Fraunces via Google Fonts with Georgia fallback), system sans for body. Reduced motion respected via `prefers-reduced-motion`.

## Error handling

- API errors return `{ error: string, code: string }` with the status codes above. The UI shows them as toasts; dialogs stay open on error so the user can retry.
- Scanner failures per repo appear on the book as a small warning tab and in the detail panel.
- `gh` missing or unauthenticated: header shows `GitHub data unavailable` and the enrichment step is skipped.
- SSE disconnect: client retries with backoff up to 30 s and shows `Reconnecting…` in the header.
- Server refuses to start if any configured shelf path does not exist; it logs which one and the UI cannot load, so the config error is loud.

## Testing

**Server (vitest)** — each test creates a temp dir, runs real `git init` and commits with `git` to build fixtures, and points the server modules at that dir via an injected config.
- scanner: finds repos one level deep, ignores non-git dirs, ignores root `.git`, reads branch, count, dirty, remote, handles empty repo, handles a repo whose git command fails.
- move: happy path, target exists → 409, dirty without force → 409, dirty with force → moves, same shelf → 400, path outside shelves → 400.
- rename: happy path, invalid name → 400, sibling exists → 409, GitHub branch mocked (`gh` calls go through an injectable runner).
- mkdir: happy path, nested, gitkeep, traversal `../x` → 400, exists → 409.
- config: default written when missing, add/remove shelf, missing path rejected.
- audit: one line per action, error lines recorded.

**Frontend (vitest)** — `derive.ts` functions: dimensions clamp, palette stability, stale logic, match logic across query, filter, shelf.

**E2E (Playwright)** — with a fixture config pointing at temp repos: page loads, header stats match fixture, all books present, typing in search dims books, clicking a book opens the panel with the right name, mkdir through the dialog creates the folder on disk.

## Milestones

1. Server: config, scanner, `/api/state`, tests.
2. Server: actions (move, rename, mkdir, open), audit, SSE, tests.
3. Server: GitHub enrichment with cache, tests with mocked runner.
4. Frontend: store, api, derive with tests; static bookcase and books from real state.
5. Frontend: hover, click, camera, search, filters, detail panel.
6. Frontend: dialogs and actions wired, drag to move, shelves manager, toasts.
7. E2E, README, `npm start` production mode, first commit tagged v0.1.0.
