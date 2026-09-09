import { create } from 'zustand';
import type { AppState, Repo, RepoPages, Shelf } from './types';
import { api, ApiError, subscribeEvents } from './api';
import { matches, type Filter } from './derive';
import { applyThemeCss, loadThemeId, saveThemeId, themeById } from './themes';
import { staticData, staticState } from './static';

export type DialogKind = 'move' | 'rename' | 'mkdir' | 'shelves' | 'clone' | 'visibility' | 'delete' | 'create' | 'publish';

export interface Dialog {
  kind: DialogKind;
  repoId?: string;
  shelfId?: string;
  targetShelfId?: string;
  visibility?: 'public' | 'private';
}

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

export type CaseStyle = 'classic' | 'modern' | 'floating';
export const CASE_STYLES: { id: CaseStyle; name: string; description: string }[] = [
  { id: 'classic', name: 'Classic', description: 'Solid case with sides, back panel and crown' },
  { id: 'modern', name: 'Modern', description: 'Thin planks, slim frame, open back' },
  { id: 'floating', name: 'Floating', description: 'Planks only, nothing else in the way' },
];

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 8;

export interface DragState {
  repoId: string;
  overShelfId: string | null;
}

export interface ShelfState {
  loaded: boolean;
  loadError: string | null;
  connected: boolean;
  /** Every shelf the server knows, including hidden ones. */
  allShelves: Shelf[];
  /** Shelves currently shown on the bookcase (hidden ones appear once revealed). */
  shelves: Shelf[];
  repos: Repo[];
  secretRevealed: boolean;
  caseStyle: CaseStyle;
  githubAvailable: boolean;
  githubLogin: string | null;
  staleAfterDays: number;

  query: string;
  filter: Filter;
  activeShelfId: string;
  selectedRepoId: string | null;
  hoveredRepoId: string | null;
  drag: DragState | null;
  dialog: Dialog | null;
  toasts: Toast[];
  scrollRow: number;
  rowOffsets: Record<string, number>;
  busy: boolean;
  zoom: number;
  orbit: { yaw: number; pitch: number };
  focus: { x: number; y: number } | null;
  themeId: string;
  pages: Record<string, RepoPages>;
  setPages: (repoId: string, pages: RepoPages) => void;
  /** Rewind: books created after this instant are hidden. null = off. */
  timeline: number | null;
  rewindPlaying: boolean;
  setTimeline: (t: number | null) => void;
  startRewind: () => void;
  readOnly: boolean;
  /** When true every eased animation snaps to its target (used while exporting frames). */
  instant: boolean;
  setInstant: (v: boolean) => void;

  load: () => Promise<void>;
  applyState: (s: AppState) => void;
  mergeRepo: (r: Repo) => void;
  setQuery: (q: string) => void;
  setFilter: (f: Filter) => void;
  setActiveShelf: (id: string) => void;
  clearFilters: () => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  startDrag: (repoId: string) => void;
  dragOver: (shelfId: string | null) => void;
  endDrag: (drop: boolean) => void;
  openDialog: (d: Dialog) => void;
  closeDialog: () => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  setScrollRow: (row: number) => void;
  setRowOffset: (shelfId: string, offset: number) => void;
  setZoom: (z: number) => void;
  setOrbit: (yaw: number, pitch: number) => void;
  setFocus: (f: { x: number; y: number } | null) => void;
  resetView: () => void;
  setTheme: (id: string) => void;
  setCaseStyle: (c: CaseStyle) => void;
  revealSecret: () => void;
  setBusy: (b: boolean) => void;
  runAction: (label: string, fn: () => Promise<{ state?: AppState }>) => Promise<boolean>;
}

let toastSeq = 1;

function loadCaseStyle(): CaseStyle {
  try {
    const v = localStorage.getItem('repo-shelf.case');
    if (v === 'classic' || v === 'modern' || v === 'floating') return v;
  } catch {
    /* ignore */
  }
  return 'classic';
}

