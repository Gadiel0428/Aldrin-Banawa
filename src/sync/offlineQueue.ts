/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { OfflineQueueItem, QueueItemStatus } from '../types/sync';

const QUEUE_STORAGE_KEY = 'juwei_wms_offline_queue_v1';

export const OfflineQueue = {
  getAll(): OfflineQueueItem[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  add(item: Omit<OfflineQueueItem, 'id' | 'timestamp' | 'retryCount' | 'status'>): OfflineQueueItem {
    const queue = OfflineQueue.getAll();
    const newItem: OfflineQueueItem = {
      ...item,
      id: 'q-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      retryCount: 0,
      status: 'PENDING',
    };
    queue.push(newItem);
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch {}
    return newItem;
  },

  remove(id: string): void {
    const queue = OfflineQueue.getAll().filter((i) => i.id !== id);
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch {}
  },

  clearCompleted(): void {
    const queue = OfflineQueue.getAll().filter((i) => i.status === 'PENDING' || i.status === 'SYNCING');
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch {}
  },

  purgeAll(): void {
    try {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
    } catch {}
  },

  updateStatus(id: string, status: QueueItemStatus, lastError?: string): void {
    const queue = OfflineQueue.getAll();
    const target = queue.find((i) => i.id === id);
    if (target) {
      target.status = status;
      if (lastError) target.lastError = lastError;
      try {
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
      } catch {}
    }
  },
};
