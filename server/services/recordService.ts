/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authoritative Record Upsert/Delete & Stock Movement Execution Service
 */

import type { WebSocket } from "ws";
import logger from "../../src/lib/logger.ts";
import {
  describeRecordDiff,
  getAuditRecordLabel,
  recordAuditTrail,
} from "./auditService.ts";
import { isDeviceRevoked, markRecordTombstone } from "./authService.ts";
import { commitDatabase } from "./backupService.ts";
import {
  normalizeBaseRecord,
  type DeleteExecutionResult,
  type ServerContext,
  type UpsertExecutionResult,
} from "./context.ts";
import { getFifoColorForDate } from "./fifoService.ts";
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

  const rawDeviceId = String(device_id || record?.device_id || record?.deviceId || "").trim();
  if (isDeviceRevoked(ctx, rawDeviceId)) {
    closeDeviceSockets(ctx, rawDeviceId, "DEVICE_REVOKED");
    return {
      success: false,
      status: 403,
      error: "DEVICE_REVOKED",
    };
  }

  const clientResetVersion =
    Number(reset_version) || Number(record?.reset_version) || ctx.systemResetVersion;
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

  if (!collection || !record) {
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
    record.id ||
      record.record_id ||
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
      record.user_id ||
      (employeeId ? `USR-${employeeId}` : author ? `USR-${author}` : "OPERATOR")
  ).trim();
  const effectiveDeviceId = String(device_id || record.device_id || "DEV-CENTRAL").trim();

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
      ...record,
      id: recordId,
      record_id: record.record_id || recordId,
      reset_version: ctx.systemResetVersion,
      created_at: existingRecord.created_at || record.created_at || serverTime,
      created_by: existingRecord.created_by || record.created_by || author || "Operator",
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
      ...record,
      id: recordId,
      record_id: record.record_id || recordId,
      reset_version: ctx.systemResetVersion,
      created_at: record.created_at || serverTime,
      created_by: record.created_by || author || employeeId || "Operator",
      updated_at: serverTime,
      updated_by: author || employeeId || "Operator",
      user_id: effectiveUserId,
      device_id: effectiveDeviceId,
      version: Number(record.version) || 1,
    };
    currentList.unshift(confirmedRecord);
  }

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
      accountId: confirmedRecord.accountId || confirmedRecord.account_id,
      warehouseId:
        confirmedRecord.warehouseId ||
        confirmedRecord.warehouse_id ||
        confirmedRecord.locationWarehouse,
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

  const {
    productId,
    warehouseId,
    type,
    quantity,
    delta,
    referenceId,
    referenceNumber,
    notes,
    userId,
    userName,
    deviceId,
    idempotencyKey,
    preventNegativeStock = true,
    lotNumber,
    location,
  } = body;

  if (!productId) {
    return { status: 400, payload: { error: "productId is required" } };
  }

  if (idempotencyKey && ctx.state.stockMovements) {
    const existing: any = ctx.state.stockMovements.find(
      (m: any) => m.idempotency_key === idempotencyKey || m.idempotencyKey === idempotencyKey
    );
    if (existing) {
      return {
        status: 200,
        payload: {
          success: true,
          idempotency_replayed: true,
          movementId: existing.id,
          productId: existing.product_id || existing.productId,
          warehouseId: existing.warehouse_id || existing.warehouseId,
          previousQuantity: existing.previous_quantity || existing.previousQuantity || 0,
          newQuantity: existing.new_quantity || existing.newQuantity || 0,
          delta: existing.quantity || existing.delta || 0,
          timestamp: existing.created_at || existing.timestamp || new Date().toISOString(),
        },
      };
    }
  }

  let finalDelta = Number(delta !== undefined ? delta : quantity);
  if (isNaN(finalDelta)) finalDelta = 0;

  if (["SALE", "PURCHASE_RETURN", "ADJUSTMENT_OUT", "TRANSFER_OUT"].includes(type)) {
    if (finalDelta > 0) finalDelta = -finalDelta;
  } else if (["PURCHASE", "SALE_RETURN", "ADJUSTMENT_IN", "TRANSFER_IN"].includes(type)) {
    if (finalDelta < 0) finalDelta = Math.abs(finalDelta);
  }

  let stockItem: any = ctx.state.stocks.find(
    (s: any) => String(s.id) === String(productId) || s.partCode === productId
  );
  const prevQty = stockItem ? Number(stockItem.quantity) || 0 : 0;
  const newQty = prevQty + finalDelta;

  if (preventNegativeStock && newQty < 0) {
    return {
      status: 400,
      payload: {
        error: `Insufficient stock in central database. Available: ${prevQty}, Requested: ${finalDelta}`,
      },
    };
  }

  const serverTime = new Date().toISOString();
  if (stockItem) {
    stockItem.quantity = newQty;
    stockItem.version = (stockItem.version || 1) + 1;
    stockItem.updated_at = serverTime;
    stockItem.reset_version = ctx.systemResetVersion;
    if (location) stockItem.location = location;
    if (lotNumber) stockItem.lotNumber = lotNumber;
  } else {
    stockItem = normalizeBaseRecord(
      {
        id: productId,
        partCode: productId,
        description: notes || "Warehouse Stock Item",
        type: "RAW",
        location: location || "Zone A",
        quantity: newQty,
        unit: "PCS",
        lotNumber: lotNumber || "",
        receivedDate: serverTime.split("T")[0],
        fifoColor: getFifoColorForDate(
          ctx,
          serverTime.split("T")[0],
          ctx.state.fifoColorsByMonth
        ),
        status: "APPROVED",
      },
      ctx.systemResetVersion
    );
    ctx.state.stocks.push(stockItem);
  }

  const movementId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const movementRecord: any = {
    id: movementId,
    product_id: productId,
    warehouse_id: warehouseId || "wh-main",
    type: type || "ADJUSTMENT_IN",
    quantity: finalDelta,
    previous_quantity: prevQty,
    new_quantity: newQty,
    reference_id: referenceId || null,
    reference_number: referenceNumber || null,
    notes: notes || null,
    user_id: userId || null,
    user_name: userName || "Operator",
    device_id: deviceId || "CENTRAL-SERVER",
    idempotency_key: idempotencyKey || null,
    created_at: serverTime,
    product_name: stockItem.description,
    product_sku: stockItem.partCode,
    unit: stockItem.unit,
    reset_version: ctx.systemResetVersion,
  };

  if (!ctx.state.stockMovements) ctx.state.stockMovements = [];
  ctx.state.stockMovements.unshift(movementRecord);
  if (ctx.state.stockMovements.length > 500) ctx.state.stockMovements.pop();

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
    recordId: movementId,
    summary: `${type || "ADJUSTMENT"} ${stockItem.partCode || productId} (${prevQty} -> ${newQty}, delta ${finalDelta >= 0 ? `+${finalDelta}` : finalDelta})`,
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
    accountId: body.accountId || stockItem.accountId || "ACC-JUWEI",
    warehouseId: warehouseId || stockItem.warehouseId || "WH-MAIN",
    collection: "stocks",
    record: stockItem,
    movement: movementRecord,
    actionDesc: notes || `Stock movement: ${type} (${finalDelta})`,
    author: userName || "Operator",
    user_id: userId,
    device_id: deviceId,
    timestamp: serverTime,
  });

  return {
    status: 200,
    payload: {
      success: true,
      movementId,
      productId,
      warehouseId: warehouseId || "wh-main",
      previousQuantity: prevQty,
      newQuantity: newQty,
      delta: finalDelta,
      timestamp: movementRecord.created_at,
      systemResetVersion: ctx.systemResetVersion,
    },
  };
}
