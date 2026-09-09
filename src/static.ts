import type { AppState, Repo, RepoPages, Shelf } from './types';

/** Data embedded in a published shelf page (see server/publish.ts). Present only on static sites. */
export interface StaticShelfData {
  owner: string | null;
  title: string;
  generatedAt: string;
  sourceUrl: string;
  shelves: Shelf[];
  repos: Repo[];
  pages: Record<string, RepoPages>;
}

declare global {
  interface Window {
    __SHELF_STATIC?: StaticShelfData;
  }
}

export function staticData(): StaticShelfData | null {
  return typeof window !== 'undefined' && window.__SHELF_STATIC ? window.__SHELF_STATIC : null;
}

export function isStaticSite(): boolean {
  return staticData() !== null;
}

export function staticState(d: StaticShelfData): AppState {
  return {
    shelves: d.shelves,
    repos: d.repos,
    github: { available: false, login: d.owner },
    config: { staleAfterDays: 90 },
  };
}
