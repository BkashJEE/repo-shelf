import { useEffect, useRef } from 'react';
import { useShelf } from '../store';

const DURATION_MS = 7000;

/** Drives the on-screen rewind: moves the timeline cursor from the first repo to today and shows the year. */
export function RewindOverlay() {
  const playing = useShelf((s) => s.rewindPlaying);
  const timeline = useShelf((s) => s.timeline);
  const repos = useShelf((s) => s.repos);
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const dates = repos.map((r) => (r.createdAt ? new Date(r.createdAt).getTime() : NaN)).filter((t) => Number.isFinite(t));
    if (!dates.length) {
      useShelf.getState().toast('error', 'No creation dates yet. Rescan once so git can report first commits.');
      useShelf.setState({ rewindPlaying: false, timeline: null });
      return;
    }
    const start = Math.min(...dates) - 24 * 3600 * 1000;
    const end = Date.now();
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 2);
      useShelf.getState().setTimeline(start + (end - start) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else {
        setTimeout(() => useShelf.setState({ rewindPlaying: false, timeline: null }), 1800);
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, repos]);

  if (!playing || timeline === null) return null;
  const count = repos.filter((r) => r.createdAt && new Date(r.createdAt).getTime() <= timeline).length;
  return (
    <div className="rewind" aria-live="polite">
      <div className="rewind-year">{new Date(timeline).getFullYear()}</div>
      <div className="rewind-count">
        {count} {count === 1 ? 'repo' : 'repos'}
      </div>
    </div>
  );
}
