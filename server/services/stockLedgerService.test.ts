/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for movement-derived stock balances & ledger calculations
 */

import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import type { WebSocketServer } from 'ws';
import type {
  DeliveryRecord,
  IssuanceRecord,
  MaterialStockItem,
  ReceivingRecord,
  RecyclingRecord,
  ReturnRecord,
  StockMovement,
} from '../../shared/types.ts';
import type { ServerConfig } from '../config.ts';
import { createServerContext, type ServerContext } from './context.ts';
import {
  roundStockQuantity,
  normalizeSignedMovementDelta,
  isNonStockReferenceMovement,
  doesMovementBelongToStock,
  getMovementStatsForStock,
  computeDerivedBalanceForStock,
  deriveAllStockBalances,
  ensureIdempotentMovement,
  ensureMovementsForBusinessRecord,
  rebuildMovementsMigration,
} from './stockLedgerService.ts';

function createTestContext(
  stocks: MaterialStockItem[] = [],
  stockMovements: StockMovement[] = []
): ServerContext {
  const tempDir = path.join(os.tmpdir(), 'juwei-wms-vitest');
  const config: ServerConfig = {
    port: 3000,
    dataDir: tempDir,
    backupsDir: path.join(tempDir, 'backups'),
    configuredDataDirRaw: tempDir,
    configuredDataDir: tempDir,
    isDataDirConfigured: true,
    isInsideProjectSource: false,
    dataFileSqlite: path.join(tempDir, 'central-database.sqlite'),
    dataFileJson: path.join(tempDir, 'central-database.json'),
    dataFile: path.join(tempDir, 'central-database.sqlite'),
    githubRepo: 'owner/repo',
    publicServerUrl: 'http://localhost:3000',
    publicServerSource: 'test',
    nodeEnv: 'test',
    isProduction: false,
    version: '1.0.0',
    getStorageFilePath: (filename: string) => path.join(tempDir, filename),
  };

  const ctx = createServerContext({
    serverInstanceId: 'test-instance',
    serverBootTime: '2026-11-01T00:00:00.000Z',
    config,
    wss: {} as WebSocketServer,
  });

  ctx.state.stocks = stocks;
  ctx.state.stockMovements = stockMovements;
  return ctx;
}

function makeStock(overrides: Partial<MaterialStockItem>): MaterialStockItem {
  return {
    id: 'STK-1',
    partCode: 'RM-ABS-01',
    description: 'ABS Pellets',
    type: 'RAW',
    location: 'Zone A',
    quantity: 0,
    unit: 'KG',
    lotNumber: 'LOT-A',
    receivedDate: '2026-11-01',
    fifoColor: 'Grey',
    status: 'APPROVED',
    ...overrides,
  };
}

