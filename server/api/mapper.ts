/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralized API <-> Internal Format Field Mapper
 *
 * Single source of truth for converting request payloads, query params,
 * records, and response objects between external API formats (camelCase /
 * snake_case / legacy field aliases) and internal server representations.
 */

import type { Request } from "express";
import type {
  ChatMessage,
  RegisteredAccount,
  StockMovement,
  StockMovementResult,
  StockMovementType,
} from "../../shared/types.ts";
import { normalizeUnitCode } from "../../shared/units.ts";
import { resolveEffectiveMaxDevices } from "../../shared/deviceLimit.ts";

export interface MappedRequestMeta {
  deviceId: string;
  userId: string;
  employeeId: string;
  author: string;
  resetVersion?: number;
  accountId: string;
  warehouseId: string;
  expectedVersion?: number;
  actionDesc?: string;
  adminPin: string;
  sessionToken: string;
}

export interface InternalStockMovementInput {
  product_id: string;
  warehouse_id: string;
  account_id: string;
  type: StockMovementType;
  quantity?: number;
  delta?: number;
  reference_id: string | null;
  reference_number: string | null;
  notes: string | null;
  user_id: string | null;
  user_name: string;
  device_id: string;
  idempotency_key: string | null;
  preventNegativeStock: boolean;
  lot_number: string;
  location: string;
  unit?: string;
  reset_version?: number;
}

export interface MappedCategoryAction {
  action: string;
  category: string;
  oldCategory: string;
  newCategory: string;
  categories?: unknown[];
  updateExistingRecords: boolean;
}

export interface MappedRoleAction {
  action: string;
  role: string;
  oldRole: string;
  newRole: string;
  roles?: unknown[];
  updateExistingAccounts: boolean;
}

export interface MappedBatchMutation {
  mutationId: unknown;
  type: string;
  collection: string;
  targetRecordId: string;
  record?: Record<string, any>;
  author?: string;
  employeeId?: string;
  user_id?: string;
  device_id: string;
  actionDesc?: string;
  expectedVersion?: number;
  reset_version?: number;
}

export interface MappedVerifyCredentialsInput {
  identifier: string;
  pin: string;
  deviceId: string;
}

export interface MappedUpdatePinInput {
  employeeId: string;
  currentPin: string;
  newPin: string;
  requesterEmployeeId: string;
  author?: string;
  reason?: string;
}

export interface MappedUpdateAccountInput {
  oldEmployeeId: string;
  updatedUser: Record<string, any> | null;
  author?: string;
}

export interface MappedDeviceHeartbeatInput {
  deviceId: string;
  deviceName?: string;
  employeeId?: string;
  username?: string;
  role?: string;
  currentView?: string;
  appVersion?: string;
  platform?: string;
}

export interface MappedDeviceAuthorizeInput {
  deviceId: string;
  deviceName?: string;
  authorId?: string;
  employeeId: string;
  status: string;
}

export interface MappedAuditLogsQuery {
  dateFrom: string;
  dateTo: string;
  user: string;
  recordType: string;
  action: string;
  searchQuery: string;
  limitParam: number;
}

export interface MappedReleasePublishInput {
  version: string;
  tag: string;
  repository?: string;
  releaseUrl: string;
  buildId: string | number;
}

function pickDefined<T = unknown>(...values: T[]): T | undefined {
  for (const val of values) {
    if (val !== undefined && val !== null) return val;
  }
  return undefined;
}

function pickNonEmptyString(...values: unknown[]): string {
  for (const val of values) {
    if (val !== undefined && val !== null) {
      const str = String(val).trim();
      if (str.length > 0) return str;
    }
  }
  return "";
}

function parseOptionalNumber(val: unknown): number | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  const num = Number(val);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * Extracts and normalizes request metadata headers & body/record aliases into
 * a single canonical shape.
 */
