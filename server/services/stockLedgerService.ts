/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Movement-Derived Stock Ledger, Idempotent Migration & Nightly Reconciliation Service
 */

import fs from "fs";
import path from "path";
import type {
  DeliveryRecord,
  IssuanceRecord,
  MaterialStockItem,
  RebuildMovementsResult,
  ReceivingRecord,
  ReconcileMismatch,
  ReconcileMissingUnitItem,
  ReconcileOrphanMovementSummary,
  ReconcileReport,
  RecyclingRecord,
  ReturnRecord,
  StockMovement,
  StockMovementType,
} from "../../shared/types.ts";
import { normalizeUnitCode, resolveMasterDataUnit } from "../../shared/units.ts";
import { allocateFifoLots } from "../../shared/fifoAllocation.ts";
import logger from "../../src/lib/logger.ts";
import { mapStockMovementFromApi } from "../api/mapper.ts";
import { recordAuditTrail } from "./auditService.ts";
import { commitDatabase } from "./backupService.ts";
import { normalizeBaseRecord, type ServerContext } from "./context.ts";
import { getFifoColorForDate } from "./fifoService.ts";

export const NON_BALANCE_MOVEMENT_TYPES = new Set<string>(["LOCATION_TRANSFER"]);

const OUTBOUND_NEGATIVE_TYPES = new Set<string>([
  "SALE",
  "PURCHASE_RETURN",
  "ADJUSTMENT_OUT",
  "TRANSFER_OUT",
]);

const INBOUND_POSITIVE_TYPES = new Set<string>([
  "PURCHASE",
  "SALE_RETURN",
  "ADJUSTMENT_IN",
  "TRANSFER_IN",
]);

export function roundStockQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function normalizeSignedMovementDelta(
  type: string,
  quantityOrDelta: number
): number {
  let finalDelta = Number(quantityOrDelta);
  if (!Number.isFinite(finalDelta)) return 0;

  if (OUTBOUND_NEGATIVE_TYPES.has(type)) {
    if (finalDelta > 0) finalDelta = -finalDelta;
  } else if (INBOUND_POSITIVE_TYPES.has(type)) {
    if (finalDelta < 0) finalDelta = Math.abs(finalDelta);
  }
  return roundStockQuantity(finalDelta);
}

export function isNonStockReferenceMovement(m: Partial<StockMovement> | Record<string, any>): boolean {
  if (!m) return true;
  if (NON_BALANCE_MOVEMENT_TYPES.has(String(m.type || ""))) {
    return true;
  }
  const prodId = String(m.product_id || "").trim();
  if (prodId.startsWith("PKG-")) {
    return true;
  }
  return false;
}

export function findMovementByIdempotencyKey(
  ctx: ServerContext,
  idempotencyKey?: string | null
): StockMovement | undefined {
  const cleanKey = String(idempotencyKey || "").trim();
  if (!cleanKey || !Array.isArray(ctx.state.stockMovements)) return undefined;
  return ctx.state.stockMovements.find(
    (m) => String(m?.idempotency_key || "").trim() === cleanKey
  );
}

export function resolveStockItemForMovement(
  ctx: ServerContext,
  productId?: string | null,
  lotNumber?: string | null
): MaterialStockItem | undefined {
  const cleanProductId = String(productId || "").trim();
  if (!cleanProductId) return undefined;
  const stocks = Array.isArray(ctx.state.stocks) ? ctx.state.stocks : [];

  const byId = stocks.find(
    (s) => s && (String(s.id) === cleanProductId || String((s as any).record_id || "") === cleanProductId)
  );
  if (byId) return byId;

  const cleanLot = String(lotNumber || "").trim();
  if (cleanLot) {
    const byPartAndLot = stocks.find(
      (s) =>
        s &&
        String(s.partCode || "").trim() === cleanProductId &&
        String(s.lotNumber || "").trim() === cleanLot
    );
    if (byPartAndLot) return byPartAndLot;
  }

  return stocks.find((s) => s && String(s.partCode || "").trim() === cleanProductId);
}

export function doesMovementBelongToStock(
  stockItem: MaterialStockItem,
  movement: StockMovement,
  allStockIds?: Set<string>
): boolean {
  if (!stockItem || !movement || isNonStockReferenceMovement(movement)) {
    return false;
  }
  const movProdId = String(movement.product_id || "").trim();
  const stockId = String(stockItem.id || "").trim();
  if (!movProdId || !stockId) return false;

  if (movProdId === stockId) {
    return true;
  }

  // Legacy fallback: movements created before batch ID linking stored partCode in product_id
  const knownIds =
    allStockIds || new Set<string>((stockId ? [stockId] : []));
  if (knownIds.has(movProdId)) {
    // Movement belongs to another distinct stock batch ID
    return false;
  }

  const partCode = String(stockItem.partCode || "").trim();
  const sku = String(movement.product_sku || "").trim();
  const partMatches = Boolean(partCode) && (movProdId === partCode || sku === partCode);
  if (!partMatches) return false;

  const movLot = String(movement.lot_number || "").trim();
  const stockLot = String(stockItem.lotNumber || "").trim();
  if (movLot && stockLot && movLot !== stockLot) {
    return false;
  }

  return true;
}

export function getMovementStatsForStock(
  ctx: ServerContext,
  stockItem: MaterialStockItem,
  allStockIds?: Set<string>
): { total: number; count: number } {
  const movements = Array.isArray(ctx.state.stockMovements) ? ctx.state.stockMovements : [];
  const stockIds =
    allStockIds || new Set<string>((ctx.state.stocks || []).map((s) => String(s.id)));
  const seenKeys = new Set<string>();

  let total = 0;
  let count = 0;

  for (const m of movements) {
    if (!m || !doesMovementBelongToStock(stockItem, m, stockIds)) continue;
    const key = String(m.idempotency_key || "").trim();
    if (key) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    total += Number(m.quantity) || 0;
    count += 1;
  }

  return {
    total: roundStockQuantity(total),
    count,
  };
}

