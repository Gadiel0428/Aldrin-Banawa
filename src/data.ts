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
  ForkliftChecklist,
  FifoMonthColor,
  FifoColorsMap
} from './types';

// Default FIFO color mappings helper (January=1 to December=12)
export const DEFAULT_FIFO_COLORS_BY_MONTH: FifoColorsMap = {
  1: { name: 'Magenta', colorClass: 'bg-fuchsia-600', textClass: 'text-fuchsia-600', hex: '#c026d3' },
  2: { name: 'Orange', colorClass: 'bg-orange-500', textClass: 'text-orange-500', hex: '#f97316' },
  3: { name: 'Dark Green', colorClass: 'bg-emerald-800', textClass: 'text-emerald-800', hex: '#065f46' },
  4: { name: 'Yellow', colorClass: 'bg-yellow-400', textClass: 'text-yellow-600', hex: '#facc15' },
  5: { name: 'Navy Blue', colorClass: 'bg-blue-900', textClass: 'text-blue-900', hex: '#1e3a8a' },
  6: { name: 'Brown', colorClass: 'bg-amber-800', textClass: 'text-amber-800', hex: '#92400e' },
  7: { name: 'Pink', colorClass: 'bg-pink-400', textClass: 'text-pink-400', hex: '#f472b6' },
  8: { name: 'Violet', colorClass: 'bg-violet-600', textClass: 'text-violet-600', hex: '#7c3aed' },
  9: { name: 'Black', colorClass: 'bg-stone-900', textClass: 'text-stone-900', hex: '#1c1917' },
  10: { name: 'Light Orange', colorClass: 'bg-orange-300', textClass: 'text-orange-400', hex: '#fdba74' },
  11: { name: 'Grey', colorClass: 'bg-slate-500', textClass: 'text-slate-500', hex: '#64748b' },
  12: { name: 'Silver', colorClass: 'bg-slate-300', textClass: 'text-slate-400', hex: '#cbd5e1' }
};

export const FIFO_COLORS_BY_MONTH: FifoColorsMap = { ...DEFAULT_FIFO_COLORS_BY_MONTH };

export interface FifoColorOption {
  name: string;
  colorClass: string;
  textClass: string;
  hex: string;
}

export const FIFO_COLOR_PRESETS: FifoColorOption[] = [
  { name: 'Magenta', colorClass: 'bg-fuchsia-600', textClass: 'text-fuchsia-600', hex: '#c026d3' },
  { name: 'Orange', colorClass: 'bg-orange-500', textClass: 'text-orange-500', hex: '#f97316' },
  { name: 'Dark Green', colorClass: 'bg-emerald-800', textClass: 'text-emerald-800', hex: '#065f46' },
  { name: 'Yellow', colorClass: 'bg-yellow-400', textClass: 'text-yellow-600', hex: '#facc15' },
  { name: 'Navy Blue', colorClass: 'bg-blue-900', textClass: 'text-blue-900', hex: '#1e3a8a' },
  { name: 'Brown', colorClass: 'bg-amber-800', textClass: 'text-amber-800', hex: '#92400e' },
  { name: 'Pink', colorClass: 'bg-pink-400', textClass: 'text-pink-400', hex: '#f472b6' },
  { name: 'Violet', colorClass: 'bg-violet-600', textClass: 'text-violet-600', hex: '#7c3aed' },
  { name: 'Black', colorClass: 'bg-stone-900', textClass: 'text-stone-900', hex: '#1c1917' },
  { name: 'Light Orange', colorClass: 'bg-orange-300', textClass: 'text-orange-400', hex: '#fdba74' },
  { name: 'Grey', colorClass: 'bg-slate-500', textClass: 'text-slate-500', hex: '#64748b' },
  { name: 'Silver', colorClass: 'bg-slate-300', textClass: 'text-slate-400', hex: '#cbd5e1' },
  { name: 'Red', colorClass: 'bg-red-600', textClass: 'text-red-600', hex: '#dc2626' },
  { name: 'Crimson', colorClass: 'bg-rose-700', textClass: 'text-rose-700', hex: '#be123c' },
  { name: 'Blue', colorClass: 'bg-blue-600', textClass: 'text-blue-600', hex: '#2563eb' },
  { name: 'Sky Blue', colorClass: 'bg-sky-400', textClass: 'text-sky-500', hex: '#38bdf8' },
  { name: 'Green', colorClass: 'bg-green-600', textClass: 'text-green-600', hex: '#16a34a' },
  { name: 'Lime', colorClass: 'bg-lime-500', textClass: 'text-lime-600', hex: '#84cc16' },
  { name: 'Teal', colorClass: 'bg-teal-600', textClass: 'text-teal-600', hex: '#0d9488' },
  { name: 'Cyan', colorClass: 'bg-cyan-500', textClass: 'text-cyan-600', hex: '#06b6d4' },
  { name: 'Purple', colorClass: 'bg-purple-600', textClass: 'text-purple-600', hex: '#9333ea' },
  { name: 'Indigo', colorClass: 'bg-indigo-600', textClass: 'text-indigo-600', hex: '#4f46e5' },
  { name: 'Amber', colorClass: 'bg-amber-500', textClass: 'text-amber-600', hex: '#f59e0b' },
  { name: 'Gold', colorClass: 'bg-yellow-500', textClass: 'text-yellow-600', hex: '#eab308' },
  { name: 'White', colorClass: 'bg-white', textClass: 'text-slate-600', hex: '#ffffff' }
];

export function resolveFifoColor(
  name: string,
  fallbackColorClass = 'bg-indigo-600',
  fallbackTextClass = 'text-indigo-600'
): FifoMonthColor {
  const match = FIFO_COLOR_PRESETS.find(p => p.name.trim().toLowerCase() === (name || '').trim().toLowerCase());
  if (match) {
    return { name: match.name, colorClass: match.colorClass, textClass: match.textClass, hex: match.hex };
  }
  return {
    name: name || 'Custom',
    colorClass: fallbackColorClass,
    textClass: fallbackTextClass
  };
}

export const INITIAL_STOCK: MaterialStockItem[] = [];

export const INITIAL_RECEIVING: ReceivingRecord[] = [];

export const INITIAL_RETURNS: ReturnRecord[] = [];

export const INITIAL_RECYCLING: RecyclingRecord[] = [];

export const INITIAL_ISSUANCE: IssuanceRecord[] = [];

export const INITIAL_DELIVERIES: DeliveryRecord[] = [];

export const INITIAL_ENV_LOGS: EnvironmentalLog[] = [];

export const INITIAL_FORKLIFT_CHECKS: ForkliftChecklist[] = [];
