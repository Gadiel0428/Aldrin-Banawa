/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Save-Time Validation Rules (Client + Server Single Source of Truth)
 */

import type {
  AuthorizedDevice,
  DeliveryRecord,
  IssuanceRecord,
  MaterialStockItem,
  ReceivingRecord,
} from './types';

export const RR_FORMAT_REGEX = /^RR-\d{4}-\d{4}$/;
export const PO_FORMAT_REGEX = /^PO-\d{4}-\d{4}$/;
export const DR_FORMAT_REGEX = /^DR-\d{5}$/;
export const SI_FORMAT_REGEX = /^SI-\d{5}$/;

export const DEFAULT_MAX_DEVICES = 2;
export const MIN_MAX_DEVICES = 1;
export const MAX_MAX_DEVICES = 10;

export interface ValidationResult {
  valid: boolean;
  fieldErrors: Record<string, string>;
  message: string;
}

export function normalizeDocValue(val: unknown): string {
  return String(val ?? '').trim();
}

export function normalizeYmdDate(val: unknown): string | null {
  const str = String(val ?? '').trim();
  if (!str) return null;
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function isSameRecord(candidate: Record<string, any>, existing: Record<string, any>): boolean {
  const cId = String(candidate?.id || candidate?.record_id || '').trim();
  const eId = String(existing?.id || existing?.record_id || '').trim();
  return Boolean(cId && eId && cId === eId);
}

function hasDuplicateDocValue(
  value: string,
  targetRecord: Record<string, any>,
  existingList: Record<string, any>[],
  fieldExtractor: (item: Record<string, any>) => unknown
): boolean {
  const normalizedTarget = value.trim().toUpperCase();
  if (!normalizedTarget) return false;

  for (const item of existingList) {
    if (!item || isSameRecord(targetRecord, item)) continue;
    const existingVal = String(fieldExtractor(item) ?? '').trim().toUpperCase();
    if (existingVal && existingVal === normalizedTarget) {
      return true;
    }
  }
  return false;
}

function buildResult(fieldErrors: Record<string, string>): ValidationResult {
  const messages = Object.values(fieldErrors).filter(Boolean);
  return {
    valid: messages.length === 0,
    fieldErrors,
    message: messages.length > 0 ? messages[0] : '',
  };
}

export interface ValidateReceivingOptions {
  requireOperationalFields?: boolean;
}

export function validateReceivingRecord(
  record: Partial<ReceivingRecord> & Record<string, any>,
  existingReceiving: Partial<ReceivingRecord>[] = [],
  options: ValidateReceivingOptions = {}
): ValidationResult {
  const fieldErrors: Record<string, string> = {};

  if (options.requireOperationalFields) {
    if (!String(record.supplierOrDept || '').trim()) {
      fieldErrors.supplierOrDept = 'Arrival classification / category is required.';
    }
    if (!String(record.partCode || '').trim()) {
      fieldErrors.partCode = 'Model / Part Code is required.';
    }
    if (!String(record.location || '').trim()) {
      fieldErrors.location = 'Storage location is required.';
    }
    if (!String(record.unit || '').trim()) {
      fieldErrors.unit = 'Unit of Measure (UOM) is required.';
    }
  }

  // Quantity must be strictly positive (> 0)
  const qty = Number(record.quantity);
  if (
    record.quantity === undefined ||
    record.quantity === null ||
    record.quantity === ('' as any) ||
    Number.isNaN(qty) ||
    !Number.isFinite(qty) ||
    qty <= 0
  ) {
    fieldErrors.quantity = 'Quantity must be greater than 0 (negative or zero values are not allowed).';
  }

  // Expiry earlier than receipt date check
  const receiptDateYmd = normalizeYmdDate(record.receivedDate || record.received_date || record.date);
  const rawExp = record.expirationDate ?? record.expiration_date;
  const expiryDateYmd = normalizeYmdDate(rawExp);
  if (rawExp !== undefined && rawExp !== null && String(rawExp).trim() !== '' && !expiryDateYmd) {
    fieldErrors.expirationDate = 'Expiry date must be a valid YYYY-MM-DD date.';
  } else if (expiryDateYmd && receiptDateYmd && expiryDateYmd < receiptDateYmd) {
    fieldErrors.expirationDate = `Expiry date (${expiryDateYmd}) cannot be earlier than the receipt date (${receiptDateYmd}).`;
  }

  // RR Number format & duplicate check
  const rr = normalizeDocValue(record.rrNumber ?? record.rr_number);
  if (rr) {
    if (!RR_FORMAT_REGEX.test(rr)) {
      fieldErrors.rrNumber = 'RR number must match format RR-YYYY-NNNN (e.g. RR-2026-0001).';
    } else if (
      hasDuplicateDocValue(rr, record, existingReceiving as Record<string, any>[], (r) => r.rrNumber ?? r.rr_number)
    ) {
      fieldErrors.rrNumber = `Duplicate RR number "${rr}" already exists.`;
    }
  }

  // PO Number format & duplicate check
  const po = normalizeDocValue(record.poNumber ?? record.po_number);
  if (po) {
    if (!PO_FORMAT_REGEX.test(po)) {
      fieldErrors.poNumber = 'PO number must match format PO-YYYY-NNNN (e.g. PO-2026-0001).';
    } else if (
      hasDuplicateDocValue(po, record, existingReceiving as Record<string, any>[], (r) => r.poNumber ?? r.po_number)
    ) {
      fieldErrors.poNumber = `Duplicate PO number "${po}" already exists.`;
    }
  }

  // DR Number format & duplicate check
  const dr = normalizeDocValue(record.drNumber ?? record.dr_number);
  if (dr) {
    if (!DR_FORMAT_REGEX.test(dr)) {
      fieldErrors.drNumber = 'DR number must match format DR-NNNNN (e.g. DR-00001).';
    } else if (
      hasDuplicateDocValue(dr, record, existingReceiving as Record<string, any>[], (r) => r.drNumber ?? r.dr_number)
    ) {
      fieldErrors.drNumber = `Duplicate DR number "${dr}" already exists.`;
    }
  }

  // SI Number format & duplicate check
  const si = normalizeDocValue(record.siNumber ?? record.si_number);
  if (si) {
    if (!SI_FORMAT_REGEX.test(si)) {
      fieldErrors.siNumber = 'SI number must match format SI-NNNNN (e.g. SI-00001).';
    } else if (
      hasDuplicateDocValue(si, record, existingReceiving as Record<string, any>[], (r) => r.siNumber ?? r.si_number)
    ) {
      fieldErrors.siNumber = `Duplicate SI number "${si}" already exists.`;
    }
  }

  return buildResult(fieldErrors);
}

export interface ValidateIssuanceOptions {
  requireOperationalFields?: boolean;
  availableLotQty?: number;
  isNewerLotSelected?: boolean;
  superAdminApproved?: boolean;
}

export function validateIssuanceRecord(
  record: Partial<IssuanceRecord> & Record<string, any>,
  options: ValidateIssuanceOptions = {}
): ValidationResult {
  const fieldErrors: Record<string, string> = {};

  if (options.requireOperationalFields) {
    if (!String(record.requisitionNumber || '').trim()) {
      fieldErrors.requisitionNumber = 'Requisition slip number is required.';
    }
    if (!String(record.partCode || '').trim()) {
      fieldErrors.partCode = 'Part code is required.';
    }
    if (!String(record.lotNumber || '').trim()) {
      fieldErrors.lotNumber = 'Lot number is required.';
    }
    if (!String(record.receivedBy || '').trim()) {
      fieldErrors.receivedBy = 'Receiver name / signature is required.';
    }
    if (options.isNewerLotSelected) {
      if (!String(record.overrideReason || '').trim()) {
        fieldErrors.overrideReason = 'Override reason is required when selecting a newer lot.';
      }
      if (!options.superAdminApproved) {
        fieldErrors.superAdminApproved = 'Super Admin approval is required when selecting a newer lot.';
      }
    }
  }

  const rawQtyReq = record.quantityRequested ?? record.quantity_requested;
  const qtyReq = Number(rawQtyReq);
  if (
    rawQtyReq === undefined ||
    rawQtyReq === null ||
    rawQtyReq === '' ||
    Number.isNaN(qtyReq) ||
    !Number.isFinite(qtyReq) ||
    qtyReq <= 0
  ) {
    fieldErrors.quantityRequested = 'Quantity requested must be greater than 0 (negative or zero values are not allowed).';
  }

  const rawQtyIss = record.quantityIssued ?? record.quantity_issued;
  const qtyIss = Number(rawQtyIss);
  if (
    rawQtyIss === undefined ||
    rawQtyIss === null ||
    rawQtyIss === '' ||
    Number.isNaN(qtyIss) ||
    !Number.isFinite(qtyIss) ||
    qtyIss <= 0
  ) {
    fieldErrors.quantityIssued = 'Quantity issued must be greater than 0 (negative or zero values are not allowed).';
  } else if (
    options.availableLotQty !== undefined &&
    Number.isFinite(options.availableLotQty) &&
    qtyIss > options.availableLotQty
  ) {
    fieldErrors.quantityIssued = `Quantity issued cannot exceed available lot stock (${options.availableLotQty}).`;
  }

  return buildResult(fieldErrors);
}

export interface ValidateDeliveryOptions {
  requireOperationalFields?: boolean;
  requireReleaseDocs?: boolean;
}

export function validateDeliveryRecord(
  record: Partial<DeliveryRecord> & Record<string, any>,
  existingDeliveries: Partial<DeliveryRecord>[] = [],
  options: ValidateDeliveryOptions = {}
): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  const isReleased = record.status === 'RELEASED' || Boolean(options.requireReleaseDocs);

  if (options.requireOperationalFields) {
    if (!String(record.pickingListNumber || '').trim()) {
      fieldErrors.pickingListNumber = 'Picking List (DPL) number is required.';
    }
    if (!String(record.modelName || '').trim()) {
      fieldErrors.modelName = 'Model / Description is required.';
    }
    if (!String(record.partCode || '').trim()) {
      fieldErrors.partCode = 'Part Code is required.';
    }
    if (!String(record.unit || '').trim()) {
      fieldErrors.unit = 'Unit of Measure (UOM) is required.';
    }
  }

  // Quantity must be strictly positive (> 0)
  const qty = Number(record.quantity);
  if (
    record.quantity === undefined ||
    record.quantity === null ||
    record.quantity === ('' as any) ||
    Number.isNaN(qty) ||
    !Number.isFinite(qty) ||
    qty <= 0
  ) {
    fieldErrors.quantity = 'Dispatch quantity must be greater than 0 (negative or zero values are not allowed).';
  }

  // PO Number: required if present or on operational pick/save; always validate format & uniqueness when non-empty
  const po = normalizeDocValue(record.poNumber ?? record.po_number);
  if (!po) {
    if (options.requireOperationalFields || 'poNumber' in record || 'po_number' in record) {
      fieldErrors.poNumber = 'PO number is required and must match format PO-YYYY-NNNN (e.g. PO-2026-0001).';
    }
  } else if (!PO_FORMAT_REGEX.test(po)) {
    fieldErrors.poNumber = 'PO number must match format PO-YYYY-NNNN (e.g. PO-2026-0001).';
  } else if (
    hasDuplicateDocValue(po, record, existingDeliveries as Record<string, any>[], (d) => d.poNumber ?? d.po_number)
  ) {
    fieldErrors.poNumber = `Duplicate PO number "${po}" already exists.`;
  }

  // DR Number: required on release; always validate format & uniqueness when provided
  const dr = normalizeDocValue(record.drNumber ?? record.dr_number);
  if (!dr) {
    if (isReleased) {
      fieldErrors.drNumber = 'DR number is required (format DR-NNNNN, e.g. DR-00001).';
    }
  } else if (!DR_FORMAT_REGEX.test(dr)) {
    fieldErrors.drNumber = 'DR number must match format DR-NNNNN (e.g. DR-00001).';
  } else if (
    hasDuplicateDocValue(dr, record, existingDeliveries as Record<string, any>[], (d) => d.drNumber ?? d.dr_number)
  ) {
    fieldErrors.drNumber = `Duplicate DR number "${dr}" already exists.`;
  }

  // SI Number (salesInvoice): required on release; always validate format & uniqueness when provided
  const si = normalizeDocValue(record.salesInvoice ?? record.sales_invoice ?? record.siNumber);
  if (!si) {
    if (isReleased) {
      fieldErrors.salesInvoice = 'SI number is required (format SI-NNNNN, e.g. SI-00001).';
    }
  } else if (!SI_FORMAT_REGEX.test(si)) {
    fieldErrors.salesInvoice = 'SI number must match format SI-NNNNN (e.g. SI-00001).';
  } else if (
    hasDuplicateDocValue(
      si,
      record,
      existingDeliveries as Record<string, any>[],
      (d) => d.salesInvoice ?? d.sales_invoice ?? d.siNumber
    )
  ) {
    fieldErrors.salesInvoice = `Duplicate SI number "${si}" already exists.`;
  }

  if (options.requireReleaseDocs && !String(record.wayBill ?? record.way_bill ?? '').trim()) {
    fieldErrors.wayBill = 'Waybill number is required for gate pass release.';
  }

  return buildResult(fieldErrors);
}

