import { useMemo } from 'react';
import { useShelf } from '../store';
import { rowOverflow } from '../scene/layout';

/**
 * Side arrows (‹ ›) that pan the current shelf row when it overflows the
 * bookcase. Rendered as a fixed overlay on the left/right edges of the scene
 * so they are always fully on screen — unlike the old in-scene 3D arrows,
 * which could end up clipped at the viewport edges when zoomed or orbited.
 */
export function PanArrows() {
  const scrollRow = useShelf((s) => s.scrollRow);
  const shelves = useShelf((s) => s.shelves);
  const repos = useShelf((s) => s.repos);
  const rowOffsets = useShelf((s) => s.rowOffsets);
  const panRow = useShelf((s) => s.panRow);

  const currentShelf = shelves[scrollRow];
  const currentRepos = useMemo(
    () => (currentShelf ? repos.filter((r) => r.shelfId === currentShelf.id) : []),
    [repos, currentShelf],
  );
  const panOverflow = useMemo(() => rowOverflow(currentRepos), [currentRepos]);
  const panOffset = rowOffsets[currentShelf?.id ?? ''] ?? 0;

  if (panOverflow <= 0) return null;

  const canPanLeft = panOffset > 0;
  const canPanRight = panOffset < panOverflow - 0.01;

  return (
    <div className="pan-arrows" role="group" aria-label="Scroll shelf">
      <button
        className="pan-arrow pan-left"
        onClick={() => panRow(-1)}
        disabled={!canPanLeft}
        aria-label="Scroll shelf left"
        title="Scroll shelf left (←)"
      >
        ‹
      </button>
      <button
        className="pan-arrow pan-right"
        onClick={() => panRow(1)}
        disabled={!canPanRight}
        aria-label="Scroll shelf right"
        title="Scroll shelf right (→)"
      >
        ›
      </button>
    </div>
  );
}
