/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { InventoryItem, Warehouse, InventorySummary } from '../types/inventory';
import { Product } from '../types/product';
import { getApiBaseUrl } from '../config/serverConfig';

export const DEFAULT_WAREHOUSES: Warehouse[] = [
  { id: 'wh-main', name: 'Main Warehouse (Bays 1-4)', location: 'Building A', code: 'WH-MAIN', is_active: true },
  { id: 'wh-secondary', name: 'Raw Material Bay (Bays 5-8)', location: 'Building B', code: 'WH-RAW', is_active: true },
  { id: 'wh-quarantine', name: 'QC / Quarantine Holding Bay', location: 'Section Q', code: 'WH-QC', is_active: true },
];

export async function fetchWarehouses(): Promise<Warehouse[]> {
  return DEFAULT_WAREHOUSES;
}

export async function fetchInventory(warehouseId?: string): Promise<InventoryItem[]> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/sync`, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const json = await res.json();
      const rawStocks = json?.data?.stocks || [];
      const warehouses = DEFAULT_WAREHOUSES;
      const whMap = new Map(warehouses.map((w) => [w.id, w]));

      const items: InventoryItem[] = rawStocks.map((s: any) => {
        const whId = s.warehouseId || s.warehouse_id || 'wh-main';
        const wh = whMap.get(whId) || warehouses[0];
        const prod: Product = {
          id: s.id,
          sku: s.sku || s.partNumber || s.id,
          name: s.partName || s.name || s.sku || 'Material Item',
          unit: s.unit || 'PCS',
          cost: Number(s.unitCost) || 0,
          price: Number(s.unitPrice) || 0,
          min_stock: Number(s.minStock) || 10,
          category: s.category || 'RAW',
          barcode: s.barcode,
          is_active: true,
        };

        return {
          id: s.id,
          product_id: s.id,
          warehouse_id: whId,
          quantity: Number(s.currentStock ?? s.quantity ?? 0),
          updated_at: s.lastUpdated || s.updated_at || new Date().toISOString(),
          product: prod,
          warehouse: wh,
          location: s.location || 'A-01',
          lot_number: s.lotNumber || s.lot_number,
          status: 'APPROVED',
        };
      });

      if (warehouseId && warehouseId !== 'ALL') {
        return items.filter((i) => i.warehouse_id === warehouseId);
      }
      return items;
    }
  } catch (err) {
    console.warn('fetchInventory server request error:', err);
  }

  return [];
}

export async function fetchInventorySummary(): Promise<InventorySummary> {
  const items = await fetchInventory();
  let totalQuantity = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalValuation = 0;

  for (const item of items) {
    const qty = item.quantity || 0;
    const min = item.product?.min_stock || 10;
    const cost = item.product?.cost || 0;

    totalQuantity += qty;
    totalValuation += qty * cost;
    if (qty <= 0) {
      outOfStockCount++;
    } else if (qty <= min) {
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
