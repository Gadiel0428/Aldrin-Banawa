/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for FIFO lot ordering, multi-lot allocation, and override compliance
 */

import { describe, it, expect } from 'vitest';
import type { MaterialStockItem } from './types.ts';
import {
  getFifoEligibleLots,
  allocateFifoLots,
  checkFifoSelectionCompliance,
} from './fifoAllocation.ts';

function makeStock(overrides: Partial<MaterialStockItem>): MaterialStockItem {
  return {
    id: 'STK-1',
    partCode: 'RM-ABS-001',
    description: 'ABS Resin Natural',
    type: 'RAW',
    location: 'Zone A',
    quantity: 100,
    unit: 'KG',
    lotNumber: 'LOT-001',
    receivedDate: '2026-01-10',
    fifoColor: 'Magenta',
    status: 'APPROVED',
    ...overrides,
  };
}

describe('FIFO allocation', () => {
  it('orders approved positive-quantity lots oldest-first by receivedDate', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-3', lotNumber: 'LOT-MAR', receivedDate: '2026-03-01', quantity: 50 }),
      makeStock({ id: 'STK-1', lotNumber: 'LOT-JAN', receivedDate: '2026-01-05', quantity: 30 }),
      makeStock({ id: 'STK-2', lotNumber: 'LOT-FEB', receivedDate: '2026-02-12', quantity: 40 }),
    ];

    const ordered = getFifoEligibleLots(stocks, 'RM-ABS-001');
    expect(ordered.map((l) => l.lotNumber)).toEqual(['LOT-JAN', 'LOT-FEB', 'LOT-MAR']);
  });

  it('excludes QUARANTINE, HOLD, zero-quantity, and non-matching partCode lots', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-Q', lotNumber: 'LOT-QUAR', receivedDate: '2026-01-01', status: 'QUARANTINE', quantity: 100 }),
      makeStock({ id: 'STK-H', lotNumber: 'LOT-HOLD', receivedDate: '2026-01-02', status: 'HOLD', quantity: 100 }),
      makeStock({ id: 'STK-0', lotNumber: 'LOT-ZERO', receivedDate: '2026-01-03', status: 'APPROVED', quantity: 0 }),
      makeStock({ id: 'STK-OTHER', partCode: 'RM-PP-999', lotNumber: 'LOT-PP', receivedDate: '2026-01-04', quantity: 100 }),
      makeStock({ id: 'STK-OK', lotNumber: 'LOT-OK', receivedDate: '2026-02-01', status: 'APPROVED', quantity: 25 }),
    ];

    const eligible = getFifoEligibleLots(stocks, 'RM-ABS-001');
    expect(eligible).toHaveLength(1);
    expect(eligible[0].lotNumber).toBe('LOT-OK');
  });

  it('uses deterministic tie-breaking by lotNumber when receivedDate matches', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-B', lotNumber: 'LOT-B', receivedDate: '2026-02-01', quantity: 10 }),
      makeStock({ id: 'STK-A', lotNumber: 'LOT-A', receivedDate: '2026-02-01', quantity: 10 }),
    ];

    const eligible = getFifoEligibleLots(stocks, 'RM-ABS-001');
    expect(eligible.map((l) => l.lotNumber)).toEqual(['LOT-A', 'LOT-B']);
  });

  it('allocates single-lot fulfillment from the oldest lot without touching newer lots', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-NEW', lotNumber: 'LOT-NEW', receivedDate: '2026-03-10', quantity: 80 }),
      makeStock({ id: 'STK-OLD', lotNumber: 'LOT-OLD', receivedDate: '2026-01-10', quantity: 60 }),
    ];

    const plan = allocateFifoLots(stocks, 'RM-ABS-001', 40);
    expect(plan.isFulfilled).toBe(true);
    expect(plan.totalAllocated).toBe(40);
    expect(plan.unallocatedQuantity).toBe(0);
    expect(plan.totalAvailable).toBe(140);
    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0]).toMatchObject({
      stockId: 'STK-OLD',
      lotNumber: 'LOT-OLD',
      quantityAllocated: 40,
      remainingLotQuantity: 20,
    });
  });

  it('splits allocation across multiple lots in FIFO order when oldest lot is partially consumed', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-3', lotNumber: 'LOT-3', receivedDate: '2026-03-01', quantity: 100 }),
      makeStock({ id: 'STK-1', lotNumber: 'LOT-1', receivedDate: '2026-01-01', quantity: 25.5 }),
      makeStock({ id: 'STK-2', lotNumber: 'LOT-2', receivedDate: '2026-02-01', quantity: 30 }),
    ];

    const plan = allocateFifoLots(stocks, 'RM-ABS-001', 70);
    expect(plan.isFulfilled).toBe(true);
    expect(plan.totalAllocated).toBe(70);
    expect(plan.unallocatedQuantity).toBe(0);
    expect(plan.allocations.map((a) => ({ lot: a.lotNumber, qty: a.quantityAllocated, rem: a.remainingLotQuantity }))).toEqual([
      { lot: 'LOT-1', qty: 25.5, rem: 0 },
      { lot: 'LOT-2', qty: 30, rem: 0 },
      { lot: 'LOT-3', qty: 14.5, rem: 85.5 },
    ]);
  });

  it('reports unallocated shortfall when total approved stock is insufficient', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-1', lotNumber: 'LOT-1', receivedDate: '2026-01-01', quantity: 15 }),
      makeStock({ id: 'STK-2', lotNumber: 'LOT-2', receivedDate: '2026-02-01', quantity: 10 }),
      makeStock({ id: 'STK-Q', lotNumber: 'LOT-Q', receivedDate: '2026-01-15', status: 'QUARANTINE', quantity: 200 }),
    ];

    const plan = allocateFifoLots(stocks, 'RM-ABS-001', 40);
    expect(plan.isFulfilled).toBe(false);
    expect(plan.totalAvailable).toBe(25);
    expect(plan.totalAllocated).toBe(25);
    expect(plan.unallocatedQuantity).toBe(15);
    expect(plan.allocations).toHaveLength(2);
  });

  it('supports custom derived balance resolver (server ledger integration)', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-1', lotNumber: 'LOT-1', receivedDate: '2026-01-01', quantity: 999 }),
      makeStock({ id: 'STK-2', lotNumber: 'LOT-2', receivedDate: '2026-02-01', quantity: 999 }),
    ];

    const derivedBalances: Record<string, number> = { 'STK-1': 5, 'STK-2': 20 };
    const plan = allocateFifoLots(stocks, 'RM-ABS-001', 12, (s) => derivedBalances[s.id] ?? 0);

    expect(plan.isFulfilled).toBe(true);
    expect(plan.totalAvailable).toBe(25);
    expect(plan.allocations.map((a) => ({ id: a.stockId, qty: a.quantityAllocated, rem: a.remainingLotQuantity }))).toEqual([
      { id: 'STK-1', qty: 5, rem: 0 },
      { id: 'STK-2', qty: 7, rem: 13 },
    ]);
  });

  it('handles zero or negative requested quantities safely', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-1', lotNumber: 'LOT-1', quantity: 50 }),
    ];

    const zeroPlan = allocateFifoLots(stocks, 'RM-ABS-001', 0);
    expect(zeroPlan.isFulfilled).toBe(true);
    expect(zeroPlan.totalAllocated).toBe(0);
    expect(zeroPlan.allocations).toEqual([]);

    const negPlan = allocateFifoLots(stocks, 'RM-ABS-001', -10);
    expect(negPlan.isFulfilled).toBe(true);
    expect(negPlan.totalAllocated).toBe(0);
    expect(negPlan.allocations).toEqual([]);
  });

  it('flags non-FIFO selection when an older approved lot exists', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-1', lotNumber: 'LOT-JAN', receivedDate: '2026-01-10', quantity: 20 }),
      makeStock({ id: 'STK-2', lotNumber: 'LOT-FEB', receivedDate: '2026-02-15', quantity: 50 }),
    ];

    const compliant = checkFifoSelectionCompliance(stocks, 'LOT-JAN');
    expect(compliant.isNewerLotSelected).toBe(false);
    expect(compliant.olderAvailableLots).toHaveLength(0);
    expect(compliant.oldestLot?.lotNumber).toBe('LOT-JAN');

    const override = checkFifoSelectionCompliance(stocks, 'LOT-FEB');
    expect(override.isNewerLotSelected).toBe(true);
    expect(override.olderAvailableLots.map((l) => l.lotNumber)).toEqual(['LOT-JAN']);
    expect(override.oldestLot?.lotNumber).toBe('LOT-JAN');
  });
});
