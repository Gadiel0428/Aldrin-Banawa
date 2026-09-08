/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateStockMovementInput, StockMovement, StockMovementResult } from '../types/movement';

// Helper to get or generate a persistent device ID
export function getDeviceId(): string {
  let devId = localStorage.getItem('juwei_wms_device_id');
  if (!devId) {
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    devId = `DEVICE-WMS-${random}`;
    localStorage.setItem('juwei_wms_device_id', devId);
  }
  return devId;
}

/**
 * Creates an atomic stock movement.
 * Never mutates inventory quantity directly on the client.
 * Calls the central server to lock, validate, and execute.
 */
export async function createStockMovement(input: CreateStockMovementInput): Promise<StockMovementResult> {
  const deviceId = input.deviceId || getDeviceId();
  const idempotencyKey = input.idempotencyKey || `SM-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  let delta = input.quantity;
  if (['SALE', 'PURCHASE_RETURN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT'].includes(input.type)) {
    if (delta > 0) delta = -delta;
  } else if (['PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN'].includes(input.type)) {
    if (delta < 0) delta = Math.abs(delta);
  }

  try {
    const localResetVersion = typeof window !== 'undefined' 
      ? (Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0)
      : 0;

    const resp = await fetch('/api/stock-movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        delta,
        deviceId,
        idempotencyKey,
        reset_version: localResetVersion,
      }),
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      if (resp.status === 409 || errorData.error === 'STALE_RESET_VERSION') {
        if (typeof window !== 'undefined' && errorData.systemResetVersion) {
          localStorage.setItem('juwei_wms_system_reset_version', String(errorData.systemResetVersion));
        }
        throw new Error(`STALE_RESET_VERSION: Central database was reset. Stale offline transaction rejected.`);
      }
      throw new Error(errorData.error || `Server failed with status ${resp.status}`);
    }

    const resJson = await resp.json();
    return resJson;
  } catch (err: any) {
    throw new Error(`Stock movement failed: ${err.message}`);
  }
}

export async function fetchStockMovements(limit = 100, warehouseId?: string, productId?: string): Promise<StockMovement[]> {
  try {
    let url = `/api/stock-movements?limit=${limit}`;
    if (warehouseId) url += `&warehouseId=${encodeURIComponent(warehouseId)}`;
    if (productId) url += `&productId=${encodeURIComponent(productId)}`;

    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (resp.ok) {
      const list = await resp.json();
      return Array.isArray(list) ? list : [];
    }
  } catch (e) {
    console.warn("fetchStockMovements server error:", e);
  }
  return [];
}
