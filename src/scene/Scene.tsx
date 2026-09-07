import { Canvas } from '@react-three/fiber';
import { Bookcase } from './Bookcase';
import { CameraRig } from './CameraRig';
import { useShelf } from '../store';
import { themeById } from '../themes';

export function Scene() {
  const select = useShelf((s) => s.select);
  const endDrag = useShelf((s) => s.endDrag);
  const theme = useShelf((s) => themeById(s.themeId));
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      shadows
      camera={{ fov: 44, near: 0.1, far: 100, position: [0, 0, 12] }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onPointerMissed={(e) => {
        const el = e.target as HTMLElement | null;
        if (el?.dataset?.orbited) {
          delete el.dataset.orbited;
          return;
        }
        if (useShelf.getState().drag) {
          endDrag(false);
          return;
        }
        select(null);
      }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[theme.scene.background]} />
      <ambientLight intensity={theme.dark ? 0.7 : 0.55} />
      <hemisphereLight args={['#fff6e6', '#3a2a1e', 0.5]} />
      <directionalLight
        position={[5, 9, 10]}
        intensity={1.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={8}
        shadow-camera-bottom={-18}
        shadow-camera-near={1}
        shadow-camera-far={40}
      />
      <directionalLight position={[-7, 3, 6]} intensity={0.35} />
      <spotLight position={[0, 6, 14]} angle={0.9} penumbra={1} intensity={0.6} />
      <CameraRig />
      <Bookcase />
    </Canvas>
  );
}
