/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { OfflineQueueItem, QueueItemStatus } from '../types/sync';
import { getDeviceId } from '../database/movements';

const STORAGE_KEY = 'juwei_wms_offline_queue_v1';

export class OfflineQueue {
  private static items: OfflineQueueItem[] = [];
  private static loaded = false;

  private static load() {
    if (this.loaded) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.items = JSON.parse(raw);
      }
    } catch (e) {
      console.error('Failed to load offline queue from storage:', e);
      this.items = [];
    }
    this.loaded = true;
  }

  private static save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch (e) {
      console.error('Failed to save offline queue:', e);
    }
  }

  public static enqueue(
    type: OfflineQueueItem['type'],
    payload: any,
    customIdempotencyKey?: string
  ): OfflineQueueItem {
    this.load();
    const id = `Q-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const idempotencyKey = customIdempotencyKey || `IDEM-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const deviceId = getDeviceId();

    const item: OfflineQueueItem = {
      id,
      idempotencyKey,
      type,
      payload: {
        ...payload,
        idempotencyKey,
        deviceId,
      },
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: 5,
      status: 'PENDING',
      deviceId,
    };

    this.items.push(item);
    this.save();
    return item;
  }

  public static getPending(): OfflineQueueItem[] {
    this.load();
    return this.items.filter((i) => i.status === 'PENDING' || i.status === 'FAILED');
  }

  public static getAll(): OfflineQueueItem[] {
    this.load();
    return [...this.items];
  }

  public static updateStatus(id: string, status: QueueItemStatus, error?: string) {
    this.load();
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.status = status;
      if (error) {
        item.lastError = error;
        item.retryCount = (item.retryCount || 0) + 1;
      }
      this.save();
    }
  }

  public static remove(id: string) {
    this.load();
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
  }

  public static clearCompleted() {
    this.load();
    this.items = this.items.filter((i) => i.status !== 'COMPLETED');
    this.save();
  }

  public static getPendingCount(): number {
    this.load();
    return this.items.filter((i) => i.status === 'PENDING' || i.status === 'FAILED').length;
  }

  public static purgeAll() {
    this.items = [];
    this.loaded = true;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  public static pruneOutdatedResetVersions(currentResetVersion: number) {
    this.load();
    if (!currentResetVersion) return;
    const initialCount = this.items.length;
    this.items = this.items.filter((i) => !i.reset_version || i.reset_version >= currentResetVersion);
    if (this.items.length !== initialCount) {
      this.save();
    }
  }
}