export function mapRequestMetaFromApi(
  req: Pick<Request, "body" | "headers" | "query">,
  explicitDeviceId?: string
): MappedRequestMeta {
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, any>;
  const record = (body.record && typeof body.record === "object" ? body.record : {}) as Record<string, any>;
  const headers = (req.headers || {}) as Record<string, unknown>;
  const query = (req.query || {}) as Record<string, unknown>;

  const deviceId = pickNonEmptyString(
    explicitDeviceId,
    body.device_id,
    body.deviceId,
    headers["x-device-id"],
    record.device_id,
    record.deviceId,
    query.deviceId,
    query.device_id
  );

  const userId = pickNonEmptyString(
    body.user_id,
    body.userId,
    record.user_id,
    record.userId
  );

  const employeeId = pickNonEmptyString(
    body.employeeId,
    body.employee_id,
    headers["x-employee-id"],
    headers["x-user-employee-id"]
  );

  const author = pickNonEmptyString(
    body.author,
    body.userName,
    body.user_name,
    body.username
  );

  const resetVersion = parseOptionalNumber(
    pickDefined(
      body.reset_version,
      body.resetVersion,
      body.currentResetVersion,
      headers["x-reset-version"],
      record.reset_version,
      record.resetVersion
    )
  );

  const expectedVersion = parseOptionalNumber(
    pickDefined(body.expectedVersion, body.expected_version)
  );

  const accountId = pickNonEmptyString(
    body.accountId,
    body.account_id,
    headers["x-account-id"],
    record.accountId,
    record.account_id
  );

  const warehouseId = pickNonEmptyString(
    body.warehouseId,
    body.warehouse_id,
    headers["x-warehouse-id"],
    record.warehouseId,
    record.warehouse_id
  );

  const actionDesc = pickDefined(body.actionDesc, body.action_desc);

  const adminPin = pickNonEmptyString(
    body.adminPin,
    body.pin,
    headers["x-admin-pin"],
    headers["x-user-pin"]
  );

  const authHeader = String(headers["authorization"] || "").trim();
  const bearerToken = /^Bearer\s+/i.test(authHeader)
    ? authHeader.replace(/^Bearer\s+/i, "").trim()
    : "";
  const sessionToken =
    bearerToken || pickNonEmptyString(body.sessionToken, body.token, body.auth_token);

  return {
    deviceId,
    userId,
    employeeId,
    author,
    ...(resetVersion !== undefined ? { resetVersion } : {}),
    accountId,
    warehouseId,
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    ...(actionDesc !== undefined ? { actionDesc: String(actionDesc) } : {}),
    adminPin,
    sessionToken,
  };
}

/**
 * Converts a single stock movement record between API (camelCase/mixed) and
 * internal snake_case format. Maps `idempotencyKey` and `idempotency_key`
 * exclusively to internal `idempotency_key`.
 */
export function mapStockMovementFromApi(raw: Record<string, any>): StockMovement {
  const rec: Record<string, any> = { ...raw };

  const id = pickNonEmptyString(rec.id, rec.record_id, rec.recordId, rec.movementId);
  const product_id = pickNonEmptyString(rec.product_id, rec.productId);
  const warehouse_id = pickNonEmptyString(rec.warehouse_id, rec.warehouseId) || "wh-main";
  const previous_quantity = parseOptionalNumber(
    pickDefined(rec.previous_quantity, rec.previousQuantity)
  );
  const new_quantity = parseOptionalNumber(
    pickDefined(rec.new_quantity, rec.newQuantity)
  );
  const quantity =
    parseOptionalNumber(pickDefined(rec.quantity, rec.delta)) ?? 0;
  const reference_id = pickDefined(rec.reference_id, rec.referenceId) ?? null;
  const reference_number = pickDefined(rec.reference_number, rec.referenceNumber) ?? null;
  const user_id = pickDefined(rec.user_id, rec.userId) ?? null;
  const user_name = pickDefined(rec.user_name, rec.userName);
  const device_id = pickDefined(rec.device_id, rec.deviceId);
  const idempotency_key = pickDefined(rec.idempotency_key, rec.idempotencyKey) ?? null;
  const created_at =
    pickNonEmptyString(rec.created_at, rec.createdAt, rec.timestamp) ||
    new Date().toISOString();
  const product_sku = pickDefined(rec.product_sku, rec.productSku, rec.partCode, rec.part_code);
  const product_name = pickDefined(rec.product_name, rec.productName);
  const warehouse_name = pickDefined(rec.warehouse_name, rec.warehouseName);
  const lot_number = pickDefined(rec.lot_number, rec.lotNumber);
  const rawUnit = pickDefined(rec.unit, rec.uom, rec.unitOfMeasure, rec.unit_of_measure);
  const unit = rawUnit !== undefined ? normalizeUnitCode(String(rawUnit)) : undefined;
  const reset_version = parseOptionalNumber(
    pickDefined(rec.reset_version, rec.resetVersion)
  );

  // Strip API alias keys so internal records store one canonical name per field
  delete rec.movementId;
  delete rec.productId;
  delete rec.warehouseId;
  delete rec.previousQuantity;
  delete rec.newQuantity;
  delete rec.delta;
  delete rec.referenceId;
  delete rec.referenceNumber;
  delete rec.userId;
  delete rec.userName;
  delete rec.deviceId;
  delete rec.idempotencyKey;
  delete rec.createdAt;
  delete rec.timestamp;
  delete rec.productSku;
  delete rec.productName;
  delete rec.warehouseName;
  delete rec.lotNumber;
  delete rec.uom;
  delete rec.unitOfMeasure;
  delete rec.unit_of_measure;
  delete rec.resetVersion;
  delete rec.recordId;

  return {
    ...rec,
    ...(id ? { id } : {}),
    product_id,
    warehouse_id,
    type: rec.type || "ADJUSTMENT_IN",
    quantity,
    ...(previous_quantity !== undefined ? { previous_quantity } : {}),
    ...(new_quantity !== undefined ? { new_quantity } : {}),
    reference_id: reference_id !== null ? String(reference_id) : null,
    reference_number: reference_number !== null ? String(reference_number) : null,
    notes: rec.notes ?? null,
    user_id: user_id !== null ? String(user_id) : null,
    ...(user_name !== undefined ? { user_name: String(user_name) } : {}),
    ...(device_id !== undefined ? { device_id: String(device_id) } : {}),
    idempotency_key: idempotency_key !== null ? String(idempotency_key) : null,
    created_at,
    ...(product_sku !== undefined ? { product_sku: String(product_sku) } : {}),
    ...(product_name !== undefined ? { product_name: String(product_name) } : {}),
    ...(warehouse_name !== undefined ? { warehouse_name: String(warehouse_name) } : {}),
    ...(unit !== undefined ? { unit } : {}),
    ...(lot_number !== undefined ? { lot_number: String(lot_number) } : {}),
    ...(reset_version !== undefined ? { reset_version } : {}),
  } as StockMovement;
}

