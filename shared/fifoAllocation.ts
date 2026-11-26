/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared FIFO Lot Ordering, Multi-Lot Allocation & Override Compliance Utilities
 */

import type { MaterialStockItem } from './types.ts';

export interface FifoLotAllocation {
  stockItem: MaterialStockItem;
  stockId: string;
  lotNumber: string;
  receivedDate: string;
  quantityAllocated: number;
  remainingLotQuantity: number;
}

export interface FifoAllocationResult {
  partCode: string;
  requestedQuantity: number;
  totalAvailable: number;
  totalAllocated: number;
  unallocatedQuantity: number;
  isFulfilled: boolean;
  allocations: FifoLotAllocation[];
}

export interface FifoComplianceResult {
  oldestLot: MaterialStockItem | null;
  selectedLot: MaterialStockItem | null;
  isNewerLotSelected: boolean;
  olderAvailableLots: MaterialStockItem[];
}

function roundQty(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round(val * 1_000_000) / 1_000_000;
}

function parseReceivedTimeMs(receivedDate?: string | null): number {
  if (!receivedDate) return 0;
  const parsed = new Date(receivedDate).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Returns approved, positive-quantity lots for a given partCode sorted strictly
 * in FIFO order (oldest receivedDate first, deterministic tiebreak by lotNumber & id).
 */
export function getFifoEligibleLots(
  stocks: MaterialStockItem[],
  partCode: string
): MaterialStockItem[] {
  const targetPart = String(partCode || '').trim();
  if (!targetPart || !Array.isArray(stocks)) return [];

  return stocks
    .filter(
      (s): s is MaterialStockItem =>
        Boolean(s) &&
        String(s.partCode || '').trim() === targetPart &&
        s.status === 'APPROVED' &&
        (Number(s.quantity) || 0) > 0
    )
    .sort((a, b) => {
      const timeDiff = parseReceivedTimeMs(a.receivedDate) - parseReceivedTimeMs(b.receivedDate);
      if (timeDiff !== 0) return timeDiff;
      const lotCmp = String(a.lotNumber || '').localeCompare(String(b.lotNumber || ''));
      if (lotCmp !== 0) return lotCmp;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
}

/**
 * Allocates a requested quantity across eligible approved lots in FIFO order
 * (oldest lot depleted first, spilling into newer lots when partially fulfilled).
 * Optionally accepts a custom balance resolver (e.g. movement-derived server balance).
 */
export function allocateFifoLots(
  stocks: MaterialStockItem[],
  partCode: string,
  requestedQuantity: number,
  getAvailableQty?: (stock: MaterialStockItem) => number
): FifoAllocationResult {
  const safeReq = Math.max(0, roundQty(Number(requestedQuantity) || 0));
  const candidates = getFifoEligibleLots(stocks, partCode);

  let remaining = safeReq;
  let totalAvailable = 0;
  let totalAllocated = 0;
  const allocations: FifoLotAllocation[] = [];

  for (const lot of candidates) {
    const rawAvail = getAvailableQty ? getAvailableQty(lot) : Number(lot.quantity) || 0;
    const avail = Math.max(0, roundQty(rawAvail));
    if (avail <= 0) continue;

    totalAvailable = roundQty(totalAvailable + avail);

    if (remaining <= 0) continue;

    const allocateQty = roundQty(Math.min(avail, remaining));
    if (allocateQty <= 0) continue;

    remaining = roundQty(remaining - allocateQty);
    totalAllocated = roundQty(totalAllocated + allocateQty);

    allocations.push({
      stockItem: lot,
      stockId: String(lot.id),
      lotNumber: String(lot.lotNumber || ''),
      receivedDate: String(lot.receivedDate || ''),
      quantityAllocated: allocateQty,
      remainingLotQuantity: roundQty(avail - allocateQty),
    });
  }

  return {
    partCode: String(partCode || '').trim(),
    requestedQuantity: safeReq,
    totalAvailable,
    totalAllocated,
    unallocatedQuantity: remaining,
    isFulfilled: remaining <= 0,
    allocations,
  };
}

/**
 * Checks whether choosing `selectedLotNumber` for `partCode` bypasses any older approved lot.
 */
export function checkFifoSelectionCompliance(
  availableLots: MaterialStockItem[],
  selectedLotNumber: string
): FifoComplianceResult {
  if (!Array.isArray(availableLots) || availableLots.length === 0) {
    return {
      oldestLot: null,
      selectedLot: null,
      isNewerLotSelected: false,
      olderAvailableLots: [],
    };
  }

  const ordered = [...availableLots].sort(
    (a, b) => parseReceivedTimeMs(a.receivedDate) - parseReceivedTimeMs(b.receivedDate)
  );
  const oldestLot = ordered[0] || null;
  const selectedLot = ordered.find((l) => l.lotNumber === selectedLotNumber) || null;

  if (!selectedLot || !oldestLot) {
    return {
      oldestLot,
      selectedLot,
      isNewerLotSelected: false,
      olderAvailableLots: [],
    };
  }

  const selectedDateMs = parseReceivedTimeMs(selectedLot.receivedDate);
  const olderAvailableLots = ordered.filter(
    (item) =>
      item.lotNumber !== selectedLotNumber &&
      parseReceivedTimeMs(item.receivedDate) < selectedDateMs &&
      (Number(item.quantity) || 0) > 0
  );

  return {
    oldestLot,
    selectedLot,
    isNewerLotSelected: olderAvailableLots.length > 0,
    olderAvailableLots,
  };
}
