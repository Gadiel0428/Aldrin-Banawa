/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Audit Trail, PIN Audit & Backup Audit Persistence Service
 */

import fs from "fs";
import type {
  AuditTrailEntry,
  BackupAuditEntry,
  PinAuditEntry,
  PrintCheckLogEntry,
} from "../../shared/types.ts";
import logger from "../../src/lib/logger.ts";
import {
  MAX_AUDIT_TRAIL_ENTRIES,
  MAX_PRINT_CHECK_LOGS,
  type ServerContext,
} from "./context.ts";

const AUDIT_IGNORED_FIELDS = new Set<string>([
  "updated_at",
  "updated_by",
  "created_at",
  "created_by",
  "version",
  "reset_version",
  "user_id",
  "device_id",
  "record_id",
  "pin",
  "pinHash",
  "pinSalt",
  "pin_hash",
]);

export function logBackupAudit(
  ctx: ServerContext,
  action: "BACKUP_CREATED" | "DATABASE_RESTORED" | "PRUNE",
  filename: string,
  author: string,
  details?: string,
  fileSizeBytes?: number
): void {
  const entry: BackupAuditEntry = {
    id: `BA-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    action,
    filename,
    author,
    timestamp: new Date().toISOString(),
    details,
    fileSizeBytes,
  };
  ctx.backupAuditLogs.unshift(entry);
  if (ctx.backupAuditLogs.length > 100) {
    ctx.backupAuditLogs = ctx.backupAuditLogs.slice(0, 100);
  }
  try {
    fs.writeFileSync(ctx.backupAuditLogFile, JSON.stringify(ctx.backupAuditLogs, null, 2), "utf-8");
  } catch {
    // Ignore audit write failure on read-only environments
  }

  if (action === "BACKUP_CREATED") {
    logger.info(
      `[DATABASE BACKUP] Created backup '${filename}' (${fileSizeBytes || 0} bytes) by ${author}. Reason: ${details || "N/A"}`
    );
  } else if (action === "DATABASE_RESTORED") {
    logger.info(
      `[DATABASE RESTORE] OVERWROTE live database with backup '${filename}' by ${author}. Reason: ${details || "N/A"}`
    );
  }
}

export function logPinAudit(
  ctx: ServerContext,
  action: "PIN_CHANGED" | "PIN_RESET" | "COMPROMISED_PIN_RESOLVED",
  targetEmployeeId: string,
  targetUsername: string,
  changedBy: string,
  changedByEmployeeId: string,
  reason?: string,
  previousPinWasCompromised: boolean = false,
  ip?: string
): void {
  const entry: PinAuditEntry = {
    id: `PIN-LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    action,
    targetEmployeeId,
    targetUsername,
    changedBy,
    changedByEmployeeId,
    timestamp: new Date().toISOString(),
    reason: reason || "Explicit Super Admin PIN Update",
    previousPinWasCompromised,
    ip: ip || "127.0.0.1",
  };
  ctx.pinAuditLogs.unshift(entry);
  if (ctx.pinAuditLogs.length > 500) {
    ctx.pinAuditLogs = ctx.pinAuditLogs.slice(0, 500);
  }
  try {
    fs.writeFileSync(ctx.pinAuditLogFile, JSON.stringify(ctx.pinAuditLogs, null, 2), "utf-8");
  } catch (err) {
    console.error("[PIN-AUDIT-LOG] Failed to persist pin audit log to disk:", err);
  }
  logger.info(
    `[PIN-AUDIT-LOG] ${action} | Target: ${targetEmployeeId} (${targetUsername}) | By: ${changedByEmployeeId} (${changedBy}) | Reason: ${entry.reason} | Time: ${entry.timestamp}`
  );
}

export function persistAuditTrailLogs(ctx: ServerContext): void {
  try {
    fs.writeFileSync(ctx.auditTrailFile, JSON.stringify(ctx.auditTrailLogs, null, 2), "utf-8");
  } catch (err) {
    console.error("[AUDIT-TRAIL] Failed to persist audit trail to disk:", err);
  }
}