/**
 * Converts an internal `StockMovement` record to the public API list item format.
 */
export function mapStockMovementToApi(movement: Record<string, any>): StockMovement {
  return mapStockMovementFromApi(movement);
}

/**
 * Converts an incoming `/api/stock-movements` POST body to canonical internal
 * movement execution parameters. Maps `idempotencyKey` and `idempotency_key`
 * to one field (`idempotency_key`).
 */
export function mapStockMovementInputFromApi(
  body: Record<string, any>
): InternalStockMovementInput {
  const b = body || {};
  const idempotencyKeyVal = pickNonEmptyString(b.idempotency_key, b.idempotencyKey);
  const referenceIdVal = pickDefined(b.reference_id, b.referenceId);
  const referenceNumberVal = pickDefined(b.reference_number, b.referenceNumber);
  const userIdVal = pickDefined(b.user_id, b.userId);
  const resetVer = parseOptionalNumber(pickDefined(b.reset_version, b.resetVersion));
  const lot_number = pickNonEmptyString(b.lot_number, b.lotNumber);
  const unit = normalizeUnitCode(pickDefined(b.unit, b.uom, b.unitOfMeasure, b.unit_of_measure));

  return {
    product_id: pickNonEmptyString(b.product_id, b.productId),
    warehouse_id: pickNonEmptyString(b.warehouse_id, b.warehouseId) || "wh-main",
    account_id: pickNonEmptyString(b.account_id, b.accountId) || "ACC-JUWEI",
    type: (b.type || "ADJUSTMENT_IN") as StockMovementType,
    quantity: parseOptionalNumber(b.quantity),
    delta: parseOptionalNumber(b.delta),
    reference_id: referenceIdVal ? String(referenceIdVal) : null,
    reference_number: referenceNumberVal ? String(referenceNumberVal) : null,
    notes: b.notes ? String(b.notes) : null,
    user_id: userIdVal ? String(userIdVal) : null,
    user_name: pickNonEmptyString(b.user_name, b.userName) || "Operator",
    device_id: pickNonEmptyString(b.device_id, b.deviceId) || "CENTRAL-SERVER",
    idempotency_key: idempotencyKeyVal || null,
    preventNegativeStock: pickDefined(b.preventNegativeStock, b.prevent_negative_stock, true) !== false,
    lot_number,
    location: pickNonEmptyString(b.location),
    ...(unit ? { unit } : {}),
    ...(resetVer !== undefined ? { reset_version: resetVer } : {}),
  };
}

/**
 * Converts an internal `StockMovement` record into the REST API response
 * format (`StockMovementResult`).
 */
export function mapStockMovementResultToApi(
  movement: Record<string, any>,
  options?: { idempotency_replayed?: boolean; systemResetVersion?: number }
): StockMovementResult & { idempotency_replayed?: boolean; systemResetVersion?: number } {
  const m = mapStockMovementFromApi(movement);
  return {
    success: true,
    ...(options?.idempotency_replayed ? { idempotency_replayed: true } : {}),
    movementId: m.id,
    productId: m.product_id,
    warehouseId: m.warehouse_id,
    previousQuantity: m.previous_quantity ?? 0,
    newQuantity: m.new_quantity ?? 0,
    delta: m.quantity ?? 0,
    timestamp: m.created_at || new Date().toISOString(),
    ...(options?.systemResetVersion !== undefined
      ? { systemResetVersion: options.systemResetVersion }
      : {}),
  };
}

/**
 * Converts an API operator account payload into the internal `RegisteredAccount` format,
 * unifying snake_case and legacy PIN field aliases (`pin_hash` -> `pinHash`, etc.).
 */
