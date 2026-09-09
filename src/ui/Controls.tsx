import { useEffect, useRef } from 'react';
import { useShelf, selectVisibleRepos, isFiltering } from '../store';
import { languageCounts, type Filter } from '../derive';
import { staticData } from '../static';

export function Controls() {
  const query = useShelf((s) => s.query);
  const setQuery = useShelf((s) => s.setQuery);
  const filter = useShelf((s) => s.filter);
  const setFilter = useShelf((s) => s.setFilter);
  const activeShelfId = useShelf((s) => s.activeShelfId);
  const setActiveShelf = useShelf((s) => s.setActiveShelf);
  const shelves = useShelf((s) => s.shelves);
  const repos = useShelf((s) => s.repos);
  const clearFilters = useShelf((s) => s.clearFilters);
  const filtering = useShelf(isFiltering);
  const visibleCount = useShelf((s) => selectVisibleRepos(s).length);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !inField) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setQuery('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setQuery]);

  const langs = languageCounts(repos);
  const chips: { key: Filter; label: string; count?: number }[] = [
    { key: 'all', label: 'All repos', count: repos.length },
    ...langs.slice(0, 8).map((l) => ({ key: `lang:${l.language}` as Filter, label: l.language, count: l.count })),
    { key: 'remote', label: 'Has remote' },
    { key: 'dirty', label: 'Dirty' },
    { key: 'stale', label: 'Stale' },
    ...(repos.some((r) => r.visibility) ? ([{ key: 'public', label: 'Public' }, { key: 'private', label: 'Private' }] as const) : []),
    ...(repos.some((r) => r.archived) ? ([{ key: 'archived', label: 'Archived' }] as const) : []),
  ];

  return (
    <section className="controls">
      <div className="hero">
        <div>
          <div className="eyebrow">A COLLECTION, ONE REPO AT A TIME</div>
          <h1>{staticData()?.title ?? 'The repo shelf.'}</h1>
          <p className="sub">{staticData() ? 'Click any book to take a closer look. Drag the wood to orbit, scroll for shelves.' : 'Click any book to take a closer look. Drag a book to another shelf to move the repo.'}</p>
        </div>
        <div className="hero-stats">
          <div>
            <b>{repos.length}</b>
            <span>identified repos</span>
          </div>
          <div>
            <b>{shelves.length}</b>
            <span>shelves to explore</span>
          </div>
        </div>
      </div>

      <div className="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          placeholder="Find a repo, language, topic or path"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search repos"
        />
        <kbd>/</kbd>
        <select value={activeShelfId} onChange={(e) => setActiveShelf(e.target.value)} aria-label="Shelf">
          <option value="all">All shelves</option>
          {shelves.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="chips-row">
        <div className="chips">
          {chips.map((c) => (
            <button key={c.key} className={`chip ${filter === c.key ? 'on' : ''}`} onClick={() => setFilter(c.key)}>
              {c.label}
              {c.count !== undefined && <em>{c.count}</em>}
            </button>
          ))}
        </div>
        <div className="chips-meta">
          {filtering ? (
            <>
              <span>
                {visibleCount} {visibleCount === 1 ? 'repo' : 'repos'} found
              </span>
              <button className="link" onClick={clearFilters}>
                Clear filters ×
              </button>
            </>
          ) : (
            <span className="hint">Hover to browse · Click to open · Scroll for shelves · Drag wood to orbit</span>
          )}
        </div>
      </div>
    </section>
  );
}
