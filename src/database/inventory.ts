/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSupabaseClient } from './supabase';
import { InventoryItem, Warehouse, InventorySummary } from '../types/inventory';

export async function fetchWarehouses(): Promise<Warehouse[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.from('warehouses').select('*').order('name', { ascending: true });
  if (error) {
    console.warn('Error fetching warehouses:', error.message);
    return [
      { id: 'wh-main', name: 'Main Plant Warehouse', location: 'Plant A - Ground' },
      { id: 'wh-raw', name: 'Raw Material Depot', location: 'Zone A' },
      { id: 'wh-pkg', name: 'Packaging Store', location: 'Zone B' },
      { id: 'wh-fg', name: 'Finished Goods Bay', location: 'Zone D' },
    ];
  }
  return (data as Warehouse[]) || [];
}

export async function fetchInventory(warehouseId?: string): Promise<InventoryItem[]> {
  const client = getSupabaseClient();
  let query = client
    .from('inventory')
    .select('*, product:products(*), warehouse:warehouses(*)')
    .order('updated_at', { ascending: false });

  if (warehouseId) {
    query = query.eq('warehouse_id', warehouseId);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Error fetching inventory:', error.message);
    return [];
  }
  return (data as InventoryItem[]) || [];
}

export async function getProductInventoryLevel(productId: string, warehouseId: string): Promise<number> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('inventory')
    .select('quantity')
    .eq('product_id', productId)
    .eq('warehouse_id', warehouseId)
    .single();

  if (error || !data) return 0;
  return Number(data.quantity) || 0;
}

export function computeInventorySummary(items: InventoryItem[]): InventorySummary {
  let totalQuantity = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalValuation = 0;

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const minStock = Number(item.product?.min_stock) || 0;
    const cost = Number(item.product?.cost) || 0;

    totalQuantity += qty;
    totalValuation += qty * cost;

    if (qty <= 0) {
      outOfStockCount++;
    } else if (qty <= minStock) {
      lowStockCount++;
    }
  }

  return {
    totalSkus: items.length,
    totalQuantity,
    lowStockCount,
    outOfStockCount,
    totalValuation,
  };
}