export function mapAccountFromApi(raw: Record<string, any>): RegisteredAccount {
  const u: Record<string, any> = { ...raw };

  const employeeId = pickNonEmptyString(u.employeeId, u.employee_id).toUpperCase();
  const id = pickNonEmptyString(u.id, u.record_id, u.recordId) || (employeeId ? `USR-${employeeId}` : "");
  const pinHash = pickDefined(u.pinHash, u.pin_hash);
  const pinSalt = pickDefined(u.pinSalt, u.pin_salt);
  const phoneNumber = pickDefined(u.phoneNumber, u.phone_number);
  const mustChangePin = pickDefined(u.mustChangePin, u.must_change_pin);
  const isPinCompromised = pickDefined(u.isPinCompromised, u.is_pin_compromised);
  const pinChangedAt = pickDefined(u.pinChangedAt, u.pin_changed_at);
  const pinChangedBy = pickDefined(u.pinChangedBy, u.pin_changed_by);
  const registeredBy = pickDefined(u.registeredBy, u.registered_by);
  const registeredAt = pickDefined(u.registeredAt, u.registered_at);
  const registeredBySuperAdmin = pickDefined(
    u.registeredBySuperAdmin,
    u.registered_by_super_admin
  );
  const lastActive = pickDefined(u.lastActive, u.last_active);
  const deviceId = pickDefined(u.deviceId, u.device_id);
  const stationId = pickDefined(u.stationId, u.station_id);
  const isPrimaryAdminDevice = pickDefined(u.isPrimaryAdminDevice, u.is_primary_admin_device);
  const authorizedDevices = pickDefined(u.authorizedDevices, u.authorized_devices);
  const rawMaxDevices = pickDefined(u.maxDevices, u.max_devices);
  const maxDevices =
    rawMaxDevices !== undefined && rawMaxDevices !== null && String(rawMaxDevices).trim() !== ""
      ? Number(rawMaxDevices)
      : undefined;
  const updated_at = pickDefined(u.updated_at, u.updatedAt);
  const reset_version = parseOptionalNumber(pickDefined(u.reset_version, u.resetVersion));

  delete u.employee_id;
  delete u.record_id;
  delete u.recordId;
  delete u.pin_hash;
  delete u.pin_salt;
  delete u.phone_number;
  delete u.must_change_pin;
  delete u.is_pin_compromised;
  delete u.pin_changed_at;
  delete u.pin_changed_by;
  delete u.registered_by;
  delete u.registered_at;
  delete u.registered_by_super_admin;
  delete u.last_active;
  delete u.device_id;
  delete u.station_id;
  delete u.is_primary_admin_device;
  delete u.authorized_devices;
  delete u.max_devices;
  delete u.updatedAt;
  delete u.resetVersion;

  return {
    ...u,
    ...(id ? { id } : {}),
    employeeId,
    ...(pinHash !== undefined ? { pinHash } : {}),
    ...(pinSalt !== undefined ? { pinSalt } : {}),
    ...(phoneNumber !== undefined ? { phoneNumber } : {}),
    ...(maxDevices !== undefined ? { maxDevices } : {}),
    ...(mustChangePin !== undefined ? { mustChangePin: Boolean(mustChangePin) } : {}),
    ...(isPinCompromised !== undefined ? { isPinCompromised: Boolean(isPinCompromised) } : {}),
    ...(pinChangedAt !== undefined ? { pinChangedAt } : {}),
    ...(pinChangedBy !== undefined ? { pinChangedBy } : {}),
    ...(registeredBy !== undefined ? { registeredBy } : {}),
    ...(registeredAt !== undefined ? { registeredAt } : {}),
    ...(registeredBySuperAdmin !== undefined
      ? { registeredBySuperAdmin: Boolean(registeredBySuperAdmin) }
      : {}),
    ...(lastActive !== undefined ? { lastActive } : {}),
    ...(deviceId !== undefined ? { deviceId } : {}),
    ...(stationId !== undefined ? { stationId } : {}),
    ...(isPrimaryAdminDevice !== undefined
      ? { isPrimaryAdminDevice: Boolean(isPrimaryAdminDevice) }
      : {}),
    ...(authorizedDevices !== undefined ? { authorizedDevices } : {}),
    ...(updated_at !== undefined ? { updated_at } : {}),
    ...(reset_version !== undefined ? { reset_version } : {}),
  } as RegisteredAccount;
}

/**
 * Converts an internal `RegisteredAccount` to a safe API response object
 * (never exposing `pin`, `pinHash`, `pinSalt`, or `pin_hash`).
 */
export function mapAccountToApi(u: any): any {
  if (!u || typeof u !== "object") return u;
  const hasConfiguredPin = Boolean(
    u.pinHash || u.pin_hash || u.hasPin || (u.pin && String(u.pin).trim() !== "")
  );
  const {
    pin: _pin,
    pinHash: _pinHash,
    pinSalt: _pinSalt,
    pin_hash: _pinHashLegacy,
    pin_salt: _pinSaltLegacy,
    ...safe
  } = u;
  return {
    ...safe,
    maxDevices: resolveEffectiveMaxDevices(u),
    hasPin: hasConfiguredPin,
    mustChangePin: Boolean(u.mustChangePin),
  };
}

/**
 * Converts any collection record from external API format to canonical internal
 * format before storage or upsert.
 */
