// repo shelf desktop: a library door that lives on your desktop and opens into the bookshelf.
// Plain CommonJS so Electron runs it without a build step.
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const IS_DEV = !app.isPackaged;
const DOOR_SIZE = { width: 240, height: 340 };
const SHELF_SIZE = { width: 1320, height: 860 };
const SHORTCUT = 'CommandOrControl+Shift+L';

let door = null;
let shelf = null;
let tray = null;
let serverPort = 0;
let serverHandle = null;

// Packaged GUI apps on macOS get a tiny PATH; git / gh / code live in these.
if (process.platform === 'darwin') {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', `${process.env.HOME}/.local/bin`];
  process.env.PATH = [...extra, process.env.PATH ?? ''].join(':');
}

function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function freePort(start) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(freePort(start + 1)));
    srv.listen(start, '127.0.0.1', () => {
      srv.close(() => resolve(start));
    });
  });
}

function waitFor(url, ms = 60_000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(url, (res) => {
          res.resume();
          res.statusCode && res.statusCode < 500 ? resolve() : retry();
        })
        .on('error', retry);
    };
    const retry = () => (Date.now() > deadline ? reject(new Error(`timeout waiting for ${url}`)) : setTimeout(tick, 250));
    tick();
  });
}

/** Start the API (and static UI) in-process from the esbuild bundle. */
async function startServer() {
  serverPort = await freePort(4877);
  console.log('[repo-shelf] starting server on port', serverPort);
  process.env.SHELF_PORT = String(serverPort);
  process.env.SHELF_ROOT = PROJECT_ROOT;
  process.env.SHELF_STATIC_DIST = path.join(PROJECT_ROOT, 'dist-static');
  process.env.NODE_ENV = 'production';
  if (app.isPackaged) {
    // Writable, per-user locations once installed.
    process.env.SHELF_CONFIG = process.env.SHELF_CONFIG ?? userFile('shelf.config.json');
    process.env.SHELF_CACHE = process.env.SHELF_CACHE ?? userFile('cache');
    process.env.SHELF_EXPORTS = process.env.SHELF_EXPORTS ?? path.join(app.getPath('pictures'), 'repo shelf');
  }
  const bundle = path.join(PROJECT_ROOT, 'dist', 'server.cjs');
  if (!fs.existsSync(bundle)) {
    throw new Error(`Server bundle missing at ${bundle}. Run "npm run build:desktop" first.`);
  }
  serverHandle = require(bundle);
  await waitFor(`http://127.0.0.1:${serverPort}/api/state`);
}

function appUrl() {
  // In development prefer the Vite dev server (hot reload) when it is up.
  return IS_DEV && process.env.SHELF_WEB_URL ? process.env.SHELF_WEB_URL : `http://127.0.0.1:${serverPort}/`;
}

function doorPosition() {
  const saved = readJson(userFile('door.json'), null);
  const { workArea } = screen.getPrimaryDisplay();
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const inside = saved.x >= workArea.x - 40 && saved.x <= workArea.x + workArea.width - 40 && saved.y >= workArea.y - 40 && saved.y <= workArea.y + workArea.height - 40;
    if (inside) return { x: saved.x, y: saved.y };
  }
  return { x: workArea.x + workArea.width - DOOR_SIZE.width - 24, y: workArea.y + workArea.height - DOOR_SIZE.height - 24 };
}

