const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

function readServerConfigUrl() {
  const candidates = [
    path.join(__dirname, '../public/server-config.json'),
    path.join(__dirname, '../dist/server-config.json'),
  ];
  for (const cfgPath of candidates) {
    try {
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const url = parsed?.centralServerUrl || (parsed?.centralServerHost ? `http://${parsed.centralServerHost}` : '');
        if (url && typeof url === 'string') {
          return url.trim().replace(/\/+$/, '');
        }
      }
    } catch (e) {}
  }
  return '';
}

const CENTRAL_SERVER_URL = (process.env.CENTRAL_SERVER_URL || process.env.VITE_CENTRAL_SERVER_URL || readServerConfigUrl()).replace(/\/+$/, '');

let localVersion = '';
try {
  localVersion = ipcRenderer.sendSync('get-local-version-sync') || '';
} catch (e) {}

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  centralServerUrl: CENTRAL_SERVER_URL,
  localVersion,
  updateAppVersion: (version) => ipcRenderer.send('app-version-updated', version),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
