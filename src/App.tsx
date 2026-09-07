import { useEffect } from 'react';
import { connectStore, useShelf } from './store';
import { Scene } from './scene/Scene';
import { Header } from './ui/Header';
import { Controls } from './ui/Controls';
import { DetailPanel } from './ui/DetailPanel';
import { Dialogs } from './ui/Dialogs';
import { Toasts } from './ui/Toasts';
import { ViewControls } from './ui/ViewControls';
import { PanArrows } from './ui/PanArrows';

export function App() {
  const loaded = useShelf((s) => s.loaded);
  const loadError = useShelf((s) => s.loadError);
  const shelves = useShelf((s) => s.shelves);
  const repos = useShelf((s) => s.repos);
  const busy = useShelf((s) => s.busy);
  const hasSelection = useShelf((s) => s.selectedRepoId !== null);

  useEffect(() => connectStore(), []);

  // Easter egg: typing "hermes" anywhere (outside inputs) reveals the hidden shelf.
  useEffect(() => {
    const word = 'hermes';
    let typed = '';
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      typed = (typed + e.key.toLowerCase()).slice(-word.length);
      if (typed === word) useShelf.getState().revealSecret();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app ${busy ? 'busy' : ''}`}>
      <Header />
      <Controls />
      <main className={`stage ${hasSelection ? 'with-page' : ''}`}>
        {loadError ? (
          <div className="empty">
            <h2>Cannot reach the server</h2>
            <p>{loadError}</p>
            <p>
              Start it with <code>npm run dev</code> in the repo-shelf folder.
            </p>
          </div>
        ) : loaded && shelves.length === 0 ? (
          <div className="empty">
            <h2>No shelves yet</h2>
            <p>Add a folder that contains git repos.</p>
            <button className="btn primary" onClick={() => useShelf.getState().openDialog({ kind: 'shelves' })}>
              Add a shelf
            </button>
          </div>
        ) : (
          <div className="scene-wrap">
            <Scene />
            <PanArrows />
            <ViewControls />
          </div>
        )}
        <DetailPanel />
        {/* visually hidden index: keyboard / screen-reader access to every book */}
        <ul id="book-index" className="sr-only" aria-label="All repos">
          {repos.map((r) => (
            <li key={r.id}>
              <button data-book={r.name} data-shelf={r.shelfId} onClick={() => useShelf.getState().select(r.id)}>
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      </main>
      <Dialogs />
      <Toasts />
    </div>
  );
}