export const useShelf = create<ShelfState>()((set, get) => ({
  loaded: false,
  loadError: null,
  connected: false,
  allShelves: [],
  shelves: [],
  repos: [],
  secretRevealed: false,
  caseStyle: loadCaseStyle(),
  githubAvailable: false,
  githubLogin: null,
  staleAfterDays: 90,

  query: '',
  filter: 'all',
  activeShelfId: 'all',
  selectedRepoId: null,
  hoveredRepoId: null,
  drag: null,
  dialog: null,
  toasts: [],
  scrollRow: 0,
  rowOffsets: {},
  busy: false,
  zoom: 1,
  orbit: { yaw: 0, pitch: 0 },
  focus: null,
  themeId: loadThemeId(),
  pages: {},
  setPages: (repoId, pages) => set((st) => ({ pages: { ...st.pages, [repoId]: pages } })),
  timeline: null,
  rewindPlaying: false,
  setTimeline: (timeline) => set({ timeline }),
  startRewind: () => set({ rewindPlaying: true, selectedRepoId: null, timeline: 0 }),
  readOnly: staticData() !== null,
  instant: false,
  setInstant: (instant) => set({ instant }),

  async load() {
    const embedded = staticData();
    if (embedded) {
      get().applyState(staticState(embedded));
      set({ loaded: true, loadError: null, connected: true, pages: embedded.pages, readOnly: true });
      return;
    }
    try {
      const s = await api.state();
      get().applyState(s);
      set({ loaded: true, loadError: null });
    } catch (err) {
      set({ loaded: true, loadError: err instanceof Error ? err.message : String(err) });
    }
  },

  applyState(s) {
    const selected = get().selectedRepoId;
    if (!staticData()) set({ pages: {} });
    const visible = s.shelves.filter((sh) => !sh.hidden || get().secretRevealed);
    set({
      allShelves: s.shelves,
      shelves: visible,
      repos: s.repos,
      githubAvailable: s.github.available,
      githubLogin: s.github.login,
      staleAfterDays: s.config.staleAfterDays,
      selectedRepoId: selected && s.repos.some((r) => r.id === selected) ? selected : null,
      scrollRow: Math.min(get().scrollRow, Math.max(0, visible.length - 1)),
    });
  },

  mergeRepo(r) {
    set((st) => ({ repos: st.repos.map((x) => (x.id === r.id ? { ...x, ...r } : x)) }));
  },

  setQuery: (query) => set({ query }),
  setFilter: (filter) => set({ filter }),
  setActiveShelf: (activeShelfId) => set({ activeShelfId }),
  clearFilters: () => set({ query: '', filter: 'all', activeShelfId: 'all' }),
  select: (selectedRepoId) => set((st) => ({ selectedRepoId, hoveredRepoId: null, focus: selectedRepoId ? st.focus : null })),
  hover: (hoveredRepoId) => set({ hoveredRepoId }),

  startDrag: (repoId) => set({ drag: { repoId, overShelfId: null }, hoveredRepoId: null }),
  dragOver(shelfId) {
    const d = get().drag;
    if (d && d.overShelfId !== shelfId) set({ drag: { ...d, overShelfId: shelfId } });
  },
  endDrag(drop) {
    const d = get().drag;
    set({ drag: null });
    if (!d || !drop) return;
    const repo = get().repos.find((r) => r.id === d.repoId);
    if (!repo || !d.overShelfId || d.overShelfId === repo.shelfId) return;
    const target = get().allShelves.find((s) => s.id === d.overShelfId);
    if (!target) return;
    if (target.kind === 'github') {
      // Dropping a GitHub book on the other GitHub shelf flips its visibility.
      const vis = /private/i.test(target.label) ? 'private' : /public/i.test(target.label) ? 'public' : null;
      if (repo.virtual && repo.repoSlug && vis && vis !== repo.visibility) {
        set({ dialog: { kind: 'visibility', repoId: repo.id, targetShelfId: target.id, visibility: vis } });
      }
      return;
    }
    if (target.kind !== 'disk') return;
    if (repo.virtual) {
      set({ dialog: { kind: 'clone', repoId: repo.id, targetShelfId: target.id } });
      return;
    }
    set({ dialog: { kind: 'move', repoId: repo.id, targetShelfId: target.id } });
  },

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  toast(kind, text) {
    const id = toastSeq++;
    set((st) => ({ toasts: [...st.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 4000);
  },
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),

  setScrollRow(row) {
    const max = Math.max(0, get().shelves.length - 1);
    set({ scrollRow: Math.min(max, Math.max(0, row)) });
  },
  setRowOffset: (shelfId, offset) => set((st) => ({ rowOffsets: { ...st.rowOffsets, [shelfId]: offset } })),
  setBusy: (busy) => set({ busy }),
  setZoom: (z) => set({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) }),
  setOrbit: (yaw, pitch) => set({ orbit: { yaw, pitch } }),
  setFocus: (focus) => set({ focus }),
  resetView: () => set({ zoom: 1, orbit: { yaw: 0, pitch: 0 }, focus: null }),
  setTheme(id) {
    const t = themeById(id);
    saveThemeId(t.id);
    applyThemeCss(t);
    set({ themeId: t.id });
  },
  setCaseStyle(caseStyle) {
    try {
      localStorage.setItem('repo-shelf.case', caseStyle);
    } catch {
      /* ignore */
    }
    set({ caseStyle });
  },
  revealSecret() {
    if (get().secretRevealed) return;
    const all = get().allShelves;
    const hidden = all.filter((s) => s.hidden);
    set({ secretRevealed: true, shelves: all });
    if (hidden.length) {
      get().toast('info', `Secret shelf revealed: ${hidden.map((s) => s.label).join(', ')}`);
      const row = all.findIndex((s) => s.hidden);
      if (row >= 0) set({ scrollRow: row });
    }
  },

  async runAction(label, fn) {
    set({ busy: true });
    try {
      const r = await fn();
      if (r.state) get().applyState(r.state);
      get().toast('success', label);
      return true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      get().toast('error', msg);
      throw err;
    } finally {
      set({ busy: false });
    }
  },
}));

declare global {
  interface Window {
    __shelf?: typeof useShelf;
  }
}
if (typeof window !== 'undefined') window.__shelf = useShelf;

/** Repos that pass the current search / filter / shelf, in shelf order. */
export function selectVisibleRepos(st: ShelfState): Repo[] {
  const order = new Map(st.shelves.map((s, i) => [s.id, i]));
  return st.repos
    .filter((r) => matches(r, st.query, st.filter, st.activeShelfId, st.staleAfterDays))
    .sort((a, b) => (order.get(a.shelfId) ?? 0) - (order.get(b.shelfId) ?? 0) || a.name.localeCompare(b.name));
}

export function isFiltering(st: ShelfState): boolean {
  return st.query.trim() !== '' || st.filter !== 'all' || st.activeShelfId !== 'all';
}

/** Boot: load state, subscribe to SSE. Returns cleanup. */
export function connectStore(): () => void {
  const st = useShelf.getState();
  applyThemeCss(themeById(st.themeId));
  void st.load();
  if (staticData()) return () => undefined;
  return subscribeEvents({
    onRepoUpdate: (r) => useShelf.getState().mergeRepo(r),
    onStateChanged: () => void useShelf.getState().load(),
    onConnection: (connected) => useShelf.setState({ connected }),
  });
}
