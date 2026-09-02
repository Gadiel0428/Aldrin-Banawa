/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function registerInventoryIpc(ipcMain: any) {
  ipcMain.handle('inventory:fetch', async () => {
    return [];
  });
}