export function mapRecordFromApi(collection: string, raw: Record<string, any>): Record<string, any> {
  if (!raw || typeof raw !== "object") return raw;

  if (collection === "stockMovements") {
    return mapStockMovementFromApi(raw) as unknown as Record<string, any>;
  }

  if (collection === "registeredUsers") {
    return mapAccountFromApi(raw) as unknown as Record<string, any>;
  }

  const rec: Record<string, any> = { ...raw };

  const resolvedId = pickNonEmptyString(rec.id, rec.record_id, rec.recordId);
  const resolvedRecordId = pickNonEmptyString(rec.record_id, rec.recordId, rec.id);
  const device_id = pickDefined(rec.device_id, rec.deviceId);
  const user_id = pickDefined(rec.user_id, rec.userId);
  const reset_version = parseOptionalNumber(pickDefined(rec.reset_version, rec.resetVersion));
  const created_at = pickDefined(rec.created_at, rec.createdAt);
  const created_by = pickDefined(rec.created_by, rec.createdBy);
  const updated_at = pickDefined(rec.updated_at, rec.updatedAt);
  const updated_by = pickDefined(rec.updated_by, rec.updatedBy);

  const partCode = pickDefined(rec.partCode, rec.part_code, rec.itemCode, rec.item_code);
  const description = pickDefined(rec.description, rec.itemDescription, rec.materialDescription, rec.name);
  const materialType = pickDefined(rec.type, rec.materialType, rec.material_type);
  const lotNumber = pickDefined(rec.lotNumber, rec.lot_number);
  const receivedDate = pickDefined(rec.receivedDate, rec.received_date);
  const expirationDate = pickDefined(rec.expirationDate, rec.expiration_date);
  const fifoColor = pickDefined(rec.fifoColor, rec.fifo_color);
  const fifoColorCode = pickDefined(rec.fifoColorCode, rec.fifo_color_code);
  const warehouseId = pickDefined(
    rec.warehouseId,
    rec.warehouse_id,
    rec.locationWarehouse,
    rec.warehouse
  );
  const accountId = pickDefined(rec.accountId, rec.account_id, rec.account);
  const itemDescription = pickDefined(rec.itemDescription, rec.item_description);
  const materialDescription = pickDefined(rec.materialDescription, rec.material_description);
  const vendorSupplier = pickDefined(rec.vendorSupplier, rec.vendor_supplier);
  const supplierOrDept = pickDefined(rec.supplierOrDept, rec.supplier_or_dept);
  const reorderMin = pickDefined(rec.reorderMin, rec.reorder_min);
  const shelfLifeDays = pickDefined(rec.shelfLifeDays, rec.shelf_life_days);
  const rawUnit = pickDefined(rec.unit, rec.uom, rec.unitOfMeasure, rec.unit_of_measure);
  const unit = rawUnit !== undefined ? normalizeUnitCode(String(rawUnit)) : undefined;
  const stockId = pickDefined(rec.stockId, rec.stock_id);
  const movementIdempotencyKey = pickDefined(
    rec.movementIdempotencyKey,
    rec.movement_idempotency_key
  );

  // Strip alternate alias keys to enforce single internal field names
  delete rec.recordId;
  delete rec.deviceId;
  delete rec.userId;
  delete rec.resetVersion;
  delete rec.createdAt;
  delete rec.itemCode;
  delete rec.item_code;
  delete rec.materialType;
  delete rec.material_type;
  delete rec.createdBy;
  delete rec.updatedAt;
  delete rec.updatedBy;
  delete rec.part_code;
  delete rec.lot_number;
  delete rec.received_date;
  delete rec.expiration_date;
  delete rec.fifo_color;
  delete rec.fifo_color_code;
  delete rec.warehouse_id;
  delete rec.locationWarehouse;
  delete rec.warehouse;
  delete rec.account_id;
  delete rec.account;
  delete rec.item_description;
  delete rec.material_description;
  delete rec.vendor_supplier;
  delete rec.supplier_or_dept;
  delete rec.reorder_min;
  delete rec.shelf_life_days;
  delete rec.uom;
  delete rec.unitOfMeasure;
  delete rec.unit_of_measure;
  delete rec.stock_id;
  delete rec.movement_idempotency_key;

  if (resolvedId) rec.id = resolvedId;
  if (resolvedRecordId) rec.record_id = resolvedRecordId;
  if (device_id !== undefined) rec.device_id = device_id;
  if (user_id !== undefined) rec.user_id = user_id;
  if (reset_version !== undefined) rec.reset_version = reset_version;
  if (created_at !== undefined) rec.created_at = created_at;
  if (created_by !== undefined) rec.created_by = created_by;
  if (updated_at !== undefined) rec.updated_at = updated_at;
  if (updated_by !== undefined) rec.updated_by = updated_by;

  if (partCode !== undefined) rec.partCode = partCode;
  if (description !== undefined && rec.description === undefined) rec.description = description;
  if (materialType !== undefined && rec.type === undefined) rec.type = materialType;
  if (lotNumber !== undefined) rec.lotNumber = lotNumber;
  if (receivedDate !== undefined) rec.receivedDate = receivedDate;
  if (expirationDate !== undefined) rec.expirationDate = expirationDate;
  if (fifoColor !== undefined) rec.fifoColor = fifoColor;
  if (fifoColorCode !== undefined) rec.fifoColorCode = fifoColorCode;
  if (warehouseId !== undefined) rec.warehouseId = warehouseId;
  if (accountId !== undefined) rec.accountId = accountId;
  if (itemDescription !== undefined) rec.itemDescription = itemDescription;
  if (materialDescription !== undefined) rec.materialDescription = materialDescription;
  if (vendorSupplier !== undefined) rec.vendorSupplier = vendorSupplier;
  if (supplierOrDept !== undefined) rec.supplierOrDept = supplierOrDept;
  if (reorderMin !== undefined) rec.reorderMin = reorderMin;
  if (shelfLifeDays !== undefined) rec.shelfLifeDays = shelfLifeDays;
  if (unit !== undefined) rec.unit = unit;
  if (Array.isArray(rec.bom)) {
    rec.bom = rec.bom.map((bItem: any) =>
      bItem && typeof bItem === "object"
        ? { ...bItem, unit: normalizeUnitCode(bItem.unit) }
        : bItem
    );
  }
  if (stockId !== undefined) rec.stockId = String(stockId);
  if (movementIdempotencyKey !== undefined) {
    rec.movementIdempotencyKey = String(movementIdempotencyKey);
  }

  return rec;
}

