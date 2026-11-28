/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SQLite Persistence, Pre-Startup Recovery, Scheduled Snapshots & Backup Restore Service
 */

import fs from "fs";
import path from "path";
import type { AuthorizedDevice, BackupItemRecord, RegisteredAccount } from "../../shared/types.ts";
import { resolveEffectiveMaxDevices } from "../../shared/deviceLimit.ts";
import logger from "../../src/lib/logger.ts";
import { mapRecordFromApi } from "../api/mapper.ts";
import {
  checkpointAndClose,
  commitToSqlite,
  initSqliteStore,
  openSqliteDatabase,
  readDatabaseFromSqlite,
  vacuumInto,
  validateDatabaseFile,
} from "../sqliteStore.ts";
import { logBackupAudit } from "./auditService.ts";
import {
  ensureSuperAdminSeed,
  hashPinScrypt,
  markRecordTombstone,
  markUserTombstone,
  verifyUserPin,
} from "./authService.ts";
import {
  DEFAULT_FIFO_COLORS_BY_MONTH,
  DEFAULT_OPERATIONAL_ROLES,
  DEFAULT_RECEIVING_CATEGORIES,
  STARTER_BARCODE_PRESETS,
  STARTER_CATEGORY_REGISTRIES,
  normalizeBaseRecord,
  type ServerContext,
} from "./context.ts";
import { broadcast, sanitizeUserForClient } from "./realtimeService.ts";
import { backfillAndFlagUnits } from "./stockLedgerService.ts";

export function getDbPayload(ctx: ServerContext): Record<string, any> {
  return {
    installationId: ctx.installationId,
    primaryDeviceId: ctx.primaryDeviceId,
    systemResetVersion: ctx.systemResetVersion,
    systemResetTimestamp: ctx.systemResetTimestamp,
    systemResetId: ctx.systemResetId,
    systemResetBy: ctx.systemResetBy,
    stateRevision: ctx.stateRevision,
    state: ctx.state,
    stocks: ctx.state.stocks || [],
    receiving: ctx.state.receiving || [],
    returns: ctx.state.returns || [],
    recycling: ctx.state.recycling || [],
    issuances: ctx.state.issuances || [],
    deliveries: ctx.state.deliveries || [],
    envLogs: ctx.state.envLogs || [],
    forkliftChecks: ctx.state.forkliftChecks || [],
    registries: ctx.state.registries || [],
    registeredUsers: ctx.state.registeredUsers || [],
    stockMovements: ctx.state.stockMovements || [],
    operationalRoles: ctx.state.operationalRoles || [...DEFAULT_OPERATIONAL_ROLES],
    receivingCategories: ctx.state.receivingCategories || [...DEFAULT_RECEIVING_CATEGORIES],
    fifoColorsByMonth: ctx.state.fifoColorsByMonth || { ...DEFAULT_FIFO_COLORS_BY_MONTH },
    authorizedDevices: Array.from(ctx.authorizedDevicesMap.values()),
    deletedRecordTombstones: Array.from(ctx.deletedRecordTombstones),
    deletedUserTombstones: Array.from(ctx.deletedUserTombstones),
    chatMessages: ctx.chatMessages.slice(-200),
  };
}

export function commitDatabase(ctx: ServerContext): boolean {
  try {
    const payload = getDbPayload(ctx);
    return commitToSqlite(payload);
  } catch (err) {
    console.error("CRITICAL: Failed SQLite database commit to disk:", err);
    return false;
  }
}

