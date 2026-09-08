/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StockMovement } from '../types/movement';

export function subscribeToInventory(
  _warehouseId?: string,
  callback?: () => void
): () => void {
  if (typeof window === 'undefined' || !callback) return () => {};

  const handleUpdate = () => {
    try {
      callback();
    } catch (e) {
      console.warn('Realtime inventory callback error:', e);
    }
  };

  window.addEventListener('stock_movement_created', handleUpdate);
  window.addEventListener('inventory_updated', handleUpdate);
  window.addEventListener('storage', handleUpdate);

  return () => {
    window.removeEventListener('stock_movement_created', handleUpdate);
    window.removeEventListener('inventory_updated', handleUpdate);
    window.removeEventListener('storage', handleUpdate);
  };
}

export function subscribeToProducts(callback: () => void): () => void {
  if (typeof window === 'undefined' || !callback) return () => {};

  const handleUpdate = () => {
    try {
      callback();
    } catch (e) {
      console.warn('Realtime product callback error:', e);
    }
  };

  window.addEventListener('products_updated', handleUpdate);
  window.addEventListener('storage', handleUpdate);

  return () => {
    window.removeEventListener('products_updated', handleUpdate);
    window.removeEventListener('storage', handleUpdate);
  };
}

export function subscribeToStockMovements(
  callback: (movement: StockMovement) => void
): () => void {
  if (typeof window === 'undefined' || !callback) return () => {};

  const handleMovement = (e: Event) => {
    try {
      const customEvent = e as CustomEvent<StockMovement>;
      if (customEvent.detail) {
        callback(customEvent.detail);
      }
    } catch (err) {
      console.warn('Realtime stock movement callback error:', err);
    }
  };

  window.addEventListener('stock_movement_created', handleMovement);

  return () => {
    window.removeEventListener('stock_movement_created', handleMovement);
  };
}
