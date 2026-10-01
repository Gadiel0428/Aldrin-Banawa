const { contextBridge, ipcRenderer } = require('electron');

const CENTRAL_SERVER_URL = process.env.CENTRAL_SERVER_URL || process.env.VITE_CENTRAL_SERVER_URL || 'http://192.168.20.214:3000';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  centralServerUrl: CENTRAL_SERVER_URL,
  updateAppVersion: (version) => ipcRenderer.send('app-version-updated', version),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openGeneratedPDF: (pdfData, filename) => ipcRenderer.invoke('open-generated-pdf', { pdfData, filename })
});
