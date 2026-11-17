/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SyncState = 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'ERROR' | 'REVOKED';

export type QueueItemStatus = 'PENDING' | 'SYNCING' | 'CONFLICT' | 'FAILED';

export interface SyncStatusInfo {
  state: SyncState;
  isOnline: boolean;
  isRevoked?: boolean;
  pendingCount: number;
  conflictCount?: number;
  lastSyncTimestamp: number | null;
  deviceId: string;
  activeProvider: 'CENTRAL_SERVER' | 'SERVER_SOCKET' | 'OFFLINE';
  errorMessage?: string;
}
