import type { AppState, OpenTarget, Repo } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(route: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(route, init);
  } catch (err) {
    throw new ApiError(0, 'network', 'Cannot reach the repo shelf server. Is it running?');
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const e = (body ?? {}) as { error?: string; code?: string };
    throw new ApiError(res.status, e.code ?? 'http_error', e.error ?? `Request failed (${res.status}).`);
  }
  return body as T;
}

function post<T>(route: string, payload: unknown): Promise<T> {
  return request<T>(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
}

export interface ActionResponse {
  ok: true;
  state: AppState;
  newPath?: string;
  created?: string;
  newRemoteUrl?: string | null;
}

export const api = {
  state: () => request<AppState>('/api/state'),
  rescan: (shelfId?: string) => post<{ shelves: AppState['shelves']; repos: Repo[] }>('/api/rescan', { shelfId }),
  move: (repoId: string, targetShelfId: string, force = false) =>
    post<ActionResponse>('/api/repo/move', { repoId, targetShelfId, force }),
  rename: (repoId: string, newName: string, alsoGitHub = false) =>
    post<ActionResponse>('/api/repo/rename', { repoId, newName, alsoGitHub }),
  mkdir: (repoId: string, relDir: string, gitkeep = false) =>
    post<ActionResponse>('/api/repo/mkdir', { repoId, relDir, gitkeep }),
  open: (repoId: string, target: OpenTarget) => post<{ ok: true }>('/api/repo/open', { repoId, target }),
  clone: (repoId: string, targetShelfId: string) => post<ActionResponse>('/api/repo/clone', { repoId, targetShelfId }),
  setVisibility: (repoId: string, visibility: 'public' | 'private') =>
    post<ActionResponse>('/api/repo/visibility', { repoId, visibility }),
  setArchived: (repoId: string, archived: boolean) => post<ActionResponse>('/api/repo/archive', { repoId, archived }),
  deleteOnGitHub: (repoId: string, confirmName: string) => post<ActionResponse>('/api/repo/delete', { repoId, confirmName }),
  addShelf: (label: string, path: string) => post<AppState>('/api/shelves', { label, path }),
  removeShelf: (id: string) => request<AppState>(`/api/shelves/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export interface EventHandlers {
  onRepoUpdate: (repo: Repo) => void;
  onStateChanged: () => void;
  onConnection: (connected: boolean) => void;
}

/** Subscribe to server events. Returns an unsubscribe function. */
export function subscribeEvents(h: EventHandlers): () => void {
  const es = new EventSource('/api/events');
  es.addEventListener('open', () => h.onConnection(true));
  es.addEventListener('error', () => h.onConnection(false));
  es.addEventListener('repo:update', (ev) => {
    try {
      h.onRepoUpdate(JSON.parse((ev as MessageEvent).data) as Repo);
    } catch {
      /* ignore malformed */
    }
  });
  es.addEventListener('state:changed', () => h.onStateChanged());
  return () => es.close();
}
