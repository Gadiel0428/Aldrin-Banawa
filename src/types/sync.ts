/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateStockMovementInput } from './movement';

export type SyncState = 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'ERROR';

export type QueueItemStatus = 'PENDING' | 'SYNCING' | 'COMPLETED' | 'FAILED';

export interface OfflineQueueItem {
  id: string; // Unique queue task UUID
  idempotencyKey: string; // Used to prevent duplicate executions
  type: 'STOCK_MOVEMENT' | 'PRODUCT_UPSERT' | 'RECEIVING_RECORD' | 'ISSUANCE_RECORD' | 'USER_UPDATE';
  payload: CreateStockMovementInput | Record<string, any>;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  status: QueueItemStatus;
  lastError?: string;
  deviceId: string;
  reset_version?: number;
}

export interface SyncStatusInfo {
  state: SyncState;
  isOnline: boolean;
  pendingCount: number;
  lastSyncTimestamp: number | null;
  deviceId: string;
  activeProvider: 'CENTRAL_SERVER' | 'SERVER_SOCKET' | 'OFFLINE';
  errorMessage?: string;
}