export function validateStockRecord(
  record: Partial<MaterialStockItem> & Record<string, any>
): ValidationResult {
  const fieldErrors: Record<string, string> = {};

  if (record.quantity !== undefined && record.quantity !== null) {
    const qty = Number(record.quantity);
    if (Number.isNaN(qty) || !Number.isFinite(qty) || qty < 0) {
      fieldErrors.quantity = 'Stock quantity cannot be negative.';
    }
  }

  const receiptDateYmd = normalizeYmdDate(record.receivedDate || record.received_date);
  const rawExp = record.expirationDate ?? record.expiration_date;
  const expiryDateYmd = normalizeYmdDate(rawExp);
  if (rawExp !== undefined && rawExp !== null && String(rawExp).trim() !== '' && !expiryDateYmd) {
    fieldErrors.expirationDate = 'Expiry date must be a valid YYYY-MM-DD date.';
  } else if (expiryDateYmd && receiptDateYmd && expiryDateYmd < receiptDateYmd) {
    fieldErrors.expirationDate = `Expiry date (${expiryDateYmd}) cannot be earlier than the receipt date (${receiptDateYmd}).`;
  }

  return buildResult(fieldErrors);
}

export interface MaxDevicesValidationResult {
  valid: boolean;
  value?: number;
  error?: string;
}

