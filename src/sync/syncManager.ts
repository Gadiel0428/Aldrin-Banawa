/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SyncStatusInfo } from '../types/sync';
import { CreateStockMovementInput, StockMovementResult } from '../types/movement';
import { createStockMovement } from '../database/movements';
import { OfflineQueue } from './offlineQueue';

type Listener = (status: SyncStatusInfo) => void;

class SyncManager {
  private listeners: Set<Listener> = new Set();
  private status: SyncStatusInfo = {
    state: typeof navigator !== 'undefined' && navigator.onLine ? 'ONLINE' : 'OFFLINE',
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingCount: 0,
    lastSyncTimestamp: Date.now(),
    deviceId: typeof window !== 'undefined' ? (localStorage.getItem('juwei_wms_station_id') || 'DEV-STATION') : 'DEV-STATION',
    activeProvider: 'SERVER_SOCKET',
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
      this.status.pendingCount = OfflineQueue.getAll().filter((i) => i.status === 'PENDING').length;
    }
  }

  private handleNetworkChange(online: boolean) {
    this.status.isOnline = online;
    this.status.state = online ? 'ONLINE' : 'OFFLINE';
    this.notify();
    if (online) {
      this.forceSyncNow().catch(() => {});
    }
  }

  public getStatus(): SyncStatusInfo {
    this.status.pendingCount = OfflineQueue.getAll().filter((i) => i.status === 'PENDING').length;
    return { ...this.status };
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.status.pendingCount = OfflineQueue.getAll().filter((i) => i.status === 'PENDING').length;
    const snap = { ...this.status };
    this.listeners.forEach((cb) => {
      try {
        cb(snap);
      } catch {}
    });
  }

  public async forceSyncNow(): Promise<void> {
    this.status.state = 'SYNCING';
    this.notify();
    try {
      const items = OfflineQueue.getAll().filter((i) => i.status === 'PENDING');
      for (const item of items) {
        if (item.type === 'STOCK_MOVEMENT') {
          try {
            OfflineQueue.updateStatus(item.id, 'SYNCING');
            const res = await createStockMovement(item.payload as CreateStockMovementInput);
            if (res.success) {
              OfflineQueue.updateStatus(item.id, 'COMPLETED');
            } else {
              OfflineQueue.updateStatus(item.id, 'FAILED', res.error);
            }
          } catch (e: any) {
            OfflineQueue.updateStatus(item.id, 'FAILED', e?.message || 'Sync failed');
          }
        }
      }
      this.status.state = 'ONLINE';
      this.status.lastSyncTimestamp = Date.now();
    } catch {
      this.status.state = 'ERROR';
    } finally {
      this.notify();
    }
  }

  public async executeMovement(input: CreateStockMovementInput): Promise<StockMovementResult> {
    try {
      const result = await createStockMovement(input);
      if (result.success) {
        this.status.lastSyncTimestamp = Date.now();
        this.notify();
        return result;
      }
      // If movement rejected due to business logic or error, throw error
      throw new Error(result.error || 'Stock movement rejected by central authority');
    } catch (err: any) {
      // If offline or network unreachable, queue offline
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        OfflineQueue.add({
          idempotencyKey: input.idempotencyKey || ('MOV-' + Date.now()),
          type: 'STOCK_MOVEMENT',
          payload: input,
          maxRetries: 5,
          deviceId: input.deviceId || this.status.deviceId,
        });
        this.notify();
        return {
          success: true,
          movementId: 'OFFLINE-' + Date.now(),
          productId: input.productId,
          warehouseId: input.warehouseId,
          previousQuantity: 0,
          newQuantity: input.quantity,
          delta: input.quantity,
          timestamp: new Date().toISOString(),
        };
      }
      throw err;
    }
  }
}

export const syncManager = new SyncManager();
