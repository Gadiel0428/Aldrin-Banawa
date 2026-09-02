/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSupabaseClient } from './supabase';

/**
 * Subscribes to real-time inventory modifications for instant cross-device updates.
 */
export function subscribeToInventory(
  warehouseId?: string,
  onChange?: (payload: any) => void
) {
  const client = getSupabaseClient();
  const channelName = warehouseId ? `realtime-inv-${warehouseId}` : `realtime-inv-all`;

  const filterConfig = warehouseId
    ? {
        event: '*',
        schema: 'public',
        table: 'inventory',
        filter: `warehouse_id=eq.${warehouseId}`,
      }
    : {
        event: '*',
        schema: 'public',
        table: 'inventory',
      };

  const channel = client
    .channel(channelName)
    .on('postgres_changes', filterConfig as any, (payload) => {
      if (onChange) onChange(payload);
    })
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}

/**
 * Subscribes to new stock movements stream across all connected computers/tablets.
 */
export function subscribeToStockMovements(
  onMovement: (movement: any) => void
) {
  const client = getSupabaseClient();
  const channel = client
    .channel('realtime-stock-movements')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'stock_movements',
      },
      (payload) => {
        onMovement(payload.new);
      }
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}

/**
 * Subscribes to products catalog modifications.
 */
export function subscribeToProducts(onChange: () => void) {
  const client = getSupabaseClient();
  const channel = client
    .channel('realtime-products')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'products',
      },
      () => {
        onChange();
      }
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}

/**
 * Master multi-table subscriber for global synchronization.
 */
export function subscribeToAllChanges(onSyncEvent: (table: string, payload: any) => void) {
  const client = getSupabaseClient();
  const channel = client
    .channel('realtime-master-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, (p) => onSyncEvent('inventory', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, (p) => onSyncEvent('stock_movements', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (p) => onSyncEvent('products', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouses' }, (p) => onSyncEvent('warehouses', p))
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}
