import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useShelf, ZOOM_MAX, ZOOM_MIN } from '../store';
import { ROW_H, SHELF_W, rowCenterY } from './layout';

const FOV = 44;
const YAW_MAX = THREE.MathUtils.degToRad(40);
const PITCH_MIN = THREE.MathUtils.degToRad(-14);
const PITCH_MAX = THREE.MathUtils.degToRad(24);
const ORBIT_SPEED = 0.0045;

export function CameraRig() {
  const { camera, size, invalidate, gl } = useThree();
  const scrollRow = useShelf((s) => s.scrollRow);
  const zoom = useShelf((s) => s.zoom);
  const orbit = useShelf((s) => s.orbit);
  const focus = useShelf((s) => s.focus);
  const setScrollRow = useShelf((s) => s.setScrollRow);
  const shelfCount = useShelf((s) => s.shelves.length);
  const cur = useRef({ x: 0, y: rowCenterY(0), dist: 12, yaw: 0, pitch: 0 });
  const accum = useRef(0);

  // Wheel: plain = change shelf, ctrl (or trackpad pinch) = zoom.
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useShelf.getState();
      if (e.ctrlKey || e.metaKey) {
        st.setZoom(st.zoom * Math.exp(-e.deltaY * 0.0022));
        invalidate();
        return;
      }
      accum.current += e.deltaY;
      if (Math.abs(accum.current) > 60) {
        setScrollRow(st.scrollRow + Math.sign(accum.current));
        accum.current = 0;
      }
      invalidate();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [gl, setScrollRow, invalidate]);

  // Orbit: right-drag anywhere, or left-drag / one finger on empty wood (not on a book).
  // Pinch with two pointers zooms.
  useEffect(() => {
    const el = gl.domElement;
    let active: { x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart: { dist: number; zoom: number } | null = null;
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: useShelf.getState().zoom };
        active = null;
        return;
      }
      const st = useShelf.getState();
      if (e.button === 2 || (e.button === 0 && st.hoveredRepoId === null && !st.drag)) {
        active = { x: e.clientX, y: e.clientY, yaw: st.orbit.yaw, pitch: st.orbit.pitch, moved: false };
        el.setPointerCapture?.(e.pointerId);
      }
    };
    const move = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchStart && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart.dist > 0) useShelf.getState().setZoom((pinchStart.zoom * d) / pinchStart.dist);
        el.dataset.orbited = '1';
        invalidate();
        return;
      }
      if (!active) return;
      const dx = e.clientX - active.x;
      const dy = e.clientY - active.y;
      if (!active.moved && Math.hypot(dx, dy) < 4) return;
      active.moved = true;
      el.dataset.orbited = '1';
      useShelf.getState().setOrbit(active.yaw - dx * ORBIT_SPEED, active.pitch + dy * ORBIT_SPEED);
      gl.domElement.style.cursor = 'grabbing';
      invalidate();
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (!active) return;
      el.releasePointerCapture?.(e.pointerId);
      gl.domElement.style.cursor = '';
      active = null;
    };
    const ctx = (e: MouseEvent) => e.preventDefault();
    const dbl = () => {
      // double-click on empty wood resets the view
      if (useShelf.getState().hoveredRepoId === null) {
        useShelf.getState().resetView();
        invalidate();
      }
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', ctx);
    el.addEventListener('dblclick', dbl);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('contextmenu', ctx);
      el.removeEventListener('dblclick', dbl);
    };
  }, [gl, invalidate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = useShelf.getState();
      if (e.key === 'ArrowDown' || e.key === 'PageDown') setScrollRow(st.scrollRow + 1);
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') setScrollRow(st.scrollRow - 1);
      else if (e.key === 'ArrowRight') st.panRow(1);
      else if (e.key === 'ArrowLeft') st.panRow(-1);
      else if (e.key === '+' || e.key === '=') st.setZoom(st.zoom * 1.25);
      else if (e.key === '-' || e.key === '_') st.setZoom(st.zoom / 1.25);
      else if (e.key === '0') st.resetView();
      else return;
      e.preventDefault();
      invalidate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setScrollRow, invalidate]);

  useEffect(() => {
    invalidate();
  }, [scrollRow, size, shelfCount, zoom, orbit, focus, invalidate]);

  useFrame((state, delta) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== FOV) {
      cam.fov = FOV;
      cam.updateProjectionMatrix();
    }
    const aspect = size.width / Math.max(1, size.height);
    const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const zForWidth = (SHELF_W + 1.6) / (2 * halfTan * aspect);
    const zForHeight = (ROW_H * 1.5) / (2 * halfTan);
    const baseDist = THREE.MathUtils.clamp(Math.max(zForWidth, zForHeight), 8, 26);
    const targetDist = THREE.MathUtils.clamp(baseDist / zoom, 1.1, 90);

    // Look target: the current row. `focus` is reserved for an explicit "frame this book" action; selecting a book never moves the camera.
    const visibleRows = (2 * targetDist * halfTan) / ROW_H;
    let targetX = 0;
    let targetY = rowCenterY(scrollRow) + 0.1 - (visibleRows > 1.9 ? ROW_H * 0.45 : 0);
    // Zoomed out: blend the look target toward the middle of the whole bookcase so every shelf fits.
    if (zoom < 1 && shelfCount > 1) {
      const caseMid = (rowCenterY(0) + rowCenterY(shelfCount - 1)) / 2;
      const t = THREE.MathUtils.clamp((1 - zoom) / 0.5, 0, 1);
      targetY = THREE.MathUtils.lerp(targetY, caseMid, t);
    }
    if (focus) {
      const halfW = targetDist * halfTan * aspect;
      targetX = THREE.MathUtils.clamp(focus.x, -SHELF_W / 2, SHELF_W / 2);
      targetY = focus.y;
    }

    // Orbit plus a gentle mouse parallax on top.
    const targetYaw = THREE.MathUtils.clamp(orbit.yaw, -YAW_MAX, YAW_MAX) + state.pointer.x * 0.06;
    const targetPitch = THREE.MathUtils.clamp(orbit.pitch, PITCH_MIN, PITCH_MAX) + state.pointer.y * 0.03 + 0.05;

    const c = cur.current;
    const k = 1 - Math.exp(-delta * 7);
    c.x += (targetX - c.x) * k;
    c.y += (targetY - c.y) * k;
    c.dist += (targetDist - c.dist) * k;
    c.yaw += (targetYaw - c.yaw) * k;
    c.pitch += (targetPitch - c.pitch) * k;

    const cp = Math.cos(c.pitch);
    cam.position.set(c.x + Math.sin(c.yaw) * c.dist * cp, c.y + Math.sin(c.pitch) * c.dist, Math.cos(c.yaw) * c.dist * cp);
    cam.lookAt(c.x, c.y, 0);

    const settled =
      Math.abs(targetX - c.x) < 0.002 &&
      Math.abs(targetY - c.y) < 0.002 &&
      Math.abs(targetDist - c.dist) < 0.002 &&
      Math.abs(targetYaw - c.yaw) < 0.0005 &&
      Math.abs(targetPitch - c.pitch) < 0.0005;
    if (!settled) invalidate();
  });

  return null;
}

export { ZOOM_MIN, ZOOM_MAX };
