const { app, BrowserWindow, shell, ipcMain, net, session } = require('electron');
const path = require('path');
const fs = require('fs');

// Authoritative Central Production Server URL (Warehouse Local Server Host)
const CENTRAL_SERVER_URL = process.env.CENTRAL_SERVER_URL || process.env.VITE_CENTRAL_SERVER_URL || 'http://192.168.20.214:3000';

// Ensure unhandled exceptions don't crash the desktop app silently
process.on('uncaughtException', (err) => {
  console.error('JUWEI WMS Desktop Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('JUWEI WMS Desktop Unhandled Rejection at:', promise, 'reason:', reason);
});

let mainWindow = null;
let currentAppVersion = '';
let loadedFromLocalBundle = false;

function normalizeVersion(ver) {
  return ver ? String(ver).replace(/^v/i, '').trim() : '';
}

function compareSemver(a, b) {
  const cleanA = normalizeVersion(a);
  const cleanB = normalizeVersion(b);
  if (!cleanA && !cleanB) return 0;
  if (!cleanA) return -1;
  if (!cleanB) return 1;

  const pa = cleanA.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? parseInt(part, 10) : 0));
  const pb = cleanB.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? parseInt(part, 10) : 0));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function getLocalInstalledVersion() {
  const candidates = [];

  try {
    if (app && typeof app.getVersion === 'function') {
      const v = normalizeVersion(app.getVersion());
      if (v && v !== '0.0.0') {
        candidates.push(v);
      }
    }
  } catch (e) {}

  try {
    const buildInfoPaths = [
      path.join(__dirname, '../dist/build-info.json'),
      path.join(__dirname, '../public/build-info.json'),
      path.join(__dirname, 'dist/build-info.json'),
      path.join(__dirname, '../package.json'),
    ];
    for (const bip of buildInfoPaths) {
      if (fs.existsSync(bip)) {
        const bInfo = JSON.parse(fs.readFileSync(bip, 'utf8'));
        const v = normalizeVersion(bInfo && bInfo.version);
        if (v && v !== '0.0.0') {
          candidates.push(v);
        }
      }
    }
  } catch (e) {}

  if (candidates.length === 0) return '';
  candidates.sort((a, b) => compareSemver(b, a));
  return candidates[0];
}

// Helper to format window title with live version
function getFormattedWindowTitle(ver) {
  const v = normalizeVersion(ver);
  return v
    ? `JUWEI WAREHOUSE MANAGEMENT SYSTEM v${v} (WAREHOUSE SERVER)`
    : 'JUWEI WAREHOUSE MANAGEMENT SYSTEM (WAREHOUSE SERVER)';
}

function setElectronWindowTitle(ver) {
  if (!mainWindow) return;
  const localVer = getLocalInstalledVersion();
  const nextVer = normalizeVersion(ver);
  // Never downgrade displayed title version below the actually installed EXE version
  if (nextVer && (!localVer || compareSemver(nextVer, localVer) >= 0 || !loadedFromLocalBundle)) {
    currentAppVersion = nextVer;
  } else if (localVer && !currentAppVersion) {
    currentAppVersion = localVer;
  }
  const title = getFormattedWindowTitle(currentAppVersion || localVer);
  if (mainWindow.getTitle() !== title) {
    mainWindow.setTitle(title);
  }
}

async function fetchRemoteBuildInfo(timeoutMs = 2500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const targetUrl = (CENTRAL_SERVER_URL || 'http://192.168.20.214:3000').replace(/\/+$/, '');
    const apiUrl = `${targetUrl}/api/build-info`;
    const response = await net.fetch(apiUrl, { cache: 'no-store', signal: controller.signal });
    if (response.ok) {
      return await response.json();
    }
  } catch (err) {
    // Server offline or unreachable
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
}

// Queries authoritative /api/build-info without downgrading installed EXE version
async function fetchVersionAndUpdateWindowTitle() {
  if (!mainWindow) return;
  const localVer = getLocalInstalledVersion();
  const data = await fetchRemoteBuildInfo(3000);
  if (data) {
    const remoteBundleVer = normalizeVersion(data.bundleVersion || data.version);
    if (!loadedFromLocalBundle && remoteBundleVer) {
      setElectronWindowTitle(remoteBundleVer);
    } else if (localVer) {
      setElectronWindowTitle(localVer);
    }
  } else if (localVer && !currentAppVersion) {
    setElectronWindowTitle(localVer);
  }
}

// Set safe writable data path for persistence (AppData / LocalAppData on Windows)
try {
  const userDataDir = app.getPath('userData');
  process.env.JUWEI_DATA_DIR = userDataDir;
} catch (e) {
  console.warn('Could not determine userData directory:', e);
}

