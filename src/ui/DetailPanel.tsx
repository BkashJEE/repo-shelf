import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useShelf, selectVisibleRepos } from '../store';
import { api } from '../api';
import { bookColor, displayName, formatSize, isStale, languageOf, relativeTime } from '../derive';
import type { OpenTarget } from '../types';

export function DetailPanel() {
  const repo = useShelf((s) => s.repos.find((r) => r.id === s.selectedRepoId) ?? null);
  const shelves = useShelf((s) => s.shelves);
  const staleDays = useShelf((s) => s.staleAfterDays);
  const select = useShelf((s) => s.select);
  const openDialog = useShelf((s) => s.openDialog);
  const toast = useShelf((s) => s.toast);
  const visible = useShelf(useShallow(selectVisibleRepos));
  const dialogOpen = useShelf((s) => s.dialog !== null);

  useEffect(() => {
    if (!repo) return;
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') select(null);
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const githubLogin = useShelf((s) => s.githubLogin);
  if (!repo) return null;

  const idx = visible.findIndex((r) => r.id === repo.id);
  const step = (d: number) => {
    if (!visible.length) return;
    const next = visible[(idx + d + visible.length) % visible.length];
    select(next.id);
    const row = shelves.findIndex((s) => s.id === next.shelfId);
    if (row >= 0) useShelf.getState().setScrollRow(row);
  };

  const shelfIndex = shelves.findIndex((s) => s.id === repo.shelfId);
  const diskShelves = shelves.filter((s) => s.kind === 'disk');
  const explorerLabel = /Mac|iPhone/.test(navigator.platform) ? 'Finder' : /Win/.test(navigator.platform) ? 'Explorer' : 'Files';
  const shelf = shelves[shelfIndex];
  const lang = languageOf(repo);
  const stale = isStale(repo, staleDays);

  const ownsIt = Boolean(repo.owner && githubLogin && repo.owner.toLowerCase() === githubLogin.toLowerCase());
  const archive = (archived: boolean) => {
    void useShelf.getState().runAction(archived ? `Archived ${repo.name}` : `Unarchived ${repo.name}`, () => api.setArchived(repo.id, archived)).catch(() => undefined);
  };
  const open = (target: OpenTarget) => {
    api.open(repo.id, target).catch((e: Error) => toast('error', e.message));
  };
  const copyPath = () => {
    navigator.clipboard?.writeText(repo.virtual ? (repo.linkUrl ?? '') : repo.path).then(
      () => toast('info', 'Path copied'),
      () => toast('error', 'Could not copy'),
    );
  };

  return (
    <aside className="panel page" role="region" aria-label={`${repo.name} details`}>
      <div className="page-gutter" aria-hidden="true" />
      <button className="panel-close" onClick={() => select(null)} aria-label="Close">
        ×
      </button>
      <div className="panel-eyebrow">FROM SHELF {String(shelfIndex + 1).padStart(2, '0')} · {shelf?.label}</div>
      <div className="tags">
        {repo.virtual && <span className="tag tag-muted">{repo.repoSlug ? 'On GitHub' : 'Link'}</span>}
        <span className="tag" style={{ background: bookColor(lang) }}>
          {lang}
        </span>
        {repo.visibility === 'private' && <span className="tag tag-muted">🔒 Private</span>}
        {repo.visibility === 'public' && <span className="tag tag-muted">Public</span>}
        {repo.archived && <span className="tag tag-muted">Archived</span>}
        {repo.github?.isFork && <span className="tag tag-muted">Fork</span>}
        {repo.dirtyCount > 0 && <span className="tag tag-red">{repo.dirtyCount} uncommitted</span>}
        {stale && <span className="tag tag-muted">Stale</span>}
        {repo.error && <span className="tag tag-red">git error</span>}
      </div>
      <h2 className="panel-title">{displayName(repo.name)}</h2>
      <div className="panel-slug">{repo.repoSlug ?? repo.name}</div>
      <p className="panel-desc">
        {repo.github?.description ??
          (repo.virtual ? 'Not on your disk yet. Open it, or clone it onto one of your shelves.' : repo.repoSlug ? 'No description on GitHub.' : 'Local repo, no GitHub remote.')}
      </p>

      <button className="path" onClick={copyPath} title="Click to copy">
        {repo.virtual ? repo.linkUrl : repo.path}
      </button>

      {repo.virtual ? (
        <dl className="facts">
          <div>
            <dt>Stars</dt>
            <dd>{repo.github ? repo.github.stars.toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>Last push</dt>
            <dd title={repo.github?.pushedAt ?? ''}>{repo.github ? relativeTime(repo.github.pushedAt) : '—'}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{repo.owner ?? '—'}</dd>
          </div>
          <div className="span2">
            <dt>Topics</dt>
            <dd>{repo.github?.topics.length ? repo.github.topics.join(', ') : '—'}</dd>
          </div>
        </dl>
      ) : (
        <dl className="facts">
          <div>
            <dt>Branch</dt>
            <dd>{repo.branch ?? '—'}</dd>
          </div>
          <div>
            <dt>Last commit</dt>
            <dd title={repo.lastCommitAt ?? ''}>{relativeTime(repo.lastCommitAt)}</dd>
          </div>
          <div>
            <dt>Commits</dt>
            <dd>{repo.commitCount}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatSize(repo.sizeKB)}</dd>
          </div>
          <div>
            <dt>Stars</dt>
            <dd>{repo.github ? repo.github.stars.toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>Topics</dt>
            <dd>{repo.github?.topics.length ? repo.github.topics.join(', ') : '—'}</dd>
          </div>
        </dl>
      )}

      {repo.virtual ? (
        <div className="btn-row">
          <button className="btn primary" onClick={() => open('github')}>
            {repo.repoSlug ? 'View on GitHub ↗' : 'Open link ↗'}
          </button>
          {repo.remoteUrl && (
            <button className="btn" onClick={() => openDialog({ kind: 'clone', repoId: repo.id })} disabled={!diskShelves.length}>
              Clone to a shelf…
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="btn-row">
            <button className="btn primary" onClick={() => open('code')}>
              Open in VS Code
            </button>
            <button className="btn" onClick={() => open('terminal')}>
              Terminal
            </button>
            <button className="btn" onClick={() => open('explorer')}>
              {explorerLabel}
            </button>
            {(repo.github?.htmlUrl || repo.repoSlug) && (
              <button className="btn" onClick={() => open('github')}>
                View on GitHub ↗
              </button>
            )}
          </div>
          <div className="btn-row secondary">
            <button className="link" onClick={() => openDialog({ kind: 'move', repoId: repo.id })} disabled={diskShelves.length < 2}>
              Move…
            </button>
            <button className="link" onClick={() => openDialog({ kind: 'rename', repoId: repo.id })}>
              Rename…
            </button>
            <button className="link" onClick={() => openDialog({ kind: 'mkdir', repoId: repo.id })}>
              New folder…
            </button>
          </div>
        </>
      )}

      {repo.virtual && repo.repoSlug && (
        <div className="gh-manage">
          <div className="lbl">Manage on GitHub</div>
          {ownsIt ? (
            <div className="btn-row">
              <button
                className="btn"
                onClick={() => openDialog({ kind: 'visibility', repoId: repo.id, visibility: repo.visibility === 'private' ? 'public' : 'private' })}
              >
                {repo.visibility === 'private' ? 'Make public…' : 'Make private…'}
              </button>
              <button className="btn" onClick={() => archive(!repo.archived)}>
                {repo.archived ? 'Unarchive' : 'Archive'}
              </button>
              <button className="btn danger-outline" onClick={() => openDialog({ kind: 'delete', repoId: repo.id })}>
                Delete…
              </button>
            </div>
          ) : (
            <p className="modal-note">Owned by {repo.owner}. Only your own repos can be changed from here.</p>
          )}
        </div>
      )}

      <footer className="panel-foot">
        <span>
          {idx >= 0 ? idx + 1 : '–'} / {visible.length}
        </span>
        <span>
          <button className="nav" onClick={() => step(-1)} aria-label="Previous repo">
            ←
          </button>
          <button className="nav" onClick={() => step(1)} aria-label="Next repo">
            →
          </button>
        </span>
      </footer>
    </aside>
  );
}
