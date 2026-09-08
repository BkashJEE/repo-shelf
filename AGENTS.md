# AGENTS.md

Guidance for coding agents (Codex, Cursor, Copilot, etc.) working in this repository. Humans: see README.md and CONTRIBUTING.md.

## What this is

repo shelf renders every git repository under configured root folders ("shelves") as a book on a 3D bookcase and lets the user search, inspect, move, rename, add folders to, and open repos. Local only: an Express API on `127.0.0.1:4877` plus a Vite/React/React Three Fiber UI on `5177`.

## Commands

```bash
npm install
npm run dev          # API + UI with hot reload
npm test             # vitest: server (real temp git repos) + pure functions
npm run test:e2e     # Playwright (run `npx playwright install chromium` once)
npm run typecheck    # both tsconfigs
npm run build && npm start   # production, single port 4877
```

Run `npm test` and `npm run typecheck` before you consider a task done. Add tests for any server behaviour you touch.

## Layout

- `server/` Node API. `scanner.ts` (find repos, read git), `github.ts` (`gh` enrichment, cached), `actions.ts` (move/rename/mkdir/open), `pathguard.ts` (all path checks), `app.ts` (routes, SSE), `config.ts` (`shelf.config.json`).
- `src/` UI. `store.ts` is the single zustand store. `derive.ts` holds pure functions (book size/color, filters, `displayName`). `themes.ts` defines color themes for page + scene. `scene/` is the 3D part (`Bookcase`, `Shelf`, `Book`, `CameraRig`, `textures.ts` canvas spines/covers). `ui/` is the HTML overlay.
- `tests/server/helpers.ts` creates real git repos in a temp dir; use it instead of mocking git.
- `docs/design/` has the original design spec and plan.

## Hard rules

1. The API must stay loopback only. Never delete anything on disk. Deleting a repo on GitHub is allowed only through `deleteGitHubRepo`, which requires the exact name typed and the owner's gh login.
2. Every path from the client goes through `pathguard.ts` before touching disk.
3. Every mutating action is audited via `audit.ts`.
4. Never run move/rename against real user repos in tests. Use `tests/server/helpers.ts` or the e2e fixtures in `%TEMP%/repo-shelf-e2e`.
5. Keep the scene on `frameloop="demand"`; call `invalidate()` when something animates. Do not switch it to `always`.
6. No new runtime dependencies without a reason stated in the PR. Current stack: React 19, R3F 9, drei 10, three, zustand 5, Express 5.
7. Match existing style: TypeScript strict, single quotes, 2-space indent, no default exports for components.

## Conventions

- Book visuals come from `derive.ts`: height = commits (log), thickness = size (log), color = language palette, gold band = stars, red tab = dirty, faded = stale.
- Repo folder names are shown through `displayName()` ("hermes-pocket" -> "Hermes Pocket"); the raw name stays in `Repo.name` and the panel slug line.
- Camera state (`zoom`, `orbit`, `focus`, `scrollRow`) lives in the store; `CameraRig` only eases toward it.
- Themes: add to `THEMES` in `src/themes.ts`; both `ui` (CSS vars) and `scene` (3D colors) are required.
- Responsive breakpoints: 1000px (tablet) and 640px (phone) in `src/styles.css`. The detail page sits beside the bookcase (never over it) and stacks below it on phones.
- GitHub account shelves: `ShelfConfigEntry.github` (`'me'` or a login) with `visibility` lists an account's repos as virtual books (`scanner.githubRepo`); actions `setVisibility`, `setArchived`, `deleteGitHubRepo`, `cloneRepo` apply. Dragging between the public and private GitHub shelves changes visibility.
- Link shelves: `ShelfConfigEntry.links` makes virtual books (`Repo.virtual`, `path: ''`). Server actions refuse them with `400 virtual`; only `open github` and `clone` apply. `hidden: true` shelves are revealed client-side by typing `hermes` (see `revealSecret` in the store).
- Bookcase styles: `caseStyle` in the store (`classic | modern | floating`) toggles geometry in `Bookcase.tsx` / `Shelf.tsx`.

## Good next tasks

Pick one, keep the PR focused:

- **Favorites / pins**: star a book from the panel, persist in `shelf.config.json`, show a small ribbon on the spine, add a "Pinned" chip.
- **Clone any URL**: today only link books and repos with a remote can be cloned; add a dialog that takes an arbitrary GitHub URL and streams `git clone` progress over SSE.
- **Sort within a shelf**: name / last commit / size / commits, stored per shelf, animated re-layout.
- **Custom spine color per repo**: override in config, color picker in the panel.
- **Electron or Tauri wrapper**: single-window desktop app that starts the API itself; keep the web version working.
- **Linux/macOS open-in-terminal polish**: `actions.ts` has basic support; test on real machines and handle missing terminals gracefully.
- **Book row overflow**: when a shelf has more books than fit, add smooth panning with keyboard support (currently arrow buttons only).
- **Accessibility pass**: keyboard navigation between books (the hidden `#book-index` list is the hook), focus rings, reduced-motion audit.
- **Performance**: instanced book meshes for shelves with 200+ repos; measure with the Home shelf fixture.

## Definition of done

Feature works in the browser, `npm test` and `npm run typecheck` pass, e2e still passes if you touched flows it covers, README updated if user-facing.