/**
 * Converts an internal record back to external API representation.
 */
export function mapRecordToApi(collection: string, record: any): any {
  if (!record || typeof record !== "object") return record;
  if (collection === "registeredUsers") {
    return mapAccountToApi(record);
  }
  if (collection === "stockMovements") {
    return mapStockMovementToApi(record);
  }
  return record;
}

/**
 * Maps full sync state data for API responses / WS init payloads.
 */
export function mapSyncStateToApi(data: Record<string, any>): Record<string, any> {
  const cloned: Record<string, any> = { ...data };
  if (Array.isArray(cloned.registeredUsers)) {
    cloned.registeredUsers = cloned.registeredUsers.map((u: any) => mapAccountToApi(u));
  }
  if (Array.isArray(cloned.stockMovements)) {
    cloned.stockMovements = cloned.stockMovements.map((m: any) => mapStockMovementToApi(m));
  }
  return cloned;
}

/**
 * Converts `/api/categories` request body aliases (`oldCat` / `oldCategory`,
 * `newCat` / `newCategory`) to canonical fields.
 */
export function mapCategoryActionFromApi(body: Record<string, any>): MappedCategoryAction {
  const b = body || {};
  return {
    action: String(b.action || "").trim(),
    category: String(b.category || "").trim(),
    oldCategory: pickNonEmptyString(b.oldCategory, b.oldCat, b.old_category),
    newCategory: pickNonEmptyString(b.newCategory, b.newCat, b.new_category),
    categories: Array.isArray(b.categories) ? b.categories : undefined,
    updateExistingRecords: pickDefined(b.updateExistingRecords, b.update_existing_records, true) !== false,
  };
}

/**
 * Converts `/api/roles` request body aliases to canonical fields.
 */
export function mapRoleActionFromApi(body: Record<string, any>): MappedRoleAction {
  const b = body || {};
  return {
    action: String(b.action || "").trim(),
    role: String(b.role || "").trim(),
    oldRole: pickNonEmptyString(b.oldRole, b.old_role),
    newRole: pickNonEmptyString(b.newRole, b.new_role),
    roles: Array.isArray(b.roles) ? b.roles : undefined,
    updateExistingAccounts: pickDefined(b.updateExistingAccounts, b.update_existing_accounts, true) !== false,
  };
}

/**
 * Converts a batch mutation item from `/api/sync/batch` or WS `batch_mutations`
 * into canonical internal format.
 */
export function mapBatchMutationFromApi(
  raw: Record<string, any>,
  defaults: {
    author: string;
    employeeId?: string;
    user_id: string;
    device_id: string;
    reset_version: number;
  }
): MappedBatchMutation {
  const m = raw || {};
  const collection = String(m.collection || "").trim();
  const device_id = pickNonEmptyString(m.device_id, m.deviceId) || defaults.device_id;
  const user_id = pickNonEmptyString(m.user_id, m.userId) || defaults.user_id;
  const reset_version =
    parseOptionalNumber(pickDefined(m.reset_version, m.resetVersion)) ?? defaults.reset_version;
  const expectedVersion = parseOptionalNumber(
    pickDefined(m.expectedVersion, m.expected_version)
  );
  const mappedRecord =
    m.record && typeof m.record === "object"
      ? mapRecordFromApi(collection, m.record)
      : undefined;
  const targetRecordId = pickNonEmptyString(
    m.id,
    m.recordId,
    m.record_id,
    mappedRecord?.id,
    mappedRecord?.record_id
  );

  return {
    mutationId: pickDefined(m.id, m.mutationId),
    type: String(m.type || "").trim(),
    collection,
    targetRecordId,
    record: mappedRecord,
    author: pickNonEmptyString(m.author) || defaults.author,
    employeeId: pickNonEmptyString(m.employeeId, m.employee_id) || defaults.employeeId,
    user_id,
    device_id,
    actionDesc: pickDefined(m.actionDesc, m.action_desc) as string | undefined,
    expectedVersion,
    reset_version,
  };
}