export function scrubPlaintextPinsInSqliteBackup(targetPath: string): void {
  try {
    if (!fs.existsSync(targetPath)) return;
    const bDb = openSqliteDatabase(targetPath);
    try {
      const rows = bDb
        .prepare("SELECT id, data FROM registered_users")
        .all() as Array<{ id: string; data: string }>;
      const updateStmt = bDb.prepare("UPDATE registered_users SET data = ? WHERE id = ?");
      for (const row of rows) {
        try {
          const parsedUser = JSON.parse(row.data);
          let changed = false;
          if (parsedUser.pin && !parsedUser.pinHash) {
            const { pinHash, pinSalt } = hashPinScrypt(String(parsedUser.pin));
            parsedUser.pinHash = pinHash;
            parsedUser.pinSalt = pinSalt;
            changed = true;
          }
          if ("pin" in parsedUser || "pin_hash" in parsedUser) {
            delete parsedUser.pin;
            delete parsedUser.pin_hash;
            changed = true;
          }
          if (changed) {
            updateStmt.run(JSON.stringify(parsedUser), row.id);
          }
        } catch {
          // Ignore malformed individual user row
        }
      }
    } finally {
      try {
        bDb.close();
      } catch {
        // Ignore close errors
      }
    }
  } catch (err) {
    console.warn("[BACKUP SECURITY] Failed scrubbing plain-text PINs from SQLite backup:", err);
  }
}

export function scrubPlaintextPinsInJsonBackup(targetPath: string): void {
  try {
    if (!fs.existsSync(targetPath)) return;
    const parsed = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
    const scrubArr = (arr: any[]) =>
      arr.map((u: any) => {
        if (!u || typeof u !== "object") return u;
        const copy = { ...u };
        if (copy.pin && !copy.pinHash) {
          const { pinHash, pinSalt } = hashPinScrypt(String(copy.pin));
          copy.pinHash = pinHash;
          copy.pinSalt = pinSalt;
        }
        delete copy.pin;
        delete copy.pin_hash;
        return copy;
      });
    if (Array.isArray(parsed?.registeredUsers)) {
      parsed.registeredUsers = scrubArr(parsed.registeredUsers);
    }
    if (Array.isArray(parsed?.state?.registeredUsers)) {
      parsed.state.registeredUsers = scrubArr(parsed.state.registeredUsers);
    }
    fs.writeFileSync(targetPath, JSON.stringify(parsed, null, 2), "utf-8");
  } catch (err) {
    console.warn("[BACKUP SECURITY] Failed scrubbing plain-text PINs from JSON backup:", err);
  }
}

export function formatBackupTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

export function getNextBackupFilename(ctx: ServerContext, date: Date = new Date()): string {
  const backupsDir = ctx.config.backupsDir;
  const base = `central-database-${formatBackupTimestamp(date)}`;
  let filename = `${base}.sqlite`;
  let counter = 1;
  while (fs.existsSync(path.join(backupsDir, filename))) {
    filename = `${base}-${counter}.sqlite`;
    counter++;
  }
  return filename;
}

