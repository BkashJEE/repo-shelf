export interface Theme {
  id: string;
  name: string;
  description: string;
  /** UI palette, applied as CSS variables. */
  ui: {
    page: string;
    paper: string;
    ink: string;
    muted: string;
    line: string;
    accent: string;
    accentInk: string;
    red: string;
  };
  /** 3D scene colors. */
  scene: {
    background: string;
    frame: string;
    plank: string;
    lip: string;
    /** Back panel radial gradient: center, mid, edge. */
    back: [string, string, string];
    plate: string;
    plateInk: string;
  };
  dark: boolean;
}

export const THEMES: Theme[] = [
  {
    id: 'slate',
    name: 'Slate',
    description: 'Clean white workspace, navy accents, walnut shelves',
    ui: {
      page: '#f7f8fa',
      paper: '#ffffff',
      ink: '#141a23',
      muted: '#68717d',
      line: '#e3e6eb',
      accent: '#1f3a5f',
      accentInk: '#ffffff',
      red: '#b3362b',
    },
    scene: {
      background: '#f7f8fa',
      frame: '#3d2a1e',
      plank: '#6d4c35',
      lip: '#241710',
      back: ['#4a3123', '#33211a', '#1c110b'],
      plate: '#1d1611',
      plateInk: '#e8dcc8',
    },
    dark: false,
  },
  {
    id: 'library',
    name: 'Library',
    description: 'Warm cream paper and classic walnut',
    ui: {
      page: '#f6f4ee',
      paper: '#fbfaf6',
      ink: '#1d1c19',
      muted: '#7a776f',
      line: '#e4e0d6',
      accent: '#3f5f4a',
      accentInk: '#f6f4ee',
      red: '#b43a2e',
    },
    scene: {
      background: '#f6f4ee',
      frame: '#8a5c38',
      plank: '#a97a52',
      lip: '#2f1a0f',
      back: ['#5a3521', '#3d2315', '#22120a'],
      plate: '#2a1a10',
      plateInk: '#e9dcc6',
    },
    dark: false,
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Dark interface, charcoal shelves, spines glow',
    ui: {
      page: '#0f1217',
      paper: '#171b22',
      ink: '#e8ebf0',
      muted: '#8b94a3',
      line: '#262c36',
      accent: '#7aa2ff',
      accentInk: '#0b1020',
      red: '#e06c5d',
    },
    scene: {
      background: '#0f1217',
      frame: '#20242b',
      plank: '#2c313a',
      lip: '#0a0c10',
      back: ['#262b34', '#1a1e25', '#0c0e12'],
      plate: '#0b0d11',
      plateInk: '#c9d1dc',
    },
    dark: true,
  },
  {
    id: 'nordic',
    name: 'Nordic',
    description: 'Pale birch shelves on a cool gray page',
    ui: {
      page: '#f3f4f2',
      paper: '#ffffff',
      ink: '#1c2024',
      muted: '#6b7176',
      line: '#e0e3e2',
      accent: '#2f6f6b',
      accentInk: '#ffffff',
      red: '#b8412f',
    },
    scene: {
      background: '#f3f4f2',
      frame: '#c8b79a',
      plank: '#d9c9ac',
      lip: '#8a7a5e',
      back: ['#e7dcc6', '#d4c6aa', '#b9a888'],
      plate: '#3a332a',
      plateInk: '#f1ebdf',
    },
    dark: false,
  },
  {
    id: 'ink',
    name: 'Ink',
    description: 'Black lacquer shelves, high contrast, gallery feel',
    ui: {
      page: '#ffffff',
      paper: '#ffffff',
      ink: '#000000',
      muted: '#5f5f5f',
      line: '#e6e6e6',
      accent: '#000000',
      accentInk: '#ffffff',
      red: '#c0392b',
    },
    scene: {
      background: '#ffffff',
      frame: '#141414',
      plank: '#1f1f1f',
      lip: '#000000',
      back: ['#2a2a2a', '#1a1a1a', '#0a0a0a'],
      plate: '#000000',
      plateInk: '#f2f2f2',
    },
    dark: false,
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Deep green room, dark oak shelves',
    ui: {
      page: '#0f1a15',
      paper: '#162319',
      ink: '#e7efe9',
      muted: '#8fa697',
      line: '#24352b',
      accent: '#7fd1a1',
      accentInk: '#0b1a12',
      red: '#e7776a',
    },
    scene: {
      background: '#0f1a15',
      frame: '#3a2a1c',
      plank: '#5a4230',
      lip: '#1a120c',
      back: ['#2f3f34', '#1f2c25', '#101915'],
      plate: '#0b120e',
      plateInk: '#d6e5db',
    },
    dark: true,
  },
];

export const DEFAULT_THEME = 'slate';

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function applyThemeCss(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  const u = theme.ui;
  root.style.setProperty('--page', u.page);
  root.style.setProperty('--paper', u.paper);
  root.style.setProperty('--ink', u.ink);
  root.style.setProperty('--muted', u.muted);
  root.style.setProperty('--line', u.line);
  root.style.setProperty('--accent', u.accent);
  root.style.setProperty('--accent-ink', u.accentInk);
  root.style.setProperty('--red', u.red);
}

const KEY = 'repo-shelf.theme';

export function loadThemeId(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && THEMES.some((t) => t.id === v)) return v;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_THEME;
}

export function saveThemeId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}
