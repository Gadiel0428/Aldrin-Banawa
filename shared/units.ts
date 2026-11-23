/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Unit-of-Measure (UOM) Normalization, Master-Data Resolution, and Grouping Utilities
 * Single source of truth imported by both server/ and src/.
 */

import { UOM_OPTIONS, type MasterRegistryItem, type MaterialStockItem } from './types';

export const MISSING_UNIT_LABEL = 'MISSING UNIT';
export const MISSING_UNIT_KEY = 'UNSPECIFIED';

const UNIT_ALIAS_MAP: Record<string, string> = {
  KG: 'KG',
  KGS: 'KG',
  KILO: 'KG',
  KILOS: 'KG',
  KILOGRAM: 'KG',
  KILOGRAMS: 'KG',
  PC: 'PCS',
  PCS: 'PCS',
  PIECE: 'PCS',
  PIECES: 'PCS',
  SET: 'SET',
  SETS: 'SET',
  BOX: 'BOX',
  BOXES: 'BOX',
  BX: 'BOX',
  UNIT: 'UNITS',
  UNITS: 'UNITS',
  UOM: '',
  L: 'LITERS',
  LTR: 'LITERS',
  LTRS: 'LITERS',
  LITER: 'LITERS',
  LITERS: 'LITERS',
  LITRE: 'LITERS',
  LITRES: 'LITERS',
  ROLL: 'ROLLS',
  ROLLS: 'ROLLS',
  RL: 'ROLLS',
  RLS: 'ROLLS',
  PACK: 'PACKS',
  PACKS: 'PACKS',
  PK: 'PACKS',
  PKS: 'PACKS',
  TUBE: 'TUBES',
  TUBES: 'TUBES',
  TB: 'TUBES',
  BAG: 'BAGS',
  BAGS: 'BAGS',
  M: 'MTRS',
  MTR: 'MTRS',
  MTRS: 'MTRS',
  METER: 'MTRS',
  METERS: 'MTRS',
  LOT: 'LOT',
  LOTS: 'LOT',
};

const EMPTY_UNIT_TOKENS = new Set([
  '',
  'N/A',
  'NA',
  'NONE',
  'NULL',
  'UNDEFINED',
  'UNKNOWN',
  'MISSING',
  'MISSING UNIT',
  'UNSPECIFIED',
  '-',
  '--',
]);

const PREFERRED_UNIT_ORDER: string[] = [
  'KG',
  'PCS',
  'SET',
  'BOX',
  'UNITS',
  'LITERS',
  'ROLLS',
  'PACKS',
  'TUBES',
  'BAGS',
  'MTRS',
  'LOT',
];

export function normalizeUnitCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!cleaned || EMPTY_UNIT_TOKENS.has(cleaned)) return '';
  if (Object.prototype.hasOwnProperty.call(UNIT_ALIAS_MAP, cleaned)) {
    return UNIT_ALIAS_MAP[cleaned];
  }
  return cleaned;
}

export function getAllSelectUomOptions(extraUnit?: unknown): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  const push = (val: unknown) => {
    const norm = normalizeUnitCode(val);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      list.push(norm);
    }
  };
  PREFERRED_UNIT_ORDER.forEach(push);
  UOM_OPTIONS.forEach(push);
  push(extraUnit);
  return list;
}

export interface UnitLookupCandidate {
  unit?: string | null;
  partCode?: string | null;
  description?: string | null;
  itemDescription?: string | null;
  materialDescription?: string | null;
  modelName?: string | null;
  itemType?: string | null;
  lotNumber?: string | null;
  stockId?: string | null;
}

export type ResolvedUnitSource = 'RECORD' | 'MASTER_DATA' | 'STOCK_BATCH' | 'MISSING';

export interface ResolvedUnitResult {
  unit: string;
  source: ResolvedUnitSource;
  isMissing: boolean;
  masterUnit?: string;
}

function normKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function findMasterPresetUnit(
  candidate: UnitLookupCandidate,
  registries: MasterRegistryItem[] = []
): string {
  if (!Array.isArray(registries) || registries.length === 0) return '';

  const partCodeKey = normKey(candidate.partCode);
  const descKey = normKey(
    candidate.description ||
      candidate.itemDescription ||
      candidate.materialDescription ||
      candidate.modelName ||
      candidate.itemType
  );

  // Prioritize BARCODE_PRESET entries, then any active registry carrying a unit
  const orderedRegistries = registries.filter((r) => r && normalizeUnitCode(r.unit) !== '');
  orderedRegistries.sort((a, b) => {
    const aPreset = a.type === 'BARCODE_PRESET' ? 0 : 1;
    const bPreset = b.type === 'BARCODE_PRESET' ? 0 : 1;
    if (aPreset !== bPreset) return aPreset - bPreset;
    const aActive = a.status === 'ACTIVE' ? 0 : 1;
    const bActive = b.status === 'ACTIVE' ? 0 : 1;
    return aActive - bActive;
  });

  if (partCodeKey) {
    const exactCode = orderedRegistries.find(
      (r) => normKey(r.code) === partCodeKey || normKey(r.name) === partCodeKey
    );
    if (exactCode) return normalizeUnitCode(exactCode.unit);
  }

  if (descKey) {
    const exactDesc = orderedRegistries.find(
      (r) =>
        normKey(r.description) === descKey ||
        normKey(r.name) === descKey ||
        normKey(r.code) === descKey
    );
    if (exactDesc) return normalizeUnitCode(exactDesc.unit);
  }

  return '';
}

