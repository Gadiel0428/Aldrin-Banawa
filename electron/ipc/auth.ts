/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function registerAuthIpc(ipcMain: any) {
  ipcMain.handle('auth:get-session', async () => {
    return { authenticated: true };
  });
}