export function validateMaxDevices(rawValue: unknown): MaxDevicesValidationResult {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return {
      valid: false,
      error: `Maximum devices must be a whole number between ${MIN_MAX_DEVICES} and ${MAX_MAX_DEVICES}.`,
    };
  }
  const num = Number(rawValue);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < MIN_MAX_DEVICES || num > MAX_MAX_DEVICES) {
    return {
      valid: false,
      error: `Maximum devices must be a whole number between ${MIN_MAX_DEVICES} and ${MAX_MAX_DEVICES}.`,
    };
  }
  return { valid: true, value: num };
}

export function normalizeMaxDevices(
  rawValue: unknown,
  fallback: number = DEFAULT_MAX_DEVICES
): number {
  const res = validateMaxDevices(rawValue);
  if (res.valid && res.value !== undefined) {
    return res.value;
  }
  return fallback;
}

export function isSuperAdminAccount(account?: {
  employeeId?: string;
  permission?: string;
  role?: string;
} | null): boolean {
  if (!account) return false;
  const empId = String(account.employeeId || '').trim().toUpperCase();
  const perm = String(account.permission || '').trim().toUpperCase();
  const role = String(account.role || '').trim().toUpperCase();
  return empId === 'JPMP-002' || perm === 'FULL_ACCESS' || role.includes('SUPER ADMIN');
}

export function getDeviceBoundEmployeeId(
  device?: { boundEmployeeId?: string; employeeId?: string } | null
): string {
  if (!device) return '';
  return String(device.boundEmployeeId ?? device.employeeId ?? '').trim().toUpperCase();
}

export function countBoundDevicesForOperator(
  devices: Iterable<AuthorizedDevice>,
  employeeId: string
): number {
  const targetId = String(employeeId || '').trim().toUpperCase();
  if (!targetId) return 0;
  let count = 0;
  for (const dev of devices) {
    if (!dev || dev.status !== 'AUTHORIZED') continue;
    const boundId = String(dev.boundEmployeeId ?? dev.employeeId ?? '').trim().toUpperCase();
    if (boundId && boundId === targetId) {
      count++;
    }
  }
  return count;
}

export function buildDeviceLimitErrorMessage(limit: number): string {
  return `You have reached your device limit (${limit}). Ask your Super Administrator to remove an old device or raise your limit.`;
}