function createDoor() {
  if (door && !door.isDestroyed()) {
    door.show();
    return door;
  }
  const pos = doorPosition();
  door = new BrowserWindow({
    ...DOOR_SIZE,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    title: 'repo shelf',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  door.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  door.loadFile(path.join(__dirname, 'door.html'));
  door.on('moved', () => {
    const [x, y] = door.getPosition();
    writeJson(userFile('door.json'), { x, y });
  });
  door.on('closed', () => {
    door = null;
  });
  return door;
}

function createShelf() {
  if (shelf && !shelf.isDestroyed()) {
    shelf.show();
    shelf.focus();
    return shelf;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(SHELF_SIZE.width, workArea.width - 40);
  const height = Math.min(SHELF_SIZE.height, workArea.height - 40);
  shelf = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    minWidth: 720,
    minHeight: 520,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#f7f8fa',
    show: false,
    title: 'repo shelf',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  shelf.loadURL(appUrl());
  shelf.once('ready-to-show', () => shelf.show());
  // Links to GitHub etc. open in the real browser, never inside the widget.
  shelf.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  shelf.on('close', (e) => {
    // Closing the shelf just returns you to the door; quit from the tray.
    if (!app.isQuitting) {
      e.preventDefault();
      shelf.hide();
      showDoor('closing');
    }
  });
  shelf.on('closed', () => {
    shelf = null;
  });
  return shelf;
}

function showDoor(state) {
  const w = createDoor();
  w.show();
  if (state) w.webContents.send('door:state', state);
}

function openShelf() {
  createShelf();
  if (door && !door.isDestroyed()) {
    // Let the door finish its swing before it disappears behind the shelf.
    setTimeout(() => door && !door.isDestroyed() && door.hide(), 350);
  }
}

function toggle() {
  if (shelf && !shelf.isDestroyed() && shelf.isVisible()) {
    shelf.hide();
    showDoor('closing');
  } else {
    openShelf();
  }
}

function trayIcon() {
  // 16x16 spine-stack icon drawn as PNG data so no image assets are needed.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="6" width="6" height="20" rx="1" fill="#3f5f4a"/><rect x="12" y="4" width="6" height="22" rx="1" fill="#a3452f"/><rect x="20" y="8" width="7" height="18" rx="1" fill="#c9a227"/></svg>`;
  const img = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  return img.resize({ width: 18, height: 18 });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('repo shelf');
  const menu = Menu.buildFromTemplate([
    { label: 'Open the shelf', click: () => openShelf() },
    { label: 'Show the door', click: () => showDoor() },
    { type: 'separator' },
    { label: `Toggle shortcut: ${SHORTCUT.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl')}`, enabled: false },
    { label: 'Open in browser', click: () => shell.openExternal(appUrl()) },
    { type: 'separator' },
    {
      label: 'Quit repo shelf',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => toggle());
}

ipcMain.on('door:open', () => openShelf());
ipcMain.on('door:quit', () => {
  app.isQuitting = true;
  app.quit();
});
ipcMain.on('shelf:minimize', () => shelf && shelf.minimize());
ipcMain.on('shelf:close', () => {
  if (shelf) shelf.close();
});
ipcMain.on('shelf:maximize', () => {
  if (!shelf) return;
  shelf.isMaximized() ? shelf.unmaximize() : shelf.maximize();
});
ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), port: serverPort, dev: IS_DEV }));

const single = process.argv.includes('--capture') ? true : app.requestSingleInstanceLock();
if (!single) {
  console.log('[repo-shelf] already running, opening the shelf there');
  app.quit();
} else {
  app.on('second-instance', () => openShelf());
  app.whenReady().then(async () => {
    try {
      await startServer();
    } catch (err) {
      const msg = String(err && err.stack ? err.stack : err);
      console.error('[repo-shelf] could not start:', msg);
      if (!process.argv.includes('--capture')) {
        const { dialog } = require('electron');
        dialog.showErrorBox('repo shelf could not start', msg);
      }
      app.exit(1);
      return;
    }
    createTray();
    createDoor();
    globalShortcut.register(SHORTCUT, toggle);
    if (process.argv.includes('--open')) openShelf();
    // --capture <dir>: save PNGs of the door and the shelf, then quit (used for docs and smoke tests).
    const cap = process.argv.indexOf('--capture');
    if (cap > 0 && process.argv[cap + 1]) {
      const dir = process.argv[cap + 1];
      fs.mkdirSync(dir, { recursive: true });
      const snap = async (win, file) => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(dir, file), img.toPNG());
          console.log('[repo-shelf] captured', file);
        } catch (err) {
          console.error('[repo-shelf] capture of', file, 'failed:', String(err));
        }
      };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      setTimeout(async () => {
        await snap(door, 'desktop-door.png');
        door.webContents.send('door:state', 'open');
        await sleep(900);
        await snap(door, 'desktop-door-open.png');
        openShelf();
        shelf.webContents.on('console-message', (_e, level, msg) => console.log('[shelf console]', level, String(msg).slice(0, 200)));
        shelf.webContents.on('did-fail-load', (_e, code, desc, url) => console.log('[shelf] failed to load', code, desc, url));
        await sleep(12000);
        shelf.show();
        shelf.focus();
        await sleep(800);
        await snap(shelf, 'desktop-shelf.png');
        try {
          // capturePage cannot see GPU-composited WebGL on every platform; ask the page to render a frame for us.
          const dataUrl = await shelf.webContents.executeJavaScript('window.__r3f && window.__r3f.snapshot()');
          if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png')) {
            fs.writeFileSync(path.join(dir, 'desktop-scene.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
            const st = await shelf.webContents.executeJavaScript('(() => { const s = window.__shelf.getState(); return { repos: s.repos.length, shelves: s.shelves.length, plates: document.querySelectorAll(".plate").length }; })()');
            console.log('[repo-shelf] scene snapshot ok', JSON.stringify(st));
          } else console.log('[repo-shelf] scene snapshot unavailable');
        } catch (err) {
          console.error('[repo-shelf] scene snapshot failed:', String(err));
        }
        // --capture-open <book name>: open that book and screenshot the spread (proves the page content renders).
        const openIdx = process.argv.indexOf('--capture-open');
        if (openIdx > 0 && process.argv[openIdx + 1]) {
          const name = process.argv[openIdx + 1];
          try {
            const info = await shelf.webContents.executeJavaScript(`(async () => {
              const b = document.querySelector('#book-index button[data-book=${JSON.stringify(name)}]');
              if (!b) return 'book not found: ' + ${JSON.stringify(name)};
              b.click();
              for (let i = 0; i < 100; i++) {
                await new Promise((r) => setTimeout(r, 250));
                if (document.querySelector('.readme')) break;
              }
              await new Promise((r) => setTimeout(r, 800));
              return {
                title: document.querySelector('.panel-title')?.innerText,
                sections: [...document.querySelectorAll('.doc-toc .chapter')].map((c) => c.innerText),
                heading: document.querySelector('.doc-heading')?.innerText,
                excerpt: (document.querySelector('.readme')?.innerText || '').slice(0, 160),
                foot: document.querySelector('.page-foot span')?.innerText,
              };
            })()`);
            console.log('[repo-shelf] opened book', JSON.stringify(info));
            await sleep(600);
            await snap(shelf, 'desktop-book.png');
          } catch (err) {
            console.error('[repo-shelf] open book failed:', String(err));
          }
        }
        // --capture-exports: also run every Share export (shelfie, orbit, rewind) and wait for the toasts.
        if (process.argv.includes('--capture-exports')) {
          const runShare = (label) =>
            shelf.webContents.executeJavaScript(`(async () => {
              document.querySelector('.share-menu button').click();
              await new Promise((r) => setTimeout(r, 300));
              const btn = [...document.querySelectorAll('.share-list .theme-opt')].find((b) => b.textContent.includes(${JSON.stringify(label)}));
              if (!btn) return 'menu item missing';
              btn.click();
              let last = '';
              for (let i = 0; i < 180; i++) {
                await new Promise((r) => setTimeout(r, 1000));
                const t = document.querySelector('.toasts')?.innerText;
                if (t) last = t;
                if (!document.querySelector('.share-job') && i > 2) break;
              }
              return last || 'finished without toast';
            })()`);
          for (const label of ['Shelfie', 'Orbit GIF', 'Rewind GIF']) {
            try {
              console.log('[repo-shelf] export', label, '->', await runShare(label));
            } catch (err) {
              console.error('[repo-shelf] export', label, 'failed:', String(err));
            }
          }
        }
        console.log('[repo-shelf] capture done');
        app.isQuitting = true;
        app.quit();
        setTimeout(() => app.exit(0), 1500);
      }, 1500);
    }
  });
  app.on('window-all-closed', () => {
    /* keep running in the tray; the door comes back from the tray menu */
  });
  app.on('before-quit', () => {
    app.isQuitting = true;
    globalShortcut.unregisterAll();
    if (serverHandle && typeof serverHandle.close === 'function') serverHandle.close();
  });
  app.on('activate', () => showDoor());
}
