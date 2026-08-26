const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Ensure unhandled exceptions don't crash the desktop app silently
process.on('uncaughtException', (err) => {
  console.error('JUWEI WMS Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('JUWEI WMS Unhandled Rejection at:', promise, 'reason:', reason);
});

let mainWindow = null;
let serverStarted = false;

// Set safe writable data path for persistence (AppData / LocalAppData on Windows)
try {
  const userDataDir = app.getPath('userData');
  process.env.JUWEI_DATA_DIR = userDataDir;
} catch (e) {
  console.warn('Could not determine userData directory:', e);
}

function startEmbeddedServer() {
  if (serverStarted) return;
  try {
    process.env.NODE_ENV = 'production';
    const serverPath = path.join(__dirname, '../dist/server.cjs');
    if (fs.existsSync(serverPath)) {
      console.log('Starting JUWEI WMS Node Express & WebSocket Server from:', serverPath);
      require(serverPath);
      serverStarted = true;
    } else {
      console.warn('Embedded server bundle dist/server.cjs not found at:', serverPath);
    }
  } catch (err) {
    console.error('Error starting embedded JUWEI WMS server:', err);
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, '../public/favicon.ico');
  const windowOptions = {
    width: 1366,
    height: 868,
    minWidth: 1024,
    minHeight: 700,
    title: 'JUWEI WAREHOUSE MANAGEMENT SYSTEM',
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

  const isDev = process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL;

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // Start embedded Express & WebSocket real-time server
    startEmbeddedServer();

    let retries = 0;
    const maxRetries = 25;
    const loadApp = () => {
      mainWindow.loadURL('http://localhost:3000').catch((err) => {
        if (retries < maxRetries) {
          retries++;
          setTimeout(loadApp, 400);
        } else {
          console.warn('Could not connect to http://localhost:3000, loading fallback local HTML file:', err);
          const indexPath = path.join(__dirname, '../dist/index.html');
          if (fs.existsSync(indexPath)) {
            mainWindow.loadFile(indexPath).catch(loadErr => {
              console.error('Failed to load local HTML fallback:', loadErr);
            });
          } else {
            console.error('dist/index.html does not exist at path:', indexPath);
          }
        }
      });
    };

    setTimeout(loadApp, 200);
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
