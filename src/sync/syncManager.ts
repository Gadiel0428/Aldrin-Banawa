/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SyncState, SyncStatusInfo } from '../types/sync';
import { OfflineQueue } from './offlineQueue';
import { createStockMovement, getDeviceId } from '../database/movements';
import { ConflictResolver } from './conflictResolver';

type StatusListener = (status: SyncStatusInfo) => void;

export class SyncManager {
  private static instance: SyncManager;
  private state: SyncState = 'ONLINE';
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isSyncing = false;
  private lastSyncTimestamp: number | null = Date.now();
  private listeners: Set<StatusListener> = new Set();
  private timer: any = null;
  private deviceId: string;

  private constructor() {
    this.deviceId = getDeviceId();
    this.initNetworkListeners();
    this.startPeriodicSync();
  }

  public static getInstance(): SyncManager {
    if (!this.instance) {
      this.instance = new SyncManager();
    }
    return this.instance;
  }

  private initNetworkListeners() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('🌐 Network online detected by SyncManager');
        this.isOnline = true;
        this.state = 'ONLINE';
        this.notify();
        this.syncPendingQueue();
      });

      window.addEventListener('offline', () => {
        console.log('⚠️ Network offline detected by SyncManager');
        this.isOnline = false;
        this.state = 'OFFLINE';
        this.notify();
      });
    }
  }

  private startPeriodicSync() {
    // Check every 15 seconds for pending queue items
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.isOnline && !this.isSyncing && OfflineQueue.getPendingCount() > 0) {
        this.syncPendingQueue();
      }
    }, 15000);
  }

  public subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const status = this.getStatus();
    this.listeners.forEach((fn) => {
      try {
        fn(status);
      } catch (err) {
        console.error('Error in sync listener:', err);
      }
    });
  }

  public getStatus(): SyncStatusInfo {
    return {
      state: this.state,
      isOnline: this.isOnline,
      pendingCount: OfflineQueue.getPendingCount(),
      lastSyncTimestamp: this.lastSyncTimestamp,
      deviceId: this.deviceId,
      activeProvider: this.isOnline ? 'SUPABASE' : 'LOCAL_OFFLINE',
    };
  }

  /**
   * Dispatches a transaction. If online, executes atomically. If offline or failed, enqueues to offline queue.
   */
  public async executeMovement(input: any): Promise<any> {
    const idempotencyKey = input.idempotencyKey || `IDEM-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const fullInput = {
      ...input,
      idempotencyKey,
      deviceId: this.deviceId,
    };

    if (!this.isOnline) {
      console.warn('Device offline: Queuing stock movement locally');
      const queueItem = OfflineQueue.enqueue('STOCK_MOVEMENT', fullInput, idempotencyKey);
      this.notify();
      return {
        success: true,
        queuedLocally: true,
        queueId: queueItem.id,
        idempotencyKey,
        delta: input.quantity,
      };
    }

    try {
      this.state = 'SYNCING';
      this.notify();
      const result = await createStockMovement(fullInput);
      this.state = 'ONLINE';
      this.lastSyncTimestamp = Date.now();
      this.notify();
      return result;
    } catch (err: any) {
      const conflict = ConflictResolver.handleMovementError(err);
      if (conflict.reason === 'INSUFFICIENT_STOCK') {
        this.state = 'ERROR';
        this.notify();
        throw new Error(conflict.message);
      }

      // If transient network or server error, enqueue offline for auto-retry
      console.warn('Network / Server error during atomic movement. Enqueuing for background retry:', err);
      const queueItem = OfflineQueue.enqueue('STOCK_MOVEMENT', fullInput, idempotencyKey);
      this.state = 'OFFLINE';
      this.notify();
      return {
        success: true,
        queuedLocally: true,
        queueId: queueItem.id,
        idempotencyKey,
        delta: input.quantity,
        note: 'Saved locally. Will sync when server is reachable.',
      };
    }
  }

  /**
   * Flushes and processes pending offline items
   */
  public async syncPendingQueue(): Promise<void> {
    if (this.isSyncing) return;
    const pending = OfflineQueue.getPending();
    if (pending.length === 0) return;

    this.isSyncing = true;
    this.state = 'SYNCING';
    this.notify();

    console.log(`🔄 SyncManager: Flushing ${pending.length} pending offline transactions...`);

    for (const item of pending) {
      OfflineQueue.updateStatus(item.id, 'SYNCING');
      try {
        if (item.type === 'STOCK_MOVEMENT') {
          await createStockMovement(item.payload as any);
        }
        OfflineQueue.updateStatus(item.id, 'COMPLETED');
        OfflineQueue.remove(item.id);
      } catch (err: any) {
        if (err.message && (err.message.includes('STALE_RESET_VERSION') || err.message.includes('hard reset'))) {
          console.warn('SyncManager: Detected stale reset version. Purging entire offline queue to prevent re-uploading old data.');
          OfflineQueue.purgeAll();
          break;
        }
        const conflict = ConflictResolver.handleMovementError(err);
        if (conflict.accepted) {
          // Idempotent hit, can safely drop
          OfflineQueue.remove(item.id);
        } else {
          console.error(`Failed to sync queued item ${item.id}:`, err);
          OfflineQueue.updateStatus(item.id, 'FAILED', err.message);
        }
      }
    }

    this.isSyncing = false;
    this.lastSyncTimestamp = Date.now();
    this.state = this.isOnline ? 'ONLINE' : 'OFFLINE';
    this.notify();
  }

  public forceSyncNow(): Promise<void> {
    return this.syncPendingQueue();
  }
}

export const syncManager = SyncManager.getInstance();
