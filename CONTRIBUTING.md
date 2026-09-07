# Contributing to repo shelf

Thanks for helping. This is a small project with a clear shape, so contributions are easy to review when they follow the layout below.

## Setup

```bash
git clone https://github.com/BkashJEE/repo-shelf.git
cd repo-shelf
npm install
npm run dev
```

Open http://127.0.0.1:5177. The API runs on port 4877. On first start a `shelf.config.json` is written with your `Developer`, `Documents`, and home folders as shelves; edit it or use the **Shelves** button.

Requirements: Node 20 or newer, git. Optional: GitHub CLI (`gh auth login`) for descriptions, stars, and topics. Works on Windows, macOS and Linux; CI runs all three.

## Project layout

```
server/            Express API (Node): config, scanner, GitHub enrichment, actions, SSE
  scanner.ts       finds repos one level under each shelf, reads git metadata
  actions.ts       move / rename / mkdir / open, with path guards
  pathguard.ts     every mutating route goes through these checks
src/               React + React Three Fiber UI
  scene/           bookcase, shelves, books, camera, canvas textures
  ui/              header, search, filter chips, detail panel, dialogs, theme picker
  store.ts         zustand store, all UI state lives here
  derive.ts        pure functions: book size/color, filters, display names
  themes.ts        color themes for both the page and the 3D scene
tests/
  server/          vitest, uses real temporary git repos
  derive.test.ts   vitest, pure functions
  e2e/             Playwright against fixture repos in a temp folder
```

## Running tests

```bash
npm test           # unit tests
npm run test:e2e   # Playwright (run `npx playwright install chromium` once)
npm run typecheck
```

Please add or update tests with your change. Server actions touch the filesystem, so they must have tests that prove the guards hold (path traversal, name collisions, dirty repos).

## Rules that keep the app safe

- The API binds to `127.0.0.1` only and refuses non-loopback requests.
- No route may delete a repository. Move, rename, and mkdir only.
- Any path coming from the client is resolved and checked against the configured shelves before use.
- Every mutating action is appended to `.cache/actions.log`.

If your change relaxes any of these, say so in the pull request and explain why.

## Adding a theme

Add an entry to `THEMES` in `src/themes.ts`. A theme has a UI palette (page, paper, ink, muted, line, accent) and a scene palette (background, frame, plank, lip, back-panel gradient, label plate). Keep contrast readable on the spines: light themes use dark wood, dark themes use lighter spines.

## Pull requests

- One change per pull request.
- Keep the existing code style (Prettier defaults, 2-space indent, single quotes).
- Run `npm test` and `npm run typecheck` before opening the PR.
- Describe what you changed and how you verified it. Screenshots help for anything visual.

## Reporting bugs

Open an issue with your OS, Node version, what you did, what you expected, and what happened. If the scanner misread a repo, include the output of `git status --porcelain` and `git remote -v` from that repo.
