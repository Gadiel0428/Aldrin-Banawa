/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authoritative Record Upsert/Delete & Stock Movement Execution Service
 */

import type { WebSocket } from "ws";
import logger from "../../src/lib/logger.ts";
import {
  mapRecordFromApi,
  mapStockMovementInputFromApi,
  mapStockMovementResultToApi,
} from "../api/mapper.ts";
import {
  describeRecordDiff,
  getAuditRecordLabel,
  recordAuditTrail,
} from "./auditService.ts";
import { isDeviceRevoked, markRecordTombstone } from "./authService.ts";
import { commitDatabase } from "./backupService.ts";
import {
  type DeleteExecutionResult,
  type ServerContext,
  type UpsertExecutionResult,
} from "./context.ts";
import {
  backfillAndFlagUnits,
  computeDerivedBalanceForStock,
  ensureIdempotentMovement,
  ensureMovementsForBusinessRecord,
  findMovementByIdempotencyKey,
  resolveAndApplyRecordUnit,
  resolveStockItemForMovement,
} from "./stockLedgerService.ts";
import {
  broadcast,
  broadcastInventoryEvent,
  closeDeviceSockets,
} from "./realtimeService.ts";

export const INVENTORY_COLLECTIONS = new Set<string>([
  "stocks",
  "issuances",
  "deliveries",
  "receiving",
  "returns",
  "recycling",
]);

