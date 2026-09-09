import { useEffect, useRef, useState } from 'react';
import { useShelf } from '../store';
import { api } from '../api';
import { isStaticSite } from '../static';
import { bytesToDataUrl, downloadDataUrl, orbitGif, rewindGif, shelfiePng } from '../share/capture';

type Job = { label: string; done: number; total: number } | null;

export function ShareMenu() {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<Job>(null);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useShelf((s) => s.toast);
  const openDialog = useShelf((s) => s.openDialog);
  const startRewind = useShelf((s) => s.startRewind);
  const githubLogin = useShelf((s) => s.githubLogin);
  const readOnly = isStaticSite();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const stamp = () => new Date().toISOString().slice(0, 10);
  const who = githubLogin ? `${githubLogin}-` : '';

  const finish = async (dataUrl: string, name: string) => {
    downloadDataUrl(dataUrl, name);
    if (!readOnly) {
      try {
        const r = await api.saveShare(name, dataUrl);
        toast('success', `Saved ${name} to ${r.dir}`);
      } catch {
        toast('success', `Downloaded ${name}`);
      }
    } else toast('success', `Downloaded ${name}`);
  };

  const run = async (label: string, fn: (onProgress: (d: number, t: number) => void) => Promise<{ dataUrl: string; name: string }>) => {
    setOpen(false);
    setJob({ label, done: 0, total: 1 });
    try {
      const { dataUrl, name } = await fn((done, total) => setJob({ label, done, total }));
      await finish(dataUrl, name);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setJob(null);
    }
  };

  return (
    <div className="share-menu" ref={ref}>
      <button className="btn small" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title="Share your shelf">
        Share ▾
      </button>
      {job && (
        <span className="share-job" role="status">
          {job.label}… {job.total > 1 ? `${Math.round((job.done / job.total) * 100)}%` : ''}
        </span>
      )}
      {open && (
        <div className="theme-menu share-list" role="menu">
          <button className="theme-opt" role="menuitem" onClick={() => run('Shelfie', async () => ({ dataUrl: await shelfiePng(1600), name: `${who}repo-shelf-${stamp()}.png` }))}>
            <span className="theme-text">
              <b>Shelfie (PNG)</b>
              <small>This view, captioned with your stats. 1600px wide.</small>
            </span>
          </button>
          <button
            className="theme-opt"
            role="menuitem"
            onClick={() =>
              run('Orbit GIF', async (p) => ({ dataUrl: await bytesToDataUrl(await orbitGif({ onProgress: p }), 'image/gif'), name: `${who}repo-shelf-orbit-${stamp()}.gif` }))
            }
          >
            <span className="theme-text">
              <b>Orbit GIF</b>
              <small>The camera sweeps around your bookcase. ~3 s loop, 720px.</small>
            </span>
          </button>
          <button
            className="theme-opt"
            role="menuitem"
            onClick={() =>
              run('Rewind GIF', async (p) => ({ dataUrl: await bytesToDataUrl(await rewindGif({ onProgress: p }), 'image/gif'), name: `${who}repo-shelf-rewind-${stamp()}.gif` }))
            }
          >
            <span className="theme-text">
              <b>Rewind GIF</b>
              <small>Books land in the order you created them, year by year.</small>
            </span>
          </button>
          <button
            className="theme-opt"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              startRewind();
            }}
          >
            <span className="theme-text">
              <b>Play rewind here</b>
              <small>Watch it on screen without exporting.</small>
            </span>
          </button>
          {!readOnly && (
            <>
              <div className="theme-section">Publish</div>
              <button
                className="theme-opt"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  openDialog({ kind: 'publish' });
                }}
              >
                <span className="theme-text">
                  <b>Publish my shelf…</b>
                  <small>A 3D library site of your public repos on GitHub Pages, with a link to share.</small>
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