export function resolveMasterDataUnit(
  candidate: UnitLookupCandidate | null | undefined,
  registries: MasterRegistryItem[] = [],
  stocks: MaterialStockItem[] = []
): ResolvedUnitResult {
  if (!candidate) {
    return { unit: '', source: 'MISSING', isMissing: true };
  }

  const recordUnit = normalizeUnitCode(candidate.unit);
  const masterUnit = findMasterPresetUnit(candidate, registries);

  if (recordUnit) {
    return {
      unit: recordUnit,
      source: 'RECORD',
      isMissing: false,
      masterUnit: masterUnit || undefined,
    };
  }

  if (masterUnit) {
    return {
      unit: masterUnit,
      source: 'MASTER_DATA',
      isMissing: false,
      masterUnit,
    };
  }

  if (Array.isArray(stocks) && stocks.length > 0) {
    const stockId = candidate.stockId ? String(candidate.stockId).trim() : '';
    const partCodeKey = normKey(candidate.partCode);
    const lotKey = normKey(candidate.lotNumber);

    if (stockId) {
      const byId = stocks.find((s) => s.id === stockId);
      const idUnit = normalizeUnitCode(byId?.unit);
      if (idUnit) {
        return { unit: idUnit, source: 'STOCK_BATCH', isMissing: false };
      }
    }

    if (partCodeKey && lotKey) {
      const byPartLot = stocks.find(
        (s) => normKey(s.partCode) === partCodeKey && normKey(s.lotNumber) === lotKey && normalizeUnitCode(s.unit) !== ''
      );
      const partLotUnit = normalizeUnitCode(byPartLot?.unit);
      if (partLotUnit) {
        return { unit: partLotUnit, source: 'STOCK_BATCH', isMissing: false };
      }
    }

    if (partCodeKey) {
      const byPart = stocks.find(
        (s) => normKey(s.partCode) === partCodeKey && normalizeUnitCode(s.unit) !== ''
      );
      const partUnit = normalizeUnitCode(byPart?.unit);
      if (partUnit) {
        return { unit: partUnit, source: 'STOCK_BATCH', isMissing: false };
      }
    }
  }

  return {
    unit: '',
    source: 'MISSING',
    isMissing: true,
  };
}

export interface UnitTotalBucket {
  key: string;
  unit: string;
  displayUnit: string;
  total: number;
  count: number;
  isMissing: boolean;
}

export interface GroupedUnitTotalsResult {
  buckets: UnitTotalBucket[];
  hasMultipleUnits: boolean;
  missingCount: number;
}

export function compareUnitKeys(aKey: string, bKey: string): number {
  if (aKey === bKey) return 0;
  if (aKey === MISSING_UNIT_KEY) return 1;
  if (bKey === MISSING_UNIT_KEY) return -1;
  const idxA = PREFERRED_UNIT_ORDER.indexOf(aKey);
  const idxB = PREFERRED_UNIT_ORDER.indexOf(bKey);
  if (idxA !== -1 && idxB !== -1) return idxA - idxB;
  if (idxA !== -1) return -1;
  if (idxB !== -1) return 1;
  return aKey.localeCompare(bKey);
}

export function groupQuantitiesByUnit<T>(
  items: T[],
  getQuantity: (item: T) => number,
  getUnit: (item: T) => string | undefined | null
): GroupedUnitTotalsResult {
  const map = new Map<string, UnitTotalBucket>();
  let missingCount = 0;

  for (const item of items) {
    const qty = Number(getQuantity(item));
    const safeQty = Number.isFinite(qty) ? qty : 0;
    const norm = normalizeUnitCode(getUnit(item));
    const isMissing = !norm;
    const key = isMissing ? MISSING_UNIT_KEY : norm;

    if (isMissing) {
      missingCount += 1;
    }

    const existing = map.get(key);
    if (existing) {
      existing.total += safeQty;
      existing.count += 1;
    } else {
      map.set(key, {
        key,
        unit: norm,
        displayUnit: isMissing ? MISSING_UNIT_LABEL : norm,
        total: safeQty,
        count: 1,
        isMissing,
      });
    }
  }

  const buckets = Array.from(map.values()).sort((a, b) => compareUnitKeys(a.key, b.key));
  const definedUnitsCount = buckets.filter((b) => !b.isMissing).length;

  return {
    buckets,
    hasMultipleUnits: definedUnitsCount > 1 || (definedUnitsCount >= 1 && missingCount > 0),
    missingCount,
  };
}

export function formatNumberForUnit(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function formatQuantityWithUnit(quantity: number, unit?: string | null): string {
  const norm = normalizeUnitCode(unit);
  const qtyStr = formatNumberForUnit(quantity);
  return `${qtyStr} ${norm || MISSING_UNIT_LABEL}`;
}

export function formatGroupedTotals(
  buckets: UnitTotalBucket[],
  separator = ' | '
): string {
  if (!buckets || buckets.length === 0) return '0';
  return buckets
    .map((b) => `${formatNumberForUnit(b.total)} ${b.displayUnit}`)
    .join(separator);
}