export function getAllBackupRecords(ctx: ServerContext): BackupItemRecord[] {
  const backupsDir = ctx.config.backupsDir;
  try {
    if (!fs.existsSync(backupsDir)) return [];
    const entries = fs.readdirSync(backupsDir, { withFileTypes: true });
    const backups: BackupItemRecord[] = entries
      .filter(
        (e: fs.Dirent) =>
          e.isFile() &&
          e.name.startsWith("central-database-") &&
          (e.name.endsWith(".sqlite") || e.name.endsWith(".json"))
      )
      .map((e: fs.Dirent) => {
        const filePath = path.join(backupsDir, e.name);
        let mtime = 0;
        let birthtime = 0;
        let size = 0;
        try {
          const stat = fs.statSync(filePath);
          mtime = stat.mtimeMs;
          birthtime = stat.birthtimeMs || stat.mtimeMs;
          size = stat.size;
        } catch {
          // Ignore stat failures
        }
        return {
          filename: e.name,
          filePath,
          sizeBytes: size,
          sizeFormatted:
            size > 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(2)} MB` : `${(size / 1024).toFixed(1)} KB`,
          createdAt: new Date(birthtime || mtime).toISOString(),
          mtime,
        };
      });

    backups.sort((a: BackupItemRecord, b: BackupItemRecord) => b.mtime - a.mtime || b.filename.localeCompare(a.filename));
    return backups;
  } catch (err: any) {
    console.error("[DATABASE BACKUP] Error reading backups list:", err);
    return [];
  }
}

export async function createDatabaseBackup(
  ctx: ServerContext,
  reason: string = "SCHEDULED",
  author: string = "SYSTEM"
): Promise<{ success: boolean; filename?: string; error?: string }> {
  if (ctx.isBackupInProgress) {
    logger.info(`[DATABASE BACKUP] Backup already in progress, skipping concurrent trigger (${reason})`);
    return { success: false, error: "A backup is already in progress" };
  }
  ctx.isBackupInProgress = true;
  const backupsDir = ctx.config.backupsDir;
  const dataFileSqlite = ctx.config.dataFileSqlite;
  try {
    if (!fs.existsSync(backupsDir)) {
      await fs.promises.mkdir(backupsDir, { recursive: true });
    }

    commitDatabase(ctx);

    if (!fs.existsSync(dataFileSqlite)) {
      console.warn("[DATABASE BACKUP] Cannot create backup: SQLite database file does not exist on disk.");
      return { success: false, error: "Database file does not exist on disk" };
    }

    const filename = getNextBackupFilename(ctx);
    const targetPath = path.join(backupsDir, filename);

    vacuumInto(targetPath);
    scrubPlaintextPinsInSqliteBackup(targetPath);
    const stat = await fs.promises.stat(targetPath);

    logBackupAudit(ctx, "BACKUP_CREATED", filename, author, reason, stat.size);
    return { success: true, filename };
  } catch (err: any) {
    console.error("[DATABASE BACKUP] Failed to create database backup:", err);
    return { success: false, error: err?.message || String(err) };
  } finally {
    ctx.isBackupInProgress = false;
  }
}

export function applyDatabaseObject(ctx: ServerContext, parsed: any): boolean {
  try {
    if (!parsed || typeof parsed !== "object") return false;

    if (parsed.installationId) ctx.installationId = String(parsed.installationId);
    if (parsed.primaryDeviceId) ctx.primaryDeviceId = String(parsed.primaryDeviceId);
    if (parsed.systemResetVersion) ctx.systemResetVersion = Number(parsed.systemResetVersion) || 1;
    if (parsed.systemResetTimestamp) ctx.systemResetTimestamp = String(parsed.systemResetTimestamp);
    if (parsed.systemResetId) ctx.systemResetId = String(parsed.systemResetId);
    if (parsed.systemResetBy) ctx.systemResetBy = String(parsed.systemResetBy);
    if (parsed.stateRevision) ctx.stateRevision = Number(parsed.stateRevision) || 1;

    if (Array.isArray(parsed.authorizedDevices)) {
      ctx.authorizedDevicesMap.clear();
      parsed.authorizedDevices.forEach((dev: AuthorizedDevice) => {
        if (dev && dev.deviceId) {
          const normalizedBound = dev.boundEmployeeId || dev.employeeId;
          ctx.authorizedDevicesMap.set(dev.deviceId, {
            ...dev,
            ...(normalizedBound ? { boundEmployeeId: String(normalizedBound).trim().toUpperCase() } : {}),
          });
        }
      });
    }

    if (parsed.state && typeof parsed.state === "object") {
      Object.keys(parsed.state).forEach((key: string) => {
        if (key in ctx.state && Array.isArray(parsed.state[key])) {
          if (key === "operationalRoles") {
            ctx.state.operationalRoles = Array.from(
              new Set<string>(
                parsed.state[key].map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean)
              )
            );
          } else if (key === "receivingCategories") {
            ctx.state.receivingCategories = Array.from(
              new Set<string>(
                parsed.state[key].map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean)
              )
            );
          } else if (key === "fifoColorsByMonth") {
            if (parsed.state[key] && typeof parsed.state[key] === "object") {
              ctx.state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...parsed.state[key] };
            }
          } else {
            (ctx.state as any)[key] = parsed.state[key].map((rec: any) =>
              normalizeBaseRecord(mapRecordFromApi(key, rec), ctx.systemResetVersion)
            );
          }
        } else if (
          key === "fifoColorsByMonth" &&
          parsed.state &&
          parsed.state[key] &&
          typeof parsed.state[key] === "object"
        ) {
          ctx.state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...parsed.state[key] };
        }
      });
    }
    for (const key of Object.keys(ctx.state)) {
      if (key === "operationalRoles") {
        if (Array.isArray(parsed.operationalRoles) && parsed.operationalRoles.length > 0) {
          ctx.state.operationalRoles = Array.from(
            new Set<string>(
              parsed.operationalRoles.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean)
            )
          );
        }
      } else if (key === "receivingCategories") {
        if (Array.isArray(parsed.receivingCategories) && parsed.receivingCategories.length > 0) {
          ctx.state.receivingCategories = Array.from(
            new Set<string>(
              parsed.receivingCategories.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean)
            )
          );
        }
      } else if (key === "fifoColorsByMonth") {
        if (parsed.fifoColorsByMonth && typeof parsed.fifoColorsByMonth === "object") {
          ctx.state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...parsed.fifoColorsByMonth };
        }
      } else if (Array.isArray(parsed[key]) && !(parsed.state && key in parsed.state)) {
        (ctx.state as any)[key] = parsed[key].map((rec: any) =>
          normalizeBaseRecord(mapRecordFromApi(key, rec), ctx.systemResetVersion)
        );
      }
    }
    if (!Array.isArray(ctx.state.operationalRoles) || ctx.state.operationalRoles.length === 0) {
      ctx.state.operationalRoles = [...DEFAULT_OPERATIONAL_ROLES];
    }
    if (!Array.isArray(ctx.state.receivingCategories) || ctx.state.receivingCategories.length === 0) {
      ctx.state.receivingCategories = [...DEFAULT_RECEIVING_CATEGORIES];
    }
    if (
      !ctx.state.fifoColorsByMonth ||
      typeof ctx.state.fifoColorsByMonth !== "object" ||
      Object.keys(ctx.state.fifoColorsByMonth).length === 0
    ) {
      ctx.state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH };
    }
    if (!Array.isArray(ctx.state.registries) || ctx.state.registries.length === 0) {
      ctx.state.registries = [...STARTER_CATEGORY_REGISTRIES, ...STARTER_BARCODE_PRESETS];
    } else {
      for (const preset of STARTER_BARCODE_PRESETS) {
        if (
          !ctx.state.registries.some(
            (r: any) => (r.code || "").toUpperCase() === preset.code.toUpperCase()
          )
        ) {
          ctx.state.registries.push(preset);
        }
      }
      const hasAnyCategoryRegistry = ctx.state.registries.some((r: any) => r.type === "CATEGORY");
      if (!hasAnyCategoryRegistry) {
        const legacyCats = Array.isArray(ctx.state.receivingCategories) && ctx.state.receivingCategories.length > 0
          ? ctx.state.receivingCategories
          : DEFAULT_RECEIVING_CATEGORIES;
        for (const catName of legacyCats) {
          const clean = String(catName || "").trim().toUpperCase();
          if (!clean) continue;
          const matchingStarter = STARTER_CATEGORY_REGISTRIES.find((c) => c.name === clean);
          ctx.state.registries.push(
            matchingStarter || {
              id: `REG-CAT-${clean.replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
              type: "CATEGORY",
              code: clean,
              name: clean,
              description: "Master Data Material Category",
              status: "ACTIVE",
              dateRegistered: "2026-10-02",
            }
          );
        }
      }
    }

    if (Array.isArray(parsed.deletedRecordTombstones)) {
      parsed.deletedRecordTombstones.forEach((id: string) => markRecordTombstone(ctx, id));
    }
    if (Array.isArray(parsed.deletedUserTombstones)) {
      parsed.deletedUserTombstones.forEach((empId: string) => markUserTombstone(ctx, empId));
    }
    if (Array.isArray(parsed.chatMessages)) {
      ctx.chatMessages.length = 0;
      ctx.chatMessages.push(...parsed.chatMessages.slice(-200));
    }

    ensureSuperAdminSeed(ctx, false);
    backfillAndFlagUnits(ctx);

    let compromisedAccountsCount = 0;
    ctx.state.registeredUsers.forEach((u: RegisteredAccount) => {
      u.maxDevices = resolveEffectiveMaxDevices(u);
      const cleanPin = String(u.pin || "").trim();
      if (cleanPin === "1234" || verifyUserPin(u, "1234").matched) {
        u.isPinCompromised = true;
        compromisedAccountsCount++;
        console.warn(
          `[SECURITY ALERT] Operator ${u.employeeId} (${u.username}) has compromised PIN '1234'. Marked as COMPROMISED.`
        );
      }
    });
    if (compromisedAccountsCount > 0) {
      console.warn(
        `[SECURITY AUDIT] ${compromisedAccountsCount} operator account(s) have compromised default PIN '1234'. Super Admin PIN reset required.`
      );
    }

    return true;
  } catch {
    return false;
  }
}

