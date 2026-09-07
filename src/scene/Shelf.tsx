import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import type { Repo, Shelf as ShelfT } from '../types';
import { useShelf } from '../store';
import { Book } from './Book';
import { layoutRow, plankTopY, PLANK_T, ROW_H, SHELF_W, SIDE_PAD, USABLE_W, BOOK_DEPTH } from './layout';
import { backPanelTexture, woodTexture } from './textures';
import { themeById } from '../themes';

interface Props {
  shelf: ShelfT;
  row: number;
  repos: Repo[];
}

export function ShelfRow({ shelf, row, repos }: Props) {
  const plankY = plankTopY(row);
  const { slots, totalWidth } = useMemo(() => layoutRow(repos), [repos]);
  const dragOver = useShelf((s) => s.drag?.overShelfId === shelf.id);
  const dragging = useShelf((s) => s.drag !== null);
  const offset = useShelf((s) => s.rowOffsets[shelf.id] ?? 0);
  const overflow = Math.max(0, totalWidth - USABLE_W);
  const startX = -SHELF_W / 2 + SIDE_PAD - Math.min(offset, overflow);
  const theme = useShelf((s) => themeById(s.themeId));
  const caseStyle = useShelf((s) => s.caseStyle);
  const plankT = caseStyle === 'modern' ? PLANK_T * 0.55 : PLANK_T;
  const wood = woodTexture();
  const back = backPanelTexture(theme);
  const rowTop = plankY + ROW_H - PLANK_T;
  const rowMidY = (plankY + rowTop) / 2;

  const clipRow = overflow > 0;

  return (
    <group>
      {/* back panel */}
      {caseStyle === 'classic' && (
        <mesh position={[0, rowMidY, -BOOK_DEPTH / 2 - 0.1]} receiveShadow>
          <planeGeometry args={[SHELF_W, ROW_H - PLANK_T]} />
          <meshStandardMaterial map={back} roughness={0.95} color={dragOver ? '#c9a27a' : '#ffffff'} />
        </mesh>
      )}
      {/* plank */}
      <mesh position={[0, plankY - plankT / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[SHELF_W, plankT, BOOK_DEPTH + 0.4]} />
        <meshStandardMaterial map={wood} roughness={0.7} color={dragOver ? '#e0c49a' : theme.scene.plank} />
      </mesh>
      {/* plank front lip */}
      <mesh position={[0, plankY - plankT / 2, BOOK_DEPTH / 2 + 0.2]}>
        <boxGeometry args={[SHELF_W, plankT + 0.02, 0.02]} />
        <meshStandardMaterial color={theme.scene.lip} roughness={0.6} />
      </mesh>
      {/* soft contact shadow where the books meet the plank */}
      <mesh position={[0, plankY + 0.002, -0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[SHELF_W, BOOK_DEPTH + 0.2]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      {/* drop highlight */}
      {dragging && (
        <mesh position={[0, rowMidY, -BOOK_DEPTH / 2 - 0.05]}>
          <planeGeometry args={[SHELF_W - 0.2, ROW_H - PLANK_T - 0.2]} />
          <meshBasicMaterial color={dragOver ? '#f0d9a8' : '#ffffff'} transparent opacity={dragOver ? 0.18 : 0.04} />
        </mesh>
      )}

      {slots.map((slot) => (
        <Book
          key={slot.repo.id}
          repo={slot.repo}
          x={startX + slot.x}
          y={plankY + slot.height / 2}
          width={slot.width}
          height={slot.height}
          plankY={plankY}
          clip={clipRow}
        />
      ))}

      <Html position={[0, plankY - plankT / 2, BOOK_DEPTH / 2 + 0.22]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`plate ${dragOver ? 'plate-active' : ''}`} style={{ background: theme.scene.plate, color: theme.scene.plateInk }}>
          Shelf {String(row + 1).padStart(2, '0')} · {shelf.label} · {repos.length} {repos.length === 1 ? (shelf.kind === 'links' ? 'link' : 'repo') : shelf.kind === 'links' ? 'links' : 'repos'}
        </div>
      </Html>
    </group>
  );
}
