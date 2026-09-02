/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product } from './product';

export interface Warehouse {
  id: string;
  name: string;
  location?: string;
  code?: string;
  is_active?: boolean;
  created_at?: string;
}

export interface InventoryItem {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  updated_at: string;
  
  // Joined relational fields
  product?: Product;
  warehouse?: Warehouse;
  
  // Location/Lot specific attributes if segregated
  location?: string;
  lot_number?: string;
  fifo_color?: string;
  status?: 'APPROVED' | 'QUARANTINE' | 'HOLD';
}

export interface InventorySummary {
  totalSkus: number;
  totalQuantity: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValuation: number;
}