export function loadDatabaseFromDisk(ctx: ServerContext): void {
  const timestampStr = formatBackupTimestamp(new Date());
  const dataFileSqlite = ctx.config.dataFileSqlite;
  const dataFileJson = ctx.config.dataFileJson;
  const backupsDir = ctx.config.backupsDir;

  if (fs.existsSync(dataFileSqlite)) {
    const validation = validateDatabaseFile(dataFileSqlite);
    if (validation.valid && validation.data) {
      initSqliteStore(dataFileSqlite);
      applyDatabaseObject(ctx, validation.data);
      if (ctx.oneTimeSetupPin) {
        commitDatabase(ctx);
      }
      logger.info("Live database loaded normally");
      return;
    }

    console.warn(
      `WARNING: Live SQLite database '${dataFileSqlite}' is corrupt or unreadable (${validation.error || "validation failed"}). Moving aside as corrupt...`
    );
    try {
      const corruptTarget = `${dataFileSqlite}.corrupt-${timestampStr}`;
      fs.renameSync(dataFileSqlite, corruptTarget);
      logger.info(`[CORRUPT DB] Moved corrupt database aside to: ${corruptTarget}`);
      if (fs.existsSync(`${dataFileSqlite}-wal`)) {
        try {
          fs.renameSync(`${dataFileSqlite}-wal`, `${dataFileSqlite}-wal.corrupt-${timestampStr}`);
        } catch {
          // Ignore WAL move failure
        }
      }
      if (fs.existsSync(`${dataFileSqlite}-shm`)) {
        try {
          fs.renameSync(`${dataFileSqlite}-shm`, `${dataFileSqlite}-shm.corrupt-${timestampStr}`);
        } catch {
          // Ignore SHM move failure
        }
      }
    } catch (moveErr) {
      console.error("Failed to move corrupt SQLite file aside:", moveErr);
    }
  }

  if (fs.existsSync(dataFileJson)) {
    try {
      const rawJson = fs.readFileSync(dataFileJson, "utf-8");
      if (rawJson && rawJson.trim().length > 0) {
        const parsed = JSON.parse(rawJson);
        if (applyDatabaseObject(ctx, parsed)) {
          initSqliteStore(dataFileSqlite);
          commitDatabase(ctx);

          const loadedFromSqlite = readDatabaseFromSqlite();
          const stocksMatch =
            (loadedFromSqlite.state?.stocks?.length || 0) === (ctx.state.stocks?.length || 0);
          const receivingMatch =
            (loadedFromSqlite.state?.receiving?.length || 0) === (ctx.state.receiving?.length || 0);
          const usersMatch =
            (loadedFromSqlite.state?.registeredUsers?.length || 0) ===
            (ctx.state.registeredUsers?.length || 0);

          if (stocksMatch && receivingMatch && usersMatch) {
            const migratedTarget = `${dataFileJson}.migrated-${timestampStr}`;
            fs.renameSync(dataFileJson, migratedTarget);
            logger.info(
              `[MIGRATION SUCCESS] Legacy JSON database successfully migrated to SQLite (${dataFileSqlite}). Original renamed to: ${migratedTarget}`
            );
            return;
          } else {
            console.error(
              "[MIGRATION WARNING] SQLite verification did not match in-memory state after importing legacy JSON!"
            );
          }
        }
      }
    } catch (jsonErr) {
      console.error("[MIGRATION ERROR] Failed to import legacy central-database.json:", jsonErr);
    }
  }

  let autoRestoredBackupFilename: string | null = null;
  try {
    if (fs.existsSync(backupsDir)) {
      const entries = fs.readdirSync(backupsDir, { withFileTypes: true });
      const backupCandidates = entries
        .filter(
          (e: fs.Dirent) =>
            e.isFile() &&
            e.name.startsWith("central-database-") &&
            (e.name.endsWith(".sqlite") || e.name.endsWith(".json"))
        )
        .map((e: fs.Dirent) => {
          const filePath = path.join(backupsDir, e.name);
          let mtime = 0;
          try {
            mtime = fs.statSync(filePath).mtimeMs;
          } catch {
            // Ignore stat error
          }
          return {
            filename: e.name,
            filePath,
            mtime,
            isSqlite: e.name.endsWith(".sqlite"),
          };
        });

      backupCandidates.sort(
        (a: { mtime: number; filename: string }, b: { mtime: number; filename: string }) =>
          b.mtime - a.mtime || b.filename.localeCompare(a.filename)
      );

      for (const candidate of backupCandidates) {
        try {
          if (candidate.isSqlite) {
            const validation = validateDatabaseFile(candidate.filePath);
            if (validation.valid && validation.data) {
              if (fs.existsSync(dataFileSqlite)) {
                try {
                  checkpointAndClose();
                } catch {
                  // Ignore checkpoint error
                }
                try {
                  fs.unlinkSync(dataFileSqlite);
                } catch {
                  // Ignore unlink error
                }
              }
              fs.copyFileSync(candidate.filePath, dataFileSqlite);
              initSqliteStore(dataFileSqlite);
              applyDatabaseObject(ctx, validation.data);

              autoRestoredBackupFilename = candidate.filename;
              logger.info(
                `Live database missing/corrupted — auto-restored from backup '${candidate.filename}'`
              );
              logBackupAudit(
                ctx,
                "DATABASE_RESTORED",
                candidate.filename,
                "SYSTEM_AUTO_RECOVERY",
                "Live database missing or corrupted on startup — automatically recovered from latest SQLite backup",
                fs.statSync(candidate.filePath).size
              );
              return;
            }
          } else {
            const rawBackup = fs.readFileSync(candidate.filePath, "utf-8");
            if (rawBackup && rawBackup.trim().length > 0) {
              const parsed = JSON.parse(rawBackup);
              if (applyDatabaseObject(ctx, parsed)) {
                initSqliteStore(dataFileSqlite);
                commitDatabase(ctx);

                autoRestoredBackupFilename = candidate.filename;
                logger.info(
                  `Live database missing/corrupted — auto-restored from backup '${candidate.filename}'`
                );
                logBackupAudit(
                  ctx,
                  "DATABASE_RESTORED",
                  candidate.filename,
                  "SYSTEM_AUTO_RECOVERY",
                  "Live database missing or corrupted on startup — automatically recovered from latest JSON backup",
                  fs.statSync(candidate.filePath).size
                );
                return;
              }
            }
          }
        } catch {
          // Move to next candidate
        }
      }
    }
  } catch (scanErr) {
    console.error("[AUTO RECOVERY] Error scanning backups directory:", scanErr);
  }

  if (!autoRestoredBackupFilename) {
    console.warn(
      "WARNING: Live database is missing/corrupted and no backup files are available in backups folder. Starting with an empty database. No recovery was possible."
    );
    initSqliteStore(dataFileSqlite);
    ensureSuperAdminSeed(ctx, true);
    commitDatabase(ctx);
  }
}

