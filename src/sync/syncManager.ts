/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SyncStatusInfo } from '../types/sync';
import { QueuedMutation } from '../types';
import { CreateStockMovementInput, StockMovementResult } from '../types/movement';
import { createStockMovement, getDeviceId } from '../database/movements';

export const MUTATION_QUEUE_STORAGE_KEY = 'juwei_wms_mutation_queue_v1';
export const MUTATION_QUEUE_CHANGED_EVENT = 'juwei_mutation_queue_changed';
export const FORCE_FLUSH_MUTATIONS_EVENT = 'juwei_force_flush_mutations';
export const DEVICE_REVOKED_EVENT = 'juwei_device_revoked';

type Listener = (status: SyncStatusInfo) => void;

export function calculateRetryBackoffMs(retryCount: number): number {
  return Math.min(60000, 2000 * Math.pow(2, Math.max(0, retryCount - 1)));
}

export function computeSignedStockDelta(
  type: CreateStockMovementInput['type'],
  quantity: number,
  explicitDelta?: number
): number {
  let delta = Number(explicitDelta !== undefined ? explicitDelta : quantity) || 0;
  if (['SALE', 'PURCHASE_RETURN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT'].includes(type)) {
    if (delta > 0) delta = -delta;
  } else if (['PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN'].includes(type)) {
    if (delta < 0) delta = Math.abs(delta);
  }
  return delta;
}

