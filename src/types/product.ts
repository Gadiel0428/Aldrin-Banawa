/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  category?: string;
  type?: 'RAW' | 'PACKAGING' | 'CONSUMABLE' | 'WIP' | 'FG' | 'SUB_PART';
  unit: string; // PCS, KG, SET, BOX, UNITS, LITERS
  cost: number;
  price: number;
  min_stock: number;
  is_active: boolean;
  model_name?: string;
  color?: string;
  shelf_life_days?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ProductFilter {
  search?: string;
  category?: string;
  type?: string;
  isActive?: boolean;
}
