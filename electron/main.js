import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

let mainWindow = null;
let serverStarted = false;

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
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
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
    // In production desktop EXE build, start embedded Express & WebSocket real-time server
    startEmbeddedServer();

    // Load from local HTTP server so WebSockets and HTTP routes connect natively to localhost:3000
    let retries = 0;
    const loadApp = () => {
      mainWindow.loadURL('http://localhost:3000').catch((err) => {
        if (retries < 6) {
          retries++;
          setTimeout(loadApp, 400);
        } else {
          console.warn('Could not connect to http://localhost:3000, loading fallback local HTML file:', err);
          const indexPath = path.join(__dirname, '../dist/index.html');
          mainWindow.loadFile(indexPath);
        }
      });
    };

    setTimeout(loadApp, 300);
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
