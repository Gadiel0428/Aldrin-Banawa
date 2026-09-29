const { app, BrowserWindow, shell, ipcMain, net } = require('electron');
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

// Helper to format window title with live version
function getFormattedWindowTitle(ver) {
  const v = ver ? String(ver).replace(/^v/i, '').trim() : '';
  return v 
    ? `JUWEI WAREHOUSE MANAGEMENT SYSTEM v${v} (CENTRAL CLOUD CONNECTED)`
    : 'JUWEI WAREHOUSE MANAGEMENT SYSTEM (CENTRAL CLOUD CONNECTED)';
}

function setElectronWindowTitle(ver) {
  if (!mainWindow) return;
  if (ver) {
    currentAppVersion = String(ver).replace(/^v/i, '').trim();
  }
  const title = getFormattedWindowTitle(currentAppVersion);
  if (mainWindow.getTitle() !== title) {
    mainWindow.setTitle(title);
  }
}

// Queries authoritative /api/build-info to reflect live GitHub release version
async function fetchVersionAndUpdateWindowTitle() {
  if (!mainWindow) return;
  try {
    const targetUrl = (CENTRAL_SERVER_URL || 'http://192.168.20.214:3000').replace(/\/+$/, '');
    const apiUrl = `${targetUrl}/api/build-info`;
    const response = await net.fetch(apiUrl, { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (data && data.version) {
        setElectronWindowTitle(data.version);
      }
    }
  } catch (err) {
    // quiet fallback
  }
}

// Set safe writable data path for persistence (AppData / LocalAppData on Windows)
try {
  const userDataDir = app.getPath('userData');
  process.env.JUWEI_DATA_DIR = userDataDir;
} catch (e) {
  console.warn('Could not determine userData directory:', e);
}

function createWindow() {
  const iconPath = path.join(__dirname, '../public/favicon.ico');

  let appVersion = '';
  try {
    const buildInfoPaths = [
      path.join(__dirname, '../dist/build-info.json'),
      path.join(__dirname, '../public/build-info.json'),
      path.join(__dirname, 'dist/build-info.json'),
    ];
    for (const bip of buildInfoPaths) {
      if (fs.existsSync(bip)) {
        const bInfo = JSON.parse(fs.readFileSync(bip, 'utf8'));
        if (bInfo && bInfo.version) {
          appVersion = bInfo.version;
          break;
        }
      }
    }
  } catch (e) {}

  if (!appVersion) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
      if (pkg.version) appVersion = pkg.version;
    } catch (e) {}
  }

  const windowTitle = appVersion 
    ? `JUWEI WAREHOUSE MANAGEMENT SYSTEM v${appVersion} (CENTRAL CLOUD CONNECTED)`
    : 'JUWEI WAREHOUSE MANAGEMENT SYSTEM (CENTRAL CLOUD CONNECTED)';

  const windowOptions = {
    width: 1366,
    height: 868,
    minWidth: 1024,
    minHeight: 700,
    title: windowTitle,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
    autoHideMenuBar: false,
    backgroundColor: '#0f172a',
    show: false,
  };

  if (fs.existsSync(iconPath)) {
    windowOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowOptions);

  const isDev = process.env.NODE_ENV === 'development' && process.env.VITE_DEV_SERVER_URL;

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    console.log('[JUWEI WMS Desktop] Loading local development server:', process.env.VITE_DEV_SERVER_URL);
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // Installed Client Mode: Automatically connect to CENTRAL PRODUCTION SERVER
    // NEVER use localhost or local per-PC database for client synchronization!
    console.log('[JUWEI WMS Desktop] Connecting to Central Production Server:', CENTRAL_SERVER_URL);
    
    let retries = 0;
    const maxRetries = 10;
    const loadCentralApp = () => {
      mainWindow.loadURL(CENTRAL_SERVER_URL).catch((err) => {
        console.warn(`[JUWEI WMS Desktop] Connection to Central Server attempt ${retries + 1}/${maxRetries} failed:`, err.message);
        if (retries < maxRetries) {
          retries++;
          setTimeout(loadCentralApp, 1500);
        } else {
          console.warn('[JUWEI WMS Desktop] Loading offline fallback local interface...');
          const indexPath = path.join(__dirname, '../dist/index.html');
          if (fs.existsSync(indexPath)) {
            mainWindow.loadFile(indexPath).catch(loadErr => {
              console.error('[JUWEI WMS Desktop] Failed to load local HTML fallback:', loadErr);
            });
          } else {
            console.error('[JUWEI WMS Desktop] dist/index.html does not exist at path:', indexPath);
          }
        }
      });
    };

    loadCentralApp();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Handle external links safely in system default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Intercept document.title changes to keep window title in sync with live version
  mainWindow.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    if (title) {
      const match = title.match(/v(\d+\.\d+\.\d+[\w.-]*)/i);
      if (match && match[1]) {
        currentAppVersion = match[1];
      }
      const formattedTitle = title.includes('(CENTRAL CLOUD CONNECTED)')
        ? title
        : `${title} (CENTRAL CLOUD CONNECTED)`;
      mainWindow.setTitle(formattedTitle);
    }
  });

  // Sync version from /api/build-info after web page loads
  mainWindow.webContents.on('did-finish-load', () => {
    fetchVersionAndUpdateWindowTitle();
  });

  // Periodically query /api/build-info to update window title if a new GitHub release is pushed
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


// IPC listener to update window title immediately when renderer detects a new version
ipcMain.on('app-version-updated', (event, version) => {
  if (version) {
    setElectronWindowTitle(version);
  }
});

// IPC handler to return the current known app version
ipcMain.handle('get-app-version', () => {
  return currentAppVersion || '';
});

