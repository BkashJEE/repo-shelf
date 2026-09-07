import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Repo } from '../types';
import { useShelf } from '../store';
import { displayName, matches, relativeTime } from '../derive';
import { bookTextures, pageEdgeTexture, sideColor } from './textures';
import { BOOK_DEPTH, CLIP_X, rowAtY } from './layout';

interface Props {
  repo: Repo;
  x: number;
  y: number;
  width: number;
  height: number;
  plankY: number;
  /** When true (row overflows the shelf), the book is clipped at the shelf ends. */
  clip?: boolean;
}

const tmpV = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const DRAG_PLANE_Z = 2.4;

/**
 * World-space planes that hide any part of a book that sticks out past the
 * shelf ends. Defined once: three.js applies material clipping planes in
 * world space (the renderer must have `localClippingEnabled` set, see
 * Scene.tsx).
 */
const SHELF_END_PLANES = [
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), CLIP_X),
  new THREE.Plane(new THREE.Vector3(1, 0, 0), CLIP_X),
];

export function Book({ repo, x, y, width, height, plankY, clip = false }: Props) {
  const group = useRef<THREE.Group>(null);
  const [mats, setMats] = useState<THREE.MeshStandardMaterial[] | null>(null);
  const { camera, invalidate } = useThree();

  const staleDays = useShelf((s) => s.staleAfterDays);
  const hovered = useShelf((s) => s.hoveredRepoId === repo.id);
  const selected = useShelf((s) => s.selectedRepoId === repo.id);
  const anySelected = useShelf((s) => s.selectedRepoId !== null);
  const dragging = useShelf((s) => s.drag?.repoId === repo.id);
  const anyDragging = useShelf((s) => s.drag !== null);
  const query = useShelf((s) => s.query);
  const filter = useShelf((s) => s.filter);
  const activeShelfId = useShelf((s) => s.activeShelfId);
  const shelfCount = useShelf((s) => s.shelves.length);
  const shelves = useShelf((s) => s.shelves);
  const dimmed = !matches(repo, query, filter, activeShelfId, staleDays);
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    const { spine, cover } = bookTextures(repo, staleDays);
    const side = sideColor(repo, staleDays);
    const edge = pageEdgeTexture();
    const mk = (opts: THREE.MeshStandardMaterialParameters) =>
      new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.02, transparent: true, ...opts });
    const list = [
      mk({ map: cover }), // +x front cover
      mk({ map: edge, roughness: 0.98 }), // -x fore-edge (page stack)
      mk({ map: edge, roughness: 0.98 }), // +y top page edges
      mk({ map: edge, roughness: 0.98 }), // -y bottom page edges
      mk({ map: spine }), // +z spine (faces camera)
      mk({ color: side, roughness: 0.8 }), // -z back cover
    ];
    setMats(list);
    invalidate();
    return () => list.forEach((m) => m.dispose());
  }, [repo, staleDays, invalidate]);

  // Keep long rows inside the shelf: clip at the frame ends, except while the
  // book is being dragged or swung open (selected), when it legitimately
  // leaves the row plane. Toggling the planes changes the shader (clipping
  // defines), so each material needs a recompile.
  const clipRow = clip && !dragging && !selected;
  useEffect(() => {
    if (!mats) return;
    for (const m of mats) {
      m.clippingPlanes = clipRow ? SHELF_END_PLANES : null;
      m.needsUpdate = true;
    }
    invalidate();
  }, [mats, clipRow, invalidate]);

  const pressRef = useRef<{ x: number; y: number; id: number } | null>(null);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pressRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    (e.target as HTMLElement | undefined)?.setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pressRef.current;
      if (!p || useShelf.getState().drag) return;
      if (!repo.virtual && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= 8) {
        useShelf.getState().startDrag(repo.id);
        invalidate();
      }
    };
    const up = () => {
      const p = pressRef.current;
      pressRef.current = null;
      const st = useShelf.getState();
      if (st.drag?.repoId === repo.id) {
        st.endDrag(true);
        invalidate();
        return;
      }
      if (p) {
        st.select(st.selectedRepoId === repo.id ? null : repo.id);
        invalidate();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [repo.id, invalidate]);

  // Animated targets
  const target = useRef({ x, y, z: 0, rot: 0, opacity: 1, scale: 1 });
  const current = useRef({ x, y, z: 0, rot: 0, opacity: 1, scale: 1 });

  useFrame((state, delta) => {
    const g = group.current;
    if (!g || !mats) return;
    const t = target.current;
    const c = current.current;

    if (dragging) {
      // follow pointer on a plane in front of the shelves
      tmpV.set(state.pointer.x, state.pointer.y, 0.5).unproject(camera);
      tmpDir.copy(tmpV).sub(camera.position).normalize();
      const dist = (DRAG_PLANE_Z - camera.position.z) / tmpDir.z;
      tmpV.copy(camera.position).addScaledVector(tmpDir, dist);
      t.x = tmpV.x;
      t.y = tmpV.y;
      t.z = DRAG_PLANE_Z;
      t.rot = 0;
      t.scale = 1.08;
      t.opacity = 0.95;
      const row = rowAtY(tmpV.y, shelfCount);
      const overShelf = row >= 0 ? shelves[row] : null;
      const over = overShelf && overShelf.kind === 'disk' ? overShelf.id : null;
      useShelf.getState().dragOver(over);
    } else {
      t.x = x;
      t.y = y;
      t.scale = 1;
      if (selected) {
        t.z = 1.25;
        t.rot = -Math.PI / 2;
        t.opacity = 1;
      } else if (dimmed) {
        t.z = -0.5;
        t.rot = 0;
        t.opacity = 0.15;
      } else if (hovered && !anyDragging) {
        t.z = 0.35;
        t.rot = 0;
        t.opacity = 1;
      } else {
        t.z = 0;
        t.rot = 0;
        t.opacity = anySelected ? 0.8 : 1;
      }
    }

    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * (dragging ? 22 : 9));
    c.x += (t.x - c.x) * k;
    c.y += (t.y - c.y) * k;
    c.z += (t.z - c.z) * k;
    c.rot += (t.rot - c.rot) * k;
    c.opacity += (t.opacity - c.opacity) * k;
    c.scale += (t.scale - c.scale) * k;

    // When selected, pivot around the spine's front edge so the cover swings out toward the camera.
    g.position.set(c.x, c.y, c.z);
    g.rotation.y = c.rot;
    g.scale.setScalar(c.scale);
    for (const m of mats) m.opacity = c.opacity;

    const settled =
      Math.abs(t.x - c.x) < 0.001 &&
      Math.abs(t.y - c.y) < 0.001 &&
      Math.abs(t.z - c.z) < 0.001 &&
      Math.abs(t.rot - c.rot) < 0.001 &&
      Math.abs(t.opacity - c.opacity) < 0.002 &&
      Math.abs(t.scale - c.scale) < 0.001;
    if (!settled || dragging) invalidate();
  });

  useEffect(() => {
    invalidate();
  }, [hovered, selected, dimmed, dragging, anySelected, anyDragging, x, y, invalidate]);

  useEffect(() => {
    document.body.style.cursor = dragging ? 'grabbing' : hovered ? 'pointer' : '';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hovered, dragging]);

  if (!mats) return null;

  const showTip = hovered && !selected && !anyDragging && !dimmed;

  return (
    <group ref={group} position={[x, y, 0]}>
      <mesh
        material={mats}
        castShadow
        receiveShadow
        onPointerOver={(e) => {
          e.stopPropagation();
          if (!useShelf.getState().drag) useShelf.getState().hover(repo.id);
        }}
        onPointerOut={() => {
          if (useShelf.getState().hoveredRepoId === repo.id) useShelf.getState().hover(null);
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          const st = useShelf.getState();
          st.setFocus({ x, y });
          st.setZoom(3.2);
          if (st.selectedRepoId !== repo.id) st.select(repo.id);
          invalidate();
        }}
        raycast={dragging ? () => null : undefined}
      >
        <boxGeometry args={[width, height, BOOK_DEPTH]} />
      </mesh>
      {showTip && (
        <Html position={[0, height / 2 + 0.25, BOOK_DEPTH / 2]} center zIndexRange={[40, 30]} style={{ pointerEvents: 'none' }}>
          <div className="tip">
            <strong>{displayName(repo.name)}</strong>
            <span>
              {repo.commitCount} commits · {relativeTime(repo.lastCommitAt)}
              {repo.dirtyCount ? ` · ${repo.dirtyCount} uncommitted` : ''}
            </span>
          </div>
        </Html>
      )}
      {repo.error && !dimmed && (
        <Html position={[0, -height / 2 + 0.2, BOOK_DEPTH / 2]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <span className="warn-dot" title="git could not read this repo" />
        </Html>
      )}
      {/* invisible pad above the plank keeps hover stable between books */}
      <mesh position={[0, -(height / 2) + (plankY - y) + height / 2, 0]} visible={false}>
        <boxGeometry args={[0.001, 0.001, 0.001]} />
      </mesh>
    </group>
  );
}
