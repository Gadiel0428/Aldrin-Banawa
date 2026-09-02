/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function registerSalesIpc(ipcMain: any) {
  ipcMain.handle('sales:create', async (_event: any, payload: any) => {
    return { success: true, payload };
  });
}
