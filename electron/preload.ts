/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getSyncStatus: () => ipcRenderer.invoke('sync:get-status'),
  flushSyncQueue: (items: any[]) => ipcRenderer.invoke('sync:flush-queue', items),
  getAuthSession: () => ipcRenderer.invoke('auth:get-session'),
});
