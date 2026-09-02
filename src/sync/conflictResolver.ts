/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ConflictResolutionResult {
  accepted: boolean;
  reason?: 'INSUFFICIENT_STOCK' | 'IDEMPOTENCY_DUPLICATE' | 'LOCKED' | 'INVALID_PRODUCT' | 'DATABASE_ERROR';
  message: string;
  serverState?: any;
}

export class ConflictResolver {
  /**
   * Evaluates server response and classifies conflict errors.
   */
  public static handleMovementError(error: any): ConflictResolutionResult {
    const message = error?.message || String(error);

    if (message.includes('Insufficient stock') || message.includes('P0001')) {
      return {
        accepted: false,
        reason: 'INSUFFICIENT_STOCK',
        message: 'Transaction rejected: Insufficient warehouse stock to complete operation.',
      };
    }

    if (message.includes('duplicate key') || message.includes('idempotency')) {
      return {
        accepted: true, // Idempotent operations are safe to consider accepted
        reason: 'IDEMPOTENCY_DUPLICATE',
        message: 'Transaction already processed previously (Idempotency matched).',
      };
    }

    return {
      accepted: false,
      reason: 'DATABASE_ERROR',
      message: `Database synchronization error: ${message}`,
    };
  }
}
