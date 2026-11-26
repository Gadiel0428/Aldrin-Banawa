/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for stock expiry & low-stock alerts (computeStockAlerts)
 */

import { describe, it, expect } from 'vitest';
import type { MasterRegistryItem, MaterialStockItem } from '../types';
import { computeStockAlerts } from './stockAlerts';

function makeStock(overrides: Partial<MaterialStockItem>): MaterialStockItem {
  return {
    id: 'STK-1',
    partCode: 'RM-RESIN-001',
    description: 'PC/ABS Resin',
    type: 'RAW',
    location: 'Zone A',
    quantity: 100,
    unit: 'KG',
    lotNumber: 'LOT-1',
    receivedDate: '2026-01-01',
    fifoColor: 'Magenta',
    status: 'APPROVED',
    ...overrides,
  };
}

describe('stockAlerts expiry & low-stock computation', () => {
  const refDate = '2026-11-01';

  it('flags lots expired before or on reference date as isExpired: true', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-PAST', lotNumber: 'LOT-PAST', expirationDate: '2026-10-25' }), // -7 days
      makeStock({ id: 'STK-TODAY', lotNumber: 'LOT-TODAY', expirationDate: '2026-11-01' }), // 0 days
    ];

    const summary = computeStockAlerts(stocks, refDate);
    expect(summary.shelfLifeCount).toBe(2);
    expect(summary.nearExpiryItems[0].diffDays).toBe(-7);
    expect(summary.nearExpiryItems[0].isExpired).toBe(true);
    expect(summary.nearExpiryItems[1].diffDays).toBe(0);
    expect(summary.nearExpiryItems[1].isExpired).toBe(true);
  });

  it('includes lots within 30-day window (1..30 days) and excludes day 31+', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-1D', lotNumber: 'LOT-1D', expirationDate: '2026-11-02' }), // +1 day
      makeStock({ id: 'STK-30D', lotNumber: 'LOT-30D', expirationDate: '2026-12-01' }), // +30 days
      makeStock({ id: 'STK-31D', lotNumber: 'LOT-31D', expirationDate: '2026-12-02' }), // +31 days
    ];

    const summary = computeStockAlerts(stocks, refDate);
    expect(summary.nearExpiryItems.map((n) => n.item.id)).toEqual(['STK-1D', 'STK-30D']);
    expect(summary.nearExpiryItems[0]).toMatchObject({ diffDays: 1, isExpired: false });
    expect(summary.nearExpiryItems[1]).toMatchObject({ diffDays: 30, isExpired: false });
  });

  it('sorts nearExpiryItems ascending by diffDays (most urgent first)', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-20', expirationDate: '2026-11-21' }),
      makeStock({ id: 'STK-EXP', expirationDate: '2026-10-20' }),
      makeStock({ id: 'STK-05', expirationDate: '2026-11-06' }),
    ];

    const summary = computeStockAlerts(stocks, refDate);
    expect(summary.nearExpiryItems.map((n) => n.item.id)).toEqual(['STK-EXP', 'STK-05', 'STK-20']);
  });

  it('ignores missing or malformed expiration dates and handles ISO datetimes cleanly', () => {
    const stocks: MaterialStockItem[] = [
      makeStock({ id: 'STK-NOEXP', expirationDate: undefined }),
      makeStock({ id: 'STK-EMPTY', expirationDate: '' }),
      makeStock({ id: 'STK-BAD', expirationDate: 'not-a-date' }),
      makeStock({ id: 'STK-ISO', expirationDate: '2026-11-10T18:45:00.000Z' }), // +9 days
    ];

    const summary = computeStockAlerts(stocks, refDate);
    expect(summary.shelfLifeCount).toBe(1);
    expect(summary.nearExpiryItems[0].item.id).toBe('STK-ISO');
    expect(summary.nearExpiryItems[0].diffDays).toBe(9);
  });

  it('deduplicates combined expiry and low-stock alerts in unifiedAlerts', () => {
    const registries: MasterRegistryItem[] = [
      {
        id: 'REG-1',
        type: 'BARCODE_PRESET',
        code: 'RM-BOTH',
        name: 'Combined Alert Material',
        unit: 'KG',
        status: 'ACTIVE',
        dateRegistered: '2026-10-01',
      },
    ];
    const stocks: MaterialStockItem[] = [
      makeStock({
        id: 'STK-BOTH',
        partCode: 'RM-BOTH',
        quantity: 10,
        reorderMin: 50,
        expirationDate: '2026-11-10',
      }),
      makeStock({
        id: 'STK-LOW-ONLY',
        partCode: 'RM-LOW',
        quantity: 5,
        reorderMin: 20,
        unit: 'PCS',
      }),
      makeStock({
        id: 'STK-QUAR-LOW',
        partCode: 'RM-QUAR',
        status: 'QUARANTINE',
        quantity: 100,
        reorderMin: 20,
        unit: 'KG',
      }),
    ];

    const summary = computeStockAlerts(stocks, refDate, registries);
    expect(summary.lowStockCount).toBe(3); // RM-BOTH (10 <= 50), RM-LOW (5 <= 20), RM-QUAR (0 approved <= 20)
    expect(summary.shelfLifeCount).toBe(1); // STK-BOTH
    expect(summary.totalCount).toBe(3); // deduplicated RM-BOTH + RM-LOW + RM-QUAR

    const combined = summary.unifiedAlerts.find((a) => a.partCode === 'RM-BOTH');
    expect(combined).toMatchObject({
      isExpiring: true,
      isLowStock: true,
      currentQty: 10,
      reorderMin: 50,
      shortage: 40,
      diffDays: 9,
    });
  });
});