export function executeRecordUpsert(
  ctx: ServerContext,
  params: {
    collection: string;
    record: any;
    author?: string;
    employeeId?: string;
    user_id?: string;
    device_id?: string;
    actionDesc?: string;
    expectedVersion?: number;
    reset_version?: number;
    userPermission?: string;
    excludeSocket?: WebSocket;
  }
): UpsertExecutionResult {
  const {
    collection,
    record,
    author,
    employeeId,
    user_id,
    device_id,
    actionDesc,
    expectedVersion,
    reset_version,
    userPermission,
    excludeSocket,
  } = params;

  const normalizedInputRecord =
    record && typeof record === "object" ? mapRecordFromApi(collection, record) : record;

  const rawDeviceId = String(device_id || normalizedInputRecord?.device_id || "").trim();
  if (isDeviceRevoked(ctx, rawDeviceId)) {
    closeDeviceSockets(ctx, rawDeviceId, "DEVICE_REVOKED");
    return {
      success: false,
      status: 403,
      error: "DEVICE_REVOKED",
    };
  }

  const clientResetVersion =
    Number(reset_version) || Number(normalizedInputRecord?.reset_version) || ctx.systemResetVersion;
  if (clientResetVersion < ctx.systemResetVersion) {
    return {
      success: false,
      status: 409,
      error:
        "STALE_RESET_VERSION: Central database was reset. Data from previous reset versions cannot be restored.",
      systemResetVersion: ctx.systemResetVersion,
      systemResetId: ctx.systemResetId,
    };
  }

  if (!collection || !normalizedInputRecord) {
    return { success: false, status: 400, error: "Collection and record required" };
  }

  if (!(collection in ctx.state)) {
    return { success: false, status: 400, error: `Unknown collection: ${collection}` };
  }

  if (userPermission === "VIEW_ONLY") {
    return {
      success: false,
      status: 403,
      error: "PERMISSION DENIED: Account has VIEW_ONLY privileges.",
    };
  }

  const serverTime = new Date().toISOString();
  const currentList: any[] = (ctx.state as any)[collection] || [];
  const recordId = String(
    normalizedInputRecord.id ||
      `REC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
  );

  const existingIndex = currentList.findIndex(
    (item: any) =>
      item && (String(item.id) === recordId || String(item.record_id) === recordId)
  );
  const existingRecord = existingIndex >= 0 ? currentList[existingIndex] : null;

  let confirmedRecord: any;
  let isCreation = false;
  const effectiveUserId = String(
    user_id ||
      normalizedInputRecord.user_id ||
      (employeeId ? `USR-${employeeId}` : author ? `USR-${author}` : "OPERATOR")
  ).trim();
  const effectiveDeviceId = String(device_id || normalizedInputRecord.device_id || "DEV-CENTRAL").trim();

  if (existingRecord) {
    const serverVer = Number(existingRecord.version) || 1;
    if (
      expectedVersion !== undefined &&
      expectedVersion !== null &&
      !Number.isNaN(Number(expectedVersion)) &&
      serverVer > Number(expectedVersion)
    ) {
      return {
        success: false,
        status: 409,
        error: "VERSION_CONFLICT: Newer revision exists in central database.",
        confirmedRecord: existingRecord,
        currentRecord: existingRecord,
        systemResetVersion: ctx.systemResetVersion,
      };
    }

    const nextVersion = (Number(existingRecord.version) || 1) + 1;
    confirmedRecord = {
      ...existingRecord,
      ...normalizedInputRecord,
      id: recordId,
      record_id: normalizedInputRecord.record_id || recordId,
      reset_version: ctx.systemResetVersion,
      created_at: existingRecord.created_at || normalizedInputRecord.created_at || serverTime,
      created_by: existingRecord.created_by || normalizedInputRecord.created_by || author || "Operator",
      updated_at: serverTime,
      updated_by: author || employeeId || "Operator",
      user_id: effectiveUserId,
      device_id: effectiveDeviceId,
      version: nextVersion,
    };
    currentList[existingIndex] = confirmedRecord;
  } else {
    if (
      ctx.deletedRecordTombstones.has(recordId) &&
      expectedVersion !== undefined &&
      expectedVersion !== null &&
      !Number.isNaN(Number(expectedVersion)) &&
      Number(expectedVersion) >= 1
    ) {
      return {
        success: false,
        status: 409,
        error: "VERSION_CONFLICT: Record was deleted on central database.",
        confirmedRecord: null,
        currentRecord: null,
        systemResetVersion: ctx.systemResetVersion,
      };
    }
    isCreation = true;
    confirmedRecord = {
      ...normalizedInputRecord,
      id: recordId,
      record_id: normalizedInputRecord.record_id || recordId,
      reset_version: ctx.systemResetVersion,
      created_at: normalizedInputRecord.created_at || serverTime,
      created_by: normalizedInputRecord.created_by || author || employeeId || "Operator",
      updated_at: serverTime,
      updated_by: author || employeeId || "Operator",
      user_id: effectiveUserId,
      device_id: effectiveDeviceId,
      version: Number(normalizedInputRecord.version) || 1,
    };
    currentList.unshift(confirmedRecord);
  }

  resolveAndApplyRecordUnit(ctx, collection, confirmedRecord);
  if (collection === "registries") {
    backfillAndFlagUnits(ctx);
  }

  if (collection === "stocks") {
    confirmedRecord.quantity = computeDerivedBalanceForStock(ctx, confirmedRecord);
  }

  const ledgerOutcome = ensureMovementsForBusinessRecord(
    ctx,
    collection,
    confirmedRecord,
    isCreation,
    existingRecord
  );

  ctx.deletedRecordTombstones.delete(recordId);
  (ctx.state as any)[collection] = currentList;
  ctx.stateRevision++;

  const commitOk = commitDatabase(ctx);
  if (!commitOk) {
    return {
      success: false,
      status: 500,
      error: "Failed to commit record to central disk database",
    };
  }

  for (const createdMov of ledgerOutcome.createdMovements) {
    const relatedStock =
      ledgerOutcome.updatedStocks.find((s) => String(s.id) === String(createdMov.product_id)) ||
      resolveStockItemForMovement(ctx, createdMov.product_id, createdMov.lot_number);
    broadcastInventoryEvent(ctx, {
      type: "INVENTORY_UPDATE",
      accountId: createdMov.warehouse_id ? undefined : relatedStock?.accountId,
      warehouseId: createdMov.warehouse_id || relatedStock?.warehouseId || "WH-MAIN",
      collection: "stocks",
      record: relatedStock,
      movement: createdMov,
      actionDesc: createdMov.notes || `Stock movement: ${createdMov.type} (${createdMov.quantity})`,
      author: author || employeeId || "Operator",
      user_id: effectiveUserId,
      device_id: effectiveDeviceId,
      timestamp: serverTime,
    });
  }

  const auditLabel = getAuditRecordLabel(collection, confirmedRecord);
  const auditDiff = isCreation ? "" : describeRecordDiff(existingRecord, confirmedRecord);
  recordAuditTrail(ctx, {
    timestamp: serverTime,
    actor: author || employeeId || confirmedRecord.updated_by || "Operator",
    actorId: employeeId || effectiveUserId,
    action: isCreation ? "CREATE" : "UPDATE",
    recordType: collection,
    recordId,
    summary: isCreation
      ? `Created ${collection}${auditLabel ? ` [${auditLabel}]` : ""}`
      : `Updated ${collection}${auditLabel ? ` [${auditLabel}]` : ""}${auditDiff ? ` — ${auditDiff}` : ""}`,
    details: actionDesc || (auditDiff ? `Changed: ${auditDiff}` : undefined),
    deviceId: effectiveDeviceId,
  });

  logger.debug(
    `[CENTRAL-DB] [${isCreation ? "CREATE" : "UPDATE"}] [${collection}] ID: ${recordId} | Rev: v${confirmedRecord.version} | User: ${effectiveUserId} | Device: ${effectiveDeviceId} | Time: ${serverTime}`
  );

  if (INVENTORY_COLLECTIONS.has(collection)) {
    let invEventType = "INVENTORY_UPDATE";
    if (collection === "stocks") {
      invEventType = isCreation ? "STOCK_CREATED" : "STOCK_ADJUSTMENT";
    } else if (collection === "issuances" || collection === "deliveries") {
      invEventType = "PICK_PACK_SHIP";
    }

    broadcastInventoryEvent(ctx, {
      type: invEventType,
      collection,
      record: confirmedRecord,
      accountId: confirmedRecord.accountId,
      warehouseId: confirmedRecord.warehouseId,
      author: author || employeeId || "Operator",
      user_id: effectiveUserId,
      device_id: effectiveDeviceId,
      actionDesc: actionDesc || `${isCreation ? "Created" : "Updated"} ${collection} record`,
      timestamp: serverTime,
      isCreation,
      excludeSocket,
    });
  } else {
    const eventType = isCreation ? "DATA_CREATE" : "DATA_UPDATE";
    broadcast(
      ctx,
      {
        type: eventType,
        collection,
        record: confirmedRecord,
        id: recordId,
        record_id: recordId,
        author: author || employeeId || "Operator",
        user_id: effectiveUserId,
        device_id: effectiveDeviceId,
        actionDesc: actionDesc || `${isCreation ? "Created" : "Updated"} ${collection} record`,
        timestamp: serverTime,
        version: confirmedRecord.version,
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
      },
      excludeSocket
    );

    broadcast(
      ctx,
      {
        type: isCreation ? "RECORD_CREATED" : "RECORD_UPDATED",
        collection,
        record: confirmedRecord,
        id: recordId,
        record_id: recordId,
        author: author || employeeId || "Operator",
        user_id: effectiveUserId,
        device_id: effectiveDeviceId,
        actionDesc: actionDesc || `${isCreation ? "Created" : "Updated"} ${collection} record`,
        timestamp: serverTime,
        version: confirmedRecord.version,
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
      },
      excludeSocket
    );

    broadcast(
      ctx,
      {
        type: "collection_updated",
        collection,
        data: currentList,
        systemResetVersion: ctx.systemResetVersion,
      },
      excludeSocket
    );
  }

  return {
    success: true,
    status: 200,
    confirmedRecord,
    isCreation,
    systemResetVersion: ctx.systemResetVersion,
    systemResetId: ctx.systemResetId,
  };
}

export function executeRecordDelete(
  ctx: ServerContext,
  params: {
    collection: string;
    id: string;
    author?: string;
    employeeId?: string;
    user_id?: string;
    device_id?: string;
    actionDesc?: string;
    expectedVersion?: number;
    reset_version?: number;
    userPermission?: string;
    excludeSocket?: WebSocket;
  }
): DeleteExecutionResult {
  const {
    collection,
    id,
    author,
    employeeId,
    user_id,
    device_id,
    actionDesc,
    expectedVersion,
    reset_version,
    userPermission,
    excludeSocket,
  } = params;

  const rawDeviceId = String(device_id || "").trim();
  if (isDeviceRevoked(ctx, rawDeviceId)) {
    closeDeviceSockets(ctx, rawDeviceId, "DEVICE_REVOKED");
    return {
      success: false,
      status: 403,
      error: "DEVICE_REVOKED",
    };
  }

  const clientResetVersion = Number(reset_version) || ctx.systemResetVersion;
  if (clientResetVersion < ctx.systemResetVersion) {
    return {
      success: false,
      status: 409,
      error: "STALE_RESET_VERSION: Central database was reset. Stale delete operation rejected.",
      systemResetVersion: ctx.systemResetVersion,
      systemResetId: ctx.systemResetId,
    };
  }

  if (!collection || !id) {
    return { success: false, status: 400, error: "Collection and ID required" };
  }

  if (!(collection in ctx.state)) {
    return { success: false, status: 400, error: "Invalid collection" };
  }

  if (userPermission === "VIEW_ONLY") {
    return {
      success: false,
      status: 403,
      error: "PERMISSION DENIED: Account has VIEW_ONLY privileges.",
    };
  }

  const recordId = String(id);
  const currentList: any[] = (ctx.state as any)[collection] || [];
  const existingRecord =
    currentList.find(
      (item: any) =>
        item && (String(item.id) === recordId || String(item.record_id) === recordId)
    ) || null;
  if (
    existingRecord &&
    expectedVersion !== undefined &&
    expectedVersion !== null &&
    !Number.isNaN(Number(expectedVersion))
  ) {
    const serverVer = Number(existingRecord.version) || 1;
    if (serverVer > Number(expectedVersion)) {
      return {
        success: false,
        status: 409,
        error: "VERSION_CONFLICT: Newer revision exists in central database.",
        currentRecord: existingRecord,
        confirmedRecord: existingRecord,
        systemResetVersion: ctx.systemResetVersion,
      };
    }
  }

  markRecordTombstone(ctx, recordId);
  (ctx.state as any)[collection] = currentList.filter(
    (item: any) => String(item.id) !== recordId && String(item.record_id) !== recordId
  );
  ctx.stateRevision++;

  const commitOk = commitDatabase(ctx);
  if (!commitOk) {
    return {
      success: false,
      status: 500,
      error: "Failed to commit record deletion to central database",
    };
  }

  const serverTime = new Date().toISOString();
  const effectiveUserId = String(
    user_id || (employeeId ? `USR-${employeeId}` : author ? `USR-${author}` : "OPERATOR")
  ).trim();
  const effectiveDeviceId = String(device_id || "DEV-CENTRAL").trim();

  const deletedLabel = existingRecord
    ? getAuditRecordLabel(collection, existingRecord)
    : recordId;
  recordAuditTrail(ctx, {
    timestamp: serverTime,
    actor: author || employeeId || "Operator",
    actorId: employeeId || effectiveUserId,
    action: "DELETE",
    recordType: collection,
    recordId,
    summary: `Deleted ${collection}${deletedLabel ? ` [${deletedLabel}]` : ""}`,
    details: actionDesc || undefined,
    deviceId: effectiveDeviceId,
  });

  logger.debug(
    `[CENTRAL-DB] [DELETE] [${collection}] ID: ${recordId} | User: ${effectiveUserId} | Device: ${effectiveDeviceId} | Time: ${serverTime}`
  );

  if (INVENTORY_COLLECTIONS.has(collection)) {
    let invEventType = "INVENTORY_UPDATE";
    if (collection === "stocks") {
      invEventType = "STOCK_ADJUSTMENT";
    } else if (collection === "issuances" || collection === "deliveries") {
      invEventType = "PICK_PACK_SHIP";
    }

    broadcastInventoryEvent(ctx, {
      type: invEventType,
      collection,
      record: { id: recordId, record_id: recordId, quantity: 0, status: "DELETED" },
      author: author || employeeId || "Operator",
      user_id: effectiveUserId,
      device_id: effectiveDeviceId,
      actionDesc: actionDesc || `Deleted ${collection} record`,
      timestamp: serverTime,
      isDelete: true,
      excludeSocket,
    });
  }

  broadcast(
    ctx,
    {
      type: "DATA_DELETE",
      collection,
      id: recordId,
      record_id: recordId,
      author: author || employeeId || "Operator",
      user_id: effectiveUserId,
      device_id: effectiveDeviceId,
      actionDesc: actionDesc || `Deleted ${collection} record`,
      timestamp: serverTime,
      systemResetVersion: ctx.systemResetVersion,
      systemResetId: ctx.systemResetId,
    },
    excludeSocket
  );

  broadcast(
    ctx,
    {
      type: "RECORD_DELETED",
      collection,
      id: recordId,
      record_id: recordId,
      author: author || employeeId || "Operator",
      user_id: effectiveUserId,
      device_id: effectiveDeviceId,
      timestamp: serverTime,
      systemResetVersion: ctx.systemResetVersion,
      systemResetId: ctx.systemResetId,
    },
    excludeSocket
  );

  broadcast(
    ctx,
    {
      type: "record_deleted",
      collection,
      id: recordId,
      systemResetVersion: ctx.systemResetVersion,
    },
    excludeSocket
  );

  broadcast(
    ctx,
    {
      type: "collection_updated",
      collection,
      data: (ctx.state as any)[collection],
      systemResetVersion: ctx.systemResetVersion,
    },
    excludeSocket
  );

  return {
    success: true,
    status: 200,
    id: recordId,
    collection,
    systemResetVersion: ctx.systemResetVersion,
    systemResetId: ctx.systemResetId,
  };
}

export interface StockMovementExecutionParams {
  reqDevId: string;
  actorName?: string;
  actorEmployeeId?: string;
  clientResetVersion?: number;
  userPermission?: string;
  body: Record<string, any>;
}

export function executeStockMovement(
  ctx: ServerContext,
  params: StockMovementExecutionParams
): { status: number; payload: Record<string, any> } {
  const { reqDevId, actorName, actorEmployeeId, clientResetVersion, userPermission, body } = params;

  if (isDeviceRevoked(ctx, reqDevId)) {
    closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
    return { status: 403, payload: { error: "DEVICE_REVOKED" } };
  }

  if (userPermission === "VIEW_ONLY") {
    return {
      status: 403,
      payload: { error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." },
    };
  }

  if (clientResetVersion && clientResetVersion < ctx.systemResetVersion) {
    return {
      status: 409,
      payload: {
        error: "STALE_RESET_VERSION: Central database was reset. Movement rejected.",
        systemResetVersion: ctx.systemResetVersion,
      },
    };
  }

  const input = mapStockMovementInputFromApi(body);
  const {
    product_id: productId,
    warehouse_id: warehouseId,
    account_id: accountId,
    type,
    quantity,
    delta,
    reference_id: referenceId,
    reference_number: referenceNumber,
    notes,
    user_id: userId,
    user_name: userName,
    device_id: deviceId,
    idempotency_key: idempotencyKey,
    preventNegativeStock,
    lot_number: lotNumber,
    location,
    unit: movementUnit,
  } = input;

  if (!productId) {
    return { status: 400, payload: { error: "productId is required" } };
  }

  const effectiveIdempotencyKey =
    idempotencyKey ||
    `SM-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const existingReplayed = idempotencyKey
    ? findMovementByIdempotencyKey(ctx, idempotencyKey)
    : undefined;
  if (existingReplayed) {
    const existingStock = resolveStockItemForMovement(
      ctx,
      existingReplayed.product_id,
      existingReplayed.lot_number
    );
    if (existingStock) {
      existingStock.quantity = computeDerivedBalanceForStock(ctx, existingStock);
    }
    return {
      status: 200,
      payload: mapStockMovementResultToApi(existingReplayed, { idempotency_replayed: true }),
    };
  }

  const resolvedExistingStock = resolveStockItemForMovement(ctx, productId, lotNumber);
  const isPkgAuditRef =
    type === "RECYCLING" &&
    String(productId || "").startsWith("PKG-") &&
    !resolvedExistingStock;

  const outcome = ensureIdempotentMovement(ctx, {
    productId,
    warehouseId: warehouseId || "wh-main",
    accountId: accountId || "ACC-JUWEI",
    type: type || "ADJUSTMENT_IN",
    quantity: Number(delta !== undefined ? delta : quantity) || 0,
    delta: delta !== undefined ? Number(delta) : undefined,
    referenceId,
    referenceNumber,
    notes,
    userId,
    userName: userName || actorName || "Operator",
    deviceId: deviceId || reqDevId || "CENTRAL-SERVER",
    idempotencyKey: effectiveIdempotencyKey,
    preventNegativeStock,
    lotNumber,
    location,
    fallbackUnit: movementUnit,
    allowCreateMissingStock: !isPkgAuditRef,
    allowUnlinkedReference: isPkgAuditRef,
  });

  if (!outcome.success || !outcome.movement) {
    return {
      status: outcome.status || 400,
      payload: { error: outcome.error || "Stock movement rejected" },
    };
  }

  if (outcome.replayed) {
    return {
      status: 200,
      payload: mapStockMovementResultToApi(outcome.movement, { idempotency_replayed: true }),
    };
  }

  const movementRecord = outcome.movement;
  const stockItem = outcome.stockItem;
  const serverTime = movementRecord.created_at || new Date().toISOString();
  const prevQty = Number(movementRecord.previous_quantity) || 0;
  const newQty = Number(movementRecord.new_quantity) || 0;
  const finalDelta = Number(movementRecord.quantity) || 0;

  ctx.stateRevision++;

  const commitOk = commitDatabase(ctx);
  if (!commitOk) {
    return {
      status: 500,
      payload: { error: "Failed to commit stock movement to central database" },
    };
  }

  recordAuditTrail(ctx, {
    timestamp: serverTime,
    actor: actorName || userName || "Operator",
    actorId: actorEmployeeId || userId || "OPERATOR",
    action: "STOCK_MOVEMENT",
    recordType: "stockMovements",
    recordId: movementRecord.id,
    summary: `${type || "ADJUSTMENT"} ${stockItem?.partCode || productId} (${prevQty} -> ${newQty}, delta ${finalDelta >= 0 ? `+${finalDelta}` : finalDelta})`,
    details: notes || (referenceNumber ? `Ref: ${referenceNumber}` : undefined),
    deviceId: reqDevId || deviceId,
  });

  let movementEventType = "INVENTORY_UPDATE";
  if (["TRANSFER_IN", "TRANSFER_OUT", "TRANSFER", "LOCATION_TRANSFER"].includes(type)) {
    movementEventType = "LOCATION_TRANSFER";
  } else if (["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "CYCLE_COUNT", "ADJUSTMENT"].includes(type)) {
    movementEventType = "STOCK_ADJUSTMENT";
  } else if (["SALE", "PICK", "PACK", "SHIP", "DISPATCH"].includes(type)) {
    movementEventType = "PICK_PACK_SHIP";
  }

  broadcastInventoryEvent(ctx, {
    type: movementEventType,
    accountId: accountId || stockItem?.accountId || "ACC-JUWEI",
    warehouseId: warehouseId || stockItem?.warehouseId || "WH-MAIN",
    collection: "stocks",
    record: stockItem,
    movement: movementRecord,
    actionDesc: notes || `Stock movement: ${type} (${finalDelta})`,
    author: userName || "Operator",
    user_id: userId || undefined,
    device_id: deviceId,
    timestamp: serverTime,
  });

  return {
    status: 200,
    payload: mapStockMovementResultToApi(movementRecord, {
      systemResetVersion: ctx.systemResetVersion,
    }),
  };
}
