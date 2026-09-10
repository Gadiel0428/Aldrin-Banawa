/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { 
  MaterialStockItem, 
  ReceivingRecord, 
  ReturnRecord, 
  RecyclingRecord, 
  IssuanceRecord, 
  DeliveryRecord, 
  EnvironmentalLog,
  ForkliftChecklist
} from './types';

// FIFO color mappings helper
export const FIFO_COLORS_BY_MONTH: { [key: number]: { name: string; colorClass: string; textClass: string } } = {
  1: { name: 'Magenta', colorClass: 'bg-fuchsia-600', textClass: 'text-fuchsia-600' },
  2: { name: 'Orange', colorClass: 'bg-orange-500', textClass: 'text-orange-500' },
  3: { name: 'Dark Green', colorClass: 'bg-emerald-800', textClass: 'text-emerald-800' },
  4: { name: 'Yellow', colorClass: 'bg-yellow-400', textClass: 'text-yellow-600' },
  5: { name: 'Navy Blue', colorClass: 'bg-blue-900', textClass: 'text-blue-900' },
  6: { name: 'Brown', colorClass: 'bg-amber-800', textClass: 'text-amber-800' },
  7: { name: 'Pink', colorClass: 'bg-pink-400', textClass: 'text-pink-400' },
  8: { name: 'Violet', colorClass: 'bg-violet-600', textClass: 'text-violet-600' },
  9: { name: 'Black', colorClass: 'bg-stone-900', textClass: 'text-stone-900' },
  10: { name: 'Light Orange', colorClass: 'bg-orange-300', textClass: 'text-orange-400' },
  11: { name: 'Grey', colorClass: 'bg-slate-500', textClass: 'text-slate-500' },
  12: { name: 'Silver', colorClass: 'bg-slate-300', textClass: 'text-slate-400' }
};

export const INITIAL_STOCK: MaterialStockItem[] = [];

export const INITIAL_RECEIVING: ReceivingRecord[] = [];

export const INITIAL_RETURNS: ReturnRecord[] = [];

export const INITIAL_RECYCLING: RecyclingRecord[] = [];

export const INITIAL_ISSUANCE: IssuanceRecord[] = [];

export const INITIAL_DELIVERIES: DeliveryRecord[] = [];

export const INITIAL_ENV_LOGS: EnvironmentalLog[] = [];

export const INITIAL_FORKLIFT_CHECKS: ForkliftChecklist[] = [];