export function createPreStartupBackup(ctx: ServerContext): { success: boolean; filename?: string } {
  const backupsDir = ctx.config.backupsDir;
  const dataFileSqlite = ctx.config.dataFileSqlite;
  const dataFileJson = ctx.config.dataFileJson;
  try {
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const timestampStr = formatBackupTimestamp(new Date());

    if (fs.existsSync(dataFileSqlite)) {
      const validation = validateDatabaseFile(dataFileSqlite);
      if (validation.valid) {
        const base = `central-database-PRE-STARTUP-${timestampStr}`;
        let filename = `${base}.sqlite`;
        let counter = 1;
        while (fs.existsSync(path.join(backupsDir, filename))) {
          filename = `${base}-${counter}.sqlite`;
          counter++;
        }
        const targetPath = path.join(backupsDir, filename);

        try {
          const tempDb = openSqliteDatabase(dataFileSqlite, { readonly: true });
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          tempDb.prepare("VACUUM INTO ?;").run(targetPath);
          tempDb.close();
        } catch {
          fs.copyFileSync(dataFileSqlite, targetPath);
        }
        scrubPlaintextPinsInSqliteBackup(targetPath);

        const backupStat = fs.statSync(targetPath);
        logBackupAudit(
          ctx,
          "BACKUP_CREATED",
          filename,
          "SYSTEM_PRE_STARTUP",
          "Mandatory pre-startup safety copy taken before server code loads or touches data",
          backupStat.size
        );
        logger.info(
          `[DATABASE PRE-STARTUP BACKUP] Safety backup created: '${filename}' (${backupStat.size} bytes). Taken before server code touches data.`
        );
        return { success: true, filename };
      } else {
        const unreadablePath = `${dataFileSqlite}.unreadable`;
        try {
          fs.copyFileSync(dataFileSqlite, unreadablePath);
          console.warn(
            `[DATABASE PRE-STARTUP BACKUP] Live SQLite DB is unreadable. Raw copy kept at: '${unreadablePath}'`
          );
        } catch (copyErr) {
          console.error("Failed to copy unreadable SQLite DB:", copyErr);
        }
        return { success: false };
      }
    }

    if (fs.existsSync(dataFileJson)) {
      const stat = fs.statSync(dataFileJson);
      if (stat.size > 0) {
        const base = `central-database-PRE-STARTUP-${timestampStr}`;
        let filename = `${base}.json`;
        let counter = 1;
        while (fs.existsSync(path.join(backupsDir, filename))) {
          filename = `${base}-${counter}.json`;
          counter++;
        }
        const targetPath = path.join(backupsDir, filename);
        fs.copyFileSync(dataFileJson, targetPath);
        scrubPlaintextPinsInJsonBackup(targetPath);
        const backupStat = fs.statSync(targetPath);
        logBackupAudit(
          ctx,
          "BACKUP_CREATED",
          filename,
          "SYSTEM_PRE_STARTUP",
          "Mandatory pre-startup safety copy of legacy JSON taken before server code loads or touches data",
          backupStat.size
        );
        logger.info(
          `[DATABASE PRE-STARTUP BACKUP] Safety legacy JSON backup created: '${filename}' (${backupStat.size} bytes).`
        );
        return { success: true, filename };
      }
    }

    logger.info(
      "[DATABASE PRE-STARTUP BACKUP] No existing live database file found on disk (fresh install) — skipping pre-startup backup."
    );
    return { success: false };
  } catch (err: any) {
    console.error("[DATABASE PRE-STARTUP BACKUP] Failed to create pre-startup safety backup:", err);
    return { success: false };
  }
}

