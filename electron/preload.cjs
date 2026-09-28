const { contextBridge, ipcRenderer } = require('electron');

const CENTRAL_SERVER_URL = process.env.CENTRAL_SERVER_URL || process.env.VITE_CENTRAL_SERVER_URL || 'https://aldrin-banawa.onrender.com';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  centralServerUrl: CENTRAL_SERVER_URL,
  printDocument: (customHtml) => ipcRenderer.invoke('print-document', customHtml),
  updateAppVersion: (version) => ipcRenderer.send('app-version-updated', version),
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
});
