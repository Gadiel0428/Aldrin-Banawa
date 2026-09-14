const { contextBridge, ipcRenderer } = require('electron');

const CENTRAL_SERVER_URL = process.env.CENTRAL_SERVER_URL || process.env.VITE_CENTRAL_SERVER_URL || 'https://ais-pre-vmhtsbs5lyqg4e3o5qf35l-327128958892.asia-southeast1.run.app';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  centralServerUrl: CENTRAL_SERVER_URL,
  printDocument: () => ipcRenderer.invoke('print-document'),
  getAppVersion: () => '1.0.0'
});