/**
 * Formats an individual batch mutation execution result to the API response shape.
 */
export function mapBatchMutationResultToApi(params: {
  mutationId: unknown;
  type: string;
  collection: string;
  recordId: string;
  success: boolean;
  status: number;
  error?: string;
  fieldErrors?: Record<string, string>;
  confirmedRecord?: any;
  currentRecord?: any;
}): Record<string, any> {
  const record =
    params.confirmedRecord !== undefined
      ? mapRecordToApi(params.collection, params.confirmedRecord)
      : undefined;
  const currentRecord =
    params.currentRecord !== undefined || params.confirmedRecord !== undefined
      ? mapRecordToApi(params.collection, params.currentRecord || params.confirmedRecord)
      : undefined;

  return {
    id: params.mutationId,
    mutationId: params.mutationId,
    type: params.type,
    collection: params.collection,
    recordId: params.recordId,
    success: params.success,
    status: params.status,
    error: params.error,
    ...(params.fieldErrors ? { fieldErrors: params.fieldErrors, errors: params.fieldErrors } : {}),
    ...(params.type === "upsert" ? { record } : {}),
    currentRecord,
  };
}

/**
 * Converts `/api/accounts/verify` input payload.
 */
export function mapVerifyCredentialsInputFromApi(
  req: Pick<Request, "body" | "headers" | "query">
): MappedVerifyCredentialsInput {
  const b = (req.body || {}) as Record<string, any>;
  const meta = mapRequestMetaFromApi(req);
  return {
    identifier: String(b.identifier || "").trim(),
    pin: String(b.pin || "").trim(),
    deviceId: meta.deviceId,
  };
}

/**
 * Converts `/api/accounts/verify` output payload (`token` and `sessionToken`).
 */
export function mapVerifyCredentialsResponseToApi(params: {
  sessionToken: string;
  user: RegisteredAccount;
  mustChangePin: boolean;
  isPinCompromised: boolean;
  systemResetVersion: number;
}): Record<string, any> {
  return {
    success: true,
    token: params.sessionToken,
    sessionToken: params.sessionToken,
    permission: params.user.permission,
    mustChangePin: params.mustChangePin,
    isPinCompromised: params.isPinCompromised,
    user: mapAccountToApi(params.user),
    systemResetVersion: params.systemResetVersion,
  };
}

/**
 * Converts `/api/accounts/update-pin` input payload.
 */
export function mapUpdatePinInputFromApi(body: Record<string, any>): MappedUpdatePinInput {
  const b = body || {};
  const employeeId = pickNonEmptyString(b.employeeId, b.employee_id).toUpperCase();
  return {
    employeeId,
    currentPin: String(pickDefined(b.currentPin, b.current_pin, "")).trim(),
    newPin: String(pickDefined(b.newPin, b.new_pin, "")).trim(),
    requesterEmployeeId: (
      pickNonEmptyString(b.requesterEmployeeId, b.requester_employee_id) || employeeId
    ).toUpperCase(),
    author: b.author ? String(b.author) : undefined,
    reason: b.reason ? String(b.reason) : undefined,
  };
}

/**
 * Converts `/api/accounts/update` input payload.
 */
export function mapUpdateAccountInputFromApi(body: Record<string, any>): MappedUpdateAccountInput {
  const b = body || {};
  const rawUpdated =
    b.updatedUser && typeof b.updatedUser === "object"
      ? mapAccountFromApi(b.updatedUser)
      : null;
  const oldEmployeeId = pickNonEmptyString(
    b.oldEmployeeId,
    b.old_employee_id,
    rawUpdated?.employeeId
  ).toUpperCase();
  return {
    oldEmployeeId,
    updatedUser: rawUpdated,
    author: b.author ? String(b.author) : undefined,
  };
}

/**
 * Converts `/api/devices/heartbeat` input payload.
 */
export function mapDeviceHeartbeatFromApi(body: Record<string, any>): MappedDeviceHeartbeatInput {
  const b = body || {};
  return {
    deviceId: pickNonEmptyString(b.deviceId, b.device_id),
    deviceName: pickDefined(b.deviceName, b.device_name) as string | undefined,
    employeeId: pickDefined(b.employeeId, b.employee_id) as string | undefined,
    username: b.username ? String(b.username) : undefined,
    role: b.role ? String(b.role) : undefined,
    currentView: pickDefined(
      b.currentView,
      b.current_view,
      b.activeView,
      b.active_view
    ) as string | undefined,
    appVersion: pickDefined(b.appVersion, b.app_version) as string | undefined,
    platform: b.platform ? String(b.platform) : undefined,
  };
}