export function computeDerivedBalanceForStock(
  ctx: ServerContext,
  stockItem: MaterialStockItem,
  allStockIds?: Set<string>
): number {
  return getMovementStatsForStock(ctx, stockItem, allStockIds).total;
}

export function deriveAllStockBalances(ctx: ServerContext): number {
  const stocks = Array.isArray(ctx.state.stocks) ? ctx.state.stocks : [];
  const stockIds = new Set<string>(stocks.map((s) => String(s.id)));
  let updatedCount = 0;

  for (const stock of stocks) {
    if (!stock) continue;
    const derived = computeDerivedBalanceForStock(ctx, stock, stockIds);
    const current = Number(stock.quantity) || 0;
    if (roundStockQuantity(current) !== derived) {
      stock.quantity = derived;
      updatedCount++;
    }
  }

  return updatedCount;
}

export interface EnsureMovementParams {
  productId: string;
  warehouseId?: string;
  accountId?: string;
  type: StockMovementType;
  quantity: number;
  delta?: number;
  referenceId?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  userId?: string | null;
  userName?: string;
  deviceId?: string;
  idempotencyKey: string;
  preventNegativeStock?: boolean;
  lotNumber?: string;
  location?: string;
  createdAt?: string;
  allowCreateMissingStock?: boolean;
  allowUnlinkedReference?: boolean;
  fallbackPartCode?: string;
  fallbackDescription?: string;
  fallbackUnit?: string;
}

export interface EnsureMovementOutcome {
  success: boolean;
  status: number;
  error?: string;
  created: boolean;
  replayed: boolean;
  movement?: StockMovement;
  stockItem?: MaterialStockItem;
}

export function ensureIdempotentMovement(
  ctx: ServerContext,
  params: EnsureMovementParams
): EnsureMovementOutcome {
  const idempotencyKey = String(params.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    return {
      success: false,
      status: 400,
      error: "idempotency_key is required",
      created: false,
      replayed: false,
    };
  }

  const existingMovement = findMovementByIdempotencyKey(ctx, idempotencyKey);
  if (existingMovement) {
    const existingStock = resolveStockItemForMovement(
      ctx,
      existingMovement.product_id,
      existingMovement.lot_number
    );
    if (existingStock) {
      existingStock.quantity = computeDerivedBalanceForStock(ctx, existingStock);
    }
    return {
      success: true,
      status: 200,
      created: false,
      replayed: true,
      movement: existingMovement,
      stockItem: existingStock,
    };
  }

  const serverTime = params.createdAt || new Date().toISOString();
  let stockItem = resolveStockItemForMovement(ctx, params.productId, params.lotNumber);
  const allStockIds = new Set<string>((ctx.state.stocks || []).map((s) => String(s.id)));

  const rawDelta = params.delta !== undefined ? params.delta : params.quantity;
  const finalDelta = normalizeSignedMovementDelta(params.type, rawDelta);
  const isBalanceMovement =
    !NON_BALANCE_MOVEMENT_TYPES.has(params.type) && !params.allowUnlinkedReference;

  if (!stockItem && !params.allowUnlinkedReference && params.allowCreateMissingStock !== false) {
    const cleanId = String(params.productId || "").trim();
    const receivedDate = serverTime.split("T")[0];
    const resolvedUnit = resolveMasterDataUnit(
      {
        unit: params.fallbackUnit,
        partCode: params.fallbackPartCode || cleanId,
        description: params.fallbackDescription || params.notes,
        lotNumber: params.lotNumber,
        stockId: cleanId,
      },
      ctx.state.registries,
      ctx.state.stocks
    );
    stockItem = normalizeBaseRecord(
      {
        id: cleanId,
        partCode: params.fallbackPartCode || cleanId,
        description: params.fallbackDescription || params.notes || "Warehouse Stock Item",
        type: "RAW",
        location: params.location || "Zone A",
        quantity: 0,
        unit: resolvedUnit.unit,
        ...(resolvedUnit.isMissing ? { unitMissing: true } : {}),
        lotNumber: params.lotNumber || "",
        receivedDate,
        fifoColor: getFifoColorForDate(
          ctx,
          receivedDate,
          ctx.state.fifoColorsByMonth
        ),
        status: "APPROVED",
        warehouseId: params.warehouseId || "wh-main",
        accountId: params.accountId || "ACC-JUWEI",
      },
      ctx.systemResetVersion
    ) as MaterialStockItem;
    ctx.state.stocks.push(stockItem);
    allStockIds.add(String(stockItem.id));
  }

  const prevQty = stockItem
    ? computeDerivedBalanceForStock(ctx, stockItem, allStockIds)
    : 0;
  const projectedQty = isBalanceMovement
    ? roundStockQuantity(prevQty + finalDelta)
    : prevQty;

  if (params.preventNegativeStock && isBalanceMovement && projectedQty < 0) {
    return {
      success: false,
      status: 400,
      error: `Insufficient stock in central database. Available: ${prevQty}, Requested: ${finalDelta}`,
      created: false,
      replayed: false,
    };
  }

  const resolvedProductId = stockItem ? String(stockItem.id) : String(params.productId);
  const resolvedMovUnit = resolveMasterDataUnit(
    {
      unit: stockItem?.unit || params.fallbackUnit,
      partCode: stockItem?.partCode || params.fallbackPartCode || params.productId,
      description: stockItem?.description || params.fallbackDescription,
      lotNumber: params.lotNumber || stockItem?.lotNumber,
      stockId: resolvedProductId,
    },
    ctx.state.registries,
    ctx.state.stocks
  );
  const movementId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const movementRecord = mapStockMovementFromApi({
    id: movementId,
    product_id: resolvedProductId,
    warehouse_id: params.warehouseId || stockItem?.warehouseId || "wh-main",
    account_id: params.accountId || stockItem?.accountId || "ACC-JUWEI",
    type: params.type,
    quantity: NON_BALANCE_MOVEMENT_TYPES.has(params.type)
      ? Math.abs(Number(params.quantity) || 0)
      : finalDelta,
    previous_quantity: prevQty,
    new_quantity: projectedQty,
    reference_id: params.referenceId ?? null,
    reference_number: params.referenceNumber ?? null,
    notes: params.notes ?? null,
    user_id: params.userId ?? null,
    user_name: params.userName || "Operator",
    device_id: params.deviceId || "CENTRAL-SERVER",
    idempotency_key: idempotencyKey,
    created_at: serverTime,
    product_name: stockItem?.description || params.fallbackDescription,
    product_sku: stockItem?.partCode || params.fallbackPartCode || params.productId,
    unit: resolvedMovUnit.unit,
    ...(resolvedMovUnit.isMissing ? { unitMissing: true } : {}),
    lot_number: params.lotNumber || stockItem?.lotNumber || "",
    location: params.location || stockItem?.location || "",
    reset_version: ctx.systemResetVersion,
  });

  if (!ctx.state.stockMovements) ctx.state.stockMovements = [];
  ctx.state.stockMovements.unshift(movementRecord);

  if (stockItem) {
    stockItem.quantity = computeDerivedBalanceForStock(ctx, stockItem, allStockIds);
    stockItem.version = (Number(stockItem.version) || 1) + 1;
    stockItem.updated_at = serverTime;
    stockItem.reset_version = ctx.systemResetVersion;
    if (params.location) stockItem.location = params.location;
    if (params.lotNumber && !stockItem.lotNumber) stockItem.lotNumber = params.lotNumber;
  }

  return {
    success: true,
    status: 200,
    created: true,
    replayed: false,
    movement: movementRecord,
    stockItem,
  };
}

