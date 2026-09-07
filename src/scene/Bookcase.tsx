import { useMemo } from 'react';
import { useShelf } from '../store';
import { ShelfRow } from './Shelf';
import { BOOK_DEPTH, FRAME_T, PLANK_T, ROW_H, SHELF_W, plankTopY } from './layout';
import { woodTexture } from './textures';
import { themeById } from '../themes';

export function Bookcase() {
  const shelves = useShelf((s) => s.shelves);
  const repos = useShelf((s) => s.repos);
  const byShelf = useMemo(() => {
    const m = new Map<string, typeof repos>();
    for (const s of shelves) m.set(s.id, []);
    for (const r of repos) m.get(r.shelfId)?.push(r);
    return m;
  }, [shelves, repos]);
  const wood = woodTexture();
  const theme = useShelf((s) => themeById(s.themeId));
  const caseStyle = useShelf((s) => s.caseStyle);
  const frame = theme.scene.frame;
  const ft = caseStyle === 'modern' ? FRAME_T * 0.4 : FRAME_T;

  const n = Math.max(1, shelves.length);
  const top = plankTopY(0) + ROW_H - PLANK_T + ft / 2;
  const bottom = plankTopY(n - 1) - PLANK_T - ft / 2;
  const height = top - bottom;
  const midY = (top + bottom) / 2;
  const depth = BOOK_DEPTH + 0.6;

  return (
    <group>
      {caseStyle !== 'floating' && (
        <>
          {/* side panels */}
          <mesh position={[-SHELF_W / 2 - ft / 2, midY, 0]} castShadow receiveShadow>
            <boxGeometry args={[ft, height, depth]} />
            <meshStandardMaterial map={wood} color={frame} roughness={0.7} />
          </mesh>
          <mesh position={[SHELF_W / 2 + ft / 2, midY, 0]} castShadow receiveShadow>
            <boxGeometry args={[ft, height, depth]} />
            <meshStandardMaterial map={wood} color={frame} roughness={0.7} />
          </mesh>
          {/* top and bottom */}
          <mesh position={[0, top - ft / 2, 0]} castShadow>
            <boxGeometry args={[SHELF_W + ft * 2, ft, depth]} />
            <meshStandardMaterial map={wood} color={frame} roughness={0.7} />
          </mesh>
          <mesh position={[0, bottom + ft / 2, 0]}>
            <boxGeometry args={[SHELF_W + ft * 2, ft, depth]} />
            <meshStandardMaterial map={wood} color={frame} roughness={0.7} />
          </mesh>
        </>
      )}
      {caseStyle === 'classic' && (
        <>
          {/* crown molding and plinth */}
          <mesh position={[0, top + 0.12, 0.1]} castShadow>
            <boxGeometry args={[SHELF_W + ft * 2 + 0.5, 0.24, depth + 0.3]} />
            <meshStandardMaterial map={wood} color={frame} roughness={0.65} />
          </mesh>
          <mesh position={[0, bottom - 0.14, 0.1]}>
            <boxGeometry args={[SHELF_W + ft * 2 + 0.4, 0.28, depth + 0.25]} />
            <meshStandardMaterial map={wood} color={frame} roughness={0.65} />
          </mesh>
        </>
      )}

      {shelves.map((s, i) => (
        <ShelfRow key={s.id} shelf={s} row={i} repos={byShelf.get(s.id) ?? []} />
      ))}
    </group>
  );
}