export function getMutationQueue(): QueuedMutation[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MUTATION_QUEUE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMutationQueue(mutations: QueuedMutation[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    if (mutations.length === 0) {
      localStorage.removeItem(MUTATION_QUEUE_STORAGE_KEY);
    } else {
      localStorage.setItem(MUTATION_QUEUE_STORAGE_KEY, JSON.stringify(mutations));
    }
    window.dispatchEvent(new CustomEvent(MUTATION_QUEUE_CHANGED_EVENT));
  } catch {}
}

export function enqueueMutation(
  mutation: Omit<QueuedMutation, 'id' | 'timestamp'> & { id?: string; timestamp?: number }
): QueuedMutation {
  const currentResetVer = typeof localStorage !== 'undefined'
    ? (Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0)
    : 0;
  const item: QueuedMutation = {
    ...mutation,
    id: mutation.id || `MUT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: mutation.timestamp || Date.now(),
    reset_version: mutation.reset_version ?? currentResetVer,
    retryCount: mutation.retryCount ?? 0,
    status: mutation.status ?? 'PENDING',
  };
  const queue = getMutationQueue();
  const existingIdx = queue.findIndex((q) => q.id === item.id);
  if (existingIdx >= 0) {
    queue[existingIdx] = item;
  } else {
    queue.push(item);
  }
  saveMutationQueue(queue);
  return item;
}

export function removeConfirmedMutations(ids: string[]): void {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const idSet = new Set(ids);
  const queue = getMutationQueue();
  const filtered = queue.filter((q) => !idSet.has(q.id));
  if (filtered.length !== queue.length) {
    saveMutationQueue(filtered);
  }
}

class SyncManager {
  private listeners: Set<Listener> = new Set();
  private status: SyncStatusInfo = {
    state: typeof navigator !== 'undefined' && navigator.onLine ? 'ONLINE' : 'OFFLINE',
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isRevoked: false,
    pendingCount: 0,
    conflictCount: 0,
    lastSyncTimestamp: Date.now(),
    deviceId: typeof window !== 'undefined' ? getDeviceId() : 'DEV-STATION',
    activeProvider: 'SERVER_SOCKET',
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
      window.addEventListener(MUTATION_QUEUE_CHANGED_EVENT, () => this.notify());
      window.addEventListener(DEVICE_REVOKED_EVENT, (ev: any) => {
        const targetId = ev?.detail?.deviceId;
        if (!targetId || targetId === getDeviceId()) {
          this.markDeviceRevoked();
        }
      });
      window.addEventListener('storage', (ev) => {
        if (ev.key === MUTATION_QUEUE_STORAGE_KEY) {
          this.notify();
        }
      });
      this.refreshQueueCounts();
    }
  }

  private refreshQueueCounts() {
    const queue = getMutationQueue();
    this.status.pendingCount = queue.length;
    this.status.conflictCount = queue.filter((i) => i.status === 'CONFLICT').length;
    if (!this.status.isRevoked) {
      if ((this.status.conflictCount || 0) > 0) {
        this.status.state = 'ERROR';
      } else if (!this.status.isOnline) {
        this.status.state = 'OFFLINE';
      } else if (this.status.state === 'ERROR') {
        this.status.state = 'ONLINE';
      }
    }
  }

  public markDeviceRevoked() {
    this.status.isRevoked = true;
    this.status.state = 'REVOKED';
    this.status.errorMessage = 'This computer was removed from the system';
    this.notify();
  }

  private handleNetworkChange(online: boolean) {
    this.status.isOnline = online;
    if (!this.status.isRevoked) {
      this.status.state = online ? 'ONLINE' : 'OFFLINE';
    }
    this.notify();
    if (online && !this.status.isRevoked) {
      this.forceSyncNow().catch(() => {});
    }
  }

  public getStatus(): SyncStatusInfo {
    this.status.deviceId = typeof window !== 'undefined' ? getDeviceId() : this.status.deviceId;
    this.refreshQueueCounts();
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
    this.refreshQueueCounts();
    const snap = { ...this.status };
    this.listeners.forEach((cb) => {
      try {
        cb(snap);
      } catch {}
    });
  }

  public async forceSyncNow(forceRetry = true): Promise<void> {
    if (this.status.isRevoked) {
      this.notify();
      return;
    }

    this.status.state = 'SYNCING';
    this.notify();

    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(FORCE_FLUSH_MUTATIONS_EVENT, { detail: { forceRetry } }));
      }

      const now = Date.now();
      const queue = getMutationQueue();
      const movementItems = queue.filter(
        (i) =>
          i.type === 'STOCK_MOVEMENT' &&
          i.status !== 'CONFLICT' &&
          (forceRetry || !i.nextRetryAt || i.nextRetryAt <= now)
      );

      for (const item of movementItems) {
        if (this.status.isRevoked) break;
        try {
          const currentQ = getMutationQueue().map((q) =>
            q.id === item.id ? { ...q, status: 'SYNCING' as const } : q
          );
          saveMutationQueue(currentQ);

          const rawPayload = (item.payload || {}) as CreateStockMovementInput;
          const delta = computeSignedStockDelta(
            rawPayload.type,
            rawPayload.quantity,
            item.delta ?? rawPayload.delta
          );
          const res = await createStockMovement({
            ...rawPayload,
            delta,
            idempotencyKey: item.idempotencyKey || rawPayload.idempotencyKey,
            deviceId: item.deviceId || rawPayload.deviceId || getDeviceId(),
          });

          if (res.success) {
            removeConfirmedMutations([item.id]);
          } else {
            const nextRetry = (item.retryCount || 0) + 1;
            const updatedQ = getMutationQueue().map((q) =>
              q.id === item.id
                ? {
                    ...q,
                    status: 'FAILED' as const,
                    retryCount: nextRetry,
                    nextRetryAt: Date.now() + calculateRetryBackoffMs(nextRetry),
                    lastError: res.error || 'Sync failed',
                  }
                : q
            );
            saveMutationQueue(updatedQ);
          }
        } catch (e: any) {
          const msg = e?.message || 'Sync failed';
          if (msg.includes('DEVICE_REVOKED')) {
            this.markDeviceRevoked();
            return;
          }
          const nextRetry = (item.retryCount || 0) + 1;
          const updatedQ = getMutationQueue().map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: 'FAILED' as const,
                  retryCount: nextRetry,
                  nextRetryAt: Date.now() + calculateRetryBackoffMs(nextRetry),
                  lastError: msg,
                }
              : q
          );
          saveMutationQueue(updatedQ);
        }
      }

      if (!this.status.isRevoked) {
        this.status.state = this.status.isOnline ? 'ONLINE' : 'OFFLINE';
        this.status.lastSyncTimestamp = Date.now();
      }
    } catch {
      if (!this.status.isRevoked) {
        this.status.state = 'ERROR';
      }
    } finally {
      this.notify();
    }
  }

  public async executeMovement(input: CreateStockMovementInput): Promise<StockMovementResult> {
    if (this.status.isRevoked) {
      throw new Error('DEVICE_REVOKED: This computer was removed from the system');
    }

    const delta = computeSignedStockDelta(input.type, input.quantity, input.delta);
    const idempotencyKey =
      input.idempotencyKey || `SM-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const deviceId = input.deviceId || getDeviceId();

    const movementInput: CreateStockMovementInput = {
      ...input,
      delta,
      deviceId,
      idempotencyKey,
    };

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        enqueueMutation({
          id: idempotencyKey,
          idempotencyKey,
          type: 'STOCK_MOVEMENT',
          collection: 'stocks',
          recordId: input.productId,
          delta,
          payload: movementInput,
          deviceId,
          status: 'PENDING',
          retryCount: 0,
        });
        this.notify();
        return {
          success: true,
          movementId: `OFFLINE-${idempotencyKey}`,
          productId: input.productId,
          warehouseId: input.warehouseId,
          previousQuantity: 0,
          delta,
          timestamp: new Date().toISOString(),
        };
      }

      const result = await createStockMovement(movementInput);
      if (result.success) {
        this.status.lastSyncTimestamp = Date.now();
        this.notify();
        return result;
      }
      throw new Error(result.error || 'Stock movement rejected by central authority');
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('DEVICE_REVOKED')) {
        this.markDeviceRevoked();
        throw err;
      }
      const isNetworkFailure =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        /Failed to fetch|NetworkError|Load failed|fetch/i.test(msg);

      if (isNetworkFailure) {
        enqueueMutation({
          id: idempotencyKey,
          idempotencyKey,
          type: 'STOCK_MOVEMENT',
          collection: 'stocks',
          recordId: input.productId,
          delta,
          payload: movementInput,
          deviceId,
          status: 'FAILED',
          retryCount: 1,
          nextRetryAt: Date.now() + calculateRetryBackoffMs(1),
          lastError: msg,
        });
        this.notify();
        return {
          success: true,
          movementId: `OFFLINE-${idempotencyKey}`,
          productId: input.productId,
          warehouseId: input.warehouseId,
          previousQuantity: 0,
          delta,
          timestamp: new Date().toISOString(),
        };
      }
      throw err;
    }
  }
}

export const syncManager = new SyncManager();