export function persistPrintCheckLogs(ctx: ServerContext): void {
  try {
    fs.writeFileSync(ctx.printCheckLogFile, JSON.stringify(ctx.printCheckLogs, null, 2), "utf-8");
  } catch (err) {
    console.error("[PRINT-CHECK] Failed to persist print check logs to disk:", err);
  }
}

export function appendPrintCheckLog(ctx: ServerContext, entry: PrintCheckLogEntry): void {
  ctx.printCheckLogs.unshift(entry);
  if (ctx.printCheckLogs.length > MAX_PRINT_CHECK_LOGS) {
    ctx.printCheckLogs = ctx.printCheckLogs.slice(0, MAX_PRINT_CHECK_LOGS);
  }
  persistPrintCheckLogs(ctx);
}

export function formatAuditValue(val: unknown): string {
  if (val === undefined) return "unset";
  if (val === null) return "null";
  if (typeof val === "object") {
    try {
      const s = JSON.stringify(val);
      return s.length > 40 ? `${s.slice(0, 37)}...` : s;
    } catch {
      return "[object]";
    }
  }
  const str = String(val);
  return str.length > 40 ? `${str.slice(0, 37)}...` : str;
}

export function describeRecordDiff(before: any, after: any): string {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return "";
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const diffs: string[] = [];
  for (const k of keys) {
    if (AUDIT_IGNORED_FIELDS.has(k)) continue;
    const oldVal = before[k];
    const newVal = after[k];
    let same = oldVal === newVal;
    if (
      !same &&
      typeof oldVal === "object" &&
      typeof newVal === "object" &&
      oldVal !== null &&
      newVal !== null
    ) {
      try {
        same = JSON.stringify(oldVal) === JSON.stringify(newVal);
      } catch {
        same = false;
      }
    }
    if (!same) {
      diffs.push(`${k}: ${formatAuditValue(oldVal)} -> ${formatAuditValue(newVal)}`);
    }
    if (diffs.length >= 6) break;
  }
  return diffs.join(", ");
}

export function getAuditRecordLabel(recordType: string, record: any): string {
  if (!record || typeof record !== "object") return "";
  const parts: string[] = [];
  if (record.partCode) parts.push(String(record.partCode));
  if (record.lotNumber) parts.push(`Lot ${record.lotNumber}`);
  if (record.gatePassNumber) parts.push(`GP ${record.gatePassNumber}`);
  if (record.requisitionNumber) parts.push(`Req ${record.requisitionNumber}`);
  if (record.employeeId) parts.push(String(record.employeeId));
  if (record.username) parts.push(String(record.username));
  if (record.code && !record.partCode) parts.push(String(record.code));
  if (record.name && !record.username) parts.push(String(record.name));
  if (record.zone) parts.push(String(record.zone));
  if (record.forkliftId) parts.push(String(record.forkliftId));
  if (record.description && parts.length < 2) {
    const desc = String(record.description).trim();
    if (desc) parts.push(desc.length > 35 ? `${desc.slice(0, 32)}...` : desc);
  }
  return parts.join(" · ") || String(record.id || record.record_id || recordType);
}

