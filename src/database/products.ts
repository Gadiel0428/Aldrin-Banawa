/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, ProductFilter } from '../types/product';
import { getDeviceId } from './movements';
import { getApiBaseUrl } from '../config/serverConfig';

export async function fetchProducts(filter?: ProductFilter): Promise<Product[]> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/sync`, { 
      headers: { 
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      } 
    });
    if (res.ok) {
      const json = await res.json();
      const stocks = json?.data?.stocks || [];
      const registries = json?.data?.registries || [];

      const productMap = new Map<string, Product>();

      // Add from central database master registries first
      registries.forEach((r: any) => {
        const sku = String(r.partNumber || r.sku || r.code || r.id || '').toUpperCase().trim();
        if (sku && !productMap.has(sku)) {
          productMap.set(sku, {
            id: String(r.id || r.record_id || sku),
            sku: r.partNumber || r.sku || r.code || sku,
            name: r.partName || r.name || sku,
            barcode: r.barcode,
            unit: r.unit || 'PCS',
            cost: Number(r.unitCost || r.cost) || 0,
            price: Number(r.unitPrice || r.price) || 0,
            min_stock: Number(r.minStock || r.min_stock) || 10,
            category: r.category || 'RAW',
            is_active: r.status !== 'INACTIVE',
          });
        }
      });

      // Add or enrich from central database stocks
      stocks.forEach((s: any) => {
        const sku = String(s.partCode || s.partNumber || s.sku || s.id || '').toUpperCase().trim();
        if (sku && !productMap.has(sku)) {
          productMap.set(sku, {
            id: String(s.id || s.record_id || sku),
            sku: s.partCode || s.partNumber || s.sku || sku,
            name: s.description || s.partName || s.name || sku,
            barcode: s.barcode,
            unit: s.unit || 'PCS',
            cost: Number(s.unitCost || s.cost) || 0,
            price: Number(s.unitPrice || s.price) || 0,
            min_stock: Number(s.reorderMin || s.minStock || s.min_stock) || 10,
            category: s.type || s.category || 'RAW',
            is_active: true,
          });
        }
      });

      let results = Array.from(productMap.values());
      if (filter?.category) {
        results = results.filter((p) => p.category === filter.category);
      }
      if (filter?.search) {
        const q = filter.search.toLowerCase();
        results = results.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            (p.barcode && p.barcode.toLowerCase().includes(q))
        );
      }
      return results;
    }
  } catch (e) {
    console.warn('[JUWEI-WMS] fetchProducts central database request error:', e);
  }

  return [];
}

export async function upsertProduct(input: Partial<Product>): Promise<Product> {
  const deviceId = getDeviceId();
  const resetVersion = typeof window !== 'undefined'
    ? (Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0)
    : 0;
  const currentUserId = typeof window !== 'undefined'
    ? (localStorage.getItem('juwei_wms_employeeId') ? `USR-${localStorage.getItem('juwei_wms_employeeId')}` : 'USR-OPERATOR')
    : 'USR-OPERATOR';

  const newProduct: Product = {
    id: input.id || 'PROD-' + Date.now(),
    sku: input.sku || `SKU-${Date.now()}`,
    name: input.name || 'New SKU',
    barcode: input.barcode,
    unit: input.unit || 'PCS',
    cost: Number(input.cost) || 0,
    price: Number(input.price) || 0,
    min_stock: Number(input.min_stock) || 10,
    category: input.category || 'RAW',
    is_active: input.is_active ?? true,
    updated_at: new Date().toISOString(),
  };

  const registryRecord = {
    id: newProduct.id,
    record_id: newProduct.id,
    code: newProduct.sku,
    partNumber: newProduct.sku,
    name: newProduct.name,
    partName: newProduct.name,
    type: 'PART_CODE',
    category: newProduct.category,
    unit: newProduct.unit,
    unitCost: newProduct.cost,
    unitPrice: newProduct.price,
    minStock: newProduct.min_stock,
    barcode: newProduct.barcode,
    status: newProduct.is_active ? 'ACTIVE' : 'INACTIVE',
    dateRegistered: new Date().toISOString().split('T')[0],
    version: 1,
    updated_at: newProduct.updated_at,
    user_id: currentUserId,
    device_id: deviceId,
    reset_version: resetVersion
  };

  // Save to Central Database FIRST via REST API
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/records/upsert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId
      },
      body: JSON.stringify({
        collection: 'registries',
        record: registryRecord,
        author: currentUserId,
        device_id: deviceId,
        user_id: currentUserId,
        reset_version: resetVersion,
        actionDesc: `Master product catalog encode/upsert: ${newProduct.name} (${newProduct.sku})`
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server returned ${res.status}`);
    }
  } catch (err: any) {
    console.error('[JUWEI-WMS] upsertProduct error saving to central database:', err);
    throw new Error(`Central Database commit failed: ${err.message}`);
  }

  return newProduct;
}
