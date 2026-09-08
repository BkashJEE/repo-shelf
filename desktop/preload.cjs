const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  openShelf: () => ipcRenderer.send('door:open'),
  quit: () => ipcRenderer.send('door:quit'),
  minimize: () => ipcRenderer.send('shelf:minimize'),
  maximize: () => ipcRenderer.send('shelf:maximize'),
  close: () => ipcRenderer.send('shelf:close'),
  info: () => ipcRenderer.invoke('app:info'),
  onDoorState: (fn) => {
    ipcRenderer.on('door:state', (_e, state) => fn(state));
  },
});