export function recordAuditTrail(
  ctx: ServerContext,
  entry: {
    timestamp?: string;
    actor?: string;
    actorId?: string;
    action: string;
    recordType: string;
    recordId: string;
    summary: string;
    details?: string;
    deviceId?: string;
  }
): void {
  const cleanActor = String(entry.actor || entry.actorId || "SYSTEM").trim() || "SYSTEM";
  const cleanActorId = String(entry.actorId || cleanActor).trim() || "SYSTEM";
  const cleanType = String(entry.recordType || "system").trim();
  const cleanId = String(entry.recordId || "N/A").trim();

  const item: AuditTrailEntry = {
    id: `AUD-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    actor: cleanActor,
    actorId: cleanActorId,
    action: String(entry.action || "UPDATE").trim().toUpperCase(),
    recordType: cleanType,
    recordId: cleanId,
    summary: String(entry.summary || `${entry.action} ${cleanType} ${cleanId}`).trim(),
    ...(entry.details ? { details: String(entry.details).trim() } : {}),
    ...(entry.deviceId ? { deviceId: String(entry.deviceId).trim() } : {}),
  };

  ctx.auditTrailLogs.unshift(item);
  if (ctx.auditTrailLogs.length > MAX_AUDIT_TRAIL_ENTRIES) {
    ctx.auditTrailLogs = ctx.auditTrailLogs.slice(0, MAX_AUDIT_TRAIL_ENTRIES);
  }
  persistAuditTrailLogs(ctx);
}

export function ensureInitialAuditTrailSeed(ctx: ServerContext): void {
  if (ctx.auditTrailFileExistsOnBoot && ctx.auditTrailLogs.length > 0) return;

  const seeded: AuditTrailEntry[] = [];
  for (const p of ctx.pinAuditLogs) {
    seeded.push({
      id: p.id || `AUD-PIN-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: p.timestamp || new Date().toISOString(),
      actor: p.changedBy || p.changedByEmployeeId || "Super Administrator",
      actorId: p.changedByEmployeeId || "JPMP-002",
      action: p.action || "PIN_CHANGE",
      recordType: "registeredUsers",
      recordId: p.targetEmployeeId,
      summary: `${p.action} for ${p.targetUsername} (${p.targetEmployeeId})`,
      details: p.reason || "PIN audit entry",
    });
  }

  for (const b of ctx.backupAuditLogs) {
    seeded.push({
      id: b.id || `AUD-BAK-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: b.timestamp || new Date().toISOString(),
      actor: b.author || "SYSTEM",
      actorId: b.author || "SYSTEM",
      action: b.action || "BACKUP_CREATED",
      recordType: "system",
      recordId: b.filename || "database",
      summary: `${b.action}: ${b.filename}`,
      details: b.details,
    });
  }

  const recordCollections = [
    "stocks",
    "receiving",
    "returns",
    "recycling",
    "issuances",
    "deliveries",
    "envLogs",
    "forkliftChecks",
    "registries",
    "registeredUsers",
  ];
  for (const col of recordCollections) {
    const list: any[] = Array.isArray((ctx.state as any)[col]) ? (ctx.state as any)[col] : [];
    for (const rec of list) {
      if (!rec || typeof rec !== "object") continue;
      const ts = rec.updated_at || rec.created_at || rec.registeredAt || rec.date;
      if (!ts) continue;
      const isoTs = /^\d{4}-\d{2}-\d{2}$/.test(String(ts)) ? `${ts}T00:00:00.000Z` : String(ts);
      const actorName = rec.updated_by || rec.created_by || rec.registeredBy || "System";
      const recId = String(rec.id || rec.record_id || rec.employeeId || "N/A");
      const label = getAuditRecordLabel(col, rec);
      seeded.push({
        id: `AUD-INIT-${col}-${recId}`,
        timestamp: isoTs,
        actor: String(actorName),
        actorId: String(rec.user_id || actorName),
        action: Number(rec.version) > 1 ? "UPDATE" : "CREATE",
        recordType: col,
        recordId: recId,
        summary: `${Number(rec.version) > 1 ? "Updated" : "Created"} ${col}${label ? ` [${label}]` : ""}`,
        deviceId: rec.device_id,
      });
    }
  }

  if (Array.isArray(ctx.state.stockMovements)) {
    for (const m of ctx.state.stockMovements.slice(0, 200) as any[]) {
      seeded.push({
        id: `AUD-MOV-${m.id || Math.random().toString(36).substring(2, 7)}`,
        timestamp: m.created_at || m.timestamp || new Date().toISOString(),
        actor: m.user_name || m.userName || "Operator",
        actorId: m.user_id || m.user_name || "OPERATOR",
        action: "STOCK_MOVEMENT",
        recordType: "stockMovements",
        recordId: String(m.id || m.product_id || "N/A"),
        summary: `${m.type || "MOVEMENT"} ${m.product_sku || m.product_id || ""} (${Number(m.quantity) > 0 ? `+${m.quantity}` : m.quantity})`,
        details: m.notes || undefined,
        deviceId: m.device_id,
      });
    }
  }

  seeded.sort((a: AuditTrailEntry, b: AuditTrailEntry) => String(b.timestamp).localeCompare(String(a.timestamp)));
  ctx.auditTrailLogs = seeded.slice(0, MAX_AUDIT_TRAIL_ENTRIES);
  persistAuditTrailLogs(ctx);
}
