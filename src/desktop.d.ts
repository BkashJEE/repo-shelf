/** Present only inside the Electron desktop widget (see desktop/preload.cjs). */
interface DesktopBridge {
  platform: NodeJS.Platform | string;
  openShelf: () => void;
  quit: () => void;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  info: () => Promise<{ platform: string; version: string; port: number; dev: boolean }>;
  onDoorState: (fn: (state: string) => void) => void;
}

interface Window {
  desktop?: DesktopBridge;
}
