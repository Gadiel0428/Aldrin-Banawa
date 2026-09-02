/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSupabaseClient } from './supabase';
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
 * Calls the central server / PostgreSQL RPC to lock, validate, and execute.
 */
export async function createStockMovement(input: CreateStockMovementInput): Promise<StockMovementResult> {
  const deviceId = input.deviceId || getDeviceId();
  const idempotencyKey = input.idempotencyKey || `SM-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // Signed quantity logic:
  // For negative movement types (SALE, PURCHASE_RETURN, ADJUSTMENT_OUT, TRANSFER_OUT), ensure quantity is negative if positive provided
  let delta = input.quantity;
  if (['SALE', 'PURCHASE_RETURN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT'].includes(input.type)) {
    if (delta > 0) delta = -delta;
  } else if (['PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN'].includes(input.type)) {
    if (delta < 0) delta = Math.abs(delta);
  }

  const payload = {
    p_product_id: input.productId,
    p_warehouse_id: input.warehouseId,
    p_type: input.type,
    p_quantity: delta,
    p_reference_id: input.referenceId || null,
    p_reference_number: input.referenceNumber || null,
    p_notes: input.notes || null,
    p_user_id: input.userId || null,
    p_user_name: input.userName || null,
    p_device_id: deviceId,
    p_idempotency_key: idempotencyKey,
    p_prevent_negative: input.preventNegativeStock !== false,
    p_lot_number: input.lotNumber || null,
    p_location: input.location || null,
  };

  try {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('create_stock_movement', payload);

    if (error) {
      console.warn('Supabase RPC create_stock_movement failed, trying fallback API endpoint:', error.message);
      throw error;
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return {
      success: true,
      movementId: result.movement_id,
      productId: input.productId,
      warehouseId: input.warehouseId,
      previousQuantity: Number(result.previous_quantity) || 0,
      newQuantity: Number(result.new_quantity) || 0,
      delta,
      timestamp: result.timestamp || new Date().toISOString(),
    };
  } catch (err: any) {
    // If Supabase RPC is unavailable, call the central Express server endpoint
    try {
      const resp = await fetch('/api/stock-movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          delta,
          deviceId,
          idempotencyKey,
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error || `Server failed with status ${resp.status}`);
      }

      const resJson = await resp.json();
      return resJson;
    } catch (serverErr: any) {
      throw new Error(`Stock movement failed: ${serverErr.message || err.message}`);
    }
  }
}

export async function fetchStockMovements(limit = 100, warehouseId?: string, productId?: string): Promise<StockMovement[]> {
  const client = getSupabaseClient();
  let query = client
    .from('stock_movements')
    .select('*, product:products(name, sku, unit), warehouse:warehouses(name)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (warehouseId) query = query.eq('warehouse_id', warehouseId);
  if (productId) query = query.eq('product_id', productId);

  const { data, error } = await query;
  if (error) {
    // Fallback to server endpoint
    try {
      const resp = await fetch(`/api/stock-movements?limit=${limit}`);
      if (resp.ok) {
        const fallbackData = await resp.json();
        return fallbackData;
      }
    } catch {
      // ignore
    }
    return [];
  }

  return (data || []).map((m: any) => ({
    ...m,
    product_name: m.product?.name,
    product_sku: m.product?.sku,
    unit: m.product?.unit,
    warehouse_name: m.warehouse?.name,
  }));
}
