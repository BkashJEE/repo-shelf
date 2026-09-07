import { useShelf } from '../store';

export function ViewControls() {
  const zoom = useShelf((s) => s.zoom);
  const setZoom = useShelf((s) => s.setZoom);
  const resetView = useShelf((s) => s.resetView);
  const orbit = useShelf((s) => s.orbit);
  const scrollRow = useShelf((s) => s.scrollRow);
  const setScrollRow = useShelf((s) => s.setScrollRow);
  const shelfCount = useShelf((s) => s.shelves.length);

  const isDefault = Math.abs(zoom - 1) < 0.01 && orbit.yaw === 0 && orbit.pitch === 0;

  return (
    <div className="viewctl" role="group" aria-label="View controls">
      <button onClick={() => setZoom(zoom / 1.3)} aria-label="Zoom out" title="Zoom out to see every shelf  (−, ctrl+wheel)">
        −
      </button>
      <button className="zoom-val" onClick={resetView} disabled={isDefault} title="Reset view  (0, double-click wood)">
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => setZoom(zoom * 1.3)} aria-label="Zoom in" title="Zoom in  (+, ctrl+wheel)">
        +
      </button>
      <span className="viewctl-sep" />
      <button onClick={() => setScrollRow(scrollRow - 1)} disabled={scrollRow <= 0} aria-label="Previous shelf" title="Previous shelf (↑)">
        ↑
      </button>
      <button className="zoom-val" disabled title="Current shelf">
        {shelfCount ? `${scrollRow + 1}/${shelfCount}` : '–'}
      </button>
      <button onClick={() => setScrollRow(scrollRow + 1)} disabled={scrollRow >= shelfCount - 1} aria-label="Next shelf" title="Next shelf (↓)">
        ↓
      </button>
      <span className="viewctl-hint">drag wood to orbit · pinch or ctrl+wheel to zoom · double-click a book to frame it · ← → pans a long shelf</span>
    </div>
  );
}