/**
 * Converts `/api/devices/authorize` input payload.
 */
export function mapDeviceAuthorizeFromApi(body: Record<string, any>): MappedDeviceAuthorizeInput {
  const b = body || {};
  return {
    deviceId: pickNonEmptyString(b.deviceId, b.device_id),
    deviceName: pickDefined(b.deviceName, b.device_name) as string | undefined,
    authorId: pickDefined(b.authorId, b.author_id) as string | undefined,
    employeeId: pickNonEmptyString(b.employeeId, b.employee_id).toUpperCase(),
    status: String(b.status || "").trim().toUpperCase(),
  };
}

/**
 * Converts an internal `ActiveConnectionRecord` to the API presence record shape.
 */
export function mapPresenceToApi(conn: {
  connection_id: string;
  user_id: string;
  session_id: string;
  device_id: string;
  stationId?: string;
  employeeId?: string;
  username: string;
  role?: string;
  permission?: string;
  platform?: string;
  deviceName?: string;
  activeView?: string;
  connectedAt?: string;
  lastPing?: number;
  accountId?: string;
  warehouseId?: string;
}): Record<string, any> {
  return {
    connection_id: conn.connection_id,
    connectionId: conn.connection_id,
    user_id: conn.user_id,
    userId: conn.user_id,
    session_id: conn.session_id,
    sessionId: conn.session_id,
    device_id: conn.device_id,
    deviceId: conn.device_id,
    stationId: conn.stationId || "",
    employeeId: conn.employeeId || "",
    username: conn.username,
    role: conn.role || "OPERATOR",
    permission: conn.permission || "LIMITED_ACCESS",
    platform: conn.platform || "Web",
    deviceName: conn.deviceName || "Terminal",
    activeView: conn.activeView || "dashboard",
    connectedAt: conn.connectedAt,
    lastPing: conn.lastPing,
    accountId: conn.accountId || "ACC-JUWEI",
    warehouseId: conn.warehouseId || "WH-MAIN",
    source: "central_websocket" as const,
  };
}

/**
 * Converts `/api/admin/audit-logs` query params to canonical internal filter fields.
 */
export function mapAuditLogsQueryFromApi(query: Record<string, any>): MappedAuditLogsQuery {
  const q = query || {};
  return {
    dateFrom: pickNonEmptyString(q.dateFrom, q.date_from),
    dateTo: pickNonEmptyString(q.dateTo, q.date_to),
    user: pickNonEmptyString(q.user).toLowerCase(),
    recordType: pickNonEmptyString(q.recordType, q.record_type),
    action: pickNonEmptyString(q.action).toUpperCase(),
    searchQuery: pickNonEmptyString(q.q).toLowerCase(),
    limitParam: parseInt(String(q.limit || "1000"), 10),
  };
}

/**
 * Converts `/api/build-info/publish` and `/api/release/latest` payloads.
 */
export function mapReleasePublishFromApi(body: Record<string, any>): MappedReleasePublishInput {
  const b = body || {};
  const rawVersion = pickNonEmptyString(b.version, b.tag);
  const version = rawVersion.replace(/^v/i, "").trim();
  return {
    version,
    tag: String(b.tag || (version ? `v${version}` : "")),
    repository: typeof b.repository === "string" ? b.repository : undefined,
    releaseUrl: pickNonEmptyString(b.releaseUrl, b.release_url),
    buildId: pickDefined(b.buildId, b.build_id, Date.now()) as string | number,
  };
}

/**
 * Converts `/api/chat` input payload to a canonical internal `ChatMessage`.
 */
export function mapChatMessageFromApi(body: Record<string, any>): ChatMessage {
  const b = body || {};
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    sender: pickNonEmptyString(b.sender, b.username) || "Staff",
    text: pickNonEmptyString(b.text, b.message),
    timestamp: new Date().toISOString(),
    isSystem: false,
  };
}

/**
 * Converts `/api/records/delete` input payload aliases (`id`, `recordId`, `record_id`).
 */
export function mapDeleteRecordInputFromApi(body: Record<string, any>): {
  collection: string;
  id: string;
} {
  const b = body || {};
  return {
    collection: String(b.collection || "").trim(),
    id: pickNonEmptyString(b.id, b.recordId, b.record_id),
  };
}

/**
 * Converts `/api/sync` POST payload records from API format to internal format.
 */
export function mapSyncCollectionInputFromApi(
  collection: string,
  data: unknown
): any {
  if (!Array.isArray(data)) return data;
  if (
    collection === "operationalRoles" ||
    collection === "receivingCategories" ||
    collection === "fifoColorsByMonth"
  ) {
    return data;
  }
  return data.map((item: any) =>
    item && typeof item === "object" ? mapRecordFromApi(collection, item) : item
  );
}

