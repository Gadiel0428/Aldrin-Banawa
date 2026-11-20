/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export * from '../shared/types';

export type MutationQueueStatus = 'PENDING' | 'SYNCING' | 'CONFLICT' | 'FAILED';

export interface QueuedMutation {
  id: string;
  idempotencyKey?: string;
  type: 'upsert' | 'delete' | 'STOCK_MOVEMENT';
  collection: string;
  record?: any;
  recordId?: string;
  expectedVersion?: number;
  payload?: any;
  delta?: number;
  author?: string;
  actionDesc?: string;
  deviceId?: string;
  timestamp: number;
  reset_version?: number;
  retryCount?: number;
  nextRetryAt?: number;
  status?: MutationQueueStatus;
  lastError?: string;
  currentServerRecord?: any;
}

export interface SyncConflictItem {
  id: string;
  collection: string;
  recordId: string;
  type: 'upsert' | 'delete';
  localRecord?: any;
  currentServerRecord?: any;
  expectedVersion?: number;
  serverVersion?: number;
  author?: string;
  actionDesc?: string;
  error: string;
  timestamp: number;
}

export function getCustomerForPart(_partCode?: string, _description?: string): string {
  // No hardcoded placeholder entries (CISCO Systems, NISSAN Motors, EPSON Precision, General / Internal removed).
  // Return empty string; customer assignments are sourced strictly from registered master records.
  return '';
}

// Re-export modular types for single source of truth
export * from './types/index';

