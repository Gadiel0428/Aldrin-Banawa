/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function registerProductsIpc(ipcMain: any) {
  ipcMain.handle('products:fetch', async () => {
    return [];
  });
}
