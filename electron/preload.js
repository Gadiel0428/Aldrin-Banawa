const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  printDocument: () => ipcRenderer.invoke('print-document'),
  getAppVersion: () => '1.0.0'
});