function findMatchingStockForBusinessRecord(
  ctx: ServerContext,
  opts: {
    stockId?: string;
    partCode?: string;
    lotNumber?: string;
    preferApproved?: boolean;
  }
): MaterialStockItem | undefined {
  const stocks = Array.isArray(ctx.state.stocks) ? ctx.state.stocks : [];
  if (opts.stockId) {
    const exact = stocks.find((s) => s && String(s.id) === String(opts.stockId));
    if (exact) return exact;
  }

  const part = String(opts.partCode || "").trim();
  const lot = String(opts.lotNumber || "").trim();
  if (!part) return undefined;

  if (lot) {
    const exactPartAndLot = stocks.find(
      (s) =>
        s &&
        String(s.partCode || "").trim() === part &&
        String(s.lotNumber || "").trim() === lot &&
        (!opts.preferApproved || s.status === "APPROVED")
    );
    if (exactPartAndLot) return exactPartAndLot;

    const anyStatusPartAndLot = stocks.find(
      (s) =>
        s &&
        String(s.partCode || "").trim() === part &&
        String(s.lotNumber || "").trim() === lot
    );
    if (anyStatusPartAndLot) return anyStatusPartAndLot;
  }

  if (opts.preferApproved) {
    const approvedMatches = stocks
      .filter((s) => s && String(s.partCode || "").trim() === part && s.status === "APPROVED")
      .sort((a, b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
    if (approvedMatches.length > 0) return approvedMatches[0];
  }

  return stocks.find((s) => s && String(s.partCode || "").trim() === part);
}

function resolvePackagingStockForRecycling(
  ctx: ServerContext,
  rec: RecyclingRecord
): MaterialStockItem | undefined {
  if (rec.stockId) {
    const byId = (ctx.state.stocks || []).find((s) => s && s.id === rec.stockId);
    if (byId) return byId;
  }
  const keyword = String(rec.itemType || "").trim().toUpperCase();
  if (!keyword) return undefined;
  return (ctx.state.stocks || []).find(
    (s) =>
      s &&
      s.type === "PACKAGING" &&
      (String(s.description || "").toUpperCase().includes(keyword) ||
        String(s.partCode || "").toUpperCase().includes(keyword))
  );
}

function toSlug(input: string): string {
  return String(input || "PACKAGING")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function ensureMovementsForBusinessRecord(
  ctx: ServerContext,
  collection: string,
  record: any,
  isCreation: boolean,
  prevRecord?: any
): { createdMovements: StockMovement[]; updatedStocks: MaterialStockItem[] } {
  const createdMovements: StockMovement[] = [];
  const updatedStocksMap = new Map<string, MaterialStockItem>();

  if (!record || typeof record !== "object") {
    return { createdMovements, updatedStocks: [] };
  }

  const recordId = String(record.id || record.record_id || "").trim();
  if (!recordId) {
    return { createdMovements, updatedStocks: [] };
  }

  if (collection === "stocks") {
    const stock = record as MaterialStockItem;
    const stockId = String(stock.id || (stock as any).record_id || "").trim();
    const savedQty = roundStockQuantity(Number(stock.quantity) || 0);
    const derivedBalance = computeDerivedBalanceForStock(ctx, stock);
    const delta = roundStockQuantity(savedQty - derivedBalance);

    if (delta !== 0) {
      const outcome = ensureIdempotentMovement(ctx, {
        productId: stockId,
        warehouseId: stock.warehouseId || "WH-MAIN",
        accountId: stock.accountId || "ACC-JUWEI",
        type: delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: Math.abs(delta),
        delta,
        referenceId: stockId,
        referenceNumber: `STOCK-ADJ-${stockId}`,
        notes: isCreation
          ? `Initial stock creation baseline (${savedQty})`
          : `Stock quantity adjustment (${derivedBalance} -> ${savedQty})`,
        userId: (stock as any).user_id || null,
        userName: (stock as any).updated_by || (stock as any).created_by || "Operator",
        deviceId: (stock as any).device_id || "CENTRAL-SERVER",
        idempotencyKey: `STOCK-QTY:${stockId}:v${stock.version || 1}:${savedQty}`,
        preventNegativeStock: false,
        lotNumber: stock.lotNumber,
        location: stock.location,
        createdAt: stock.updated_at || stock.created_at || undefined,
        allowCreateMissingStock: false,
        fallbackPartCode: stock.partCode,
        fallbackDescription: stock.description,
        fallbackUnit: stock.unit,
      });

      if (outcome.created && outcome.movement) {
        createdMovements.push(outcome.movement);
      }
      if (outcome.stockItem) {
        updatedStocksMap.set(outcome.stockItem.id, outcome.stockItem);
      }
    }

    // Crucial: Make sure the saved quantity is not overwritten
    stock.quantity = savedQty;
    if (record.version !== undefined && record.version !== null) {
      stock.version = Number(record.version);
    }
  } else if (collection === "receiving" && isCreation) {
    const rcv = record as ReceivingRecord;
    const stockMatch = findMatchingStockForBusinessRecord(ctx, {
      stockId: rcv.stockId,
      partCode: rcv.partCode,
      lotNumber: rcv.lotNumber,
    });
    const qty = Math.abs(Number(rcv.quantity) || 0);
    if (qty > 0 || stockMatch) {
      const outcome = ensureIdempotentMovement(ctx, {
        productId: stockMatch ? stockMatch.id : String(rcv.stockId || rcv.partCode),
        type: "PURCHASE",
        quantity: qty,
        delta: qty,
        referenceId: recordId,
        referenceNumber: rcv.rrNumber || rcv.poNumber || recordId,
        notes: `Receipt of ${rcv.partCode}${rcv.lotNumber ? ` (Lot: ${rcv.lotNumber})` : ""}`,
        userId: (rcv as any).user_id || null,
        userName: (rcv as any).created_by || (rcv as any).updated_by || "Operator",
        deviceId: (rcv as any).device_id || "CENTRAL-SERVER",
        idempotencyKey: rcv.movementIdempotencyKey || `RCV:${recordId}`,
        preventNegativeStock: false,
        lotNumber: rcv.lotNumber,
        location: rcv.location || stockMatch?.location,
        createdAt: rcv.created_at || undefined,
        allowCreateMissingStock: Boolean(rcv.stockId || rcv.partCode),
        fallbackPartCode: rcv.partCode,
        fallbackDescription: rcv.itemDescription,
        fallbackUnit: rcv.unit,
      });
      if (outcome.created && outcome.movement) {
        createdMovements.push(outcome.movement);
      }
      if (outcome.stockItem) {
        updatedStocksMap.set(outcome.stockItem.id, outcome.stockItem);
      }
    }

    const isInternal = rcv.source === "INTERNAL" || rcv.source === "WIP/BOM/FG(Internal)";
    if (isInternal && Array.isArray(rcv.bom) && rcv.bom.length > 0 && rcv.autoDeductBom) {
      for (const bomItem of rcv.bom) {
        const plan = allocateFifoLots(
          ctx.state.stocks || [],
          bomItem.partCode,
          bomItem.quantityRequired,
          (compStock) => computeDerivedBalanceForStock(ctx, compStock)
        );
        for (const { stockItem: compStock, quantityAllocated: deductAmount } of plan.allocations) {
          const bomOutcome = ensureIdempotentMovement(ctx, {
            productId: compStock.id,
            type: "ADJUSTMENT_OUT",
            quantity: deductAmount,
            delta: -Math.abs(deductAmount),
            referenceId: recordId,
            referenceNumber: rcv.transferFormNumber || rcv.rrNumber || recordId,
            notes: `Auto-BOM deduction for ${rcv.partCode} (Receipt: ${recordId})`,
            userId: (rcv as any).user_id || null,
            userName: (rcv as any).created_by || (rcv as any).updated_by || "Operator",
            deviceId: (rcv as any).device_id || "CENTRAL-SERVER",
            idempotencyKey: `RCV-BOM:${recordId}:${compStock.id}`,
            preventNegativeStock: false,
            lotNumber: compStock.lotNumber,
            location: compStock.location,
            createdAt: rcv.created_at || undefined,
            allowCreateMissingStock: false,
          });
          if (bomOutcome.created && bomOutcome.movement) {
            createdMovements.push(bomOutcome.movement);
          }
          if (bomOutcome.stockItem) {
            updatedStocksMap.set(bomOutcome.stockItem.id, bomOutcome.stockItem);
          }
        }
      }
    }
  } else if (collection === "returns" && isCreation) {
    const ret = record as ReturnRecord;
    const stockMatch = findMatchingStockForBusinessRecord(ctx, {
      stockId: ret.stockId,
      partCode: ret.partCode,
      lotNumber: ret.lotNumber,
    });
    const qty = Math.abs(Number(ret.quantity) || 0);
    if (qty > 0 || stockMatch) {
      const outcome = ensureIdempotentMovement(ctx, {
        productId: stockMatch ? stockMatch.id : String(ret.stockId || ret.partCode),
        type: "SALE_RETURN",
        quantity: qty,
        delta: qty,
        referenceId: recordId,
        referenceNumber: ret.returnSlipFormNumber || recordId,
        notes: `Shop-floor return: ${ret.partCode}${ret.reason ? ` (${ret.reason})` : ""}`,
        userId: (ret as any).user_id || null,
        userName: (ret as any).created_by || (ret as any).updated_by || "Operator",
        deviceId: (ret as any).device_id || "CENTRAL-SERVER",
        idempotencyKey: ret.movementIdempotencyKey || `RET:${recordId}`,
        preventNegativeStock: false,
        lotNumber: ret.lotNumber,
        createdAt: ret.created_at || undefined,
        allowCreateMissingStock: Boolean(ret.stockId || ret.partCode),
        fallbackPartCode: ret.partCode,
        fallbackDescription: ret.materialDescription,
        fallbackUnit: ret.unit,
      });
      if (outcome.created && outcome.movement) {
        createdMovements.push(outcome.movement);
      }
      if (outcome.stockItem) {
        updatedStocksMap.set(outcome.stockItem.id, outcome.stockItem);
      }
    }
  } else if (collection === "issuances" && isCreation) {
    const iss = record as IssuanceRecord;
    const qty = Math.abs(Number(iss.quantityIssued) || 0);
    if (qty > 0) {
      const stockMatch = findMatchingStockForBusinessRecord(ctx, {
        stockId: iss.stockId,
        partCode: iss.partCode,
        lotNumber: iss.lotNumber,
        preferApproved: true,
      });
      if (stockMatch) {
        const outcome = ensureIdempotentMovement(ctx, {
          productId: stockMatch.id,
          type: "SALE",
          quantity: qty,
          delta: -qty,
          referenceId: recordId,
          referenceNumber: iss.requisitionNumber || recordId,
          notes: `Issued to ${iss.department || "Production"} (${iss.partCode}, Lot: ${iss.lotNumber})`,
          userId: (iss as any).user_id || null,
          userName: iss.issuedBy || (iss as any).created_by || "Operator",
          deviceId: (iss as any).device_id || "CENTRAL-SERVER",
          idempotencyKey: iss.movementIdempotencyKey || `ISS:${recordId}`,
          preventNegativeStock: false,
          lotNumber: iss.lotNumber || stockMatch.lotNumber,
          location: stockMatch.location,
          createdAt: iss.created_at || undefined,
          allowCreateMissingStock: false,
        });
        if (outcome.created && outcome.movement) {
          createdMovements.push(outcome.movement);
        }
        if (outcome.stockItem) {
          updatedStocksMap.set(outcome.stockItem.id, outcome.stockItem);
        }
      }
    }
  } else if (collection === "recycling" && isCreation) {
    const rec = record as RecyclingRecord;
    const qty = Math.abs(Number(rec.quantity) || 0);
    const matchingPkgStock = resolvePackagingStockForRecycling(ctx, rec);
    const delta =
      matchingPkgStock
        ? rec.disposition === "Scrap Disposal"
          ? -qty
          : rec.disposition === "Re-used"
            ? qty
            : 0
        : 0;

    const outcome = ensureIdempotentMovement(ctx, {
      productId: matchingPkgStock ? matchingPkgStock.id : `PKG-${toSlug(rec.itemType)}`,
      type: "RECYCLING",
      quantity: delta,
      delta,
      referenceId: recordId,
      referenceNumber: rec.logSheetNumber || recordId,
      notes: `Packaging recycling: ${qty} x ${rec.itemType} (${rec.disposition}, Condition: ${rec.condition})`,
      userId: (rec as any).user_id || null,
      userName: (rec as any).created_by || (rec as any).updated_by || "Operator",
      deviceId: (rec as any).device_id || "CENTRAL-SERVER",
      idempotencyKey: rec.movementIdempotencyKey || `REC:${recordId}`,
      preventNegativeStock: false,
      createdAt: rec.created_at || undefined,
      allowCreateMissingStock: false,
      allowUnlinkedReference: !matchingPkgStock,
      fallbackPartCode: matchingPkgStock?.partCode || `PKG-${toSlug(rec.itemType)}`,
      fallbackDescription: `${rec.itemType} (${rec.disposition})`,
      fallbackUnit: normalizeUnitCode(rec.unit || matchingPkgStock?.unit) || undefined,
    });
    if (outcome.created && outcome.movement) {
      createdMovements.push(outcome.movement);
    }
    if (outcome.stockItem) {
      updatedStocksMap.set(outcome.stockItem.id, outcome.stockItem);
    }
  } else if (collection === "deliveries") {
    const del = record as DeliveryRecord;
    const becameReleased = del.status === "RELEASED" && prevRecord?.status !== "RELEASED";
    if (becameReleased) {
      const qty = Math.abs(Number(del.quantity) || 0);
      if (qty > 0) {
        const stockMatch = findMatchingStockForBusinessRecord(ctx, {
          stockId: del.stockId,
          partCode: del.partCode,
          preferApproved: true,
        });
        if (stockMatch) {
          const outcome = ensureIdempotentMovement(ctx, {
            productId: stockMatch.id,
            type: "SALE",
            quantity: qty,
            delta: -qty,
            referenceId: recordId,
            referenceNumber: del.gatePassNumber || del.drNumber || del.pickingListNumber || recordId,
            notes: `Delivery released for ${del.partCode} (PO: ${del.poNumber || "N/A"})`,
            userId: (del as any).user_id || null,
            userName: del.loadedBy || del.preparedBy || (del as any).updated_by || "Operator",
            deviceId: (del as any).device_id || "CENTRAL-SERVER",
            idempotencyKey: del.movementIdempotencyKey || `DEL:${recordId}:${stockMatch.id}`,
            preventNegativeStock: false,
            lotNumber: stockMatch.lotNumber,
            location: stockMatch.location,
            createdAt: del.updated_at || del.created_at || undefined,
            allowCreateMissingStock: false,
          });
          if (outcome.created && outcome.movement) {
            createdMovements.push(outcome.movement);
          }
          if (outcome.stockItem) {
            updatedStocksMap.set(outcome.stockItem.id, outcome.stockItem);
          }
        }
      }
    }
  }

  return {
    createdMovements,
    updatedStocks: Array.from(updatedStocksMap.values()),
  };
}

export function resolveAndApplyRecordUnit(
  ctx: ServerContext,
  collection: string,
  record: any
): boolean {
  if (!record || typeof record !== "object") return false;
  const prevUnit = String(record.unit || "");
  const prevMissing = Boolean(record.unitMissing);

  if (collection === "registries") {
    const norm = normalizeUnitCode(record.unit);
    record.unit = norm;
    if (record.type === "BARCODE_PRESET") {
      if (!norm) {
        record.unitMissing = true;
      } else {
        delete record.unitMissing;
      }
    } else {
      delete record.unitMissing;
    }
    return prevUnit !== String(record.unit || "") || prevMissing !== Boolean(record.unitMissing);
  }

  if (collection === "stockMovements") {
    const res = resolveMasterDataUnit(
      {
        unit: record.unit,
        partCode: record.product_sku,
        description: record.product_name,
        lotNumber: record.lot_number,
        stockId: record.product_id,
      },
      ctx.state.registries,
      ctx.state.stocks
    );
    record.unit = res.unit;
    if (res.isMissing) {
      record.unitMissing = true;
    } else {
      delete record.unitMissing;
    }
    return prevUnit !== record.unit || prevMissing !== Boolean(record.unitMissing);
  }

  if (
    collection === "stocks" ||
    collection === "receiving" ||
    collection === "returns" ||
    collection === "issuances" ||
    collection === "deliveries"
  ) {
    const res = resolveMasterDataUnit(record, ctx.state.registries, ctx.state.stocks);
    record.unit = res.unit;
    if (res.isMissing) {
      record.unitMissing = true;
    } else {
      delete record.unitMissing;
    }
    if (Array.isArray(record.bom)) {
      record.bom = record.bom.map((b: any) => {
        if (!b || typeof b !== "object") return b;
        const bRes = resolveMasterDataUnit(b, ctx.state.registries, ctx.state.stocks);
        return { ...b, unit: bRes.unit };
      });
    }
    return prevUnit !== record.unit || prevMissing !== Boolean(record.unitMissing);
  }

  if (collection === "recycling") {
    const rec = record as RecyclingRecord;
    const pkgStock = resolvePackagingStockForRecycling(ctx, rec);
    const res = resolveMasterDataUnit(
      {
        unit: rec.unit || pkgStock?.unit,
        partCode: pkgStock?.partCode,
        description: rec.itemType,
        itemType: rec.itemType,
        stockId: rec.stockId,
      },
      ctx.state.registries,
      ctx.state.stocks
    );
    record.unit = res.unit;
    if (res.isMissing) {
      record.unitMissing = true;
    } else {
      delete record.unitMissing;
    }
    return prevUnit !== record.unit || prevMissing !== Boolean(record.unitMissing);
  }

  return false;
}

export function backfillAndFlagUnits(ctx: ServerContext): number {
  let updatedCount = 0;

  for (const reg of ctx.state.registries || []) {
    if (resolveAndApplyRecordUnit(ctx, "registries", reg)) updatedCount++;
  }
  // Stocks first so downstream records can also inspect linked stock batch units
  for (const stock of ctx.state.stocks || []) {
    if (resolveAndApplyRecordUnit(ctx, "stocks", stock)) updatedCount++;
  }
  for (const rcv of ctx.state.receiving || []) {
    if (resolveAndApplyRecordUnit(ctx, "receiving", rcv)) updatedCount++;
  }
  for (const ret of ctx.state.returns || []) {
    if (resolveAndApplyRecordUnit(ctx, "returns", ret)) updatedCount++;
  }
  for (const iss of ctx.state.issuances || []) {
    if (resolveAndApplyRecordUnit(ctx, "issuances", iss)) updatedCount++;
  }
  for (const del of ctx.state.deliveries || []) {
    if (resolveAndApplyRecordUnit(ctx, "deliveries", del)) updatedCount++;
  }
  for (const rec of ctx.state.recycling || []) {
    if (resolveAndApplyRecordUnit(ctx, "recycling", rec)) updatedCount++;
  }
  for (const mov of ctx.state.stockMovements || []) {
    if (resolveAndApplyRecordUnit(ctx, "stockMovements", mov)) updatedCount++;
  }

  return updatedCount;
}

export function rebuildMovementsMigration(
  ctx: ServerContext,
  options?: { skipCommit?: boolean }
): RebuildMovementsResult {
  if (!Array.isArray(ctx.state.stockMovements)) {
    ctx.state.stockMovements = [];
  }

  const repairedUnitsCount = backfillAndFlagUnits(ctx);

  // Normalize any existing movements without an idempotency_key so migration stays clean
  for (const existing of ctx.state.stockMovements) {
    if (existing && !existing.idempotency_key) {
      existing.idempotency_key = `LEGACY:${existing.id}`;
    }
  }

  // Capture stored balances prior to rebuilding missing movements
  const storedBalancesByStockId = new Map<string, number>();
  for (const stock of ctx.state.stocks || []) {
    if (!stock || !stock.id) continue;
    storedBalancesByStockId.set(String(stock.id), roundStockQuantity(Number(stock.quantity) || 0));
  }

  let createdMovements = 0;
  let baselineMovements = 0;

  for (const rcv of ctx.state.receiving || []) {
    const res = ensureMovementsForBusinessRecord(ctx, "receiving", rcv, true);
    createdMovements += res.createdMovements.length;
  }

  for (const ret of ctx.state.returns || []) {
    const res = ensureMovementsForBusinessRecord(ctx, "returns", ret, true);
    createdMovements += res.createdMovements.length;
  }

  for (const iss of ctx.state.issuances || []) {
    const res = ensureMovementsForBusinessRecord(ctx, "issuances", iss, true);
    createdMovements += res.createdMovements.length;
  }

  for (const rec of ctx.state.recycling || []) {
    const res = ensureMovementsForBusinessRecord(ctx, "recycling", rec, true);
    createdMovements += res.createdMovements.length;
  }

  for (const del of ctx.state.deliveries || []) {
    if (del && del.status === "RELEASED") {
      const res = ensureMovementsForBusinessRecord(ctx, "deliveries", del, true);
      createdMovements += res.createdMovements.length;
    }
  }

  // For any stock item whose derived sum differs from its pre-migration stored balance,
  // record a single idempotent MIG-BASELINE adjustment if not already migrated.
  const allStockIds = new Set<string>((ctx.state.stocks || []).map((s) => String(s.id)));
  for (const stock of ctx.state.stocks || []) {
    if (!stock || !stock.id) continue;
    const stockId = String(stock.id);
    const baselineKey = `MIG-BASELINE:${stockId}`;
    if (findMovementByIdempotencyKey(ctx, baselineKey)) {
      continue;
    }

    const derivedNow = computeDerivedBalanceForStock(ctx, stock, allStockIds);
    const storedQty = storedBalancesByStockId.get(stockId) ?? 0;
    const delta = roundStockQuantity(storedQty - derivedNow);
    if (delta !== 0) {
      const outcome = ensureIdempotentMovement(ctx, {
        productId: stockId,
        warehouseId: stock.warehouseId || "wh-main",
        accountId: stock.accountId || "ACC-JUWEI",
        type: delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: delta,
        delta,
        referenceId: stockId,
        referenceNumber: "MIGRATION-BASELINE",
        notes: `Migration baseline reconciliation for legacy stock balance (${derivedNow} -> ${storedQty})`,
        userId: "SYSTEM-MIGRATION",
        userName: "SYSTEM MIGRATION",
        deviceId: "CENTRAL-SERVER",
        idempotencyKey: baselineKey,
        preventNegativeStock: false,
        lotNumber: stock.lotNumber,
        location: stock.location,
        allowCreateMissingStock: false,
      });
      if (outcome.created) {
        createdMovements++;
        baselineMovements++;
      }
    }
  }

  // Restore derived balances as authoritative across all stock batches
  let repairedBalances = 0;
  for (const stock of ctx.state.stocks || []) {
    if (!stock || !stock.id) continue;
    const derived = computeDerivedBalanceForStock(ctx, stock, allStockIds);
    const preStored = storedBalancesByStockId.get(String(stock.id)) ?? 0;
    stock.quantity = derived;
    if (preStored !== derived) {
      repairedBalances++;
    }
  }

  const changed = createdMovements > 0 || repairedBalances > 0 || repairedUnitsCount > 0;
  if (changed) {
    ctx.stateRevision++;
    if (!options?.skipCommit) {
      commitDatabase(ctx);
    }
  }

  logger.info(
    `[STOCK-LEDGER] Migration check complete: createdMovements=${createdMovements}, baselineMovements=${baselineMovements}, repairedBalances=${repairedBalances}, totalMovements=${ctx.state.stockMovements.length}`
  );

  return {
    success: true,
    createdMovements,
    baselineMovements,
    repairedBalances,
    totalMovements: ctx.state.stockMovements.length,
    totalStocks: (ctx.state.stocks || []).length,
  };
}

export function getReconcileReportPath(): string {
  const docsDir = path.resolve(process.cwd(), "docs");
  const reportPath = path.resolve(docsDir, "reconcile-report.json");
  if (!reportPath.startsWith(docsDir + path.sep)) {
    throw new Error("Invalid reconcile report path traversal detected");
  }
  return reportPath;
}

export function reconcileStockBalances(ctx: ServerContext): ReconcileReport {
  const reportPath = getReconcileReportPath();
  const docsDir = path.dirname(reportPath);
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const stocks = Array.isArray(ctx.state.stocks) ? ctx.state.stocks : [];
  const movements = Array.isArray(ctx.state.stockMovements) ? ctx.state.stockMovements : [];
  const allStockIds = new Set<string>(stocks.map((s) => String(s.id)));

  const mismatches: ReconcileMismatch[] = [];
  let matchedCount = 0;

  for (const stock of stocks) {
    if (!stock || !stock.id) continue;
    const storedQuantity = roundStockQuantity(Number(stock.quantity) || 0);
    const stats = getMovementStatsForStock(ctx, stock, allStockIds);
    const difference = roundStockQuantity(storedQuantity - stats.total);

    const resolvedUnit = resolveMasterDataUnit(stock, ctx.state.registries, stocks);

    if (difference !== 0) {
      mismatches.push({
        stockId: String(stock.id),
        partCode: String(stock.partCode || ""),
        description: stock.description,
        lotNumber: String(stock.lotNumber || ""),
        location: stock.location,
        unit: resolvedUnit.unit || undefined,
        unitMissing: resolvedUnit.isMissing || undefined,
        storedQuantity,
        movementTotal: stats.total,
        difference,
        movementCount: stats.count,
      });
    } else {
      matchedCount++;
    }
  }

  const missingUnitItems: ReconcileMissingUnitItem[] = [];
  let missingUnitStocksCount = 0;
  const checkCollectionMissingUnits = (
    collection: string,
    items: any[] | undefined,
    filterFn?: (item: any) => boolean
  ) => {
    for (const item of items || []) {
      if (!item || (filterFn && !filterFn(item))) continue;
      const res = resolveMasterDataUnit(item, ctx.state.registries, stocks);
      if (res.isMissing) {
        if (collection === "stocks") missingUnitStocksCount += 1;
        if (missingUnitItems.length < 200) {
          missingUnitItems.push({
            collection,
            id: String(item.id || ""),
            partCode: String(item.partCode || item.code || item.itemType || ""),
            description: String(
              item.description ||
                item.itemDescription ||
                item.materialDescription ||
                item.name ||
                ""
            ),
          });
        }
      }
    }
  };

  checkCollectionMissingUnits("stocks", stocks);
  checkCollectionMissingUnits("receiving", ctx.state.receiving);
  checkCollectionMissingUnits("returns", ctx.state.returns);
  checkCollectionMissingUnits("issuances", ctx.state.issuances);
  checkCollectionMissingUnits("deliveries", ctx.state.deliveries);
  checkCollectionMissingUnits("recycling", ctx.state.recycling);
  checkCollectionMissingUnits(
    "registries",
    ctx.state.registries,
    (r) => r?.type === "BARCODE_PRESET"
  );

  // Detect orphan movements that affect balance but match no active stock batch
  const orphanBuckets = new Map<string, { total: number; count: number }>();
  const seenKeys = new Set<string>();
  for (const m of movements) {
    if (!m || isNonStockReferenceMovement(m)) continue;
    const key = String(m.idempotency_key || "").trim();
    if (key) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    const matched = stocks.some((s) => doesMovementBelongToStock(s, m, allStockIds));
    if (!matched) {
      const prodKey = String(m.product_id || m.product_sku || "UNKNOWN");
      const cur = orphanBuckets.get(prodKey) || { total: 0, count: 0 };
      cur.total = roundStockQuantity(cur.total + (Number(m.quantity) || 0));
      cur.count += 1;
      orphanBuckets.set(prodKey, cur);
    }
  }

  const orphanMovementProducts: ReconcileOrphanMovementSummary[] = Array.from(
    orphanBuckets.entries()
  )
    .filter(([, val]) => val.total !== 0)
    .map(([productId, val]) => ({
      productId,
      movementTotal: val.total,
      movementCount: val.count,
    }));

  const report: ReconcileReport = {
    generatedAt: new Date().toISOString(),
    serverInstanceId: ctx.serverInstanceId,
    dataDir: ctx.config.dataDir,
    reportPath: "docs/reconcile-report.json",
    totalStocksChecked: stocks.length,
    totalMovements: movements.length,
    matchedCount,
    mismatchCount: mismatches.length,
    mismatches,
    orphanMovementProductsCount: orphanMovementProducts.length,
    orphanMovementProducts,
    missingUnitStocksCount,
    missingUnitRecordsCount: missingUnitItems.length,
    missingUnitItems,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  if (mismatches.length > 0 || orphanMovementProducts.length > 0) {
    logger.warn(
      `[RECONCILE] Detected ${mismatches.length} stock balance mismatch(es) and ${orphanMovementProducts.length} orphan movement group(s). Report saved to ${reportPath}.`
    );
    recordAuditTrail(ctx, {
      timestamp: report.generatedAt,
      actor: "SYSTEM_RECONCILE",
      actorId: "SYSTEM",
      action: "RECONCILE_MISMATCH",
      recordType: "stocks",
      recordId: "docs/reconcile-report.json",
      summary: `Reconciliation detected ${mismatches.length} mismatch(es) across ${stocks.length} stock items`,
      details: mismatches
        .slice(0, 5)
        .map((m) => `${m.partCode} (${m.stockId}): stored=${m.storedQuantity}, ledger=${m.movementTotal}`)
        .join("; "),
    });
  } else {
    logger.info(
      `[RECONCILE] Passed with 0 mismatches across ${stocks.length} stock items (${movements.length} movements). Report saved to ${reportPath}.`
    );
  }

  return report;
}

export function scheduleNightlyReconciliation(ctx: ServerContext): () => void {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  let dailyInterval: ReturnType<typeof setInterval> | null = null;

  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(2, 0, 0, 0); // Next 02:00:00 local server time
  if (nextRun.getTime() <= now.getTime()) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  const delayMs = Math.max(1000, nextRun.getTime() - now.getTime());

  const runSafely = () => {
    try {
      reconcileStockBalances(ctx);
    } catch (err: any) {
      logger.error(`[RECONCILE] Nightly reconciliation error: ${err?.message || err}`);
    }
  };

  const initialTimeout = setTimeout(() => {
    runSafely();
    dailyInterval = setInterval(runSafely, ONE_DAY_MS);
    dailyInterval.unref?.();
  }, delayMs);

  initialTimeout.unref?.();

  logger.info(
    `[RECONCILE] Nightly reconciliation scheduled for ${nextRun.toISOString()} (in ${Math.round(delayMs / 60000)} min)`
  );

  return () => {
    clearTimeout(initialTimeout);
    if (dailyInterval) {
      clearInterval(dailyInterval);
      dailyInterval = null;
    }
  };
}