async function createWindow() {
  const iconPath = path.join(__dirname, '..', 'public', 'juwei-icon.ico');
  const fallbackIconPath = path.join(__dirname, '../public/favicon.ico');

  const appVersion = getLocalInstalledVersion();
  currentAppVersion = appVersion;

  const windowTitle = getFormattedWindowTitle(appVersion);

  const windowOptions = {
    width: 1366,
    height: 868,
    minWidth: 1024,
    minHeight: 700,
    title: windowTitle,
    icon: path.join(__dirname, '..', 'public', 'juwei-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: false,
    backgroundColor: '#0f172a',
    show: false,
  };

  if (!fs.existsSync(iconPath) && fs.existsSync(fallbackIconPath)) {
    windowOptions.icon = fallbackIconPath;
  }

  mainWindow = new BrowserWindow(windowOptions);

  const isDev = process.env.NODE_ENV === 'development' && process.env.VITE_DEV_SERVER_URL;

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    loadedFromLocalBundle = false;
    console.log('[JUWEI WMS Desktop] Loading local development server:', process.env.VITE_DEV_SERVER_URL);
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    const hasLocalDist = fs.existsSync(indexPath);

    // Check whether the central warehouse server has a strictly newer web bundle than this installed EXE.
    // If the installed GitHub EXE is newer or equal, ALWAYS run the local bundle so newly installed updates
    // take effect immediately while still syncing all database & WebSocket traffic to CENTRAL_SERVER_URL.
    const remoteInfo = await fetchRemoteBuildInfo(2500);
    const remoteBundleVer = normalizeVersion(remoteInfo && (remoteInfo.bundleVersion || remoteInfo.version));
    const serverHasNewerBundle = Boolean(
      remoteBundleVer && (!appVersion || compareSemver(remoteBundleVer, appVersion) > 0)
    );

    if (hasLocalDist && !serverHasNewerBundle) {
      loadedFromLocalBundle = true;
      console.log(
        `[JUWEI WMS Desktop] Loading newly installed local bundle (v${appVersion || 'unknown'}) connected to Central Server: ${CENTRAL_SERVER_URL}`
      );
      mainWindow.loadFile(indexPath).catch((loadErr) => {
        console.error('[JUWEI WMS Desktop] Failed to load local dist/index.html:', loadErr);
      });
    } else {
      loadedFromLocalBundle = false;
      console.log(
        `[JUWEI WMS Desktop] Connecting to Central Production Server (${CENTRAL_SERVER_URL}) [local=${appVersion || 'none'}, serverBundle=${remoteBundleVer || 'unknown'}]`
      );

      if (serverHasNewerBundle && session?.defaultSession) {
        try {
          await session.defaultSession.clearCache();
        } catch (e) {}
      }

      let retries = 0;
      const maxRetries = 6;
      const loadCentralApp = () => {
        if (!mainWindow) return;
        mainWindow.loadURL(CENTRAL_SERVER_URL).catch((err) => {
          console.warn(`[JUWEI WMS Desktop] Connection to Central Server attempt ${retries + 1}/${maxRetries} failed:`, err.message);
          if (retries < maxRetries) {
            retries++;
            setTimeout(loadCentralApp, 1500);
          } else if (hasLocalDist) {
            loadedFromLocalBundle = true;
            console.warn('[JUWEI WMS Desktop] Loading local dist/index.html fallback...');
            mainWindow.loadFile(indexPath).catch((loadErr) => {
              console.error('[JUWEI WMS Desktop] Failed to load local HTML fallback:', loadErr);
            });
          } else {
            console.error('[JUWEI WMS Desktop] dist/index.html does not exist at path:', indexPath);
          }
        });
      };

      loadCentralApp();
    }
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.maximize();
      mainWindow.show();
    }
  });

  // Handle external links safely in system default browser and allow blob: URLs in native window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && url.startsWith('blob:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1024,
          height: 800,
          autoHideMenuBar: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          }
        }
      };
    }
    if (url && (url.startsWith('https:') || url.startsWith('http:'))) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Intercept document.title changes to keep window title in sync with running version
  mainWindow.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    if (!mainWindow) return;
    const localVer = getLocalInstalledVersion();
    if (title) {
      const match = title.match(/v(\d+\.\d+\.\d+[\w.-]*)/i);
      const matchedVer = match && match[1] ? normalizeVersion(match[1]) : '';
      if (matchedVer && (!localVer || compareSemver(matchedVer, localVer) >= 0 || !loadedFromLocalBundle)) {
        currentAppVersion = matchedVer;
      }
      const effectiveTitle = (loadedFromLocalBundle && localVer && (!matchedVer || compareSemver(matchedVer, localVer) < 0))
        ? getFormattedWindowTitle(localVer)
        : (title.includes('(WAREHOUSE SERVER)') ? title : `${title} (WAREHOUSE SERVER)`);
      mainWindow.setTitle(effectiveTitle);
    }
  });

  // Sync version from /api/build-info after web page loads
  mainWindow.webContents.on('did-finish-load', () => {
    fetchVersionAndUpdateWindowTitle();
  });

  // Periodically query /api/build-info to update window title if needed
  const versionPollTimer = setInterval(() => {
    if (mainWindow) {
      fetchVersionAndUpdateWindowTitle();
    } else {
      clearInterval(versionPollTimer);
    }
  }, 30000);

  // Shortcut for opening devtools during troubleshooting (Ctrl+Shift+I or F12)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    clearInterval(versionPollTimer);
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Synchronous IPC so preload exposes installed EXE version before React first render
ipcMain.on('get-local-version-sync', (event) => {
  event.returnValue = getLocalInstalledVersion();
});

// IPC listener to update window title when renderer updates version
ipcMain.on('app-version-updated', (event, version) => {
  if (version) {
    setElectronWindowTitle(version);
  }
});

// IPC handler to return the actual installed desktop app version
ipcMain.handle('get-app-version', () => {
  return getLocalInstalledVersion() || currentAppVersion || '';
});

// IPC handler to safely launch external URLs in the system's default browser
ipcMain.handle('open-external', async (event, url) => {
  if (url && (typeof url === 'string') && (url.startsWith('https:') || url.startsWith('http:'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});
