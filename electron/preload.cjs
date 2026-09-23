const { contextBridge, ipcRenderer } = require('electron');

const CENTRAL_SERVER_URL = process.env.CENTRAL_SERVER_URL || process.env.VITE_CENTRAL_SERVER_URL || 'https://aldrin-banawa.onrender.com';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  centralServerUrl: CENTRAL_SERVER_URL,
  printDocument: () => ipcRenderer.invoke('print-document'),
  getAppVersion: () => '1.0.0'
});
