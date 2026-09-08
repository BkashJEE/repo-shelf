import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useShelf } from '../store';
import { api } from '../api';
import { relativeTime } from '../derive';
import type { Repo, RepoPages } from '../types';

export type Chapter = 'readme' | 'commits' | 'issues' | 'pulls' | 'files' | 'branches';

export const CHAPTERS: { id: Chapter; label: string }[] = [
  { id: 'readme', label: 'README' },
  { id: 'commits', label: 'Commits' },
  { id: 'issues', label: 'Issues' },
  { id: 'pulls', label: 'Pull requests' },
  { id: 'files', label: 'Files' },
  { id: 'branches', label: 'Branches' },
];

marked.setOptions({ gfm: true, breaks: false });

function renderMarkdown(md: string, base: string | null): string {
  const html = marked.parse(md, { async: false }) as string;
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] });
  // Resolve relative links/images against the GitHub page when we know it.
  if (!base) return clean;
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (!/^(https?:|mailto:|#)/.test(href)) a.setAttribute('href', `${base}/blob/HEAD/${href.replace(/^\.?\//, '')}`);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });
  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (!/^https?:/.test(src)) img.setAttribute('src', `${base}/raw/HEAD/${src.replace(/^\.?\//, '')}`);
  });
  return doc.body.innerHTML;
}

export function BookPages({ repo, chapter, onChapter }: { repo: Repo; chapter: Chapter; onChapter: (c: Chapter) => void }) {
  const cached = useShelf((s) => s.pages[repo.id]);
  const setPages = useShelf((s) => s.setPages);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    setError(null);
    api
      .pages(repo.id)
      .then((p) => alive && setPages(repo.id, p))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [repo.id, cached, setPages]);

  const base = repo.github?.htmlUrl ?? (repo.repoSlug ? `https://github.com/${repo.repoSlug}` : null);
  const readmeHtml = useMemo(() => (cached?.readme ? renderMarkdown(cached.readme, base) : ''), [cached?.readme, base]);

  const idx = CHAPTERS.findIndex((c) => c.id === chapter);
  const flip = (d: number) => onChapter(CHAPTERS[(idx + d + CHAPTERS.length) % CHAPTERS.length].id);
  const count = (c: Chapter): number | null => {
    if (!cached) return null;
    if (c === 'readme') return null;
    return cached[c].length;
  };

  return (
    <div className="book-right">
      <nav className="chapters" aria-label="Chapters">
        {CHAPTERS.map((c) => (
          <button key={c.id} className={`chapter ${chapter === c.id ? 'on' : ''}`} onClick={() => onChapter(c.id)}>
            {c.label}
            {count(c.id) !== null && <em>{count(c.id)}</em>}
          </button>
        ))}
      </nav>

      <div className="page-body">
        {error && <p className="modal-note bad">Could not load: {error}</p>}
        {!cached && !error && <p className="page-empty">Turning the page…</p>}
        {cached && chapter === 'readme' && (readmeHtml ? <article className="readme" dangerouslySetInnerHTML={{ __html: readmeHtml }} /> : <p className="page-empty">No README in this repo.</p>)}
        {cached && chapter === 'commits' && (
          <ul className="plist">
            {cached.commits.length === 0 && <li className="page-empty">No commits yet.</li>}
            {cached.commits.map((c) => (
              <li key={c.sha}>
                <code className="sha">{c.sha.slice(0, 7)}</code>
                <span className="ptitle">{c.message}</span>
                <small>
                  {c.author} · {relativeTime(c.date)}
                </small>
              </li>
            ))}
          </ul>
        )}
        {cached && (chapter === 'issues' || chapter === 'pulls') && (
          <ul className="plist">
            {cached[chapter].length === 0 && (
              <li className="page-empty">
                {repo.repoSlug ? `No open ${chapter === 'issues' ? 'issues' : 'pull requests'}.` : 'Local repo without a GitHub remote.'}
              </li>
            )}
            {cached[chapter].map((i) => (
              <li key={i.number}>
                <a href={i.url} target="_blank" rel="noopener" className="ptitle">
                  #{i.number} {i.title}
                </a>
                <small>
                  {i.draft ? 'draft · ' : ''}
                  {i.author} · {relativeTime(i.updatedAt)}
                  {i.labels.length ? ` · ${i.labels.join(', ')}` : ''}
                </small>
              </li>
            ))}
          </ul>
        )}
        {cached && chapter === 'files' && (
          <ul className="plist files">
            {cached.files.length === 0 && <li className="page-empty">Nothing listed.</li>}
            {cached.files.map((f) => (
              <li key={f.name}>
                <span className={`ficon ${f.type}`} aria-hidden="true" />
                <span className="ptitle">{f.name}</span>
              </li>
            ))}
          </ul>
        )}
        {cached && chapter === 'branches' && (
          <ul className="plist">
            {cached.branches.length === 0 && <li className="page-empty">No branches.</li>}
            {cached.branches.map((b) => (
              <li key={b}>
                <span className="ptitle">{b === repo.branch ? <b>{b}</b> : b}</span>
                {b === repo.branch && <small>current</small>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="page-foot">
        <button className="nav" onClick={() => flip(-1)} aria-label="Previous page">
          ‹
        </button>
        <span>
          {idx + 1} / {CHAPTERS.length}
          {cached?.source === 'github' ? ' · from GitHub' : cached?.source === 'disk' ? ' · from disk' : ''}
        </span>
        <button className="nav" onClick={() => flip(1)} aria-label="Next page">
          ›
        </button>
      </footer>
    </div>
  );
}

export type { RepoPages };