function makeMovement(overrides: Partial<StockMovement>): StockMovement {
  return {
    id: 'mov-1',
    product_id: 'STK-1',
    warehouse_id: 'wh-main',
    type: 'PURCHASE',
    quantity: 100,
    previous_quantity: 0,
    new_quantity: 100,
    created_at: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

describe('stockLedgerService balances from movements', () => {
  it('normalizes signed movement deltas by movement type and rounds floating-point drift', () => {
    expect(roundStockQuantity(0.1 + 0.2)).toBe(0.3);

    expect(normalizeSignedMovementDelta('PURCHASE', -50)).toBe(50);
    expect(normalizeSignedMovementDelta('SALE_RETURN', -12.5)).toBe(12.5);
    expect(normalizeSignedMovementDelta('ADJUSTMENT_IN', 10)).toBe(10);
    expect(normalizeSignedMovementDelta('TRANSFER_IN', -5)).toBe(5);

    expect(normalizeSignedMovementDelta('SALE', 35)).toBe(-35);
    expect(normalizeSignedMovementDelta('PURCHASE_RETURN', 10)).toBe(-10);
    expect(normalizeSignedMovementDelta('ADJUSTMENT_OUT', 15.25)).toBe(-15.25);
    expect(normalizeSignedMovementDelta('TRANSFER_OUT', -8)).toBe(-8);
  });

  it('treats LOCATION_TRANSFER and PKG-* movements as non-balance reference movements', () => {
    expect(isNonStockReferenceMovement({ type: 'LOCATION_TRANSFER', product_id: 'STK-1' })).toBe(true);
    expect(isNonStockReferenceMovement({ type: 'RECYCLING', product_id: 'PKG-CARTON-BOX' })).toBe(true);
    expect(isNonStockReferenceMovement({ type: 'PURCHASE', product_id: 'STK-1' })).toBe(false);
  });

  it('matches movements to stock batches by exact stock id or legacy partCode + lotNumber without cross-contaminating batches', () => {
    const stockA = makeStock({ id: 'STK-A', partCode: 'RM-01', lotNumber: 'LOT-A' });
    const stockB = makeStock({ id: 'STK-B', partCode: 'RM-01', lotNumber: 'LOT-B' });
    const allIds = new Set(['STK-A', 'STK-B']);

    expect(doesMovementBelongToStock(stockA, makeMovement({ product_id: 'STK-A' }), allIds)).toBe(true);
    expect(doesMovementBelongToStock(stockA, makeMovement({ product_id: 'STK-B' }), allIds)).toBe(false);
    expect(
      doesMovementBelongToStock(stockA, makeMovement({ product_id: 'RM-01', lot_number: 'LOT-A' }), allIds)
    ).toBe(true);
    expect(
      doesMovementBelongToStock(stockA, makeMovement({ product_id: 'RM-01', lot_number: 'LOT-B' }), allIds)
    ).toBe(false);
    expect(doesMovementBelongToStock(stockB, makeMovement({ product_id: 'STK-B' }), allIds)).toBe(true);
  });

  it('derives stock balance from purchase, return, issuance, adjustment, and deduplicates idempotency keys', () => {
    const stock = makeStock({ id: 'STK-1', quantity: 999 });
    const movements: StockMovement[] = [
      makeMovement({ id: 'm1', type: 'PURCHASE', quantity: 100, idempotency_key: 'K1' }),
      makeMovement({ id: 'm1-dup', type: 'PURCHASE', quantity: 100, idempotency_key: 'K1' }), // duplicate key ignored
      makeMovement({ id: 'm2', type: 'SALE', quantity: -40, idempotency_key: 'K2' }),
      makeMovement({ id: 'm3', type: 'SALE_RETURN', quantity: 15, idempotency_key: 'K3' }),
      makeMovement({ id: 'm4', type: 'ADJUSTMENT_OUT', quantity: -4.25, idempotency_key: 'K4' }),
      makeMovement({ id: 'm5', type: 'LOCATION_TRANSFER' as StockMovement['type'], quantity: 50, idempotency_key: 'K5' }), // non-balance
    ];

    const ctx = createTestContext([stock], movements);
    const stats = getMovementStatsForStock(ctx, stock);
    expect(stats).toEqual({ total: 70.75, count: 4 });
    expect(computeDerivedBalanceForStock(ctx, stock)).toBe(70.75);

    const updatedCount = deriveAllStockBalances(ctx);
    expect(updatedCount).toBe(1);
    expect(stock.quantity).toBe(70.75);
  });

  it('enforces idempotency and negative-stock protection in ensureIdempotentMovement', () => {
    const stock = makeStock({ id: 'STK-1', quantity: 0 });
    const ctx = createTestContext([stock], []);

    const firstIn = ensureIdempotentMovement(ctx, {
      productId: 'STK-1',
      type: 'PURCHASE',
      quantity: 50,
      idempotencyKey: 'RCV:001',
    });
    expect(firstIn.success).toBe(true);
    expect(firstIn.created).toBe(true);
    expect(firstIn.replayed).toBe(false);
    expect(stock.quantity).toBe(50);

    // Replaying identical idempotency key does not add again
    const replayIn = ensureIdempotentMovement(ctx, {
      productId: 'STK-1',
      type: 'PURCHASE',
      quantity: 50,
      idempotencyKey: 'RCV:001',
    });
    expect(replayIn.success).toBe(true);
    expect(replayIn.created).toBe(false);
    expect(replayIn.replayed).toBe(true);
    expect(stock.quantity).toBe(50);

    // Over-deduction blocked when preventNegativeStock is true
    const blockedOut = ensureIdempotentMovement(ctx, {
      productId: 'STK-1',
      type: 'SALE',
      quantity: 80,
      idempotencyKey: 'ISS:OVER',
      preventNegativeStock: true,
    });
    expect(blockedOut.success).toBe(false);
    expect(blockedOut.status).toBe(400);
    expect(stock.quantity).toBe(50);

    // Partial valid deduction succeeds
    const validOut = ensureIdempotentMovement(ctx, {
      productId: 'STK-1',
      type: 'SALE',
      quantity: 30,
      idempotencyKey: 'ISS:001',
      preventNegativeStock: true,
    });
    expect(validOut.success).toBe(true);
    expect(stock.quantity).toBe(20);
  });

  it('rebuilds balances accurately across receiving, FIFO BOM deductions, returns, issuances, deliveries, and recycling', () => {
    const compOld = makeStock({
      id: 'STK-COMP-OLD',
      partCode: 'RM-RESIN',
      lotNumber: 'LOT-OLD',
      receivedDate: '2026-10-01',
      quantity: 0,
    });
    const compNew = makeStock({
      id: 'STK-COMP-NEW',
      partCode: 'RM-RESIN',
      lotNumber: 'LOT-NEW',
      receivedDate: '2026-10-15',
      quantity: 0,
    });
    const fgStock = makeStock({
      id: 'STK-FG',
      partCode: 'FG-CASE',
      type: 'FG',
      unit: 'PCS',
      lotNumber: 'LOT-FG-1',
      receivedDate: '2026-11-01',
      quantity: 0,
    });
    const pkgStock = makeStock({
      id: 'STK-PKG',
      partCode: 'PM-CARTON',
      description: 'Carton Box',
      type: 'PACKAGING',
      unit: 'PCS',
      lotNumber: 'LOT-PKG-1',
      receivedDate: '2026-10-01',
      quantity: 0,
    });

    const ctx = createTestContext([compOld, compNew, fgStock, pkgStock], []);

    // Initial stock purchase movements for resin lots & carton
    ensureIdempotentMovement(ctx, {
      productId: 'STK-COMP-OLD',
      type: 'PURCHASE',
      quantity: 40,
      idempotencyKey: 'INIT-OLD',
    });
    ensureIdempotentMovement(ctx, {
      productId: 'STK-COMP-NEW',
      type: 'PURCHASE',
      quantity: 60,
      idempotencyKey: 'INIT-NEW',
    });
    ensureIdempotentMovement(ctx, {
      productId: 'STK-PKG',
      type: 'PURCHASE',
      quantity: 20,
      idempotencyKey: 'INIT-PKG',
    });

    // 1. Internal FG receiving with autoDeductBom (55 KG RM-RESIN -> drains 40 from OLD + 15 from NEW)
    const rcvFg: ReceivingRecord = {
      id: 'RCV-FG-1',
      date: '2026-11-01',
      source: 'INTERNAL',
      itemDescription: 'Molded Case',
      partCode: 'FG-CASE',
      quantity: 100,
      unit: 'PCS',
      lotNumber: 'LOT-FG-1',
      physicalCondition: {},
      supplierOrDept: 'Molding Line',
      iqcStatus: 'NA',
      status: 'VERIFIED',
      fifoColorCode: 'Grey',
      stockId: 'STK-FG',
      autoDeductBom: true,
      bom: [{ partCode: 'RM-RESIN', description: 'Resin', quantityRequired: 55, unit: 'KG' }],
    };
    ensureMovementsForBusinessRecord(ctx, 'receiving', rcvFg, true);

    expect(compOld.quantity).toBe(0);
    expect(compNew.quantity).toBe(45);
    expect(fgStock.quantity).toBe(100);

    // 2. Issuance of 25 PCS FG
    const iss: IssuanceRecord = {
      id: 'ISS-FG-1',
      date: '2026-11-02',
      requisitionNumber: 'REQ-1',
      department: 'Assembly',
      partCode: 'FG-CASE',
      description: 'Molded Case',
      quantityRequested: 25,
      quantityIssued: 25,
      unit: 'PCS',
      lotNumber: 'LOT-FG-1',
      fifoVerified: true,
      issuedBy: 'Staff',
      receivedBy: 'Op',
      stockId: 'STK-FG',
    };
    ensureMovementsForBusinessRecord(ctx, 'issuances', iss, true);
    expect(fgStock.quantity).toBe(75);

    // 3. Shop-floor return of 5 PCS FG
    const ret: ReturnRecord = {
      id: 'RET-FG-1',
      date: '2026-11-03',
      materialDescription: 'Molded Case',
      partCode: 'FG-CASE',
      quantity: 5,
      unit: 'PCS',
      lotNumber: 'LOT-FG-1',
      department: 'Assembly',
      reason: 'Excess',
      condition: 'Good',
      iqcEvaluation: 'APPROVED_IQC',
      status: 'APPROVED',
      returnSlipFormNumber: 'RS-1',
      stockId: 'STK-FG',
    };
    ensureMovementsForBusinessRecord(ctx, 'returns', ret, true);
    expect(fgStock.quantity).toBe(80);

    // 4. Delivery transition PREPARING -> RELEASED deducts 30 PCS FG; duplicate update does not double-deduct
    const delPrep: DeliveryRecord = {
      id: 'DEL-1',
      date: '2026-11-04',
      pickingListNumber: 'PL-1',
      poNumber: 'PO-1',
      modelName: 'Molded Case',
      partCode: 'FG-CASE',
      quantity: 30,
      unit: 'PCS',
      packagingConditionOk: true,
      fifoVerified: true,
      forkliftChecklistSigned: true,
      gatePassNumber: 'GP-1',
      status: 'PREPARING',
      preparedBy: 'Staff',
      stockId: 'STK-FG',
    };
    const delReleased: DeliveryRecord = { ...delPrep, status: 'RELEASED' };
    ensureMovementsForBusinessRecord(ctx, 'deliveries', delReleased, false, delPrep);
    ensureMovementsForBusinessRecord(ctx, 'deliveries', delReleased, false, delReleased);
    expect(fgStock.quantity).toBe(50);

    // 5. Recycling Scrap Disposal (-4) and Re-used (+2) on Carton Box
    const recScrap: RecyclingRecord = {
      id: 'REC-1',
      date: '2026-11-04',
      itemType: 'Carton Box',
      quantity: 4,
      condition: 'Damaged',
      reuseCycleCount: 5,
      disposition: 'Scrap Disposal',
      logSheetNumber: 'LS-1',
      stockId: 'STK-PKG',
    };
    const recReuse: RecyclingRecord = {
      id: 'REC-2',
      date: '2026-11-04',
      itemType: 'Carton Box',
      quantity: 2,
      condition: 'Reusable',
      reuseCycleCount: 2,
      disposition: 'Re-used',
      logSheetNumber: 'LS-2',
      stockId: 'STK-PKG',
    };
    ensureMovementsForBusinessRecord(ctx, 'recycling', recScrap, true);
    ensureMovementsForBusinessRecord(ctx, 'recycling', recReuse, true);
    expect(pkgStock.quantity).toBe(18);
  });

  it('migrates legacy un-movemented stock balances via rebuildMovementsMigration idempotently', () => {
    const legacyStock = makeStock({ id: 'STK-LEGACY', quantity: 75 });
    const ctx = createTestContext([legacyStock], []);

    const res1 = rebuildMovementsMigration(ctx, { skipCommit: true });
    expect(res1.success).toBe(true);
    expect(res1.baselineMovements).toBe(1);
    expect(legacyStock.quantity).toBe(75);
    expect(computeDerivedBalanceForStock(ctx, legacyStock)).toBe(75);

    // Second run is a clean idempotent no-op
    const res2 = rebuildMovementsMigration(ctx, { skipCommit: true });
    expect(res2.createdMovements).toBe(0);
    expect(res2.baselineMovements).toBe(0);
    expect(legacyStock.quantity).toBe(75);
  });
});