export function restoreDatabaseFromBackup(
  ctx: ServerContext,
  filename: string,
  author: string
): { success: boolean; error?: string; recordCounts?: any } {
  const backupsDir = ctx.config.backupsDir;
  const dataFileSqlite = ctx.config.dataFileSqlite;
  try {
    const cleanName = path.basename(filename);
    const resolvedBackupsDir = path.resolve(backupsDir);
    const backupPath = path.resolve(resolvedBackupsDir, cleanName);
    if (!backupPath.startsWith(resolvedBackupsDir + path.sep)) {
      return { success: false, error: "Invalid backup path." };
    }

    if (!fs.existsSync(backupPath)) {
      return {
        success: false,
        error: `Backup file '${cleanName}' not found in backups directory.`,
      };
    }

    let parsedData: any = null;
    if (cleanName.endsWith(".sqlite")) {
      const validation = validateDatabaseFile(backupPath);
      if (!validation.valid || !validation.data) {
        return {
          success: false,
          error: `Invalid or corrupt SQLite backup: ${validation.error || "validation failed"}`,
        };
      }
      parsedData = validation.data;
    } else if (cleanName.endsWith(".json")) {
      const raw = fs.readFileSync(backupPath, "utf-8");
      parsedData = JSON.parse(raw);
      if (!parsedData || typeof parsedData !== "object") {
        return { success: false, error: "Invalid backup JSON structure" };
      }
    } else {
      return {
        success: false,
        error: "Unsupported backup file format. Expected .sqlite or .json",
      };
    }

    try {
      if (fs.existsSync(dataFileSqlite)) {
        commitDatabase(ctx);
        const safetyName = getNextBackupFilename(ctx);
        const safetyPath = path.join(backupsDir, safetyName);
        vacuumInto(safetyPath);
        scrubPlaintextPinsInSqliteBackup(safetyPath);
        logger.info(`[DATABASE RESTORE] Pre-restore safety snapshot created: ${safetyName}`);
        logBackupAudit(
          ctx,
          "BACKUP_CREATED",
          safetyName,
          "SYSTEM_SAFETY",
          "Pre-restore safety snapshot before overwriting database",
          fs.statSync(safetyPath).size
        );
      }
    } catch (e) {
      console.warn("[DATABASE RESTORE] Could not create safety snapshot before restore:", e);
    }

    if (!applyDatabaseObject(ctx, parsedData)) {
      return { success: false, error: "Failed to apply backup data structure to memory." };
    }
    ctx.stateRevision += 1;

    commitDatabase(ctx);

    const stat = fs.statSync(backupPath);
    logBackupAudit(
      ctx,
      "DATABASE_RESTORED",
      cleanName,
      author,
      `Overwrote live database with backup ${cleanName}`,
      stat.size
    );

    broadcast(ctx, {
      type: "GLOBAL_RESET",
      systemResetVersion: ctx.systemResetVersion,
      systemResetTimestamp: new Date().toISOString(),
      systemResetId: `RESTORE-${Date.now()}`,
      systemResetBy: author,
      author,
      keepUsers: true,
      data: {
        ...ctx.state,
        registeredUsers: (ctx.state.registeredUsers || []).map(sanitizeUserForClient),
        chatMessages: ctx.chatMessages.slice(-200),
      },
    });

    return {
      success: true,
      recordCounts: {
        stocks: ctx.state.stocks?.length || 0,
        receiving: ctx.state.receiving?.length || 0,
        issuances: ctx.state.issuances?.length || 0,
        deliveries: ctx.state.deliveries?.length || 0,
        users: ctx.state.registeredUsers?.length || 0,
      },
    };
  } catch (err: any) {
    console.error("[DATABASE RESTORE] Failed to restore database backup:", err);
    return { success: false, error: err?.message || String(err) };
  }
}
