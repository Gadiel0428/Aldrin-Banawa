/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, ProductFilter } from '../types/product';

const PRODUCTS_LOCAL_KEY = 'juwei_wms_local_products';

export async function fetchProducts(filter?: ProductFilter): Promise<Product[]> {
  try {
    const res = await fetch('/api/sync', { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const json = await res.json();
      const stocks = json?.data?.stocks || [];
      const registries = json?.data?.registries || [];

      const productMap = new Map<string, Product>();

      // Load cached/saved local products first
      try {
        const local = localStorage.getItem(PRODUCTS_LOCAL_KEY);
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) {
            parsed.forEach((p) => {
              if (p && p.sku) productMap.set(p.sku.toUpperCase(), p);
            });
          }
        }
      } catch {}

      // Add from stocks
      stocks.forEach((s: any) => {
        const sku = (s.sku || s.partNumber || s.id || '').toUpperCase();
        if (sku && !productMap.has(sku)) {
          productMap.set(sku, {
            id: s.id,
            sku: s.sku || s.partNumber || s.id,
            name: s.partName || s.name || sku,
            barcode: s.barcode,
            unit: s.unit || 'PCS',
            cost: Number(s.unitCost) || 0,
            price: Number(s.unitPrice) || 0,
            min_stock: Number(s.minStock) || 10,
            category: s.category || 'RAW',
            is_active: true,
          });
        }
      });

      // Add from registries
      registries.forEach((r: any) => {
        const sku = (r.partNumber || r.sku || r.id || '').toUpperCase();
        if (sku && !productMap.has(sku)) {
          productMap.set(sku, {
            id: r.id,
            sku: r.partNumber || r.sku || r.id,
            name: r.partName || r.name || sku,
            barcode: r.barcode,
            unit: r.unit || 'PCS',
            cost: Number(r.unitCost) || 0,
            price: Number(r.unitPrice) || 0,
            min_stock: Number(r.minStock) || 10,
            category: r.category || 'RAW',
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
    console.warn('fetchProducts server error:', e);
  }

  // Fallback to local storage
  try {
    const local = localStorage.getItem(PRODUCTS_LOCAL_KEY);
    if (local) {
      return JSON.parse(local);
    }
  } catch {}

  return [];
}

export async function upsertProduct(input: Partial<Product>): Promise<Product> {
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

  // Cache locally
  try {
    const existing = await fetchProducts();
    const updated = [newProduct, ...existing.filter((p) => p.sku.toUpperCase() !== newProduct.sku.toUpperCase())];
    localStorage.setItem(PRODUCTS_LOCAL_KEY, JSON.stringify(updated));
  } catch {}

  // Sync to server stock/registry collection
  try {
    await fetch('/api/sync/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reset_version: Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0,
        mutations: [
          {
            type: 'upsert',
            collection: 'registries',
            record: {
              id: newProduct.id,
              partNumber: newProduct.sku,
              partName: newProduct.name,
              category: newProduct.category,
              unit: newProduct.unit,
              unitCost: newProduct.cost,
              unitPrice: newProduct.price,
              minStock: newProduct.min_stock,
              barcode: newProduct.barcode,
              isRegistered: true,
              registeredAt: new Date().toISOString(),
            },
          },
        ],
      }),
    });
  } catch (err) {
    console.warn('upsertProduct batch sync warning:', err);
  }

  return newProduct;
}
