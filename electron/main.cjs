const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Authoritative Central Production Server URL (Single Production Configuration)
const CENTRAL_SERVER_URL = process.env.CENTRAL_SERVER_URL || process.env.VITE_CENTRAL_SERVER_URL || 'https://ais-pre-vmhtsbs5lyqg4e3o5qf35l-327128958892.asia-southeast1.run.app';

// Ensure unhandled exceptions don't crash the desktop app silently
process.on('uncaughtException', (err) => {
  console.error('JUWEI WMS Desktop Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('JUWEI WMS Desktop Unhandled Rejection at:', promise, 'reason:', reason);
});

let mainWindow = null;

// Set safe writable data path for persistence (AppData / LocalAppData on Windows)
try {
  const userDataDir = app.getPath('userData');
  process.env.JUWEI_DATA_DIR = userDataDir;
} catch (e) {
  console.warn('Could not determine userData directory:', e);
}

function createWindow() {
  const iconPath = path.join(__dirname, '../public/favicon.ico');
  const windowOptions = {
    width: 1366,
    height: 868,
    minWidth: 1024,
    minHeight: 700,
    title: 'JUWEI WAREHOUSE MANAGEMENT SYSTEM (CENTRAL CLOUD CONNECTED)',
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

// IPC handler for system printing or native actions
ipcMain.handle('print-document', async () => {
  if (mainWindow) {
    mainWindow.webContents.print({ silent: false, printBackground: true });
    return true;
  }
  return false;
});
