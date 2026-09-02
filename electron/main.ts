/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { registerAuthIpc } from './ipc/auth';
import { registerProductsIpc } from './ipc/products';
import { registerInventoryIpc } from './ipc/inventory';
import { registerSalesIpc } from './ipc/sales';
import { registerSyncIpc } from './ipc/sync';

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 850,
    title: 'JUWEI WMS Desktop Client',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:3000');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  registerAuthIpc(ipcMain);
  registerProductsIpc(ipcMain);
  registerInventoryIpc(ipcMain);
  registerSalesIpc(ipcMain);
  registerSyncIpc(ipcMain);

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
