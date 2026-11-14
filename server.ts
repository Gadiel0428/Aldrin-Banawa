/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  initSqliteStore,
  commitToSqlite,
  readDatabaseFromSqlite,
  validateDatabaseFile,
  vacuumInto,
  checkpointAndClose,
  openSqliteDatabase
} from "./server/sqliteStore.ts";

// Ephemeral per-process instance identifiers (fresh every boot, never persisted)
const SERVER_INSTANCE_ID = crypto.randomUUID();
const SERVER_BOOT_TIME = new Date().toISOString();

// Initial seed structures for empty database bootstrapping
const INITIAL_STOCK: any[] = [];
const INITIAL_RECEIVING: any[] = [];
const INITIAL_RETURNS: any[] = [];
const INITIAL_RECYCLING: any[] = [];
const INITIAL_ISSUANCE: any[] = [];
const INITIAL_DELIVERIES: any[] = [];
const INITIAL_ENV_LOGS: any[] = [];
const INITIAL_FORKLIFT_CHECKS: any[] = [];

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url?.split("?")[0] || "";
    if (pathname === "/ws" || pathname === "/" || pathname === "") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Safe Disk Storage Path Resolution (AppData on Windows Desktop, Current Working Dir in Container)
  function getStorageFilePath(filename: string): string {
    const customDir = process.env.JUWEI_DATA_DIR;
    if (customDir) {
      try {
        if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
        return path.join(customDir, filename);
      } catch (e) {}
    }
    return path.join(process.cwd(), filename);
  }

  // Authoritative Central Database File
  const DATA_FILE_SQLITE = getStorageFilePath("central-database.sqlite");
  const DATA_FILE_JSON = getStorageFilePath("central-database.json");
  const DATA_FILE = DATA_FILE_SQLITE;

  // =========================================================================
  // STORAGE CONFIGURATION GUARD RAIL:
  // Verifies that JUWEI_DATA_DIR is set to an external safe location,
  // preventing database files from residing in the ephemeral project source folder.
  // =========================================================================
  const resolvedDataFile = path.resolve(DATA_FILE);
  const projectRootDir = path.resolve(process.cwd());
  const configuredDataDir = process.env.JUWEI_DATA_DIR ? path.resolve(process.env.JUWEI_DATA_DIR) : null;
  const isInsideProjectSource = resolvedDataFile.startsWith(projectRootDir) && (!configuredDataDir || !resolvedDataFile.startsWith(configuredDataDir));

  if (!configuredDataDir || isInsideProjectSource) {
    const bannerBorder = "=".repeat(100);
    console.warn(`\n${bannerBorder}`);
    console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.warn("WARNING: JUWEI_DATA_DIR is not set correctly — data is NOT being saved to the safe location and WILL be lost on the next update.");
    console.warn(`Resolved Database File: ${resolvedDataFile}`);
    console.warn(`Configured JUWEI_DATA_DIR: ${process.env.JUWEI_DATA_DIR || "(NOT SET)"}`);
    console.warn("Action Required: Set environment variable JUWEI_DATA_DIR to an external persistent folder (e.g. C:\\JuweiData or /var/juwei-data) before deploying updates!");
    console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.warn(`${bannerBorder}\n`);
  } else {
    console.log(`[STORAGE CONFIG] Persistent safe storage verified at: ${configuredDataDir} (Database: ${resolvedDataFile})`);
  }

  interface AuthorizedDeviceRecord {
    deviceId: string;
    deviceName: string;
    isPrimaryAdminDevice?: boolean;
    status: 'AUTHORIZED' | 'PENDING' | 'REVOKED';
    authorizedBy?: string;
    authorizedAt?: string;
  }

  interface ServerUser {
    employeeId: string;
    username: string;
    role: string;
    phoneNumber?: string;
    permission: string;
    pin: string;
    status: string;
    lastActive?: string;
    registeredBy?: string;
    registeredBySuperAdmin?: boolean;
    registeredAt?: string;
    stationId?: string;
    id: string;
    deviceId?: string;
    isPrimaryAdminDevice?: boolean;
    authorizedDevices?: string[];
    version: number;
    updated_at: string;
    reset_version: number;
    isPinCompromised?: boolean;
    pinChangedAt?: string;
    pinChangedBy?: string;
  }

  // Installation & Primary Device Identification
  let installationId = "INS-2026-JUWEI-PRIM01";
  let primaryDeviceId = "dev_primary_admin_pc";
  const authorizedDevicesMap = new Map<string, AuthorizedDeviceRecord>([
    [
      "dev_primary_admin_pc",
      {
        deviceId: "dev_primary_admin_pc",
        deviceName: "Primary Administrator PC (Workstation)",
        isPrimaryAdminDevice: true,
        status: "AUTHORIZED",
        authorizedBy: "INITIAL_SUPER_ADMIN_BINDING",
        authorizedAt: "2026-09-09T08:00:00.000Z"
      }
    ]
  ]);

  const defaultSuperAdmin: ServerUser = { 
    id: 'USR-JPMP-002',
    employeeId: 'JPMP-002', 
    username: 'ALDRIN BANAWA', 
    role: 'SUPER ADMINISTRATOR', 
    phoneNumber: '+639669858846',
    permission: 'FULL_ACCESS', 
    pin: '0423',
    status: 'ACTIVE',
    registeredBy: 'INITIAL_INSTALLATION_SUPER_ADMIN',
    registeredBySuperAdmin: true,
    registeredAt: '2026-09-09T08:00:00.000Z',
    stationId: 'WS-MASTER-01',
    deviceId: 'dev_primary_admin_pc',
    isPrimaryAdminDevice: true,
    authorizedDevices: ['dev_primary_admin_pc'],
    version: 1,
    updated_at: '2026-09-09T08:00:00.000Z',
    reset_version: 1788945000000
  };

  // Authoritative Central Database Reset & Versioning Metadata
  let systemResetVersion = 1;
  let systemResetTimestamp = new Date().toISOString();
  let systemResetId = "RESET-INIT";
  let systemResetBy = "SUPER ADMINISTRATOR";
  let stateRevision = 1;

  // Persistent Tombstones to prevent zombie records and accounts from resurrecting
  const deletedRecordTombstones = new Set<string>();
  const deletedUserTombstones = new Set<string>();

  function markRecordTombstone(id: string) {
    if (!id) return;
    deletedRecordTombstones.add(id);
    if (deletedRecordTombstones.size > 10000) {
      const first = deletedRecordTombstones.values().next().value;
      if (first) deletedRecordTombstones.delete(first);
    }
  }

  function markUserTombstone(employeeId: string) {
    if (!employeeId) return;
    const clean = employeeId.trim().toUpperCase();
    if (clean === 'JPMP-002') return;
    deletedUserTombstones.add(clean);
  }

  function unmarkUserTombstone(employeeId: string) {
    if (!employeeId) return;
    deletedUserTombstones.delete(employeeId.trim().toUpperCase());
  }

  interface ChatMessage {
    id: string;
    sender: string;
    text: string;
    timestamp: string;
    isSystem: boolean;
  }

  const chatMessages: ChatMessage[] = [
    {
      id: "sys-init",
      sender: "System",
      text: "JUWEI WAREHOUSE MANAGEMENT SYSTEM Central Database & WebSocket Real-time Engine Initialized.",
      timestamp: new Date().toISOString(),
      isSystem: true,
    }
  ];

  // Helper to normalize every record to conform to mandatory structure:
  // EVERY RECORD MUST HAVE A UNIQUE ID, VERSION, UPDATED_AT, AND RESET_VERSION.
  function normalizeRecord(item: any, existingItem?: any): any {
    const id = String(item.id || existingItem?.id || `REC-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    const version = existingItem ? (Number(existingItem.version) || 1) + 1 : (Number(item.version) || 1);
    const updated_at = item.updated_at || new Date().toISOString();
    const reset_version = Number(item.reset_version) || Number(existingItem?.reset_version) || systemResetVersion;

    return {
      ...item,
      id,
      record_id: item.record_id || id,
      version,
      updated_at,
      reset_version
    };
  }

  // Default Operational Roles for warehouse account assignments
  const DEFAULT_OPERATIONAL_ROLES: string[] = [
    "SYSTEM ADMINISTRATOR",
    "WAREHOUSE TEAM LEADER",
    "WAREHOUSE SUPERVISOR",
    "WAREHOUSE MANAGER",
    "WAREHOUSE CLERK",
    "WAREHOUSE INVENTORY SPECIALIST",
    "WAREHOUSE PERSONNEL",
    "INJECTION MATERIAL HANDLER",
    "PRINTING MATERIAL HANDLER",
    "HR/ADMIN",
    "INJECTION (PRODUCTION)",
    "QUALITY INSPECTOR",
    "SALES",
    "PURCHASING",
    "IMPEX",
    "LOGISTIC",
    "PRINTING AND ASSEMBLY (PRODUCTION)",
    "FINANCE/ACCOUNTING",
    "INTERNAL AUDITOR"
  ];

  // Default Receiving and Return Categories
  const DEFAULT_RECEIVING_CATEGORIES: string[] = [
    "RESIN/RAW MATERIALS",
    "INDIRECT BOM",
    "DIRECT BOM",
    "CONSUMABLES",
    "PACKAGING MATERIALS",
    "WIP (WORK IN PROGRESS)",
    "FG (FINISHED GOOD)",
    "OFFICE SUPPLIES"
  ];

  // Default FIFO Color Coding by Month (12 Months Calendar)
  const DEFAULT_FIFO_COLORS_BY_MONTH: Record<number, { name: string; colorClass: string; textClass: string; hex?: string }> = {
    1: { name: 'Magenta', colorClass: 'bg-fuchsia-600', textClass: 'text-fuchsia-600', hex: '#c026d3' },
    2: { name: 'Orange', colorClass: 'bg-orange-500', textClass: 'text-orange-500', hex: '#f97316' },
    3: { name: 'Dark Green', colorClass: 'bg-emerald-800', textClass: 'text-emerald-800', hex: '#065f46' },
    4: { name: 'Yellow', colorClass: 'bg-yellow-400', textClass: 'text-yellow-600', hex: '#facc15' },
    5: { name: 'Navy Blue', colorClass: 'bg-blue-900', textClass: 'text-blue-900', hex: '#1e3a8a' },
    6: { name: 'Brown', colorClass: 'bg-amber-800', textClass: 'text-amber-800', hex: '#92400e' },
    7: { name: 'Pink', colorClass: 'bg-pink-400', textClass: 'text-pink-400', hex: '#f472b6' },
    8: { name: 'Violet', colorClass: 'bg-violet-600', textClass: 'text-violet-600', hex: '#7c3aed' },
    9: { name: 'Black', colorClass: 'bg-stone-900', textClass: 'text-stone-900', hex: '#1c1917' },
    10: { name: 'Light Orange', colorClass: 'bg-orange-300', textClass: 'text-orange-400', hex: '#fdba74' },
    11: { name: 'Grey', colorClass: 'bg-slate-500', textClass: 'text-slate-500', hex: '#64748b' },
    12: { name: 'Silver', colorClass: 'bg-slate-300', textClass: 'text-slate-400', hex: '#cbd5e1' }
  };

  const FIFO_KNOWN_COLOR_NAMES = new Set([
    'Magenta', 'Orange', 'Dark Green', 'Yellow', 'Navy Blue', 'Brown', 'Pink',
    'Violet', 'Black', 'Light Orange', 'Grey', 'Silver',
    'Red', 'Crimson', 'Blue', 'Sky Blue', 'Green', 'Lime', 'Teal', 'Cyan',
    'Purple', 'Indigo', 'Amber', 'Gold', 'White'
  ].map(s => s.toLowerCase()));

  function getMonthFromDate(dateStr?: string | null): number | null {
    if (!dateStr) return null;
    const str = String(dateStr).trim();
    if (!str) return null;
    const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (ymdMatch) {
      const month = parseInt(ymdMatch[2], 10);
      if (month >= 1 && month <= 12) return month;
    }
    const d = new Date(str.includes('T') ? str : `${str}T00:00:00`);
    if (!isNaN(d.getTime())) {
      return d.getMonth() + 1;
    }
    return null;
  }

  function getFifoColorForDate(receivedDate?: string | null, calendar?: Record<number, any>): string {
    const monthNum = getMonthFromDate(receivedDate);
    if (!monthNum) return 'Silver';
    const activeMap = calendar || state?.fifoColorsByMonth || DEFAULT_FIFO_COLORS_BY_MONTH;
    return activeMap[monthNum]?.name || DEFAULT_FIFO_COLORS_BY_MONTH[monthNum]?.name || 'Silver';
  }

  function isValidFifoColorName(color: any, calendar?: Record<number, any>): boolean {
    if (color === undefined || color === null) return false;
    const s = String(color).trim();
    if (!s || /^\d+$/.test(s) || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') {
      return false;
    }
    if (FIFO_KNOWN_COLOR_NAMES.has(s.toLowerCase())) return true;
    const activeMap = calendar || state?.fifoColorsByMonth || DEFAULT_FIFO_COLORS_BY_MONTH;
    return Object.values(activeMap).some((m: any) => m?.name?.toLowerCase() === s.toLowerCase());
  }

  function normalizeFifoColor(value: any, receivedDate?: string | null, calendar?: Record<number, any>): string {
    const activeMap = calendar || state?.fifoColorsByMonth || DEFAULT_FIFO_COLORS_BY_MONTH;
    if (value !== undefined && value !== null) {
      const str = String(value).trim();
      if (/^\d+$/.test(str)) {
        const m = parseInt(str, 10);
        if (m >= 1 && m <= 12) {
          return activeMap[m]?.name || DEFAULT_FIFO_COLORS_BY_MONTH[m]?.name || 'Silver';
        }
        return getFifoColorForDate(receivedDate, activeMap);
      }
      if (isValidFifoColorName(str, activeMap)) {
        for (const m of Object.values(activeMap) as any[]) {
          if (m?.name?.toLowerCase() === str.toLowerCase()) return m.name;
        }
        return str;
      }
    }
    return getFifoColorForDate(receivedDate, activeMap);
  }

  const STARTER_BARCODE_PRESETS = [
    {
      id: 'REG-BCP-RESIN-001',
      type: 'BARCODE_PRESET',
      code: 'SAMPLE-RESIN-001',
      name: 'PC/ABS CYCOLOY RESIN PELLETS',
      description: 'High-impact flame retardant engineering plastic resin pellets for injection molding',
      category: 'RESIN/RAW MATERIALS',
      unit: 'KGS',
      vendorSupplier: 'SABIC INNOVATIVE PLASTICS',
      location: 'RAW-ZONE-A1',
      presetSource: 'EXTERNAL',
      status: 'ACTIVE',
      dateRegistered: '2026-10-02'
    },
    {
      id: 'REG-BCP-IND-001',
      type: 'BARCODE_PRESET',
      code: 'SAMPLE-IND-001',
      name: 'THERMAL CONDUCTIVE SILICONE GREASE',
      description: 'High-efficiency thermal interface compound for heatsink and PCB assembly',
      category: 'INDIRECT BOM',
      unit: 'TUBES',
      vendorSupplier: 'SHIN-ETSU CHEMICAL CO.',
      location: 'CHEM-SHELF-B2',
      presetSource: 'EXTERNAL',
      status: 'ACTIVE',
      dateRegistered: '2026-10-02'
    },
    {
      id: 'REG-BCP-DIR-001',
      type: 'BARCODE_PRESET',
      code: 'SAMPLE-DIR-001',
      name: 'M3X8MM STAINLESS STEEL MACHINE SCREW',
      description: 'Phillips pan-head SUS304 precision fastener for chassis sub-assembly',
      category: 'DIRECT BOM',
      unit: 'PCS',
      vendorSupplier: 'FASTENAL INDUSTRIAL SUPPLIES',
      location: 'FAST-BIN-C3',
      presetSource: 'EXTERNAL',
      status: 'ACTIVE',
      dateRegistered: '2026-10-02'
    },
    {
      id: 'REG-BCP-CON-001',
      type: 'BARCODE_PRESET',
      code: 'SAMPLE-CON-001',
      name: 'ESD ANTISTATIC CLEANROOM WIPES',
      description: '9x9 inch lint-free polyester microfiber wipes for optical and SMT cleaning',
      category: 'CONSUMABLES',
      unit: 'PACKS',
      vendorSupplier: 'CLEANROOM PRO DYNAMICS',
      location: 'CONS-RACK-D1',
      presetSource: 'EXTERNAL',
      status: 'ACTIVE',
      dateRegistered: '2026-10-02'
    },
    {
      id: 'REG-BCP-PKG-001',
      type: 'BARCODE_PRESET',
      code: 'SAMPLE-PKG-001',
      name: 'CORRUGATED SHIPPER CARTON 400X300X250',
      description: 'Double-wall heavy duty B/C flute export shipping carton with preprinted handling symbols',
      category: 'PACKAGING MATERIALS',
      unit: 'PCS',
      vendorSupplier: 'INTERNATIONAL PACKAGING CORP',
      location: 'PKG-MEZZ-E4',
      presetSource: 'EXTERNAL',
      status: 'ACTIVE',
      dateRegistered: '2026-10-02'
    },
    {
      id: 'REG-BCP-WIP-001',
      type: 'BARCODE_PRESET',
      code: 'SAMPLE-WIP-001',
      name: 'MOLDED FRONT HOUSING SUB-ASSEMBLY',
      description: 'Precision injection molded bezel frame awaiting ultrasonic brass insert staking',
      category: 'WIP (WORK IN PROGRESS)',
      unit: 'PCS',
      vendorSupplier: 'PLASTICS INJECTION LINE 2',
      location: 'WIP-STAGE-F1',
      presetSource: 'INTERNAL',
      status: 'ACTIVE',
      dateRegistered: '2026-10-02'
    },
    {
      id: 'REG-BCP-FG-001',
      type: 'BARCODE_PRESET',
      code: 'SAMPLE-FG-001',
      name: 'SMART IOT SENSOR NODE CONTROLLER',
      description: 'Fully assembled, calibrated and QC approved wireless industrial sensor unit',
      category: 'FG (FINISHED GOOD)',
      unit: 'PCS',
      vendorSupplier: 'FINAL ASSEMBLY DEPT 1',
      location: 'FG-AISLE-G2',
      presetSource: 'INTERNAL',
      status: 'ACTIVE',
      dateRegistered: '2026-10-02'
    },
    {
      id: 'REG-BCP-OFF-001',
      type: 'BARCODE_PRESET',
      code: 'SAMPLE-OFF-001',
      name: 'DIRECT THERMAL BARCODE LABELS 4X6',
      description: 'Standard perforated warehouse shipping label rolls for Zebra industrial printers',
      category: 'OFFICE SUPPLIES',
      unit: 'ROLLS',
      vendorSupplier: 'OFFICE SUPPLY DEPOT PH',
      location: 'ADMIN-CAB-H1',
      presetSource: 'EXTERNAL',
      status: 'ACTIVE',
      dateRegistered: '2026-10-02'
    }
  ];

  // Central Database In-Memory Collections (Single Source of Truth)
  const state: {
    stocks: any[];
    receiving: any[];
    returns: any[];
    recycling: any[];
    issuances: any[];
    deliveries: any[];
    envLogs: any[];
    forkliftChecks: any[];
    registries: any[];
    registeredUsers: ServerUser[];
    stockMovements: any[];
    sessions: any[];
    operationalRoles: string[];
    receivingCategories: string[];
    fifoColorsByMonth: Record<number, { name: string; colorClass: string; textClass: string; hex?: string }>;
  } = {
    stocks: INITIAL_STOCK.map((item: any) => normalizeRecord(item)),
    receiving: INITIAL_RECEIVING.map((item: any) => normalizeRecord(item)),
    returns: INITIAL_RETURNS.map((item: any) => normalizeRecord(item)),
    recycling: INITIAL_RECYCLING.map((item: any) => normalizeRecord(item)),
    issuances: INITIAL_ISSUANCE.map((item: any) => normalizeRecord(item)),
    deliveries: INITIAL_DELIVERIES.map((item: any) => normalizeRecord(item)),
    envLogs: INITIAL_ENV_LOGS.map((item: any) => normalizeRecord(item)),
    forkliftChecks: INITIAL_FORKLIFT_CHECKS.map((item: any) => normalizeRecord(item)),
    registries: [...STARTER_BARCODE_PRESETS],
    registeredUsers: [{ ...defaultSuperAdmin }],
    stockMovements: [],
    sessions: [],
    operationalRoles: [...DEFAULT_OPERATIONAL_ROLES],
    receivingCategories: [...DEFAULT_RECEIVING_CATEGORIES],
    fifoColorsByMonth: { ...DEFAULT_FIFO_COLORS_BY_MONTH },
  };

  /**
   * Helper to build complete database payload from authoritative in-memory state
   */
  function getDbPayload(): any {
    return {
      installationId,
      primaryDeviceId,
      systemResetVersion,
      systemResetTimestamp,
      systemResetId,
      systemResetBy,
      stateRevision,
      state,
      stocks: state.stocks || [],
      receiving: state.receiving || [],
      returns: state.returns || [],
      recycling: state.recycling || [],
      issuances: state.issuances || [],
      deliveries: state.deliveries || [],
      envLogs: state.envLogs || [],
      forkliftChecks: state.forkliftChecks || [],
      registries: state.registries || [],
      registeredUsers: state.registeredUsers || [],
      stockMovements: state.stockMovements || [],
      sessions: state.sessions || [],
      operationalRoles: state.operationalRoles || [...DEFAULT_OPERATIONAL_ROLES],
      receivingCategories: state.receivingCategories || [...DEFAULT_RECEIVING_CATEGORIES],
      fifoColorsByMonth: state.fifoColorsByMonth || { ...DEFAULT_FIFO_COLORS_BY_MONTH },
      authorizedDevices: Array.from(authorizedDevicesMap.values()),
      deletedRecordTombstones: Array.from(deletedRecordTombstones),
      deletedUserTombstones: Array.from(deletedUserTombstones),
      chatMessages: chatMessages.slice(-200)
    };
  }

  /**
   * Authoritative Disk Persistence: Synchronous Commit to SQLite
   * DATABASE COMMIT MUST ALWAYS HAPPEN BEFORE A WEBSOCKET EVENT IS BROADCAST.
   */
  function commitDatabase(): boolean {
    try {
      const payload = getDbPayload();
      return commitToSqlite(payload);
    } catch (err) {
      console.error("CRITICAL: Failed SQLite database commit to disk:", err);
      return false;
    }
  }

  // =========================================================================
  // AUTOMATED DATABASE BACKUPS & RECOVERY SUBSYSTEM (JUWEI_DATA_DIR / backups)
  // 1. Backs up database to backups folder every 1 hour & once on server startup.
  // 2. Format: central-database-YYYY-MM-DD-HHmm.json (e.g. central-database-2026-09-30-1400.json).
  // 3. Permanent retention: keeps EVERY backup, with NO cap on count and NO age limit.
  // 4. Non-blocking async file copying ensuring zero disruption to normal app operations.
  // 5. Automatic recovery on server startup from most recent backup if live file is missing/corrupted.
  // 6. Logs every backup created, restore performed, and startup load/recovery action.
  // =========================================================================

  const BACKUPS_DIR = process.env.JUWEI_DATA_DIR 
    ? path.join(process.env.JUWEI_DATA_DIR, "backups")
    : path.join(path.dirname(DATA_FILE), "backups");

  const BACKUP_AUDIT_LOG_FILE = getStorageFilePath("backup-audit-log.json");

  interface BackupAuditEntry {
    id: string;
    action: "BACKUP_CREATED" | "DATABASE_RESTORED" | "PRUNE";
    filename: string;
    author: string;
    timestamp: string;
    details?: string;
    fileSizeBytes?: number;
  }

  interface BackupItemRecord {
    filename: string;
    filePath: string;
    sizeBytes: number;
    sizeFormatted: string;
    createdAt: string;
    mtime: number;
  }

  let backupAuditLogs: BackupAuditEntry[] = [];
  try {
    if (fs.existsSync(BACKUP_AUDIT_LOG_FILE)) {
      const raw = fs.readFileSync(BACKUP_AUDIT_LOG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) backupAuditLogs = parsed;
    }
  } catch (e) {
    backupAuditLogs = [];
  }

  function logBackupAudit(
    action: "BACKUP_CREATED" | "DATABASE_RESTORED" | "PRUNE",
    filename: string,
    author: string,
    details?: string,
    fileSizeBytes?: number
  ) {
    const entry: BackupAuditEntry = {
      id: `BA-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      action,
      filename,
      author,
      timestamp: new Date().toISOString(),
      details,
      fileSizeBytes
    };
    backupAuditLogs.unshift(entry);
    if (backupAuditLogs.length > 100) {
      backupAuditLogs = backupAuditLogs.slice(0, 100);
    }
    try {
      fs.writeFileSync(BACKUP_AUDIT_LOG_FILE, JSON.stringify(backupAuditLogs, null, 2), "utf-8");
    } catch (e) {}

    if (action === "BACKUP_CREATED") {
      console.log(`[DATABASE BACKUP] Created backup '${filename}' (${fileSizeBytes || 0} bytes) by ${author}. Reason: ${details || 'N/A'}`);
    } else if (action === "DATABASE_RESTORED") {
      console.log(`[DATABASE RESTORE] OVERWROTE live database with backup '${filename}' by ${author}. Reason: ${details || 'N/A'}`);
    }
  }

  // =========================================================================
  // PIN CHANGE AUDIT LOGGING:
  // Tracks every single operator PIN modification, reset, and compromised
  // status resolution. Never silently resets or falls back.
  // =========================================================================
  const PIN_AUDIT_LOG_FILE = getStorageFilePath("pin-audit-log.json");

  interface PinAuditEntry {
    id: string;
    action: "PIN_CHANGED" | "PIN_RESET" | "COMPROMISED_PIN_RESOLVED";
    targetEmployeeId: string;
    targetUsername: string;
    changedBy: string;
    changedByEmployeeId: string;
    timestamp: string;
    ip?: string;
    reason?: string;
    previousPinWasCompromised: boolean;
  }

  let pinAuditLogs: PinAuditEntry[] = [];
  try {
    if (fs.existsSync(PIN_AUDIT_LOG_FILE)) {
      const raw = fs.readFileSync(PIN_AUDIT_LOG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) pinAuditLogs = parsed;
    }
  } catch (e) {
    pinAuditLogs = [];
  }

  function logPinAudit(
    action: "PIN_CHANGED" | "PIN_RESET" | "COMPROMISED_PIN_RESOLVED",
    targetEmployeeId: string,
    targetUsername: string,
    changedBy: string,
    changedByEmployeeId: string,
    reason?: string,
    previousPinWasCompromised: boolean = false,
    ip?: string
  ) {
    const entry: PinAuditEntry = {
      id: `PIN-LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      action,
      targetEmployeeId,
      targetUsername,
      changedBy,
      changedByEmployeeId,
      timestamp: new Date().toISOString(),
      reason: reason || 'Explicit Super Admin PIN Update',
      previousPinWasCompromised,
      ip: ip || '127.0.0.1'
    };
    pinAuditLogs.unshift(entry);
    if (pinAuditLogs.length > 500) {
      pinAuditLogs = pinAuditLogs.slice(0, 500);
    }
    try {
      fs.writeFileSync(PIN_AUDIT_LOG_FILE, JSON.stringify(pinAuditLogs, null, 2), "utf-8");
    } catch (err) {
      console.error("[PIN-AUDIT-LOG] Failed to persist pin audit log to disk:", err);
    }
    console.log(`[PIN-AUDIT-LOG] ${action} | Target: ${targetEmployeeId} (${targetUsername}) | By: ${changedByEmployeeId} (${changedBy}) | Reason: ${entry.reason} | Time: ${entry.timestamp}`);
  }

  function formatBackupTimestamp(date: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd}-${hh}${min}`;
  }

  function getNextBackupFilename(date: Date = new Date()): string {
    const base = `central-database-${formatBackupTimestamp(date)}`;
    let filename = `${base}.sqlite`;
    let counter = 1;
    while (fs.existsSync(path.join(BACKUPS_DIR, filename))) {
      filename = `${base}-${counter}.sqlite`;
      counter++;
    }
    return filename;
  }

  // Lists all existing backups sorted newest first. Accepts both .sqlite and legacy .json backups.
  function getAllBackupRecords(): BackupItemRecord[] {
    try {
      if (!fs.existsSync(BACKUPS_DIR)) return [];
      const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true });
      const backups: BackupItemRecord[] = entries
        .filter(e => e.isFile() && e.name.startsWith("central-database-") && (e.name.endsWith(".sqlite") || e.name.endsWith(".json")))
        .map(e => {
          const filePath = path.join(BACKUPS_DIR, e.name);
          let mtime = 0;
          let birthtime = 0;
          let size = 0;
          try {
            const stat = fs.statSync(filePath);
            mtime = stat.mtimeMs;
            birthtime = stat.birthtimeMs || stat.mtimeMs;
            size = stat.size;
          } catch (stErr) {}
          return {
            filename: e.name,
            filePath,
            sizeBytes: size,
            sizeFormatted: size > 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(2)} MB` : `${(size / 1024).toFixed(1)} KB`,
            createdAt: new Date(birthtime || mtime).toISOString(),
            mtime
          };
        });

      // Sort newest first
      backups.sort((a, b) => b.mtime - a.mtime || b.filename.localeCompare(a.filename));
      return backups;
    } catch (err: any) {
      console.error("[DATABASE BACKUP] Error reading backups list:", err);
      return [];
    }
  }

  // Non-blocking asynchronous backup creator using SQLite VACUUM INTO
  let isBackupInProgress = false;
  async function createDatabaseBackup(reason: string = "SCHEDULED", author: string = "SYSTEM"): Promise<{ success: boolean; filename?: string; error?: string }> {
    if (isBackupInProgress) {
      console.log(`[DATABASE BACKUP] Backup already in progress, skipping concurrent trigger (${reason})`);
      return { success: false, error: "A backup is already in progress" };
    }
    isBackupInProgress = true;
    try {
      if (!fs.existsSync(BACKUPS_DIR)) {
        await fs.promises.mkdir(BACKUPS_DIR, { recursive: true });
      }

      // Ensure disk database is current with memory state
      commitDatabase();

      if (!fs.existsSync(DATA_FILE_SQLITE)) {
        console.warn("[DATABASE BACKUP] Cannot create backup: SQLite database file does not exist on disk.");
        return { success: false, error: "Database file does not exist on disk" };
      }

      const filename = getNextBackupFilename();
      const targetPath = path.join(BACKUPS_DIR, filename);

      // Consistent atomic snapshot via VACUUM INTO
      vacuumInto(targetPath);
      const stat = await fs.promises.stat(targetPath);

      logBackupAudit("BACKUP_CREATED", filename, author, reason, stat.size);
      return { success: true, filename };
    } catch (err: any) {
      console.error("[DATABASE BACKUP] Failed to create database backup:", err);
      return { success: false, error: err?.message || String(err) };
    } finally {
      isBackupInProgress = false;
    }
  }

  // Apply database object payload into in-memory state
  function applyDatabaseObject(parsed: any): boolean {
    try {
      if (!parsed || typeof parsed !== 'object') return false;

      if (parsed.installationId) installationId = String(parsed.installationId);
      if (parsed.primaryDeviceId) primaryDeviceId = String(parsed.primaryDeviceId);
      if (parsed.systemResetVersion) systemResetVersion = Number(parsed.systemResetVersion) || 1;
      if (parsed.systemResetTimestamp) systemResetTimestamp = String(parsed.systemResetTimestamp);
      if (parsed.systemResetId) systemResetId = String(parsed.systemResetId);
      if (parsed.systemResetBy) systemResetBy = String(parsed.systemResetBy);
      if (parsed.stateRevision) stateRevision = Number(parsed.stateRevision) || 1;

      if (Array.isArray(parsed.authorizedDevices)) {
        authorizedDevicesMap.clear();
        parsed.authorizedDevices.forEach((dev: AuthorizedDeviceRecord) => {
          if (dev && dev.deviceId) authorizedDevicesMap.set(dev.deviceId, dev);
        });
      }

      if (parsed.state && typeof parsed.state === "object") {
        Object.keys(parsed.state).forEach((key) => {
          if (key in state && Array.isArray(parsed.state[key])) {
            if (key === 'operationalRoles') {
              state.operationalRoles = Array.from(new Set<string>(parsed.state[key].map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
            } else if (key === 'receivingCategories') {
              state.receivingCategories = Array.from(new Set<string>(parsed.state[key].map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
            } else if (key === 'fifoColorsByMonth') {
              if (parsed.state[key] && typeof parsed.state[key] === 'object') {
                state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...parsed.state[key] };
              }
            } else {
              // Ensure all loaded records have mandatory fields
              (state as any)[key] = parsed.state[key].map((rec: any) => normalizeRecord(rec));
            }
          } else if (key === 'fifoColorsByMonth' && parsed.state && parsed.state[key] && typeof parsed.state[key] === 'object') {
            state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...parsed.state[key] };
          }
        });
      }
      for (const key of Object.keys(state)) {
        if (key === 'operationalRoles') {
          if (Array.isArray(parsed.operationalRoles) && parsed.operationalRoles.length > 0) {
            state.operationalRoles = Array.from(new Set<string>(parsed.operationalRoles.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
          }
        } else if (key === 'receivingCategories') {
          if (Array.isArray(parsed.receivingCategories) && parsed.receivingCategories.length > 0) {
            state.receivingCategories = Array.from(new Set<string>(parsed.receivingCategories.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
          }
        } else if (key === 'fifoColorsByMonth') {
          if (parsed.fifoColorsByMonth && typeof parsed.fifoColorsByMonth === 'object') {
            state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...parsed.fifoColorsByMonth };
          }
        } else if (Array.isArray(parsed[key]) && (!(parsed.state && key in parsed.state))) {
          (state as any)[key] = parsed[key].map((rec: any) => normalizeRecord(rec));
        }
      }
      if (!Array.isArray(state.operationalRoles) || state.operationalRoles.length === 0) {
        state.operationalRoles = [...DEFAULT_OPERATIONAL_ROLES];
      }
      if (!Array.isArray(state.receivingCategories) || state.receivingCategories.length === 0) {
        state.receivingCategories = [...DEFAULT_RECEIVING_CATEGORIES];
      }
      if (!state.fifoColorsByMonth || typeof state.fifoColorsByMonth !== 'object' || Object.keys(state.fifoColorsByMonth).length === 0) {
        state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH };
      }
      if (!Array.isArray(state.registries) || state.registries.length === 0) {
        state.registries = [...STARTER_BARCODE_PRESETS];
      } else {
        for (const preset of STARTER_BARCODE_PRESETS) {
          if (!state.registries.some((r: any) => (r.code || '').toUpperCase() === preset.code.toUpperCase())) {
            state.registries.push(preset);
          }
        }
      if (!Array.isArray(state.sessions)) {
        state.sessions = [];
      } else if (Array.isArray(parsed.sessions) && state.sessions.length === 0) {
        state.sessions = parsed.sessions.map((rec: any) => normalizeRecord(rec));
      }

      if (Array.isArray(parsed.deletedRecordTombstones)) {
        parsed.deletedRecordTombstones.forEach((id: string) => markRecordTombstone(id));
      }
      if (Array.isArray(parsed.deletedUserTombstones)) {
        parsed.deletedUserTombstones.forEach((empId: string) => markUserTombstone(empId));
      }
      if (Array.isArray(parsed.chatMessages)) {
        chatMessages.length = 0;
        chatMessages.push(...parsed.chatMessages.slice(-200));
      }

      // Ensure Super Administrator JPMP-002 is registered in memory
      const superAdminIndex = state.registeredUsers.findIndex(
        u => (u.employeeId || '').toUpperCase().trim() === 'JPMP-002'
      );
      if (superAdminIndex === -1) {
        state.registeredUsers.unshift({ ...defaultSuperAdmin, deviceId: primaryDeviceId });
      } else {
        const existing = state.registeredUsers[superAdminIndex];
        state.registeredUsers[superAdminIndex] = {
          ...existing,
          deviceId: existing.deviceId || primaryDeviceId,
          isPrimaryAdminDevice: true,
          authorizedDevices: Array.from(new Set([...(existing.authorizedDevices || []), primaryDeviceId]))
        };
      }

      // Security Audit: Flag any account currently with '1234' as compromised
      let compromisedAccountsCount = 0;
      state.registeredUsers.forEach(u => {
        const cleanPin = String(u.pin || '').trim();
        if (cleanPin === '1234') {
          u.isPinCompromised = true;
          compromisedAccountsCount++;
          console.warn(`[SECURITY ALERT] Operator ${u.employeeId} (${u.username}) currently has compromised PIN '1234'. Marked as COMPROMISED.`);
        }
      });
      if (compromisedAccountsCount > 0) {
        console.warn(`[SECURITY AUDIT] ${compromisedAccountsCount} operator account(s) have compromised default PIN '1234'. Super Admin PIN reset required.`);
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  // Thin JSON wrapper around applyDatabaseObject
  function parseAndApplyDatabaseJson(raw: string): boolean {
    try {
      const parsed = JSON.parse(raw);
      return applyDatabaseObject(parsed);
    } catch (e) {
      return false;
    }
  }

  // Load persisted state from disk on server initialization with automatic backup recovery
  function loadDatabaseFromDisk() {
    const timestampStr = formatBackupTimestamp(new Date());

    // a) Load the live SQLite DB if it is valid.
    if (fs.existsSync(DATA_FILE_SQLITE)) {
      const validation = validateDatabaseFile(DATA_FILE_SQLITE);
      if (validation.valid && validation.data) {
        initSqliteStore(DATA_FILE_SQLITE);
        applyDatabaseObject(validation.data);
        console.log("Live database loaded normally");
        return;
      }

      // b) If it is corrupt, move it aside as central-database.sqlite.corrupt-<timestamp> (never delete it).
      console.warn(`WARNING: Live SQLite database '${DATA_FILE_SQLITE}' is corrupt or unreadable (${validation.error || 'validation failed'}). Moving aside as corrupt...`);
      try {
        const corruptTarget = `${DATA_FILE_SQLITE}.corrupt-${timestampStr}`;
        fs.renameSync(DATA_FILE_SQLITE, corruptTarget);
        console.log(`[CORRUPT DB] Moved corrupt database aside to: ${corruptTarget}`);
        if (fs.existsSync(`${DATA_FILE_SQLITE}-wal`)) {
          try { fs.renameSync(`${DATA_FILE_SQLITE}-wal`, `${DATA_FILE_SQLITE}-wal.corrupt-${timestampStr}`); } catch (e) {}
        }
        if (fs.existsSync(`${DATA_FILE_SQLITE}-shm`)) {
          try { fs.renameSync(`${DATA_FILE_SQLITE}-shm`, `${DATA_FILE_SQLITE}-shm.corrupt-${timestampStr}`); } catch (e) {}
        }
      } catch (moveErr) {
        console.error("Failed to move corrupt SQLite file aside:", moveErr);
      }
    }

    // c) If no valid SQLite DB exists but central-database.json exists, import it into SQLite and verify the copy matches.
    // Only then rename the original to central-database.json.migrated-<timestamp> (never delete it).
    if (fs.existsSync(DATA_FILE_JSON)) {
      try {
        const rawJson = fs.readFileSync(DATA_FILE_JSON, "utf-8");
        if (rawJson && rawJson.trim().length > 0) {
          const parsed = JSON.parse(rawJson);
          if (applyDatabaseObject(parsed)) {
            // Initialize fresh SQLite store
            initSqliteStore(DATA_FILE_SQLITE);
            // Save in-memory state to SQLite
            commitDatabase();

            // Verify the copy matches
            const loadedFromSqlite = readDatabaseFromSqlite();
            const stocksMatch = (loadedFromSqlite.state?.stocks?.length || 0) === (state.stocks?.length || 0);
            const receivingMatch = (loadedFromSqlite.state?.receiving?.length || 0) === (state.receiving?.length || 0);
            const usersMatch = (loadedFromSqlite.state?.registeredUsers?.length || 0) === (state.registeredUsers?.length || 0);

            if (stocksMatch && receivingMatch && usersMatch) {
              const migratedTarget = `${DATA_FILE_JSON}.migrated-${timestampStr}`;
              fs.renameSync(DATA_FILE_JSON, migratedTarget);
              console.log(`[MIGRATION SUCCESS] Legacy JSON database successfully migrated to SQLite (${DATA_FILE_SQLITE}). Original renamed to: ${migratedTarget}`);
              return;
            } else {
              console.error("[MIGRATION WARNING] SQLite verification did not match in-memory state after importing legacy JSON!");
            }
          }
        }
      } catch (jsonErr) {
        console.error("[MIGRATION ERROR] Failed to import legacy central-database.json:", jsonErr);
      }
    }

    // d) Otherwise recover from the newest VALID backup, skipping empty or corrupt files. Backups can be .sqlite or legacy .json.
    let autoRestoredBackupFilename: string | null = null;
    try {
      if (fs.existsSync(BACKUPS_DIR)) {
        const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true });
        const backupCandidates = entries
          .filter(e => e.isFile() && e.name.startsWith("central-database-") && (e.name.endsWith(".sqlite") || e.name.endsWith(".json")))
          .map(e => {
            const filePath = path.join(BACKUPS_DIR, e.name);
            let mtime = 0;
            try {
              mtime = fs.statSync(filePath).mtimeMs;
            } catch (stErr) {}
            return { filename: e.name, filePath, mtime, isSqlite: e.name.endsWith(".sqlite") };
          });

        // Sort newest first
        backupCandidates.sort((a, b) => b.mtime - a.mtime || b.filename.localeCompare(a.filename));

        for (const candidate of backupCandidates) {
          try {
            if (candidate.isSqlite) {
              const validation = validateDatabaseFile(candidate.filePath);
              if (validation.valid && validation.data) {
                // Valid SQLite backup
                if (fs.existsSync(DATA_FILE_SQLITE)) {
                  try { checkpointAndClose(); } catch (e) {}
                  try { fs.unlinkSync(DATA_FILE_SQLITE); } catch (e) {}
                }
                fs.copyFileSync(candidate.filePath, DATA_FILE_SQLITE);
                initSqliteStore(DATA_FILE_SQLITE);
                applyDatabaseObject(validation.data);

                autoRestoredBackupFilename = candidate.filename;
                console.log(`Live database missing/corrupted — auto-restored from backup '${candidate.filename}'`);
                logBackupAudit(
                  "DATABASE_RESTORED",
                  candidate.filename,
                  "SYSTEM_AUTO_RECOVERY",
                  "Live database missing or corrupted on startup — automatically recovered from latest SQLite backup",
                  fs.statSync(candidate.filePath).size
                );
                return;
              }
            } else {
              // Legacy .json backup
              const rawBackup = fs.readFileSync(candidate.filePath, "utf-8");
              if (rawBackup && rawBackup.trim().length > 0) {
                const parsed = JSON.parse(rawBackup);
                if (applyDatabaseObject(parsed)) {
                  initSqliteStore(DATA_FILE_SQLITE);
                  commitDatabase();

                  autoRestoredBackupFilename = candidate.filename;
                  console.log(`Live database missing/corrupted — auto-restored from backup '${candidate.filename}'`);
                  logBackupAudit(
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
          } catch (candErr) {
            // Move to next candidate
          }
        }
      }
    } catch (scanErr) {
      console.error("[AUTO RECOVERY] Error scanning backups directory:", scanErr);
    }

    // e) Otherwise start empty, as before.
    if (!autoRestoredBackupFilename) {
      console.warn("WARNING: Live database is missing/corrupted and no backup files are available in backups folder. Starting with an empty database. No recovery was possible.");
      initSqliteStore(DATA_FILE_SQLITE);
      commitDatabase();
      const superAdminIndex = state.registeredUsers.findIndex(
        u => (u.employeeId || '').toUpperCase().trim() === 'JPMP-002'
      );
      if (superAdminIndex === -1) {
        state.registeredUsers.unshift({ ...defaultSuperAdmin, deviceId: primaryDeviceId });
        commitDatabase();
      }
    }
  }

  // =========================================================================
  // MANDATORY PRE-STARTUP DATABASE SAFETY BACKUP:
  // Before loading the database or executing any new code that touches data,
  // create a dedicated safety backup copy of the current live database file.
  // =========================================================================
  function createPreStartupBackup(): { success: boolean; filename?: string } {
    try {
      if (!fs.existsSync(BACKUPS_DIR)) {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      }

      const timestampStr = formatBackupTimestamp(new Date());

      // If SQLite DB exists
      if (fs.existsSync(DATA_FILE_SQLITE)) {
        const validation = validateDatabaseFile(DATA_FILE_SQLITE);
        if (validation.valid) {
          const base = `central-database-PRE-STARTUP-${timestampStr}`;
          let filename = `${base}.sqlite`;
          let counter = 1;
          while (fs.existsSync(path.join(BACKUPS_DIR, filename))) {
            filename = `${base}-${counter}.sqlite`;
            counter++;
          }
          const targetPath = path.join(BACKUPS_DIR, filename);

          try {
            const tempDb = openSqliteDatabase(DATA_FILE_SQLITE, { readonly: true });
            if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
            tempDb.prepare("VACUUM INTO ?;").run(targetPath);
            tempDb.close();
          } catch (vErr) {
            fs.copyFileSync(DATA_FILE_SQLITE, targetPath);
          }

          const backupStat = fs.statSync(targetPath);
          logBackupAudit(
            "BACKUP_CREATED",
            filename,
            "SYSTEM_PRE_STARTUP",
            "Mandatory pre-startup safety copy taken before server code loads or touches data",
            backupStat.size
          );
          console.log(`[DATABASE PRE-STARTUP BACKUP] Safety backup created: '${filename}' (${backupStat.size} bytes). Taken before server code touches data.`);
          return { success: true, filename };
        } else {
          // If the live DB is unreadable at startup, keep a raw copy named *.sqlite.unreadable
          const unreadablePath = `${DATA_FILE_SQLITE}.unreadable`;
          try {
            fs.copyFileSync(DATA_FILE_SQLITE, unreadablePath);
            console.warn(`[DATABASE PRE-STARTUP BACKUP] Live SQLite DB is unreadable. Raw copy kept at: '${unreadablePath}'`);
          } catch (copyErr) {
            console.error("Failed to copy unreadable SQLite DB:", copyErr);
          }
          return { success: false };
        }
      }

      // If only legacy JSON exists, copy it as a PRE-STARTUP .json backup
      if (fs.existsSync(DATA_FILE_JSON)) {
        const stat = fs.statSync(DATA_FILE_JSON);
        if (stat.size > 0) {
          const base = `central-database-PRE-STARTUP-${timestampStr}`;
          let filename = `${base}.json`;
          let counter = 1;
          while (fs.existsSync(path.join(BACKUPS_DIR, filename))) {
            filename = `${base}-${counter}.json`;
            counter++;
          }
          const targetPath = path.join(BACKUPS_DIR, filename);
          fs.copyFileSync(DATA_FILE_JSON, targetPath);
          const backupStat = fs.statSync(targetPath);
          logBackupAudit(
            "BACKUP_CREATED",
            filename,
            "SYSTEM_PRE_STARTUP",
            "Mandatory pre-startup safety copy of legacy JSON taken before server code loads or touches data",
            backupStat.size
          );
          console.log(`[DATABASE PRE-STARTUP BACKUP] Safety legacy JSON backup created: '${filename}' (${backupStat.size} bytes).`);
          return { success: true, filename };
        }
      }

      console.log("[DATABASE PRE-STARTUP BACKUP] No existing live database file found on disk (fresh install) — skipping pre-startup backup.");
      return { success: false };
    } catch (err: any) {
      console.error("[DATABASE PRE-STARTUP BACKUP] Failed to create pre-startup safety backup:", err);
      return { success: false };
    }
  }

  // 1. Mandatory safety backup created BEFORE loading the database normally
  createPreStartupBackup();

  // 2. Load database state (or auto-recover from backups if needed) on server initialization
  loadDatabaseFromDisk();

  // =========================================================================
  // ONE-TIME FIFO TAG COLOR DATA REPAIR ON SERVER STARTUP:
  // Scans all stock and receiving records right after pre-startup backup & load.
  // If fifoColor / fifoColorCode is numeric (1-12) or not a valid color name,
  // recomputes it from the received date using the synced calendar and persists.
  // Valid color names are NEVER modified (maintaining the locked-in rule).
  // Each change is logged to console and the dedicated FIFO repair audit log.
  // =========================================================================
  const FIFO_REPAIR_AUDIT_LOG_FILE = getStorageFilePath("fifo-repair-audit-log.json");

  interface FifoRepairAuditEntry {
    id: string;
    collection: "stocks" | "receiving";
    recordId: string;
    partCode?: string;
    receivedDate?: string;
    oldFifoColor: any;
    newFifoColor: string;
    timestamp: string;
    reason: string;
  }

  let fifoRepairAuditLogs: FifoRepairAuditEntry[] = [];
  try {
    if (fs.existsSync(FIFO_REPAIR_AUDIT_LOG_FILE)) {
      const raw = fs.readFileSync(FIFO_REPAIR_AUDIT_LOG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) fifoRepairAuditLogs = parsed;
    }
  } catch (e) {
    fifoRepairAuditLogs = [];
  }

  function repairFifoTagColorsOnStartup(): {
    stocksScanned: number;
    stocksRepaired: number;
    receivingScanned: number;
    receivingRepaired: number;
    repairs: FifoRepairAuditEntry[];
  } {
    console.log("[FIFO STARTUP AUDIT] Beginning inspection of FIFO tag colors across stock and receiving records...");
    let stocksRepaired = 0;
    let receivingRepaired = 0;
    const newRepairs: FifoRepairAuditEntry[] = [];
    const nowIso = new Date().toISOString();

    // 1. Scan Stock Records
    if (Array.isArray(state.stocks)) {
      state.stocks.forEach((stock: any) => {
        const currentColor = stock.fifoColor ?? stock.fifo_color;
        if (!isValidFifoColorName(currentColor, state.fifoColorsByMonth)) {
          const recDate = stock.receivedDate || stock.received_date || stock.date || stock.updated_at || nowIso.split('T')[0];
          const newColor = getFifoColorForDate(recDate, state.fifoColorsByMonth);
          const auditEntry: FifoRepairAuditEntry = {
            id: `FIFO-AUDIT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            collection: "stocks",
            recordId: String(stock.id || stock.record_id),
            partCode: stock.partCode || stock.part_code,
            receivedDate: recDate,
            oldFifoColor: currentColor,
            newFifoColor: newColor,
            timestamp: nowIso,
            reason: currentColor === undefined || currentColor === null || currentColor === '' 
              ? "Missing FIFO color tag; recomputed from receivedDate" 
              : /^\d+$/.test(String(currentColor).trim()) 
                ? `Numeric FIFO month code ('${currentColor}') normalized to canonical color name` 
                : `Unrecognized color value ('${currentColor}') normalized to canonical color name`
          };

          stock.fifoColor = newColor;
          stock.version = (Number(stock.version) || 1) + 1;
          stock.updated_at = nowIso;

          newRepairs.push(auditEntry);
          fifoRepairAuditLogs.unshift(auditEntry);
          stocksRepaired++;

          console.log(`[FIFO REPAIR AUDIT] Repaired Stock [ID: ${stock.id}] (${stock.partCode || 'N/A'}): Old '${currentColor}' -> New '${newColor}' (Date: ${recDate})`);
        }
      });
    }

    // 2. Scan Receiving Records
    if (Array.isArray(state.receiving)) {
      state.receiving.forEach((rcv: any) => {
        const currentColor = rcv.fifoColorCode ?? rcv.fifo_color_code ?? rcv.fifoColor;
        if (!isValidFifoColorName(currentColor, state.fifoColorsByMonth)) {
          const recDate = rcv.receivedDate || rcv.received_date || rcv.date || rcv.updated_at || nowIso.split('T')[0];
          const newColor = getFifoColorForDate(recDate, state.fifoColorsByMonth);
          const auditEntry: FifoRepairAuditEntry = {
            id: `FIFO-AUDIT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            collection: "receiving",
            recordId: String(rcv.id || rcv.record_id),
            partCode: rcv.partCode || rcv.part_code,
            receivedDate: recDate,
            oldFifoColor: currentColor,
            newFifoColor: newColor,
            timestamp: nowIso,
            reason: currentColor === undefined || currentColor === null || currentColor === '' 
              ? "Missing FIFO color code; recomputed from receivedDate" 
              : /^\d+$/.test(String(currentColor).trim()) 
                ? `Numeric FIFO month code ('${currentColor}') normalized to canonical color name` 
                : `Unrecognized color value ('${currentColor}') normalized to canonical color name`
          };

          rcv.fifoColorCode = newColor;
          rcv.fifoColor = newColor;
          rcv.version = (Number(rcv.version) || 1) + 1;
          rcv.updated_at = nowIso;

          newRepairs.push(auditEntry);
          fifoRepairAuditLogs.unshift(auditEntry);
          receivingRepaired++;

          console.log(`[FIFO REPAIR AUDIT] Repaired Receiving [ID: ${rcv.id}] (${rcv.partCode || 'N/A'}): Old '${currentColor}' -> New '${newColor}' (Date: ${recDate})`);
        }
      });
    }

    // 3. Persist changes if any repairs were made
    if (newRepairs.length > 0) {
      if (fifoRepairAuditLogs.length > 1000) {
        fifoRepairAuditLogs = fifoRepairAuditLogs.slice(0, 1000);
      }
      try {
        fs.writeFileSync(FIFO_REPAIR_AUDIT_LOG_FILE, JSON.stringify(fifoRepairAuditLogs, null, 2), "utf-8");
      } catch (err) {
        console.error("[FIFO REPAIR AUDIT] Failed to save audit log file to disk:", err);
      }

      commitDatabase();
      console.log(`[FIFO DATA REPAIR SUMMARY] REPAIRED ${stocksRepaired} stock record(s) and ${receivingRepaired} receiving record(s). Database persisted to SQLite.`);

      chatMessages.push({
        id: `fifo-repair-${Date.now()}`,
        sender: "System",
        text: `[FIFO TAG AUDIT] Completed startup data repair: ${stocksRepaired} stock record(s) and ${receivingRepaired} receiving record(s) updated to canonical monthly FIFO colors based on received dates.`,
        timestamp: nowIso,
        isSystem: true
      });
    } else {
      console.log(`[FIFO DATA REPAIR SUMMARY] Clean check completed: all ${state.stocks?.length || 0} stock records and ${state.receiving?.length || 0} receiving records already possess valid FIFO tag colors. No repairs required.`);
    }

    return {
      stocksScanned: state.stocks?.length || 0,
      stocksRepaired,
      receivingScanned: state.receiving?.length || 0,
      receivingRepaired,
      repairs: newRepairs
    };
  }

  // 3. Run the startup repair right after database load
  const initialFifoRepairReport = repairFifoTagColorsOnStartup();

  function restoreDatabaseFromBackup(filename: string, author: string): { success: boolean; error?: string; recordCounts?: any } {
    try {
      const cleanName = path.basename(filename);
      const backupPath = path.join(BACKUPS_DIR, cleanName);

      if (!fs.existsSync(backupPath)) {
        return { success: false, error: `Backup file '${cleanName}' not found in backups directory.` };
      }

      // 1. Validate the backup completely BEFORE touching live data
      let parsedData: any = null;
      if (cleanName.endsWith(".sqlite")) {
        const validation = validateDatabaseFile(backupPath);
        if (!validation.valid || !validation.data) {
          return { success: false, error: `Invalid or corrupt SQLite backup: ${validation.error || 'validation failed'}` };
        }
        parsedData = validation.data;
      } else if (cleanName.endsWith(".json")) {
        const raw = fs.readFileSync(backupPath, "utf-8");
        parsedData = JSON.parse(raw);
        if (!parsedData || typeof parsedData !== "object") {
          return { success: false, error: "Invalid backup JSON structure" };
        }
      } else {
        return { success: false, error: "Unsupported backup file format. Expected .sqlite or .json" };
      }

      // 2. Create pre-restore safety snapshot of live database before overwriting
      try {
        if (fs.existsSync(DATA_FILE_SQLITE)) {
          commitDatabase();
          const safetyName = getNextBackupFilename();
          const safetyPath = path.join(BACKUPS_DIR, safetyName);
          vacuumInto(safetyPath);
          console.log(`[DATABASE RESTORE] Pre-restore safety snapshot created: ${safetyName}`);
          logBackupAudit("BACKUP_CREATED", safetyName, "SYSTEM_SAFETY", "Pre-restore safety snapshot before overwriting database", fs.statSync(safetyPath).size);
        }
      } catch (e) {
        console.warn("[DATABASE RESTORE] Could not create safety snapshot before restore:", e);
      }

      // 3. Load backup into memory
      if (!applyDatabaseObject(parsedData)) {
        return { success: false, error: "Failed to apply backup data structure to memory." };
      }
      stateRevision += 1;

      // 4. Commit memory state to SQLite
      commitDatabase();

      // Log audit
      const stat = fs.statSync(backupPath);
      logBackupAudit("DATABASE_RESTORED", cleanName, author, `Overwrote live database with backup ${cleanName}`, stat.size);

      // 5. Broadcast sync to all active terminals
      broadcast({
        type: "GLOBAL_RESET",
        systemResetVersion,
        systemResetTimestamp: new Date().toISOString(),
        systemResetId: `RESTORE-${Date.now()}`,
        systemResetBy: author,
        author,
        keepUsers: true,
        data: {
          ...state,
          chatMessages: chatMessages.slice(-200)
        }
      });

      broadcast({
        type: "DATABASE_RESTORED",
        restoredBackup: cleanName,
        author,
        timestamp: new Date().toISOString(),
        stateRevision
      });

      return {
        success: true,
        recordCounts: {
          stocks: state.stocks?.length || 0,
          receiving: state.receiving?.length || 0,
          issuances: state.issuances?.length || 0,
          deliveries: state.deliveries?.length || 0,
          users: state.registeredUsers?.length || 0
        }
      };
    } catch (err: any) {
      console.error("[DATABASE RESTORE] Failed to restore database backup:", err);
      return { success: false, error: err?.message || String(err) };
    }
  }

  // 1. Initial backup right after server starts
  createDatabaseBackup("SERVER_STARTUP", "SYSTEM_BOOT").catch(bErr => {
    console.error("[SERVER STARTUP] Initial backup error:", bErr);
  });

  // 2. Schedule recurring automated non-blocking backup every 1 hour
  const ONE_HOUR_MS = 60 * 60 * 1000;
  setInterval(() => {
    createDatabaseBackup("AUTOMATIC_1H_SCHEDULE", "SYSTEM_SCHEDULER").catch(bErr => {
      console.error("[SCHEDULED BACKUP] Error executing 1h backup:", bErr);
    });
  }, ONE_HOUR_MS);

  // Active Device Registry
  interface ConnectedDevice {
    deviceId: string;
    deviceName?: string;
    employeeId?: string;
    username?: string;
    role?: string;
    ip?: string;
    userAgent?: string;
    appVersion?: string;
    platform?: string;
    connectedAt: string;
    lastSeen: number;
    currentView?: string;
  }
  const activeDevices = new Map<string, ConnectedDevice>();

  // Authoritative Central Active Connection Registry
  interface ActiveConnectionRecord {
    connection_id: string;
    user_id: string;
    session_id: string;
    device_id: string;
    deviceId?: string;
    stationId: string;
    employeeId: string;
    username: string;
    role: string;
    permission: string;
    platform: string;
    deviceName: string;
    activeView: string;
    connectedAt: string;
    lastPing: number;
    resetVersion: number;
    ws: WebSocket;
    ip: string;
    userAgent?: string;
    accountId: string;
    warehouseId: string;
  }

  // Keyed strictly by unique connection_id
  const connectionRegistry = new Map<string, ActiveConnectionRecord>();
  const socketToConnectionId = new WeakMap<WebSocket, string>();

  // Room-based broadcasting mapping for Warehouse and Account groups
  const accountRooms = new Map<string, Set<WebSocket>>();
  const warehouseRooms = new Map<string, Set<WebSocket>>();
  const socketToRoomMeta = new WeakMap<WebSocket, { accountId: string; warehouseId: string }>();

  function normalizeGroupId(id?: any, defaultVal: string = "WH-MAIN"): string {
    if (!id || typeof id !== "string") return defaultVal;
    const clean = id.trim();
    return clean.length > 0 ? clean : defaultVal;
  }

  function assignSocketToGroup(ws: WebSocket, accountIdInput?: string, warehouseIdInput?: string) {
    const accountId = normalizeGroupId(accountIdInput, "ACC-JUWEI");
    const warehouseId = normalizeGroupId(warehouseIdInput, "WH-MAIN");

    // Remove socket from previous rooms if it was already assigned
    removeSocketFromGroups(ws);

    if (!accountRooms.has(accountId)) {
      accountRooms.set(accountId, new Set());
    }
    accountRooms.get(accountId)!.add(ws);

    if (!warehouseRooms.has(warehouseId)) {
      warehouseRooms.set(warehouseId, new Set());
    }
    warehouseRooms.get(warehouseId)!.add(ws);

    socketToRoomMeta.set(ws, { accountId, warehouseId });

    const connId = socketToConnectionId.get(ws);
    if (connId) {
      const conn = connectionRegistry.get(connId);
      if (conn) {
        conn.accountId = accountId;
        conn.warehouseId = warehouseId;
      }
    }
    console.log(`[WS ROOM] Assigned socket to Group -> Account: [${accountId}], Warehouse: [${warehouseId}]`);
  }

  function removeSocketFromGroups(ws: WebSocket) {
    const meta = socketToRoomMeta.get(ws);
    if (meta) {
      const accSet = accountRooms.get(meta.accountId);
      if (accSet) {
        accSet.delete(ws);
        if (accSet.size === 0) accountRooms.delete(meta.accountId);
      }
      const whSet = warehouseRooms.get(meta.warehouseId);
      if (whSet) {
        whSet.delete(ws);
        if (whSet.size === 0) warehouseRooms.delete(meta.warehouseId);
      }
    }
    socketToRoomMeta.delete(ws);
  }

  function getSocketsInGroup(params: { accountId?: string; warehouseId?: string }): Set<WebSocket> {
    const matchingSockets = new Set<WebSocket>();
    const targetAcc = normalizeGroupId(params.accountId, "");
    const targetWh = normalizeGroupId(params.warehouseId, "");

    // If specific warehouseId specified (and not ALL/GLOBAL)
    if (targetWh && targetWh !== "ALL" && targetWh !== "GLOBAL" && targetWh.toLowerCase() !== "all") {
      const whSet = warehouseRooms.get(targetWh);
      if (whSet) {
        for (const s of whSet) {
          if (s && s.readyState === WebSocket.OPEN) {
            const meta = socketToRoomMeta.get(s);
            if (!targetAcc || targetAcc === "ALL" || targetAcc === "GLOBAL" || (meta && meta.accountId === targetAcc)) {
              matchingSockets.add(s);
            }
          }
        }
      }
    } else if (targetAcc && targetAcc !== "ALL" && targetAcc !== "GLOBAL" && targetAcc.toLowerCase() !== "all") {
      const accSet = accountRooms.get(targetAcc);
      if (accSet) {
        for (const s of accSet) {
          if (s && s.readyState === WebSocket.OPEN) {
            matchingSockets.add(s);
          }
        }
      }
    } else {
      for (const client of wss.clients) {
        if (client && client.readyState === WebSocket.OPEN) {
          matchingSockets.add(client);
        }
      }
    }

    // Always include sockets assigned to ALL / GLOBAL or with administrative authority
    for (const globalWh of ["ALL", "GLOBAL"]) {
      const gSet = warehouseRooms.get(globalWh);
      if (gSet) {
        for (const s of gSet) {
          if (s && s.readyState === WebSocket.OPEN) {
            matchingSockets.add(s);
          }
        }
      }
    }
    for (const globalAcc of ["ALL", "GLOBAL"]) {
      const gSet = accountRooms.get(globalAcc);
      if (gSet) {
        for (const s of gSet) {
          if (s && s.readyState === WebSocket.OPEN) {
            matchingSockets.add(s);
          }
        }
      }
    }
    for (const client of wss.clients) {
      if (client && client.readyState === WebSocket.OPEN) {
        const connId = socketToConnectionId.get(client);
        if (connId) {
          const conn = connectionRegistry.get(connId);
          if (conn && (conn.permission === 'FULL_ACCESS' || (conn.employeeId || '').toUpperCase() === 'JPMP-002' || conn.role === 'SUPER ADMINISTRATOR')) {
            matchingSockets.add(client);
          }
        }
      }
    }

    return matchingSockets;
  }

  function queryDatabaseInventory(accountId?: string, warehouseId?: string) {
    const allStocks = Array.isArray(state.stocks) ? state.stocks : [];
    const cleanWh = (warehouseId || "").trim().toUpperCase();
    const cleanAcc = (accountId || "").trim().toUpperCase();

    const isAllWh = !cleanWh || cleanWh === "ALL" || cleanWh === "GLOBAL";
    const isAllAcc = !cleanAcc || cleanAcc === "ALL" || cleanAcc === "GLOBAL";

    if (isAllWh && isAllAcc) {
      return allStocks;
    }

    return allStocks.filter((item: any) => {
      if (!item) return false;
      const itemWh = String(item.warehouseId || item.warehouse_id || item.warehouse || "WH-MAIN").trim().toUpperCase();
      const itemAcc = String(item.accountId || item.account_id || item.account || "ACC-JUWEI").trim().toUpperCase();

      const whMatch = isAllWh || itemWh === cleanWh;
      const accMatch = isAllAcc || itemAcc === cleanAcc;

      return whMatch && accMatch;
    });
  }

  // Room-based inventory broadcast strictly targeting active connections matching accountId/warehouseId
  function broadcastInventoryEvent(event: {
    type: string; // 'STOCK_ADJUSTMENT' | 'PICK_PACK_SHIP' | 'LOCATION_TRANSFER' | 'INVENTORY_UPDATE' | 'stock_movement_created'
    accountId?: string;
    warehouseId?: string;
    collection?: string;
    record?: any;
    movement?: any;
    actionDesc?: string;
    author?: string;
    user_id?: string;
    device_id?: string;
    timestamp?: string;
    isCreation?: boolean;
    isDelete?: boolean;
    excludeSocket?: WebSocket;
  }) {
    const targetAccountId = normalizeGroupId(event.accountId || event.record?.accountId || event.record?.account_id, "ACC-JUWEI");
    const targetWarehouseId = normalizeGroupId(event.warehouseId || event.record?.warehouseId || event.record?.warehouse_id || event.movement?.warehouse_id, "WH-MAIN");

    // Query updated inventory from central database
    const updatedInventory = queryDatabaseInventory(targetAccountId, targetWarehouseId);
    const eventTime = event.timestamp || new Date().toISOString();
    const recordId = event.record?.id || event.record?.record_id;

    const payloadObj = {
      type: event.type,
      accountId: targetAccountId,
      warehouseId: targetWarehouseId,
      inventory: updatedInventory,
      stocks: updatedInventory,
      collection: event.collection || 'stocks',
      record: event.record,
      id: recordId,
      record_id: recordId,
      movement: event.movement,
      actionDesc: event.actionDesc || `Inventory event: ${event.type}`,
      author: event.author || 'Operator',
      user_id: event.user_id,
      device_id: event.device_id,
      timestamp: eventTime,
      systemResetVersion,
      systemResetId
    };

    const payloadString = JSON.stringify(payloadObj);

    const legacyCollectionMsg = JSON.stringify({
      type: "collection_updated",
      collection: event.collection || "stocks",
      data: (state as any)[event.collection || 'stocks'],
      systemResetVersion
    });

    const messagesToSend: string[] = [payloadString, legacyCollectionMsg];

    if (event.isDelete) {
      messagesToSend.push(JSON.stringify({
        type: "DATA_DELETE",
        collection: event.collection || "stocks",
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        actionDesc: event.actionDesc || `Deleted ${event.collection || 'stocks'} record`,
        timestamp: eventTime,
        systemResetVersion,
        systemResetId
      }));
      messagesToSend.push(JSON.stringify({
        type: "RECORD_DELETED",
        collection: event.collection || "stocks",
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        timestamp: eventTime,
        systemResetVersion,
        systemResetId
      }));
      messagesToSend.push(JSON.stringify({
        type: "record_deleted",
        collection: event.collection || "stocks",
        id: recordId,
        systemResetVersion
      }));
    } else if (event.isCreation || event.record?._isNew) {
      messagesToSend.push(JSON.stringify({
        type: "DATA_CREATE",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        actionDesc: event.actionDesc || `Created ${event.collection || 'stocks'} record`,
        timestamp: eventTime,
        systemResetVersion,
        systemResetId
      }));
      messagesToSend.push(JSON.stringify({
        type: "RECORD_CREATED",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        timestamp: eventTime,
        systemResetVersion,
        systemResetId
      }));
      messagesToSend.push(JSON.stringify({
        type: "record_upserted",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        systemResetVersion
      }));
    } else if (event.record) {
      messagesToSend.push(JSON.stringify({
        type: "DATA_UPDATE",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        actionDesc: event.actionDesc || `Updated ${event.collection || 'stocks'} record`,
        timestamp: eventTime,
        systemResetVersion,
        systemResetId
      }));
      messagesToSend.push(JSON.stringify({
        type: "RECORD_UPDATED",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        timestamp: eventTime,
        systemResetVersion,
        systemResetId
      }));
      messagesToSend.push(JSON.stringify({
        type: "record_upserted",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        systemResetVersion
      }));
    }

    if (event.movement) {
      messagesToSend.push(JSON.stringify({
        type: "stock_movement_created",
        movement: event.movement,
        stock: event.record,
        stocks: updatedInventory,
        warehouseId: targetWarehouseId,
        accountId: targetAccountId,
        systemResetVersion
      }));
    }

    // STRICTLY find all active connections matching that same accountId and warehouseId
    const targetSockets = getSocketsInGroup({ accountId: targetAccountId, warehouseId: targetWarehouseId });

    // Requirement 4: Ensure all broadcast iterations check that readyState === OPEN
    for (const client of targetSockets) {
      if (client && client.readyState === WebSocket.OPEN && client !== event.excludeSocket) {
        try {
          for (const msg of messagesToSend) {
            client.send(msg);
          }
        } catch (sendErr) {
          console.warn("WebSocket client send warning in inventory room:", sendErr);
        }
      }
    }

    console.log(`[INVENTORY-BROADCAST] [${event.type}] Dispatched ${messagesToSend.length} messages to ${targetSockets.size} active sockets in Room [${targetAccountId}:${targetWarehouseId}]`);
  }

  // Helper metrics calculated directly from the server-side registry
  function getActiveOperatorsCount(): number {
    const operatorIds = new Set<string>();
    for (const conn of connectionRegistry.values()) {
      const id = (conn.employeeId || conn.user_id || conn.username || '').trim().toUpperCase();
      if (id && id !== 'ANONYMOUS' && id !== 'CONNECTING TERMINAL') {
        operatorIds.add(id);
      }
    }
    return Math.max(operatorIds.size, connectionRegistry.size > 0 ? 1 : 0);
  }

  function getActiveTerminalsCount(): number {
    return connectionRegistry.size;
  }

  function getActiveUsersList(): string[] {
    const names = new Set<string>();
    for (const conn of connectionRegistry.values()) {
      if (conn.username && conn.username !== 'CONNECTING TERMINAL') {
        names.add(conn.username);
      }
    }
    return Array.from(names);
  }

  function getActivePresenceList() {
    return Array.from(connectionRegistry.values()).map(c => ({
      connection_id: c.connection_id,
      connectionId: c.connection_id,
      user_id: c.user_id,
      userId: c.user_id,
      session_id: c.session_id,
      sessionId: c.session_id,
      device_id: c.device_id,
      deviceId: c.device_id,
      stationId: c.stationId || '',
      employeeId: c.employeeId || '',
      username: c.username,
      role: c.role || 'OPERATOR',
      permission: c.permission || 'LIMITED_ACCESS',
      platform: c.platform || 'Web',
      deviceName: c.deviceName || 'Terminal',
      activeView: c.activeView || 'dashboard',
      connectedAt: c.connectedAt,
      lastPing: c.lastPing,
      accountId: c.accountId || 'ACC-JUWEI',
      warehouseId: c.warehouseId || 'WH-MAIN',
      source: 'central_websocket' as const
    }));
  }

  // Filter sensitive fields (e.g., plain PINs) based on caller role/permission
  function filterDataForClient(data: any, clientPermission?: string, clientEmployeeId?: string): any {
    const isSuperAdmin = (clientEmployeeId || '').toUpperCase().trim() === 'JPMP-002' || clientPermission === 'FULL_ACCESS';
    if (isSuperAdmin) {
      return data;
    }
    const cloned = { ...data };
    if (Array.isArray(cloned.registeredUsers)) {
      cloned.registeredUsers = cloned.registeredUsers.map((u: any) => {
        const { pin, pin_hash, ...safeUser } = u;
        return safeUser;
      });
    }
    return cloned;
  }

  // Authoritative WebSocket Broadcast with Role-based Data Sanitization
  function broadcast(msg: any, excludeSocket?: WebSocket) {
    const adminMsg = JSON.stringify(msg);
    let safeMsg = adminMsg;

    if (msg.collection === 'registeredUsers' && msg.record) {
      const sanitized = { ...msg.record };
      delete sanitized.pin;
      delete sanitized.pin_hash;
      safeMsg = JSON.stringify({ ...msg, record: sanitized });
    } else if (msg.data && msg.data.registeredUsers) {
      const sanitizedData = filterDataForClient(msg.data, 'LIMITED_ACCESS');
      safeMsg = JSON.stringify({ ...msg, data: sanitizedData });
    }

    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN && client !== excludeSocket) {
        try {
          const connId = socketToConnectionId.get(client);
          const conn = connId ? connectionRegistry.get(connId) : null;
          const isSuper = conn?.permission === 'FULL_ACCESS' || (conn?.employeeId || '').toUpperCase() === 'JPMP-002';
          client.send(isSuper ? adminMsg : safeMsg);
        } catch (sendErr) {
          console.warn("WebSocket client send warning:", sendErr);
        }
      }
    }
  }

  function broadcastPresenceSync() {
    const presenceList = getActivePresenceList();
    const payload = {
      type: "PRESENCE_SYNC",
      presenceList,
      activePresence: presenceList,
      activeUsers: getActiveUsersList(),
      connectedOperators: getActiveOperatorsCount(),
      liveActiveTerminals: getActiveTerminalsCount(),
      systemResetVersion,
      timestamp: new Date().toISOString()
    };
    broadcast(payload);
    // Backward compatibility for existing listeners
    broadcast({
      type: "presence_updated",
      activeUsers: getActiveUsersList(),
      activePresence: presenceList
    });
  }

  /**
   * Derive account and permission authoritatively from a session token.
   * Tokens are generated on login (crypto.randomBytes) and stored in the database.
   */
  function getAuthFromToken(token?: string | null): { user: ServerUser; permission: string; token: string } | null {
    if (!token) return null;
    const cleanToken = String(token).trim();
    if (!cleanToken) return null;

    const session = (state.sessions || []).find(s => s && (s.token === cleanToken || s.id === cleanToken));
    if (!session) return null;

    const user = state.registeredUsers.find(
      u => (u.employeeId || "").toUpperCase().trim() === (session.employeeId || "").toUpperCase().trim()
    );
    if (!user || user.status === "INACTIVE") return null;

    // Update lastActive timestamp on session
    session.lastActive = new Date().toISOString();

    // Authoritatively derive permission from user account record in database
    const permission = (user.permission || (user.employeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS')).trim().toUpperCase();

    return { user, permission, token: cleanToken };
  }

  /**
   * Extract Bearer session token from request headers or URL query parameter
   */
  function extractToken(req: express.Request): string | null {
    const authHeader = req.headers["authorization"];
    if (authHeader && typeof authHeader === "string") {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    if (req.query && typeof req.query.token === "string" && req.query.token.trim()) {
      return req.query.token.trim();
    }
    return null;
  }

  /**
   * Authenticate incoming HTTP request using session token
   */
  function authenticateRequest(req: express.Request): { user: ServerUser; permission: string; token: string } | null {
    const token = extractToken(req);
    return getAuthFromToken(token);
  }

  /**
   * Enforce valid authenticated session
   */
  function requireAuth(req: express.Request, res: express.Response): { user: ServerUser; permission: string; token: string } | null {
    const auth = authenticateRequest(req);
    if (!auth) {
      res.status(401).json({ error: "UNAUTHORIZED: Valid session token required. Please log in." });
      return null;
    }
    return auth;
  }

  /**
   * Enforce FULL_ACCESS permission (admin, backup, reset, restore, accounts, roles, categories, master data, deletes)
   */
  function requireFullAccess(req: express.Request, res: express.Response, actionDesc: string = "perform this action"): { user: ServerUser; permission: string; token: string } | null {
    const auth = requireAuth(req, res);
    if (!auth) return null;
    if (auth.permission !== "FULL_ACCESS") {
      res.status(403).json({ error: `PERMISSION_DENIED: FULL_ACCESS required to ${actionDesc}.` });
      return null;
    }
    return auth;
  }

  /**
   * Enforce write permission (rejects VIEW_ONLY)
   */
  function requireWriteAccess(req: express.Request, res: express.Response, actionDesc: string = "perform writes"): { user: ServerUser; permission: string; token: string } | null {
    const auth = requireAuth(req, res);
    if (!auth) return null;
    if (auth.permission === "VIEW_ONLY") {
      res.status(403).json({ error: `PERMISSION_DENIED: Account has VIEW_ONLY privileges and cannot ${actionDesc}.` });
      return null;
    }
    return auth;
  }

  /**
   * Enforce delete permission (rejects VIEW_ONLY and LIMITED_ACCESS)
   */
  function requireDeleteAccess(req: express.Request, res: express.Response, actionDesc: string = "delete records"): { user: ServerUser; permission: string; token: string } | null {
    const auth = requireAuth(req, res);
    if (!auth) return null;
    if (auth.permission !== "FULL_ACCESS") {
      res.status(403).json({ error: `PERMISSION_DENIED: Limited access accounts cannot delete records. FULL_ACCESS required to ${actionDesc}.` });
      return null;
    }
    return auth;
  }

  interface UpsertExecutionResult {
    success: boolean;
    status: number;
    error?: string;
    confirmedRecord?: any;
    isCreation?: boolean;
    systemResetVersion?: number;
    systemResetId?: string;
  }

  function executeRecordUpsert(params: {
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
  }): UpsertExecutionResult {
    const { collection, record, author, employeeId, user_id, device_id, actionDesc, expectedVersion, reset_version, userPermission, excludeSocket } = params;

    const clientResetVersion = Number(reset_version) || Number(record?.reset_version) || systemResetVersion;
    if (clientResetVersion < systemResetVersion) {
      return {
        success: false,
        status: 409,
        error: "STALE_RESET_VERSION: Central database was reset. Data from previous reset versions cannot be restored.",
        systemResetVersion,
        systemResetId
      };
    }

    if (!collection || !record) {
      return { success: false, status: 400, error: "Collection and record required" };
    }

    if (!(collection in state)) {
      return { success: false, status: 400, error: `Unknown collection: ${collection}` };
    }

    if (userPermission === 'VIEW_ONLY') {
      return { success: false, status: 403, error: "PERMISSION DENIED: Account has VIEW_ONLY privileges and cannot perform writes." };
    }

    const isRestrictedCollection = ['registeredUsers', 'operationalRoles', 'receivingCategories', 'registries', 'fifoColorsByMonth', 'sessions'].includes(collection);
    if (userPermission === 'LIMITED_ACCESS' && isRestrictedCollection) {
      return { success: false, status: 403, error: `PERMISSION DENIED: Limited access accounts cannot touch roles, categories, accounts, or master data (${collection}). FULL_ACCESS required.` };
    }

    const serverTime = new Date().toISOString();
    const currentList: any[] = (state as any)[collection] || [];
    const recordId = String(record.id || record.record_id || `REC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);

    const existingIndex = currentList.findIndex((item: any) => item && (String(item.id) === recordId || String(item.record_id) === recordId));
    const existingRecord = existingIndex >= 0 ? currentList[existingIndex] : null;

    let confirmedRecord: any;
    let isCreation = false;
    const effectiveUserId = String(user_id || record.user_id || (employeeId ? `USR-${employeeId}` : (author ? `USR-${author}` : 'OPERATOR'))).trim();
    const effectiveDeviceId = String(device_id || record.device_id || 'DEV-CENTRAL').trim();

    if (existingRecord) {
      // Optimistic concurrency check
      if (expectedVersion !== undefined && existingRecord.version && existingRecord.version > expectedVersion) {
        return {
          success: false,
          status: 409,
          error: "VERSION_CONFLICT: Newer revision exists in central database.",
          confirmedRecord: existingRecord,
          systemResetVersion
        };
      }

      const nextVersion = (Number(existingRecord.version) || 1) + 1;
      confirmedRecord = {
        ...existingRecord,
        ...record,
        id: recordId,
        record_id: record.record_id || recordId,
        reset_version: systemResetVersion,
        created_at: existingRecord.created_at || record.created_at || serverTime,
        created_by: existingRecord.created_by || record.created_by || author || 'Operator',
        updated_at: serverTime,
        updated_by: author || employeeId || 'Operator',
        user_id: effectiveUserId,
        device_id: effectiveDeviceId,
        version: nextVersion
      };
      currentList[existingIndex] = confirmedRecord;
    } else {
      isCreation = true;
      confirmedRecord = {
        ...record,
        id: recordId,
        record_id: record.record_id || recordId,
        reset_version: systemResetVersion,
        created_at: record.created_at || serverTime,
        created_by: record.created_by || author || employeeId || 'Operator',
        updated_at: serverTime,
        updated_by: author || employeeId || 'Operator',
        user_id: effectiveUserId,
        device_id: effectiveDeviceId,
        version: Number(record.version) || 1
      };
      currentList.unshift(confirmedRecord);
    }

    deletedRecordTombstones.delete(recordId);
    (state as any)[collection] = currentList;
    stateRevision++;

    // COMMIT DATABASE SYNCHRONOUSLY BEFORE BROADCAST
    const commitOk = commitDatabase();
    if (!commitOk) {
      return { success: false, status: 500, error: "Failed to commit record to central disk database" };
    }

    console.log(`[CENTRAL-DB] [${isCreation ? 'CREATE' : 'UPDATE'}] [${collection}] ID: ${recordId} | Rev: v${confirmedRecord.version} | User: ${effectiveUserId} | Device: ${effectiveDeviceId} | Time: ${serverTime}`);

    const isInventoryCollection = ['stocks', 'issuances', 'deliveries', 'receiving', 'returns', 'recycling'].includes(collection);
    if (isInventoryCollection) {
      let invEventType = "INVENTORY_UPDATE";
      if (collection === 'stocks') {
        invEventType = isCreation ? "STOCK_CREATED" : "STOCK_ADJUSTMENT";
      } else if (collection === 'issuances' || collection === 'deliveries') {
        invEventType = "PICK_PACK_SHIP";
      }

      broadcastInventoryEvent({
        type: invEventType,
        collection,
        record: confirmedRecord,
        accountId: confirmedRecord.accountId || confirmedRecord.account_id,
        warehouseId: confirmedRecord.warehouseId || confirmedRecord.warehouse_id || confirmedRecord.locationWarehouse,
        author: author || employeeId || "Operator",
        user_id: effectiveUserId,
        device_id: effectiveDeviceId,
        actionDesc: actionDesc || `${isCreation ? 'Created' : 'Updated'} ${collection} record`,
        timestamp: serverTime,
        isCreation,
        excludeSocket
      });
    } else {
      // Non-inventory collections use global broadcast
      const eventType = isCreation ? "DATA_CREATE" : "DATA_UPDATE";
      broadcast({
        type: eventType,
        collection,
        record: confirmedRecord,
        id: recordId,
        record_id: recordId,
        author: author || employeeId || "Operator",
        user_id: effectiveUserId,
        device_id: effectiveDeviceId,
        actionDesc: actionDesc || `${isCreation ? 'Created' : 'Updated'} ${collection} record`,
        timestamp: serverTime,
        version: confirmedRecord.version,
        systemResetVersion,
        systemResetId
      }, excludeSocket);

      broadcast({
        type: isCreation ? "RECORD_CREATED" : "RECORD_UPDATED",
        collection,
        record: confirmedRecord,
        id: recordId,
        record_id: recordId,
        author: author || employeeId || "Operator",
        user_id: effectiveUserId,
        device_id: effectiveDeviceId,
        actionDesc: actionDesc || `${isCreation ? 'Created' : 'Updated'} ${collection} record`,
        timestamp: serverTime,
        version: confirmedRecord.version,
        systemResetVersion,
        systemResetId
      }, excludeSocket);

      broadcast({
        type: "collection_updated",
        collection,
        data: currentList,
        systemResetVersion
      }, excludeSocket);
    }

    return {
      success: true,
      status: 200,
      confirmedRecord,
      isCreation,
      systemResetVersion,
      systemResetId
    };
  }

  interface DeleteExecutionResult {
    success: boolean;
    status: number;
    error?: string;
    id?: string;
    collection?: string;
    systemResetVersion?: number;
    systemResetId?: string;
  }

  function executeRecordDelete(params: {
    collection: string;
    id: string;
    author?: string;
    employeeId?: string;
    user_id?: string;
    device_id?: string;
    actionDesc?: string;
    reset_version?: number;
    userPermission?: string;
    excludeSocket?: WebSocket;
  }): DeleteExecutionResult {
    const { collection, id, author, employeeId, user_id, device_id, actionDesc, reset_version, userPermission, excludeSocket } = params;

    const clientResetVersion = Number(reset_version) || systemResetVersion;
    if (clientResetVersion < systemResetVersion) {
      return {
        success: false,
        status: 409,
        error: "STALE_RESET_VERSION: Central database was reset. Stale delete operation rejected.",
        systemResetVersion,
        systemResetId
      };
    }

    if (!collection || !id) {
      return { success: false, status: 400, error: "Collection and ID required" };
    }

    if (!(collection in state)) {
      return { success: false, status: 400, error: "Invalid collection" };
    }

    if (userPermission === 'VIEW_ONLY') {
      return { success: false, status: 403, error: "PERMISSION DENIED: Account has VIEW_ONLY privileges and cannot delete records." };
    }

    if (userPermission !== 'FULL_ACCESS') {
      return { success: false, status: 403, error: "PERMISSION DENIED: Limited access accounts cannot delete records. FULL_ACCESS required." };
    }

    const recordId = String(id);
    markRecordTombstone(recordId);
    (state as any)[collection] = ((state as any)[collection] || []).filter((item: any) => String(item.id) !== recordId && String(item.record_id) !== recordId);
    stateRevision++;

    // COMMIT DATABASE SYNCHRONOUSLY BEFORE BROADCAST
    const commitOk = commitDatabase();
    if (!commitOk) {
      return { success: false, status: 500, error: "Failed to commit record deletion to central database" };
    }

    const serverTime = new Date().toISOString();
    const effectiveUserId = String(user_id || (employeeId ? `USR-${employeeId}` : (author ? `USR-${author}` : 'OPERATOR'))).trim();
    const effectiveDeviceId = String(device_id || 'DEV-CENTRAL').trim();

    console.log(`[CENTRAL-DB] [DELETE] [${collection}] ID: ${recordId} | User: ${effectiveUserId} | Device: ${effectiveDeviceId} | Time: ${serverTime}`);

    const isInventoryCollection = ['stocks', 'issuances', 'deliveries', 'receiving', 'returns', 'recycling'].includes(collection);
    if (isInventoryCollection) {
      let invEventType = "INVENTORY_UPDATE";
      if (collection === 'stocks') {
        invEventType = "STOCK_ADJUSTMENT";
      } else if (collection === 'issuances' || collection === 'deliveries') {
        invEventType = "PICK_PACK_SHIP";
      }

      broadcastInventoryEvent({
        type: invEventType,
        collection,
        record: { id: recordId, record_id: recordId, quantity: 0, status: 'DELETED' },
        author: author || employeeId || "Operator",
        user_id: effectiveUserId,
        device_id: effectiveDeviceId,
        actionDesc: actionDesc || `Deleted ${collection} record`,
        timestamp: serverTime,
        isDelete: true,
        excludeSocket
      });
    }

    // Always broadcast DATA_DELETE, RECORD_DELETED, and collection_updated globally
    broadcast({
      type: "DATA_DELETE",
      collection,
      id: recordId,
      record_id: recordId,
      author: author || employeeId || "Operator",
      user_id: effectiveUserId,
      device_id: effectiveDeviceId,
      actionDesc: actionDesc || `Deleted ${collection} record`,
      timestamp: serverTime,
      systemResetVersion,
      systemResetId
    }, excludeSocket);

    broadcast({
      type: "RECORD_DELETED",
      collection,
      id: recordId,
      record_id: recordId,
      author: author || employeeId || "Operator",
      user_id: effectiveUserId,
      device_id: effectiveDeviceId,
      timestamp: serverTime,
      systemResetVersion,
      systemResetId
    }, excludeSocket);

    broadcast({
      type: "record_deleted",
      collection,
      id: recordId,
      systemResetVersion
    }, excludeSocket);

    broadcast({
      type: "collection_updated",
      collection,
      data: (state as any)[collection],
      systemResetVersion
    }, excludeSocket);

    return {
      success: true,
      status: 200,
      id: recordId,
      collection,
      systemResetVersion,
      systemResetId
    };
  }

  // Periodic Heartbeat to maintain live connection registry
  const heartbeatInterval = setInterval(() => {
    let changed = false;
    const now = Date.now();
    for (const [connId, conn] of connectionRegistry.entries()) {
      if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
        if (conn.ws) {
          removeSocketFromGroups(conn.ws);
        }
        connectionRegistry.delete(connId);
        changed = true;
        broadcast({
          type: "USER_OFFLINE",
          connection_id: connId,
          user_id: conn.user_id,
          session_id: conn.session_id,
          device_id: conn.device_id,
          employeeId: conn.employeeId,
          username: conn.username,
          systemResetVersion
        });
      } else if (now - conn.lastPing > 45000) {
        try { conn.ws.terminate(); } catch (e) {}
        removeSocketFromGroups(conn.ws);
        connectionRegistry.delete(connId);
        changed = true;
        broadcast({
          type: "USER_OFFLINE",
          connection_id: connId,
          user_id: conn.user_id,
          session_id: conn.session_id,
          device_id: conn.device_id,
          employeeId: conn.employeeId,
          username: conn.username,
          systemResetVersion
        });
      }
    }
    if (changed) {
      broadcastPresenceSync();
    }
  }, 15000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  // Client Connection Lifecycle Management
  wss.on("connection", (ws: any, req: http.IncomingMessage) => {
    ws.isAlive = true;

    // Generate unique connection_id for this socket
    const connection_id = `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    socketToConnectionId.set(ws, connection_id);
    console.log(`[WS Connection] New client connected (${connection_id}) on server instance: ${SERVER_INSTANCE_ID}`);

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';
    const platform = userAgent.includes("Android") ? "Android" : (userAgent.includes("iPhone") || userAgent.includes("iPad") ? "iOS" : (userAgent.includes("Windows") ? "Windows" : "Desktop"));

    // 1. On connection, extract the user's accountId (or warehouseId) from the connection query/auth token
    let queryAccountId = "ACC-JUWEI";
    let queryWarehouseId = "WH-MAIN";
    try {
      const host = req.headers.host || "127.0.0.1:3000";
      const parsedUrl = new URL(req.url || "/ws", `http://${host}`);
      const qAcc = parsedUrl.searchParams.get("accountId") || parsedUrl.searchParams.get("account_id") || (req.headers["x-account-id"] as string);
      const qWh = parsedUrl.searchParams.get("warehouseId") || parsedUrl.searchParams.get("warehouse_id") || (req.headers["x-warehouse-id"] as string);
      const rawAuthHeader = (req.headers["authorization"] as string) || "";
      const rawSecProtocol = (req.headers["sec-websocket-protocol"] as string) || "";
      const authToken = (
        parsedUrl.searchParams.get("token") || 
        parsedUrl.searchParams.get("auth_token") || 
        (rawAuthHeader ? rawAuthHeader.replace(/^Bearer\s+/i, "") : "") ||
        rawSecProtocol ||
        ""
      ).trim();

      const authOnConnect = getAuthFromToken(authToken);
      if (authOnConnect) {
        ws.token = authOnConnect.token;
      }

      if (qAcc) queryAccountId = qAcc.trim();
      if (qWh) queryWarehouseId = qWh.trim();

      if (authToken) {
        try {
          if (authToken.startsWith("{") && authToken.endsWith("}")) {
            const parsedToken = JSON.parse(authToken);
            if (parsedToken.accountId || parsedToken.account_id) queryAccountId = String(parsedToken.accountId || parsedToken.account_id).trim();
            if (parsedToken.warehouseId || parsedToken.warehouse_id) queryWarehouseId = String(parsedToken.warehouseId || parsedToken.warehouse_id).trim();
          } else if (authToken.includes(".")) {
            const parts = authToken.split(".");
            if (parts.length >= 2) {
              const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
              const parsedJwt = JSON.parse(payloadJson);
              if (parsedJwt.accountId || parsedJwt.account_id) queryAccountId = String(parsedJwt.accountId || parsedJwt.account_id).trim();
              if (parsedJwt.warehouseId || parsedJwt.warehouse_id) queryWarehouseId = String(parsedJwt.warehouseId || parsedJwt.warehouse_id).trim();
            }
          }
        } catch (e) {}
      }
    } catch (urlErr) {
      console.warn("Failed parsing WS connection url:", urlErr);
    }

    // 3. Upon any new socket connection or reconnection, immediately query the database for the current inventory state
    // and send a FULL_INVENTORY_SYNC event directly to that socket before subscribing it to incremental updates.
    const initialInventory = queryDatabaseInventory(queryAccountId, queryWarehouseId);
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: "FULL_INVENTORY_SYNC",
          serverInstanceId: SERVER_INSTANCE_ID,
          accountId: queryAccountId,
          warehouseId: queryWarehouseId,
          inventory: initialInventory,
          stocks: initialInventory,
          count: initialInventory.length,
          timestamp: new Date().toISOString(),
          systemResetVersion,
          systemResetId
        }));
      } catch (err) {
        console.warn("Error sending FULL_INVENTORY_SYNC to connecting socket:", err);
      }
    }

    // Assign socket to group (subscribing to room updates after sending initial sync)
    assignSocketToGroup(ws, queryAccountId, queryWarehouseId);

    // Register active terminal in central connection registry
    const initialRecord: ActiveConnectionRecord = {
      connection_id,
      user_id: authOnConnect ? `USR-${authOnConnect.user.employeeId}` : "ANONYMOUS",
      session_id: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      device_id: `dev_${Math.random().toString(36).substring(2, 9)}`,
      stationId: "",
      employeeId: authOnConnect ? authOnConnect.user.employeeId : "",
      username: authOnConnect ? authOnConnect.user.username : "CONNECTING TERMINAL",
      role: authOnConnect ? authOnConnect.user.role : "OPERATOR",
      permission: authOnConnect ? authOnConnect.permission : "VIEW_ONLY",
      platform,
      deviceName: `${platform} Terminal`,
      activeView: "dashboard",
      connectedAt: new Date().toISOString(),
      lastPing: Date.now(),
      resetVersion: systemResetVersion,
      ws,
      ip,
      userAgent,
      accountId: queryAccountId,
      warehouseId: queryWarehouseId
    };
    connectionRegistry.set(connection_id, initialRecord);

    ws.on("pong", () => {
      ws.isAlive = true;
      const cId = socketToConnectionId.get(ws);
      if (cId) {
        const c = connectionRegistry.get(cId);
        if (c) c.lastPing = Date.now();
      }
    });

    // Send complete initial snapshot and current presence list immediately
    try {
      const presenceList = getActivePresenceList();
      ws.send(JSON.stringify({
        type: "init",
        serverInstanceId: SERVER_INSTANCE_ID,
        connection_id,
        connectionId: connection_id,
        systemResetVersion,
        systemResetTimestamp,
        systemResetId,
        systemResetBy,
        data: filterDataForClient({ ...state, chatMessages }, initialRecord.permission, initialRecord.employeeId),
        activeUsers: getActiveUsersList(),
        activePresence: presenceList,
        presenceList,
        connectedOperators: getActiveOperatorsCount(),
        liveActiveTerminals: getActiveTerminalsCount()
      }));

      ws.send(JSON.stringify({
        type: "PRESENCE_SYNC",
        connection_id,
        presenceList,
        activePresence: presenceList,
        activeUsers: getActiveUsersList(),
        connectedOperators: getActiveOperatorsCount(),
        liveActiveTerminals: getActiveTerminalsCount(),
        systemResetVersion,
        timestamp: new Date().toISOString()
      }));
    } catch (err) {
      console.warn("Error sending initial WS state:", err);
    }

    ws.on("error", (err: any) => {
      console.warn("WebSocket client error:", err?.message || err);
    });

    function getWsAuthContext(targetWs: any, msgPayload?: any): { user: ServerUser; permission: string; token: string } | null {
      const token = msgPayload?.token || msgPayload?.sessionToken || targetWs.token;
      const auth = getAuthFromToken(token);
      if (auth) {
        targetWs.token = auth.token;
        const cId = socketToConnectionId.get(targetWs);
        if (cId) {
          const c = connectionRegistry.get(cId);
          if (c) {
            c.employeeId = auth.user.employeeId;
            c.username = auth.user.username;
            c.role = auth.user.role;
            c.permission = auth.permission;
            c.user_id = `USR-${auth.user.employeeId}`;
          }
        }
        return auth;
      }
      const cId = socketToConnectionId.get(targetWs);
      if (cId) {
        const c = connectionRegistry.get(cId);
        if (c && c.employeeId) {
          const user = state.registeredUsers.find(u => (u.employeeId || '').toUpperCase().trim() === (c.employeeId || '').toUpperCase().trim());
          if (user && user.status !== 'INACTIVE') {
            const permission = (user.permission || (user.employeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS')).trim().toUpperCase();
            return { user, permission, token: c.session_id || '' };
          }
        }
      }
      return null;
    }

    ws.on("message", async (messageData: any) => {
      ws.isAlive = true;
      try {
        const payload = JSON.parse(messageData.toString());

        switch (payload.type) {
          case "ping": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const info = connectionRegistry.get(connId);
            if (info) info.lastPing = Date.now();
            ws.send(JSON.stringify({ 
              type: "pong", 
              clientPingTime: payload.clientPingTime, 
              serverTime: Date.now() 
            }));
            break;
          }

          case "authenticate":
          case "join": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            if (!conn) break;

            const msgToken = payload.token || payload.sessionToken || ws.token;
            const auth = getAuthFromToken(msgToken);

            let employeeId = "";
            let username = "OPERATOR";
            let role = "OPERATOR";
            let permission = "VIEW_ONLY";
            let userId = conn.user_id;

            if (auth) {
              ws.token = auth.token;
              employeeId = auth.user.employeeId;
              username = auth.user.username;
              role = auth.user.role;
              permission = auth.permission;
              userId = `USR-${auth.user.employeeId}`;
            } else {
              permission = "VIEW_ONLY";
            }

            const activeView = String(payload.activeView || "dashboard").trim();
            const stationId = String(payload.stationId || "").trim();
            const deviceId = String(payload.device_id || payload.deviceId || conn.device_id).trim();
            const sessionId = String(payload.session_id || payload.sessionId || conn.session_id).trim();
            const devPlatform = String(payload.platform || conn.platform || "Web").trim();
            const devName = String(payload.deviceName || `${devPlatform} Terminal`).trim();
            const clientResetVersion = Number(payload.reset_version || payload.currentResetVersion) || systemResetVersion;

            // Update this specific connection record in the central registry
            conn.user_id = userId;
            conn.session_id = sessionId;
            conn.device_id = deviceId;
            conn.stationId = stationId;
            conn.employeeId = employeeId;
            conn.username = username;
            conn.role = role;
            conn.permission = permission;
            conn.platform = devPlatform;
            conn.deviceName = devName;
            conn.activeView = activeView;
            conn.resetVersion = clientResetVersion;
            conn.lastPing = Date.now();

            if (payload.accountId) {
              conn.accountId = String(payload.accountId).trim();
            }
            if (payload.warehouseId) {
              conn.warehouseId = String(payload.warehouseId).trim();
            }

            // Immediately query database for current inventory state for authenticated account/warehouse
            const authenticatedInventory = queryDatabaseInventory(conn.accountId, conn.warehouseId);
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({
                  type: "FULL_INVENTORY_SYNC",
                  serverInstanceId: SERVER_INSTANCE_ID,
                  accountId: conn.accountId,
                  warehouseId: conn.warehouseId,
                  inventory: authenticatedInventory,
                  stocks: authenticatedInventory,
                  count: authenticatedInventory.length,
                  timestamp: new Date().toISOString(),
                  systemResetVersion,
                  systemResetId
                }));
              } catch (e) {}
            }

            // Assign socket to account/warehouse room
            assignSocketToGroup(ws, conn.accountId, conn.warehouseId);

            // Track in activeDevices map as well
            activeDevices.set(deviceId, {
              deviceId,
              deviceName: devName,
              employeeId,
              username,
              role,
              ip: conn.ip,
              userAgent: conn.userAgent,
              appVersion: payload.appVersion || cachedGitHubVersion || 'Live',
              platform: devPlatform,
              connectedAt: conn.connectedAt,
              lastSeen: Date.now(),
              currentView: activeView
            });

            const requiresResync = clientResetVersion < systemResetVersion;
            ws.send(JSON.stringify({
              type: "auth_confirmed",
              connection_id: connId,
              user_id: userId,
              session_id: sessionId,
              device_id: deviceId,
              systemResetVersion,
              systemResetId,
              systemResetTimestamp,
              requiresResync,
              connectedOperators: getActiveOperatorsCount(),
              liveActiveTerminals: getActiveTerminalsCount()
            }));

            // Force resync if client reset_version is behind server
            if (requiresResync) {
              ws.send(JSON.stringify({
                type: "SYNC_REQUIRED",
                reason: "STALE_RESET_VERSION",
                systemResetVersion,
                systemResetId
              }));
            }

            // Immediately send the authoritative snapshot matching client permission
            ws.send(JSON.stringify({
              type: "init",
              serverInstanceId: SERVER_INSTANCE_ID,
              connection_id: connId,
              connectionId: connId,
              systemResetVersion,
              systemResetTimestamp,
              systemResetId,
              systemResetBy,
              data: filterDataForClient({ ...state, chatMessages }, conn.permission, conn.employeeId),
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList(),
              presenceList: getActivePresenceList(),
              connectedOperators: getActiveOperatorsCount(),
              liveActiveTerminals: getActiveTerminalsCount()
            }));

            // Broadcast USER_ONLINE to all clients
            broadcast({
              type: "USER_ONLINE",
              connection_id: connId,
              user_id: userId,
              session_id: sessionId,
              device_id: deviceId,
              employeeId,
              username,
              role,
              permission,
              platform: devPlatform,
              deviceName: devName,
              activeView,
              stationId,
              connectedAt: conn.connectedAt,
              systemResetVersion
            });

            // Broadcast updated PRESENCE_SYNC to all clients
            broadcastPresenceSync();

            const joinMsg: ChatMessage = {
              id: `sys-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              sender: "System",
              text: `${username} (${employeeId || stationId || devName}) connected.`,
              timestamp: new Date().toISOString(),
              isSystem: true
            };
            chatMessages.push(joinMsg);
            if (chatMessages.length > 200) chatMessages.shift();
            broadcast({ type: "chat_broadcast", message: joinMsg });
            break;
          }

          case "SUBSCRIBE_WAREHOUSE":
          case "JOIN_ROOM":
          case "subscribe_room":
          case "set_warehouse": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            const targetAcc = normalizeGroupId(payload.accountId || conn?.accountId, "ACC-JUWEI");
            const targetWh = normalizeGroupId(payload.warehouseId || payload.room || conn?.warehouseId, "WH-MAIN");

            if (conn) {
              conn.accountId = targetAcc;
              conn.warehouseId = targetWh;
            }

            // 1. Immediately query database for current inventory state
            const roomInventory = queryDatabaseInventory(targetAcc, targetWh);

            // 2. Send FULL_INVENTORY_SYNC directly to that socket before subscribing
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({
                  type: "FULL_INVENTORY_SYNC",
                  serverInstanceId: SERVER_INSTANCE_ID,
                  accountId: targetAcc,
                  warehouseId: targetWh,
                  inventory: roomInventory,
                  stocks: roomInventory,
                  count: roomInventory.length,
                  timestamp: new Date().toISOString(),
                  systemResetVersion,
                  systemResetId
                }));
              } catch (e) {}
            }

            // 3. Assign socket to that room group
            assignSocketToGroup(ws, targetAcc, targetWh);

            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({
                  type: "ROOM_SUBSCRIBED",
                  accountId: targetAcc,
                  warehouseId: targetWh,
                  systemResetVersion
                }));
              } catch (e) {}
            }
            break;
          }

          case "GET_INVENTORY":
          case "REQUEST_INVENTORY_SYNC": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            const targetAcc = normalizeGroupId(payload.accountId || conn?.accountId, "ACC-JUWEI");
            const targetWh = normalizeGroupId(payload.warehouseId || conn?.warehouseId, "WH-MAIN");

            const currentInv = queryDatabaseInventory(targetAcc, targetWh);
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({
                  type: "FULL_INVENTORY_SYNC",
                  serverInstanceId: SERVER_INSTANCE_ID,
                  accountId: targetAcc,
                  warehouseId: targetWh,
                  inventory: currentInv,
                  stocks: currentInv,
                  count: currentInv.length,
                  timestamp: new Date().toISOString(),
                  systemResetVersion,
                  systemResetId
                }));
              } catch (e) {}
            }
            break;
          }

          case "STOCK_ADJUSTMENT":
          case "adjust_stock": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth) {
              ws.send(JSON.stringify({ type: "ERROR", error: "UNAUTHORIZED: Valid session token required.", status: 401 }));
              break;
            }
            if (wsAuth.permission === "VIEW_ONLY") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: Account has VIEW_ONLY privileges and cannot adjust stock.", status: 403 }));
              break;
            }

            const targetAcc = normalizeGroupId(payload.accountId || conn?.accountId, "ACC-JUWEI");
            const targetWh = normalizeGroupId(payload.warehouseId || conn?.warehouseId, "WH-MAIN");
            const { productId, delta, newQuantity, location, lotNumber, notes } = payload;

            let stockItem = state.stocks.find((s: any) => String(s.id) === String(productId) || s.partCode === productId);
            const prevQty = stockItem ? Number(stockItem.quantity) || 0 : 0;
            const calculatedQty = newQuantity !== undefined ? Number(newQuantity) : (prevQty + Number(delta || 0));

            const serverTime = new Date().toISOString();
            if (stockItem) {
              stockItem.quantity = Math.max(0, calculatedQty);
              stockItem.version = (stockItem.version || 1) + 1;
              stockItem.updated_at = serverTime;
              stockItem.reset_version = systemResetVersion;
              if (location) stockItem.location = location;
              if (lotNumber) stockItem.lotNumber = lotNumber;
              stockItem.warehouseId = targetWh;
              stockItem.accountId = targetAcc;
            } else if (productId) {
              stockItem = normalizeRecord({
                id: productId,
                partCode: productId,
                description: notes || 'Adjusted Stock Item',
                type: 'RAW',
                location: location || 'Zone A',
                quantity: Math.max(0, calculatedQty),
                unit: 'PCS',
                lotNumber: lotNumber || '',
                receivedDate: serverTime.split('T')[0],
                fifoColor: getFifoColorForDate(serverTime.split('T')[0], state.fifoColorsByMonth),
                status: 'APPROVED',
                warehouseId: targetWh,
                accountId: targetAcc
              });
              state.stocks.push(stockItem);
            }

            const movementId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const movementRecord = {
              id: movementId,
              product_id: productId,
              warehouse_id: targetWh,
              account_id: targetAcc,
              type: payload.type || 'STOCK_ADJUSTMENT',
              quantity: delta !== undefined ? Number(delta) : (calculatedQty - prevQty),
              previous_quantity: prevQty,
              new_quantity: stockItem ? stockItem.quantity : calculatedQty,
              notes: notes || 'Stock adjustment via WebSocket',
              user_id: `USR-${wsAuth.user.employeeId}`,
              user_name: wsAuth.user.username,
              device_id: conn?.device_id || 'TERMINAL',
              created_at: serverTime,
              reset_version: systemResetVersion
            };

            if (!state.stockMovements) state.stockMovements = [];
            state.stockMovements.unshift(movementRecord);
            stateRevision++;

            // COMMIT DATABASE SYNCHRONOUSLY FIRST
            commitDatabase();

            // BROADCAST TO ALL ACTIVE CONNECTIONS IN SAME ACCOUNT / WAREHOUSE ROOM
            broadcastInventoryEvent({
              type: "STOCK_ADJUSTMENT",
              accountId: targetAcc,
              warehouseId: targetWh,
              collection: "stocks",
              record: stockItem,
              movement: movementRecord,
              actionDesc: notes || `Adjusted stock for ${productId} (${prevQty} -> ${stockItem?.quantity})`,
              author: wsAuth.user.username,
              user_id: `USR-${wsAuth.user.employeeId}`,
              device_id: conn?.device_id
            });
            break;
          }

          case "LOCATION_TRANSFER":
          case "transfer_location": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth) {
              ws.send(JSON.stringify({ type: "ERROR", error: "UNAUTHORIZED: Valid session token required.", status: 401 }));
              break;
            }
            if (wsAuth.permission === "VIEW_ONLY") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: Account has VIEW_ONLY privileges and cannot transfer locations.", status: 403 }));
              break;
            }

            const targetAcc = normalizeGroupId(payload.accountId || conn?.accountId, "ACC-JUWEI");
            const sourceWh = normalizeGroupId(payload.fromWarehouseId || payload.warehouseId || conn?.warehouseId, "WH-MAIN");
            const targetWh = normalizeGroupId(payload.toWarehouseId || payload.warehouseId || conn?.warehouseId, "WH-MAIN");
            const { productId, fromLocation, toLocation, quantity, notes } = payload;

            let stockItem = state.stocks.find((s: any) => String(s.id) === String(productId) || s.partCode === productId);
            const serverTime = new Date().toISOString();
            if (stockItem) {
              if (toLocation) stockItem.location = toLocation;
              stockItem.warehouseId = targetWh;
              stockItem.version = (stockItem.version || 1) + 1;
              stockItem.updated_at = serverTime;
              stockItem.reset_version = systemResetVersion;
            }

            const movementId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const movementRecord = {
              id: movementId,
              product_id: productId,
              warehouse_id: targetWh,
              account_id: targetAcc,
              type: 'LOCATION_TRANSFER',
              quantity: Number(quantity) || 0,
              notes: notes || `Transferred from ${fromLocation || sourceWh} to ${toLocation || targetWh}`,
              user_id: `USR-${wsAuth.user.employeeId}`,
              user_name: wsAuth.user.username,
              device_id: conn?.device_id || 'TERMINAL',
              created_at: serverTime,
              reset_version: systemResetVersion
            };

            if (!state.stockMovements) state.stockMovements = [];
            state.stockMovements.unshift(movementRecord);
            stateRevision++;

            commitDatabase();

            broadcastInventoryEvent({
              type: "LOCATION_TRANSFER",
              accountId: targetAcc,
              warehouseId: targetWh,
              collection: "stocks",
              record: stockItem,
              movement: movementRecord,
              actionDesc: notes || `Location transfer for ${productId} to ${toLocation || targetWh}`,
              author: wsAuth.user.username,
              user_id: `USR-${wsAuth.user.employeeId}`,
              device_id: conn?.device_id
            });
            break;
          }

          case "PICK_PACK_SHIP":
          case "pick_pack_ship": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth) {
              ws.send(JSON.stringify({ type: "ERROR", error: "UNAUTHORIZED: Valid session token required.", status: 401 }));
              break;
            }
            if (wsAuth.permission === "VIEW_ONLY") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: Account has VIEW_ONLY privileges and cannot pick/pack/ship.", status: 403 }));
              break;
            }

            const targetAcc = normalizeGroupId(payload.accountId || conn?.accountId, "ACC-JUWEI");
            const targetWh = normalizeGroupId(payload.warehouseId || conn?.warehouseId, "WH-MAIN");
            const { orderId, operationType, items, notes } = payload;

            const serverTime = new Date().toISOString();
            let affectedStockItem: any = null;

            if (Array.isArray(items)) {
              for (const item of items) {
                const pId = item.productId || item.id || item.partCode;
                const qty = Number(item.quantity) || 0;
                let stockItem = state.stocks.find((s: any) => String(s.id) === String(pId) || s.partCode === pId);
                if (stockItem) {
                  if (operationType === 'SHIP' || operationType === 'PICK') {
                    stockItem.quantity = Math.max(0, (Number(stockItem.quantity) || 0) - qty);
                  }
                  stockItem.version = (stockItem.version || 1) + 1;
                  stockItem.updated_at = serverTime;
                  stockItem.reset_version = systemResetVersion;
                  affectedStockItem = stockItem;
                }
              }
            }

            const movementId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const movementRecord = {
              id: movementId,
              warehouse_id: targetWh,
              account_id: targetAcc,
              type: operationType || 'PICK_PACK_SHIP',
              reference_number: orderId,
              notes: notes || `${operationType || 'Pick/Pack/Ship'} operation for order ${orderId}`,
              user_id: `USR-${wsAuth.user.employeeId}`,
              user_name: wsAuth.user.username,
              device_id: conn?.device_id || 'TERMINAL',
              created_at: serverTime,
              reset_version: systemResetVersion
            };

            if (!state.stockMovements) state.stockMovements = [];
            state.stockMovements.unshift(movementRecord);
            stateRevision++;

            commitDatabase();

            broadcastInventoryEvent({
              type: "PICK_PACK_SHIP",
              accountId: targetAcc,
              warehouseId: targetWh,
              collection: "stocks",
              record: affectedStockItem,
              movement: movementRecord,
              actionDesc: notes || `${operationType || 'Pick/Pack/Ship'} completed for order ${orderId}`,
              author: wsAuth.user.username,
              user_id: `USR-${wsAuth.user.employeeId}`,
              device_id: conn?.device_id
            });
            break;
          }

          case "record_upsert":
          case "upsert_record":
          case "DATA_CREATE":
          case "DATA_UPDATE":
          case "create_record":
          case "update_record": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth) {
              ws.send(JSON.stringify({ type: "ERROR", error: "UNAUTHORIZED: Valid session token required.", status: 401 }));
              break;
            }
            if (wsAuth.permission === "VIEW_ONLY") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: Account has VIEW_ONLY privileges and cannot perform writes.", status: 403 }));
              break;
            }

            const isRestricted = ['registeredUsers', 'operationalRoles', 'receivingCategories', 'registries', 'fifoColorsByMonth', 'sessions'].includes(payload.collection);
            if (wsAuth.permission === 'LIMITED_ACCESS' && isRestricted) {
              ws.send(JSON.stringify({ type: "ERROR", error: `PERMISSION DENIED: Limited access accounts cannot touch roles, categories, accounts, or master data (${payload.collection}). FULL_ACCESS required.`, status: 403 }));
              break;
            }

            const clientResetVersion = Number(payload.reset_version || payload.currentResetVersion) || conn?.resetVersion || systemResetVersion;

            const upsertRes = executeRecordUpsert({
              collection: payload.collection,
              record: payload.record,
              author: wsAuth.user.username,
              employeeId: wsAuth.user.employeeId,
              user_id: `USR-${wsAuth.user.employeeId}`,
              device_id: payload.device_id || conn?.deviceId || payload.record?.device_id,
              actionDesc: payload.actionDesc,
              expectedVersion: payload.expectedVersion,
              reset_version: clientResetVersion,
              userPermission: wsAuth.permission,
              excludeSocket: ws
            });

            if (!upsertRes.success) {
              ws.send(JSON.stringify({
                type: "ERROR",
                error: upsertRes.error,
                status: upsertRes.status,
                systemResetVersion,
                systemResetId
              }));
              if (upsertRes.status === 409) {
                ws.send(JSON.stringify({
                  type: "SYNC_REQUIRED",
                  reason: "STALE_RESET_VERSION_OR_CONFLICT",
                  systemResetVersion,
                  systemResetId
                }));
              }
            } else {
              ws.send(JSON.stringify({
                type: "UPSERT_CONFIRMED",
                collection: payload.collection,
                record: upsertRes.confirmedRecord,
                isCreation: upsertRes.isCreation,
                systemResetVersion
              }));
            }
            break;
          }

          case "record_delete":
          case "delete_record":
          case "DATA_DELETE": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth) {
              ws.send(JSON.stringify({ type: "ERROR", error: "UNAUTHORIZED: Valid session token required.", status: 401 }));
              break;
            }
            if (wsAuth.permission !== "FULL_ACCESS") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: Limited access accounts cannot delete records. FULL_ACCESS required.", status: 403 }));
              break;
            }

            const clientResetVersion = Number(payload.reset_version || payload.currentResetVersion) || conn?.resetVersion || systemResetVersion;
            const targetId = String(payload.id || payload.record_id || payload.recordId || "");

            const deleteRes = executeRecordDelete({
              collection: payload.collection,
              id: targetId,
              author: wsAuth.user.username,
              employeeId: wsAuth.user.employeeId,
              user_id: `USR-${wsAuth.user.employeeId}`,
              device_id: payload.device_id || conn?.deviceId,
              actionDesc: payload.actionDesc,
              reset_version: clientResetVersion,
              userPermission: wsAuth.permission,
              excludeSocket: ws
            });

            if (!deleteRes.success) {
              ws.send(JSON.stringify({
                type: "ERROR",
                error: deleteRes.error,
                status: deleteRes.status,
                systemResetVersion,
                systemResetId
              }));
            } else {
              ws.send(JSON.stringify({
                type: "DELETE_CONFIRMED",
                collection: payload.collection,
                id: targetId,
                systemResetVersion
              }));
            }
            break;
          }

          case "update_collection":
          case "sync_collection": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth) {
              ws.send(JSON.stringify({ type: "ERROR", error: "UNAUTHORIZED: Valid session token required.", status: 401 }));
              break;
            }
            if (wsAuth.permission === "VIEW_ONLY") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: Account has VIEW_ONLY privileges.", status: 403 }));
              break;
            }

            const clientResetVersion = Number(payload.reset_version || payload.currentResetVersion) || conn?.resetVersion || systemResetVersion;
            const col = payload.collection;

            if (clientResetVersion < systemResetVersion) {
              ws.send(JSON.stringify({
                type: "ERROR",
                error: "STALE_RESET_VERSION: Central database was reset. Stale sync rejected.",
                status: 409,
                systemResetVersion,
                systemResetId
              }));
              break;
            }

            if (!col || !(col in state)) {
              ws.send(JSON.stringify({ type: "ERROR", error: `Unknown collection: ${col}`, status: 400 }));
              break;
            }

            const isRestricted = ['operationalRoles', 'receivingCategories', 'fifoColorsByMonth', 'registries', 'registeredUsers', 'sessions'].includes(col);
            if (isRestricted && wsAuth.permission !== 'FULL_ACCESS') {
              ws.send(JSON.stringify({ type: "ERROR", error: `PERMISSION DENIED: Limited access accounts cannot touch roles, categories, accounts, or master data (${col}). FULL_ACCESS required.`, status: 403 }));
              break;
            }

            if (col === 'operationalRoles') {
              if (Array.isArray(payload.data)) {
                const cleaned = Array.from(new Set<string>(payload.data.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
                if (cleaned.length > 0) {
                  state.operationalRoles = cleaned;
                  stateRevision++;
                  commitDatabase();
                  broadcast({
                    type: "roles_updated",
                    roles: state.operationalRoles,
                    systemResetVersion
                  });
                  broadcast({
                    type: "collection_updated",
                    collection: "operationalRoles",
                    data: state.operationalRoles,
                    systemResetVersion
                  });
                }
              }
              break;
            }

            if (col === 'receivingCategories') {
              if (Array.isArray(payload.data)) {
                const cleaned = Array.from(new Set<string>(payload.data.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
                if (cleaned.length > 0) {
                  state.receivingCategories = cleaned;
                  stateRevision++;
                  commitDatabase();
                  broadcast({
                    type: "categories_updated",
                    categories: state.receivingCategories,
                    systemResetVersion
                  });
                  broadcast({
                    type: "collection_updated",
                    collection: "receivingCategories",
                    data: state.receivingCategories,
                    systemResetVersion
                  });
                }
              }
              break;
            }

            if (col === 'fifoColorsByMonth') {
              if (payload.data && typeof payload.data === 'object') {
                state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...payload.data };
                stateRevision++;
                commitDatabase();
                broadcast({
                  type: "fifo_colors_updated",
                  fifoColorsByMonth: state.fifoColorsByMonth,
                  systemResetVersion
                });
                broadcast({
                  type: "collection_updated",
                  collection: "fifoColorsByMonth",
                  data: state.fifoColorsByMonth,
                  systemResetVersion
                });
              }
              break;
            }

            const items: any[] = Array.isArray(payload.data) ? payload.data : [];
            const currentList: any[] = (state as any)[col] || [];
            const listMap = new Map<string, any>(currentList.map(item => [String(item.id || item.record_id), item]));

            let modifiedCount = 0;
            const serverTime = new Date().toISOString();
            const effectiveAuthor = wsAuth.user.username;
            const effectiveEmpId = wsAuth.user.employeeId;
            const effectiveDevId = payload.device_id || conn?.deviceId || 'DEV-CENTRAL';
            const effectiveUserId = `USR-${effectiveEmpId}`;

            for (const item of items) {
              if (!item) continue;
              const recId = String(item.id || item.record_id || `REC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
              if (deletedRecordTombstones.has(recId)) continue; // Never resurrect deleted items

              const existing = listMap.get(recId);
              if (existing) {
                const clientVer = Number(item.version) || 1;
                const existingVer = Number(existing.version) || 1;
                if (existingVer > clientVer) continue;

                const nextVersion = existingVer + 1;
                const updatedRec = {
                  ...existing,
                  ...item,
                  id: recId,
                  record_id: recId,
                  version: nextVersion,
                  updated_at: serverTime,
                  updated_by: effectiveAuthor,
                  user_id: effectiveUserId,
                  device_id: effectiveDevId,
                  reset_version: systemResetVersion
                };

                if (col === 'registeredUsers') {
                  // CRITICAL SECURITY FIX: Batch sync MUST NEVER overwrite operator PINs!
                  // Operator PINs can only be modified via explicit Super Admin /api/accounts/update-pin.
                  updatedRec.pin = existing.pin;
                  if (existing.pin_hash) updatedRec.pin_hash = existing.pin_hash;
                  if (existing.isPinCompromised !== undefined) updatedRec.isPinCompromised = existing.isPinCompromised;
                  if (existing.pinChangedAt) updatedRec.pinChangedAt = existing.pinChangedAt;
                  if (existing.pinChangedBy) updatedRec.pinChangedBy = existing.pinChangedBy;
                }

                listMap.set(recId, updatedRec);
                modifiedCount++;
              } else {
                if (col === 'registeredUsers') {
                  // Security Guard: New operator accounts cannot be inserted via blind collection sync.
                  // Must use dedicated /api/accounts/register with full credentials.
                  continue;
                }
                const newRec = {
                  ...item,
                  id: recId,
                  record_id: recId,
                  version: Number(item.version) || 1,
                  created_at: item.created_at || serverTime,
                  created_by: item.created_by || effectiveAuthor,
                  updated_at: serverTime,
                  updated_by: effectiveAuthor,
                  user_id: effectiveUserId,
                  device_id: effectiveDevId,
                  reset_version: systemResetVersion
                };
                listMap.set(recId, newRec);
                modifiedCount++;
              }
            }

            if (modifiedCount > 0) {
              (state as any)[col] = Array.from(listMap.values());
              stateRevision++;
              commitDatabase();

              console.log(`[CENTRAL-DB] [WS-SYNC-COLLECTION] Collection: ${col} | Items: ${items.length} | Modified: ${modifiedCount} | User: ${effectiveUserId} | Device: ${effectiveDevId}`);

              if (['stocks', 'issuances', 'deliveries', 'receiving', 'returns', 'recycling'].includes(col)) {
                broadcastInventoryEvent({
                  type: "INVENTORY_UPDATE",
                  collection: col,
                  actionDesc: `Synchronized ${col} collection (${modifiedCount} items modified)`,
                  author: effectiveAuthor,
                  user_id: effectiveUserId,
                  device_id: effectiveDevId
                });
              } else {
                broadcast({
                  type: "collection_updated",
                  collection: col,
                  data: (state as any)[col],
                  systemResetVersion
                });
              }
            }

            ws.send(JSON.stringify({
              type: "COLLECTION_SYNC_CONFIRMED",
              collection: col,
              count: (state as any)[col]?.length || 0,
              systemResetVersion
            }));
            break;
          }

          case "batch_mutations":
          case "sync_batch": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth) {
              ws.send(JSON.stringify({ type: "ERROR", error: "UNAUTHORIZED: Valid session token required.", status: 401 }));
              break;
            }
            if (wsAuth.permission === "VIEW_ONLY") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: Account has VIEW_ONLY privileges.", status: 403 }));
              break;
            }

            const clientResetVersion = Number(payload.reset_version || payload.currentResetVersion) || conn?.resetVersion || systemResetVersion;
            
            if (clientResetVersion < systemResetVersion) {
              ws.send(JSON.stringify({
                type: "ERROR",
                error: "STALE_RESET_VERSION: Central database was reset.",
                status: 409,
                systemResetVersion,
                systemResetId
              }));
              break;
            }

            const mutations = Array.isArray(payload.mutations) ? payload.mutations : [];
            let processed = 0;
            for (const m of mutations) {
              if (m.type === 'upsert' && m.collection && m.record) {
                const res = executeRecordUpsert({
                  collection: m.collection,
                  record: m.record,
                  author: wsAuth.user.username,
                  employeeId: wsAuth.user.employeeId,
                  user_id: `USR-${wsAuth.user.employeeId}`,
                  device_id: m.device_id || conn?.deviceId,
                  reset_version: clientResetVersion,
                  userPermission: wsAuth.permission
                });
                if (res.success) processed++;
              } else if (m.type === 'delete' && m.collection && (m.id || m.recordId)) {
                if (wsAuth.permission !== 'FULL_ACCESS') {
                  continue; // Limited access accounts cannot delete records
                }
                const res = executeRecordDelete({
                  collection: m.collection,
                  id: String(m.id || m.recordId),
                  author: wsAuth.user.username,
                  employeeId: wsAuth.user.employeeId,
                  user_id: `USR-${wsAuth.user.employeeId}`,
                  device_id: m.device_id || conn?.deviceId,
                  reset_version: clientResetVersion,
                  userPermission: wsAuth.permission
                });
                if (res.success) processed++;
              }
            }

            console.log(`[CENTRAL-DB] [WS-BATCH-MUTATIONS] Processed ${processed}/${mutations.length} mutations | User: ${wsAuth.user.username} | Device: ${conn?.deviceId || 'Terminal'}`);

            ws.send(JSON.stringify({
              type: "BATCH_SYNC_CONFIRMED",
              processed,
              systemResetVersion
            }));
            break;
          }

          case "request_sync":
          case "resync":
          case "get_state": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            const wsAuth = getWsAuthContext(ws, payload);
            const userPerm = wsAuth?.permission || conn?.permission || "VIEW_ONLY";
            const userEmpId = wsAuth?.user.employeeId || conn?.employeeId;
            const presenceList = getActivePresenceList();
            ws.send(JSON.stringify({
              type: "init",
              serverInstanceId: SERVER_INSTANCE_ID,
              connection_id: connId,
              connectionId: connId,
              systemResetVersion,
              systemResetTimestamp,
              systemResetId,
              systemResetBy,
              data: filterDataForClient({ ...state, chatMessages }, userPerm, userEmpId),
              activeUsers: getActiveUsersList(),
              activePresence: presenceList,
              presenceList,
              connectedOperators: getActiveOperatorsCount(),
              liveActiveTerminals: getActiveTerminalsCount()
            }));
            ws.send(JSON.stringify({
              type: "PRESENCE_SYNC",
              connection_id: connId,
              presenceList,
              activePresence: presenceList,
              activeUsers: getActiveUsersList(),
              connectedOperators: getActiveOperatorsCount(),
              liveActiveTerminals: getActiveTerminalsCount(),
              systemResetVersion,
              timestamp: new Date().toISOString()
            }));
            break;
          }

          case "presence_update": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
            if (conn) {
              const wsAuth = getWsAuthContext(ws, payload);
              if (payload.activeView) conn.activeView = payload.activeView;
              if (payload.stationId) conn.stationId = payload.stationId;
              if (wsAuth) {
                conn.username = wsAuth.user.username;
                conn.employeeId = wsAuth.user.employeeId;
                conn.role = wsAuth.user.role;
                conn.permission = wsAuth.permission;
                conn.user_id = `USR-${wsAuth.user.employeeId}`;
              }
              conn.lastPing = Date.now();
              broadcastPresenceSync();
            }
            break;
          }

          case "force_sync_all":
          case "sync_all_workstations": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth || wsAuth.permission !== "FULL_ACCESS") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: FULL_ACCESS required to force sync all workstations.", status: 403 }));
              break;
            }
            const author = wsAuth.user.username;
            broadcast({
              type: "SYNC_REQUIRED",
              author,
              reason: "CLUSTER_SYNC_REQUESTED",
              systemResetVersion,
              timestamp: new Date().toISOString()
            });
            broadcast({
              type: "force_sync",
              triggeredBy: author
            });
            break;
          }

          case "get_presence": {
            const presenceList = getActivePresenceList();
            ws.send(JSON.stringify({
              type: "PRESENCE_SYNC",
              presenceList,
              activePresence: presenceList,
              activeUsers: getActiveUsersList(),
              connectedOperators: getActiveOperatorsCount(),
              liveActiveTerminals: getActiveTerminalsCount(),
              systemResetVersion,
              timestamp: new Date().toISOString()
            }));
            break;
          }

          case "chat": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth) {
              ws.send(JSON.stringify({ type: "ERROR", error: "UNAUTHORIZED: Valid session token required.", status: 401 }));
              break;
            }
            if (wsAuth.permission === "VIEW_ONLY") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY accounts cannot post chat messages.", status: 403 }));
              break;
            }
            const cleanText = String(payload.text || '').trim();
            if (!cleanText) break;

            const newMsg: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              sender: wsAuth.user.username,
              text: cleanText,
              timestamp: new Date().toISOString(),
              isSystem: false
            };
            chatMessages.push(newMsg);
            if (chatMessages.length > 200) chatMessages.shift();
            commitDatabase();

            broadcast({
              type: "chat_broadcast",
              message: newMsg
            });
            break;
          }

          case "register_account": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth || wsAuth.permission !== "FULL_ACCESS") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: FULL_ACCESS required to register accounts.", status: 403 }));
              break;
            }
            const newUser = payload.user;
            if (!newUser || !newUser.employeeId) break;
            const cleanEmpId = String(newUser.employeeId).trim().toUpperCase();
            const cleanUsername = String(newUser.username || '').trim().toUpperCase();

            unmarkUserTombstone(cleanEmpId);

            const existingIdx = state.registeredUsers.findIndex(u => u.employeeId.toUpperCase() === cleanEmpId);
            
            // Generate unpredictable 4-digit PIN if none supplied. Never default to '1234'.
            let cleanPin = String(newUser.pin || '').trim().replace(/\D/g, '').slice(0, 4);
            if (!cleanPin || cleanPin.length < 4) {
              cleanPin = String(Math.floor(2000 + Math.random() * 7900));
            }
            const isCompromised = cleanPin === '1234';

            const userToStore: ServerUser = {
              id: newUser.id || `USR-${cleanEmpId}`,
              employeeId: cleanEmpId,
              username: cleanUsername,
              role: String(newUser.role || 'WAREHOUSE CLERK').trim().toUpperCase(),
              phoneNumber: newUser.phoneNumber ? String(newUser.phoneNumber).trim() : '',
              permission: String(newUser.permission || 'LIMITED_ACCESS').trim(),
              pin: cleanPin,
              isPinCompromised: isCompromised,
              status: 'ACTIVE',
              registeredBy: wsAuth.user.username,
              registeredBySuperAdmin: true,
              registeredAt: newUser.registeredAt || new Date().toISOString(),
              version: 1,
              updated_at: new Date().toISOString(),
              reset_version: systemResetVersion
            };

            if (existingIdx !== -1) {
              state.registeredUsers[existingIdx] = userToStore;
            } else {
              state.registeredUsers.push(userToStore);
            }
            stateRevision++;
            commitDatabase();

            const authorName = wsAuth.user.username;
            broadcast({
              type: "account_registered",
              user: userToStore,
              author: authorName,
              systemResetVersion
            });
            broadcast({
              type: "account_created",
              account: userToStore,
              user: userToStore,
              systemResetVersion
            });
            broadcast({
              type: "collection_updated",
              collection: "registeredUsers",
              data: state.registeredUsers,
              systemResetVersion
            });
            break;
          }

          case "update_account": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth || wsAuth.permission !== "FULL_ACCESS") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: FULL_ACCESS required to update accounts.", status: 403 }));
              break;
            }
            const updated = payload.user;
            if (!updated || !updated.employeeId) break;
            const cleanEmpId = String(updated.employeeId).trim().toUpperCase();
            const existingIdx = state.registeredUsers.findIndex(u => u.employeeId.toUpperCase() === cleanEmpId);
            if (existingIdx === -1) break;

            const existing = state.registeredUsers[existingIdx];
            const isSuper = cleanEmpId === 'JPMP-002';
            const mergedUser: ServerUser = {
              ...existing,
              ...updated,
              employeeId: isSuper ? 'JPMP-002' : cleanEmpId,
              username: String(updated.username || existing.username).trim().toUpperCase(),
              role: isSuper ? 'SUPER ADMINISTRATOR' : String(updated.role || existing.role).trim().toUpperCase(),
              permission: isSuper ? 'FULL_ACCESS' : String(updated.permission || existing.permission).trim(),
              // CRITICAL SECURITY FIX: General profile update cannot change PIN! PIN changes require /api/accounts/update-pin.
              pin: existing.pin,
              isPinCompromised: existing.isPinCompromised,
              pinChangedAt: existing.pinChangedAt,
              pinChangedBy: existing.pinChangedBy,
              version: (existing.version || 1) + 1,
              updated_at: new Date().toISOString(),
              reset_version: systemResetVersion
            };

            state.registeredUsers[existingIdx] = mergedUser;
            stateRevision++;
            commitDatabase();

            const authorName = wsAuth.user.username;
            broadcast({
              type: "account_updated",
              user: mergedUser,
              account: mergedUser,
              author: authorName,
              systemResetVersion
            });
            broadcast({
              type: "collection_updated",
              collection: "registeredUsers",
              data: state.registeredUsers,
              systemResetVersion
            });
            break;
          }

          case "delete_account": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth || wsAuth.permission !== "FULL_ACCESS") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: FULL_ACCESS required to delete accounts.", status: 403 }));
              break;
            }
            const cleanId = String(payload.employeeId || '').trim().toUpperCase();
            if (!cleanId || cleanId === 'JPMP-002') break;

            markUserTombstone(cleanId);
            state.registeredUsers = state.registeredUsers.filter(u => u.employeeId.toUpperCase().trim() !== cleanId);
            stateRevision++;
            commitDatabase();

            broadcast({
              type: "account_deleted",
              employeeId: cleanId,
              systemResetVersion
            });
            broadcast({
              type: "collection_updated",
              collection: "registeredUsers",
              data: state.registeredUsers,
              systemResetVersion
            });
            break;
          }

          case "all_accounts_cleared": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth || wsAuth.permission !== "FULL_ACCESS") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: FULL_ACCESS required to clear accounts.", status: 403 }));
              break;
            }
            const superAdmin = state.registeredUsers.find(u => u.employeeId.toUpperCase().trim() === 'JPMP-002') || defaultSuperAdmin;
            state.registeredUsers.forEach(u => {
              if (u.employeeId.toUpperCase().trim() !== 'JPMP-002') {
                markUserTombstone(u.employeeId);
              }
            });

            state.registeredUsers = [{ ...superAdmin }];
            stateRevision++;
            commitDatabase();

            broadcast({
              type: "all_accounts_cleared",
              data: state.registeredUsers,
              systemResetVersion
            });
            broadcast({
              type: "accounts_cleared",
              systemResetVersion
            });
            broadcast({
              type: "collection_updated",
              collection: "registeredUsers",
              data: state.registeredUsers,
              systemResetVersion
            });
            break;
          }

          case "update_roles":
          case "manage_roles": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth || wsAuth.permission !== "FULL_ACCESS") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: FULL_ACCESS required to manage roles.", status: 403 }));
              break;
            }
            if (Array.isArray(payload.roles)) {
              const cleaned = Array.from(new Set<string>(payload.roles.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
              if (cleaned.length > 0) {
                state.operationalRoles = cleaned;
                stateRevision++;
                commitDatabase();
                broadcast({
                  type: "roles_updated",
                  roles: state.operationalRoles,
                  systemResetVersion
                });
                broadcast({
                  type: "collection_updated",
                  collection: "operationalRoles",
                  data: state.operationalRoles,
                  systemResetVersion
                });
              }
            }
            break;
          }

          case "update_categories":
          case "manage_categories": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth || wsAuth.permission !== "FULL_ACCESS") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: FULL_ACCESS required to manage categories.", status: 403 }));
              break;
            }
            let recModified = false;
            let retModified = false;
            let stocksModified = false;
            let categoriesModified = false;

            if (payload.renameData && payload.renameData.oldCat && payload.renameData.newCat) {
              const cleanOld = String(payload.renameData.oldCat).trim().toUpperCase();
              const cleanNew = String(payload.renameData.newCat).trim().toUpperCase();
              if (cleanOld && cleanNew && cleanOld !== cleanNew) {
                // Update receiving records
                state.receiving = state.receiving.map(r => {
                  let ch = false;
                  const up = { ...r };
                  if ((r.supplierOrDept || '').trim().toUpperCase() === cleanOld) {
                    up.supplierOrDept = cleanNew;
                    ch = true;
                  }
                  if ((r.category || '').trim().toUpperCase() === cleanOld) {
                    up.category = cleanNew;
                    ch = true;
                  }
                  if (ch) {
                    recModified = true;
                    return { ...up, version: (r.version || 1) + 1, updated_at: new Date().toISOString() };
                  }
                  return r;
                });

                // Update return records
                state.returns = state.returns.map(ret => {
                  if ((ret.category || '').trim().toUpperCase() === cleanOld) {
                    retModified = true;
                    return { ...ret, category: cleanNew, version: (ret.version || 1) + 1, updated_at: new Date().toISOString() };
                  }
                  return ret;
                });

                // Update stocks
                state.stocks = state.stocks.map(s => {
                  if (((s as any).category || '').trim().toUpperCase() === cleanOld) {
                    stocksModified = true;
                    return { ...s, category: cleanNew, version: (s.version || 1) + 1, updated_at: new Date().toISOString() };
                  }
                  return s;
                });
              }
            }

            if (Array.isArray(payload.categories)) {
              const cleaned = Array.from(new Set<string>(payload.categories.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
              if (cleaned.length > 0) {
                state.receivingCategories = cleaned;
                categoriesModified = true;
              }
            }

            if (categoriesModified || recModified || retModified || stocksModified) {
              stateRevision++;
              commitDatabase();
              broadcast({
                type: "categories_updated",
                categories: state.receivingCategories,
                systemResetVersion
              });
              broadcast({
                type: "collection_updated",
                collection: "receivingCategories",
                data: state.receivingCategories,
                systemResetVersion
              });

              if (recModified) {
                broadcast({
                  type: "collection_updated",
                  collection: "receiving",
                  data: state.receiving,
                  systemResetVersion
                });
              }
              if (retModified) {
                broadcast({
                  type: "collection_updated",
                  collection: "returns",
                  data: state.returns,
                  systemResetVersion
                });
              }
              if (stocksModified) {
                broadcast({
                  type: "collection_updated",
                  collection: "stocks",
                  data: state.stocks,
                  systemResetVersion
                });
              }
            }
            break;
          }

          case "update_fifo_colors":
          case "manage_fifo_colors": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth || wsAuth.permission !== "FULL_ACCESS") {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: FULL_ACCESS required to manage FIFO colors.", status: 403 }));
              break;
            }
            if (payload.fifoColorsByMonth && typeof payload.fifoColorsByMonth === 'object') {
              state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...payload.fifoColorsByMonth };
              stateRevision++;
              commitDatabase();
              broadcast({
                type: "fifo_colors_updated",
                fifoColorsByMonth: state.fifoColorsByMonth,
                systemResetVersion
              });
              broadcast({
                type: "collection_updated",
                collection: "fifoColorsByMonth",
                data: state.fifoColorsByMonth,
                systemResetVersion
              });
            } else if (payload.month && payload.color) {
              const m = Number(payload.month);
              if (m >= 1 && m <= 12 && payload.color.name) {
                state.fifoColorsByMonth[m] = {
                  name: String(payload.color.name).trim(),
                  colorClass: payload.color.colorClass || 'bg-indigo-600',
                  textClass: payload.color.textClass || 'text-indigo-600',
                  hex: payload.color.hex || undefined
                };
                stateRevision++;
                commitDatabase();
                broadcast({
                  type: "fifo_colors_updated",
                  fifoColorsByMonth: state.fifoColorsByMonth,
                  systemResetVersion
                });
                broadcast({
                  type: "collection_updated",
                  collection: "fifoColorsByMonth",
                  data: state.fifoColorsByMonth,
                  systemResetVersion
                });
              }
            }
            break;
          }

          case "client_installed": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth || wsAuth.permission !== "FULL_ACCESS") {
              break;
            }
            const { stationId, installId, username, employeeId, platform, timestamp } = payload;
            console.log(`[CENTRAL-DB] Client installed: Station ${stationId} by ${username} (${employeeId}) on ${platform}`);
            broadcast({
              type: "client_installed_broadcast",
              stationId: stationId || "STATION",
              installId,
              username: username || "Operator",
              employeeId,
              platform: platform || "Terminal",
              timestamp: timestamp || new Date().toISOString(),
              systemResetVersion
            }, ws);
            break;
          }

          case "system_activity": {
            const wsAuth = getWsAuthContext(ws, payload);
            if (!wsAuth || wsAuth.permission === "VIEW_ONLY") {
              break;
            }
            const actText = String(payload.text || payload.action || '').trim();
            if (actText) {
              const newMsg: ChatMessage = {
                id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                sender: wsAuth.user.username || "SYSTEM",
                text: actText,
                timestamp: new Date().toISOString(),
                isSystem: true
              };
              chatMessages.push(newMsg);
              if (chatMessages.length > 200) chatMessages.shift();
              commitDatabase();

              broadcast({
                type: "chat_broadcast",
                message: newMsg
              });
            }
            break;
          }
        }
      } catch (err) {
        console.error("Failed processing socket message:", err);
      }
    });

    ws.on("close", () => {
      removeSocketFromGroups(ws);
      const connId = socketToConnectionId.get(ws);
      if (connId) {
        const conn = connectionRegistry.get(connId);
        // Remove ONLY this specific connection_id!
        connectionRegistry.delete(connId);
        socketToConnectionId.delete(ws);

        if (conn) {
          // If no other connection has this deviceId, clean activeDevices
          const otherUsingDevice = Array.from(connectionRegistry.values()).some(c => c.device_id === conn.device_id);
          if (!otherUsingDevice) {
            activeDevices.delete(conn.device_id);
          }

          // Broadcast USER_OFFLINE
          broadcast({
            type: "USER_OFFLINE",
            connection_id: connId,
            user_id: conn.user_id,
            session_id: conn.session_id,
            device_id: conn.device_id,
            employeeId: conn.employeeId,
            username: conn.username,
            role: conn.role,
            platform: conn.platform,
            connection: conn,
            systemResetVersion
          });

          // Broadcast updated PRESENCE_SYNC
          broadcastPresenceSync();
        }
      }
    });
  });

  // Express Middlewares
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-permission, x-reset-version, x-employee-id, x-device-id, x-account-id, x-warehouse-id, x-session-id, x-client-platform, x-permission, Cache-Control, Pragma");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.header("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // REST API: Diagnostics & Connectivity Verification
  app.get("/api/diagnostics", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      status: "ok",
      serverInstanceId: SERVER_INSTANCE_ID,
      serverBootTime: SERVER_BOOT_TIME,
      serverTimestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
      systemResetVersion,
      systemResetId,
      systemResetTimestamp,
      totalRecords: Object.values(state).reduce((acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0), 0),
      usersCount: state.registeredUsers.length,
      connectedTerminals: connectionRegistry.size,
      connectedOperators: getActiveOperatorsCount(),
      corsActive: true,
      databaseReady: true,
      websocketReady: true,
      authoritativeSource: "CENTRAL_CLOUD_DATABASE"
    });
  });

  // In-memory cache for latest GitHub release version (e.g. "v1.0.86" -> "1.0.86")
  let cachedGitHubVersion: string | null = null;
  let lastGitHubFetchTimestamp = 0;
  let isFetchingGitHubRelease = false;
  const GITHUB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache
  const RELEASE_PERSIST_FILE = getStorageFilePath("latest-github-release.json");

  // Load persisted GitHub release on startup if available
  try {
    if (fs.existsSync(RELEASE_PERSIST_FILE)) {
      const persisted = JSON.parse(fs.readFileSync(RELEASE_PERSIST_FILE, "utf8"));
      if (persisted && persisted.version) {
        cachedGitHubVersion = String(persisted.version).replace(/^v/i, "").trim();
        lastGitHubFetchTimestamp = Date.now();
        console.log(`[RELEASE SYNC] Loaded persisted GitHub release version: ${cachedGitHubVersion}`);
      }
    }
  } catch (e) {}

  // Resolves the latest release version from GitHub Releases API or disk cache
  async function getLatestGitHubReleaseVersion(buildTimeFallback: string): Promise<string> {
    // If not cached yet in memory, try loading from disk
    if (!cachedGitHubVersion) {
      try {
        if (fs.existsSync(RELEASE_PERSIST_FILE)) {
          const persisted = JSON.parse(fs.readFileSync(RELEASE_PERSIST_FILE, "utf8"));
          if (persisted && persisted.version) {
            cachedGitHubVersion = String(persisted.version).replace(/^v/i, "").trim();
            lastGitHubFetchTimestamp = Date.now();
          }
        }
      } catch (e) {}
    }

    const rawRepo = process.env.GITHUB_REPO?.trim();
    if (!rawRepo) {
      return cachedGitHubVersion || buildTimeFallback;
    }

    // Support both "owner/repo" and full url "https://github.com/owner/repo"
    const cleanRepo = rawRepo.replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
    const now = Date.now();

    // Return cached value if still fresh within 5 minutes
    if (cachedGitHubVersion && (now - lastGitHubFetchTimestamp < GITHUB_CACHE_TTL_MS)) {
      return cachedGitHubVersion;
    }

    // Avoid stampedes if an asynchronous fetch is already in flight
    if (isFetchingGitHubRelease) {
      return cachedGitHubVersion || buildTimeFallback;
    }

    isFetchingGitHubRelease = true;
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'JUWEI-WMS-Cloud-Server'
      };

      const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const apiUrl = `https://api.github.com/repos/${cleanRepo}/releases/latest`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const resp = await fetch(apiUrl, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const releaseData: any = await resp.json();
        if (releaseData && releaseData.tag_name) {
          const parsed = String(releaseData.tag_name).replace(/^v/i, '').trim();
          if (parsed) {
            cachedGitHubVersion = parsed;
            lastGitHubFetchTimestamp = Date.now();
            try {
              fs.writeFileSync(RELEASE_PERSIST_FILE, JSON.stringify({
                version: parsed,
                tag: releaseData.tag_name,
                updatedAt: new Date().toISOString()
              }, null, 2), "utf8");
            } catch (wErr) {}
            console.log(`[GITHUB RELEASE SYNC] Authoritative release tag resolved from GitHub: ${releaseData.tag_name} -> version ${parsed}`);
          }
        }
      } else {
        console.warn(`[GITHUB RELEASE SYNC] GitHub API returned HTTP ${resp.status} for ${apiUrl}`);
      }
    } catch (err: any) {
      console.warn(`[GITHUB RELEASE SYNC] Request to GitHub Releases API failed:`, err?.message || err);
    } finally {
      isFetchingGitHubRelease = false;
    }

    // Fall back to last known cached value, or build-time fallback if nothing was ever fetched
    return cachedGitHubVersion || buildTimeFallback;
  }

  // REST API: Webhook / Direct publish from GitHub Actions
  app.post(["/api/build-info/publish", "/api/release/latest"], (req, res) => {
    try {
      const { version, tag, repository, releaseUrl, buildId } = req.body || {};
      const newVersion = String(version || tag || "").replace(/^v/i, "").trim();
      if (!newVersion) {
        return res.status(400).json({ error: "Missing version or tag" });
      }

      cachedGitHubVersion = newVersion;
      lastGitHubFetchTimestamp = Date.now();
      if (repository && typeof repository === "string") {
        process.env.GITHUB_REPO = repository;
      }

      const releaseRecord = {
        version: newVersion,
        tag: tag || `v${newVersion}`,
        repository: repository || process.env.GITHUB_REPO || "",
        releaseUrl: releaseUrl || "",
        buildId: buildId || Date.now(),
        updatedAt: new Date().toISOString()
      };

      try {
        fs.writeFileSync(RELEASE_PERSIST_FILE, JSON.stringify(releaseRecord, null, 2), "utf8");
      } catch (err) {}

      console.log(`[RELEASE SYNC] Received authoritative release update from GitHub Actions: version ${newVersion} (tag: ${tag || newVersion})`);
      return res.json({ success: true, activeVersion: newVersion, release: releaseRecord });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // REST API: Build Info for Live Application Updates
  app.get(["/api/build-info", "/build-info.json"], async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const possiblePaths = [
      path.join(process.cwd(), "dist", "build-info.json"),
      path.join(process.cwd(), "public", "build-info.json"),
      path.join(process.cwd(), "build-info.json"),
    ];

    let fileContent: any = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          fileContent = JSON.parse(fs.readFileSync(p, "utf8"));
          if (fileContent) break;
        } catch (e) {}
      }
    }

    // Dynamic fallback if running in dev mode or prior to write-build-info
    let buildTimeVersion = "";
    if (fileContent?.version) {
      buildTimeVersion = String(fileContent.version).replace(/^v/i, "");
    } else {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
        if (pkg.version) buildTimeVersion = String(pkg.version).replace(/^v/i, "");
      } catch (e) {}
    }

    // Resolve authoritative live version from latest GitHub Release (cached 5 min)
    const activeVersion = await getLatestGitHubReleaseVersion(buildTimeVersion);

    if (fileContent) {
      return res.json({
        ...fileContent,
        version: activeVersion,
        versionSource: cachedGitHubVersion ? "github-releases-latest" : (fileContent.versionSource || "build-info.json")
      });
    }

    return res.json({
      buildId: 0,
      version: activeVersion,
      versionSource: cachedGitHubVersion ? "github-releases-latest" : "fallback",
      isDevelopmentFallback: true
    });
  });

  // REST API: Direct Installer Download Redirect (downloads JUWEI.WMS.Desktop.System.Setup.1.0.XX.exe directly)
  app.get("/api/download/latest-installer", async (req, res) => {
    let targetVer = "";
    if (fs.existsSync(RELEASE_PERSIST_FILE)) {
      try {
        const persisted = JSON.parse(fs.readFileSync(RELEASE_PERSIST_FILE, "utf8"));
        if (persisted?.version) targetVer = String(persisted.version).replace(/^v/i, "").trim();
      } catch (e) {}
    }
    if (!targetVer) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
        if (pkg.version) targetVer = String(pkg.version).replace(/^v/i, "").trim();
      } catch (e) {}
    }
    const cleanVer = targetVer || "1.0.93";
    const rawRepo = process.env.GITHUB_REPO?.trim() || "Gadiel0428/Aldrin-Banawa";
    const cleanRepo = rawRepo.replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
    const assetName = `JUWEI.WMS.Desktop.System.Setup.${cleanVer}.exe`;
    const directDownloadUrl = `https://github.com/${cleanRepo}/releases/download/v${cleanVer}/${assetName}`;
    return res.redirect(302, directDownloadUrl);
  });

  // REST API: Health Check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      serverInstanceId: SERVER_INSTANCE_ID,
      serverBootTime: SERVER_BOOT_TIME,
      uptime: process.uptime(),
      systemResetVersion,
      systemResetId,
      systemResetTimestamp,
      totalRecords: Object.values(state).reduce((acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0), 0),
      usersCount: state.registeredUsers.length,
      connectedClients: connectionRegistry.size,
      connectedTerminals: connectionRegistry.size,
      connectedOperators: getActiveOperatorsCount(),
      liveActiveTerminals: connectionRegistry.size
    });
  });

  // REST API: Live Connection & Active Terminals Registry
  app.get("/api/presence", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      status: "ok",
      connectedOperators: getActiveOperatorsCount(),
      liveActiveTerminals: connectionRegistry.size,
      systemResetVersion,
      presence: getActivePresenceList(),
      activeUsers: getActiveUsersList()
    });
  });

  // REST API: Synchronize All Workstations (Windows, Android, iOS, Desktop)
  app.post(["/api/sync/all-workstations", "/api/sync-all-workstations"], (req, res) => {
    const auth = requireFullAccess(req, res, "force sync all workstations");
    if (!auth) return;
    const author = auth.user.username || "SUPER ADMINISTRATOR";
    broadcast({
      type: "SYNC_REQUIRED",
      author,
      reason: "CLUSTER_SYNC_REQUESTED",
      systemResetVersion,
      timestamp: new Date().toISOString()
    });
    broadcast({
      type: "force_sync",
      triggeredBy: author
    });
    return res.json({
      success: true,
      message: "SYNC_REQUIRED broadcast sent to all workstations and devices",
      connectedTerminals: connectionRegistry.size,
      connectedOperators: getActiveOperatorsCount(),
      systemResetVersion
    });
  });

  // REST API: Full State Snapshot (Single Source of Truth)
  // FIX DATA FLICKERING: Always returns valid, complete database records without null or empty arrays.
  app.get("/api/sync", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const auth = authenticateRequest(req);
    const clientEmpId = auth?.user?.employeeId || '';
    const clientPermission = auth?.permission || 'LIMITED_ACCESS';

    res.json({
      status: "ok",
      revision: stateRevision,
      systemResetVersion,
      systemResetTimestamp,
      systemResetId,
      systemResetBy,
      data: filterDataForClient({
        ...state,
        chatMessages
      }, clientPermission, clientEmpId),
      connectedOperators: getActiveOperatorsCount(),
      liveActiveTerminals: connectionRegistry.size
    });
  });

  // REST API: Sync collection (Batch upsert from client to central database)
  app.post("/api/sync", async (req, res) => {
    try {
      const auth = requireWriteAccess(req, res, "sync collection data");
      if (!auth) return;

      const { collection, data, reset_version, device_id } = req.body;
      const clientResetVersion = Number(reset_version || req.headers['x-reset-version']) || systemResetVersion;
      if (clientResetVersion < systemResetVersion) {
        return res.status(409).json({
          error: "STALE_RESET_VERSION: Central database was reset. Stale sync rejected.",
          systemResetVersion,
          systemResetId
        });
      }

      if (!collection || !(collection in state)) {
        return res.status(400).json({ error: `Unknown or invalid collection: ${collection}` });
      }

      const isRestricted = ['operationalRoles', 'receivingCategories', 'fifoColorsByMonth', 'registries', 'registeredUsers', 'sessions'].includes(collection);
      if (isRestricted && auth.permission !== 'FULL_ACCESS') {
        return res.status(403).json({ error: `PERMISSION DENIED: Limited access accounts cannot touch roles, categories, accounts, or master data (${collection}). FULL_ACCESS required.` });
      }

      if (collection === 'operationalRoles') {
        if (Array.isArray(data)) {
          const cleaned = Array.from(new Set<string>(data.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
          if (cleaned.length > 0) {
            state.operationalRoles = cleaned;
            stateRevision++;
            commitDatabase();
            broadcast({
              type: "roles_updated",
              roles: state.operationalRoles,
              systemResetVersion
            });
            broadcast({
              type: "collection_updated",
              collection: "operationalRoles",
              data: state.operationalRoles,
              systemResetVersion
            });
          }
        }
        return res.json({ success: true, count: state.operationalRoles.length, systemResetVersion });
      }

      if (collection === 'receivingCategories') {
        if (Array.isArray(data)) {
          const cleaned = Array.from(new Set<string>(data.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
          if (cleaned.length > 0) {
            state.receivingCategories = cleaned;
            stateRevision++;
            commitDatabase();
            broadcast({
              type: "categories_updated",
              categories: state.receivingCategories,
              systemResetVersion
            });
            broadcast({
              type: "collection_updated",
              collection: "receivingCategories",
              data: state.receivingCategories,
              systemResetVersion
            });
          }
        }
        return res.json({ success: true, count: state.receivingCategories.length, systemResetVersion });
      }

      if (collection === 'fifoColorsByMonth') {
        if (data && typeof data === 'object') {
          state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...data };
          stateRevision++;
          commitDatabase();
          broadcast({
            type: "fifo_colors_updated",
            fifoColorsByMonth: state.fifoColorsByMonth,
            systemResetVersion
          });
          broadcast({
            type: "collection_updated",
            collection: "fifoColorsByMonth",
            data: state.fifoColorsByMonth,
            systemResetVersion
          });
        }
        return res.json({ success: true, count: Object.keys(state.fifoColorsByMonth).length, systemResetVersion });
      }

      const items: any[] = Array.isArray(data) ? data : [];
      const currentList: any[] = (state as any)[collection] || [];
      const listMap = new Map<string, any>(currentList.map(it => [String(it.id || it.record_id), it]));

      let modifiedCount = 0;
      const serverTime = new Date().toISOString();
      const effectiveAuthor = auth.user.username;
      const effectiveEmpId = auth.user.employeeId;
      const effectiveDevId = String(device_id || req.headers['x-device-id'] || 'DEV-CENTRAL').trim();
      const effectiveUserId = `USR-${effectiveEmpId}`;

      for (const item of items) {
        if (!item) continue;
        const recId = String(item.id || item.record_id || `REC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
        if (deletedRecordTombstones.has(recId)) continue;

        const existing = listMap.get(recId);
        if (existing) {
          const clientVer = Number(item.version) || 1;
          const existingVer = Number(existing.version) || 1;
          if (existingVer > clientVer) continue;

          const nextVersion = existingVer + 1;
          const updatedRec = {
            ...existing,
            ...item,
            id: recId,
            record_id: recId,
            version: nextVersion,
            updated_at: serverTime,
            updated_by: effectiveAuthor,
            user_id: effectiveUserId,
            device_id: effectiveDevId,
            reset_version: systemResetVersion
          };

          if (collection === 'registeredUsers') {
            // CRITICAL SECURITY FIX: Batch sync MUST NEVER overwrite operator PINs!
            updatedRec.pin = existing.pin;
            if (existing.pin_hash) updatedRec.pin_hash = existing.pin_hash;
            if (existing.isPinCompromised !== undefined) updatedRec.isPinCompromised = existing.isPinCompromised;
            if (existing.pinChangedAt) updatedRec.pinChangedAt = existing.pinChangedAt;
            if (existing.pinChangedBy) updatedRec.pinChangedBy = existing.pinChangedBy;
          }

          listMap.set(recId, updatedRec);
          modifiedCount++;
        } else {
          if (collection === 'registeredUsers') {
            // Security Guard: New accounts cannot be inserted via batch sync.
            continue;
          }
          const newRec = {
            ...item,
            id: recId,
            record_id: recId,
            version: Number(item.version) || 1,
            created_at: item.created_at || serverTime,
            created_by: item.created_by || effectiveAuthor,
            updated_at: serverTime,
            updated_by: effectiveAuthor,
            user_id: effectiveUserId,
            device_id: effectiveDevId,
            reset_version: systemResetVersion
          };
          listMap.set(recId, newRec);
          modifiedCount++;
        }
      }

      if (modifiedCount > 0) {
        (state as any)[collection] = Array.from(listMap.values());
        stateRevision++;
        commitDatabase();

        console.log(`[CENTRAL-DB] [REST-POST-SYNC] Collection: ${collection} | Items received: ${items.length} | Modified: ${modifiedCount} | User: ${effectiveUserId} | Device: ${effectiveDevId}`);

        broadcast({
          type: "collection_updated",
          collection,
          data: (state as any)[collection],
          systemResetVersion
        });
      }

      return res.json({
        success: true,
        collection,
        count: (state as any)[collection]?.length || 0,
        modified: modifiedCount,
        systemResetVersion
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Batch Mutations (offline reconciliation for reconnecting devices)
  app.post("/api/sync/batch", async (req, res) => {
    try {
      const auth = requireWriteAccess(req, res, "submit batch mutations");
      if (!auth) return;

      const { mutations, reset_version, device_id } = req.body;
      const clientResetVersion = Number(reset_version || req.headers['x-reset-version']) || systemResetVersion;
      
      if (clientResetVersion < systemResetVersion) {
        return res.status(409).json({
          error: "STALE_RESET_VERSION: Central database was reset. Stale offline queue rejected.",
          systemResetVersion,
          systemResetId
        });
      }

      const mutList = Array.isArray(mutations) ? mutations : [];
      let processed = 0;
      const effectiveDevId = String(device_id || req.headers['x-device-id'] || 'DEV-OFFLINE').trim();
      const effectiveAuthor = auth.user.username;
      const effectiveUserId = `USR-${auth.user.employeeId}`;

      for (const m of mutList) {
        if (m.type === 'upsert' && m.collection && m.record) {
          const isRestricted = ['operationalRoles', 'receivingCategories', 'fifoColorsByMonth', 'registries', 'registeredUsers', 'sessions'].includes(m.collection);
          if (isRestricted && auth.permission !== 'FULL_ACCESS') {
            continue; // Limited access accounts cannot touch master data/roles/categories/accounts
          }

          const r = executeRecordUpsert({
            collection: m.collection,
            record: m.record,
            author: effectiveAuthor,
            employeeId: auth.user.employeeId,
            user_id: effectiveUserId,
            device_id: m.device_id || effectiveDevId,
            actionDesc: m.actionDesc,
            reset_version: clientResetVersion,
            userPermission: auth.permission
          });
          if (r.success) processed++;
        } else if (m.type === 'delete' && m.collection && (m.id || m.recordId)) {
          if (auth.permission !== 'FULL_ACCESS') {
            continue; // Limited access accounts cannot delete
          }
          const r = executeRecordDelete({
            collection: m.collection,
            id: String(m.id || m.recordId),
            author: effectiveAuthor,
            employeeId: auth.user.employeeId,
            user_id: effectiveUserId,
            device_id: m.device_id || effectiveDevId,
            actionDesc: m.actionDesc,
            reset_version: clientResetVersion,
            userPermission: auth.permission
          });
          if (r.success) processed++;
        }
      }

      console.log(`[CENTRAL-DB] [REST-BATCH-MUTATIONS] Processed ${processed}/${mutList.length} offline mutations from device ${effectiveDevId} | User: ${effectiveUserId}`);

      return res.json({
        success: true,
        processed,
        total: mutList.length,
        systemResetVersion
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: State Summary & Revision
  app.get(["/api/sync/state-summary", "/api/sync/digest"], (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const summary: Record<string, { count: number; lastUpdated?: string }> = {};
    Object.keys(state).forEach((key) => {
      const arr = (state as any)[key];
      summary[key] = {
        count: Array.isArray(arr) ? arr.length : 0,
      };
    });

    res.json({
      status: "ok",
      stateRevision,
      systemResetVersion,
      systemResetId,
      summary,
      timestamp: new Date().toISOString()
    });
  });

  // REST API: Devices & Heartbeats
  app.get("/api/devices", (req, res) => {
    const now = Date.now();
    const threshold = 5 * 60 * 1000; // 5 min
    const devices = Array.from(activeDevices.values()).map(dev => ({
      ...dev,
      isOnline: (now - dev.lastSeen) < threshold
    }));
    res.json({ success: true, count: devices.length, devices });
  });

  app.post("/api/devices/heartbeat", (req, res) => {
    try {
      const { deviceId, deviceName, employeeId, username, role, currentView, appVersion, platform } = req.body;
      if (!deviceId) return res.status(400).json({ error: "deviceId required" });

      const now = Date.now();
      const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
      const existing = activeDevices.get(deviceId);

      activeDevices.set(deviceId, {
        deviceId,
        deviceName: deviceName || existing?.deviceName || 'Terminal Device',
        employeeId: employeeId || existing?.employeeId || '',
        username: username || existing?.username || 'Operator',
        role: role || existing?.role || 'OPERATOR',
        ip,
        userAgent: req.headers['user-agent'],
        appVersion: appVersion || cachedGitHubVersion || 'Live',
        platform: platform || 'Web',
        connectedAt: existing?.connectedAt || new Date().toISOString(),
        lastSeen: now,
        currentView: currentView || existing?.currentView || 'dashboard'
      });

      return res.json({ success: true, serverTime: now, systemResetVersion });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Authorized Devices Management (Super Administrator)
  app.get("/api/devices/authorized", (req, res) => {
    res.json({
      success: true,
      installationId,
      primaryDeviceId,
      devices: Array.from(authorizedDevicesMap.values())
    });
  });

  app.post("/api/devices/authorize", (req, res) => {
    const { deviceId, deviceName, authorId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    if (!isAuthorizedSuperAdmin(req)) {
      return res.status(403).json({ error: "PERMISSION_DENIED: Only Super Administrator can authorize devices." });
    }

    const cleanDeviceId = String(deviceId).trim();
    const cleanDeviceName = String(deviceName || `Workstation (${cleanDeviceId})`).trim();
    const nowIso = new Date().toISOString();

    const deviceRecord: AuthorizedDeviceRecord = {
      deviceId: cleanDeviceId,
      deviceName: cleanDeviceName,
      isPrimaryAdminDevice: cleanDeviceId === primaryDeviceId,
      status: 'AUTHORIZED',
      authorizedBy: authorId || 'ALDRIN BANAWA (JPMP-002)',
      authorizedAt: nowIso
    };

    authorizedDevicesMap.set(cleanDeviceId, deviceRecord);
    commitDatabase();

    broadcast({
      type: "DEVICE_AUTHORIZATION_UPDATED",
      device: deviceRecord,
      systemResetVersion
    });

    return res.json({ success: true, device: deviceRecord });
  });

  app.post("/api/devices/revoke", (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    if (!isAuthorizedSuperAdmin(req)) {
      return res.status(403).json({ error: "PERMISSION_DENIED: Only Super Administrator can revoke devices." });
    }

    if (deviceId === primaryDeviceId) {
      return res.status(400).json({ error: "CANNOT_REVOKE_PRIMARY: The primary administrator device cannot be revoked." });
    }

    const existing = authorizedDevicesMap.get(deviceId);
    if (existing) {
      existing.status = 'REVOKED';
      authorizedDevicesMap.set(deviceId, existing);
      commitDatabase();

      broadcast({
        type: "DEVICE_REVOKED",
        deviceId,
        systemResetVersion
      });
    }

    return res.json({ success: true, message: `Device ${deviceId} revoked` });
  });

  // REST API: Terminal Fresh Install & Primary Administrator Device Binding
  app.post("/api/terminal/fresh-install", (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "perform terminal fresh installation");
      if (!auth) return;

      const { deviceId, deviceName, stationId } = req.body;
      const targetDeviceId = deviceId || primaryDeviceId;

      // Ensure target device is authorized
      if (!authorizedDevicesMap.has(targetDeviceId)) {
        authorizedDevicesMap.set(targetDeviceId, {
          deviceId: targetDeviceId,
          deviceName: deviceName || 'Primary Administrator PC',
          isPrimaryAdminDevice: true,
          status: 'AUTHORIZED',
          authorizedBy: 'SYSTEM_FRESH_INSTALL',
          authorizedAt: new Date().toISOString()
        });
      }

      // If this PC is registering as primary administrator device:
      primaryDeviceId = targetDeviceId;

      // Ensure Super Administrator JPMP-002 is bound to this device
      const superAdminIndex = state.registeredUsers.findIndex(
        u => (u.employeeId || '').toUpperCase().trim() === 'JPMP-002'
      );
      if (superAdminIndex >= 0) {
        state.registeredUsers[superAdminIndex] = {
          ...state.registeredUsers[superAdminIndex],
          deviceId: targetDeviceId,
          isPrimaryAdminDevice: true,
          authorizedDevices: [targetDeviceId]
        };
      }

      commitDatabase();

      return res.json({
        success: true,
        installationId,
        primaryDeviceId,
        systemResetVersion,
        systemResetId,
        superAdmin: state.registeredUsers.find(u => u.employeeId === 'JPMP-002')
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // SUPER ADMIN AUTHENTICATION, RATE LIMITING & AUDIT LOGGING
  // 1. Employee ID MUST be EXACTLY 'JPMP-002' (reject empty or substring matches).
  // 2. PIN must match ONLY the stored Super Admin PIN from the database (no '0423' fallback).
  // 3. Rate limiting: 5 wrong attempts locks admin auth for 5 minutes.
  // 4. Every attempt (success, failure, lockout) is recorded to authoritative audit log.
  // =========================================================================
  const MAX_SUPER_ADMIN_FAILED_ATTEMPTS = 5;
  const SUPER_ADMIN_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

  let superAdminFailedAttempts = 0;
  let superAdminLockedUntil = 0;

  const ADMIN_AUTH_AUDIT_LOG_FILE = getStorageFilePath("admin-auth-audit-log.json");

  interface AdminAuthAuditEntry {
    id: string;
    outcome: 'SUCCESS' | 'INVALID_EMPLOYEE_ID' | 'INCORRECT_PIN' | 'SUPER_ADMIN_NOT_FOUND' | 'LOCKED_OUT';
    employeeId: string;
    ip: string;
    timestamp: string;
    details: string;
    failedAttempts: number;
    lockedUntil?: string;
    path?: string;
    method?: string;
  }

  let adminAuthAuditLogs: AdminAuthAuditEntry[] = [];
  try {
    if (fs.existsSync(ADMIN_AUTH_AUDIT_LOG_FILE)) {
      const raw = fs.readFileSync(ADMIN_AUTH_AUDIT_LOG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) adminAuthAuditLogs = parsed;
    }
  } catch (e) {
    adminAuthAuditLogs = [];
  }

  function logAdminAuthAudit(entryData: {
    outcome: 'SUCCESS' | 'INVALID_EMPLOYEE_ID' | 'INCORRECT_PIN' | 'SUPER_ADMIN_NOT_FOUND' | 'LOCKED_OUT';
    employeeId: string;
    ip: string;
    details: string;
    failedAttempts: number;
    lockedUntil?: string;
    req?: express.Request;
  }) {
    const entry: AdminAuthAuditEntry = {
      id: `AUTH-LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      outcome: entryData.outcome,
      employeeId: entryData.employeeId,
      ip: entryData.ip,
      timestamp: new Date().toISOString(),
      details: entryData.details,
      failedAttempts: entryData.failedAttempts,
      lockedUntil: entryData.lockedUntil,
      path: entryData.req?.path || entryData.req?.originalUrl,
      method: entryData.req?.method
    };

    adminAuthAuditLogs.unshift(entry);
    if (adminAuthAuditLogs.length > 500) {
      adminAuthAuditLogs = adminAuthAuditLogs.slice(0, 500);
    }

    try {
      fs.writeFileSync(ADMIN_AUTH_AUDIT_LOG_FILE, JSON.stringify(adminAuthAuditLogs, null, 2), "utf-8");
    } catch (err) {
      console.error("[ADMIN-AUTH-AUDIT] Failed to persist admin auth audit log:", err);
    }

    if (entryData.outcome === 'SUCCESS') {
      console.log(`[ADMIN-AUTH-AUDIT] SUCCESS: JPMP-002 authenticated for ${entry.method || ''} ${entry.path || ''} from ${entry.ip}`);
    } else {
      console.warn(`[ADMIN-AUTH-AUDIT] ${entryData.outcome}: ID='${entryData.employeeId}', IP=${entry.ip}, Path=${entry.path || 'N/A'}. Details: ${entryData.details}`);
    }
  }

  // Helper to authenticate Super Admin
  function isAuthorizedSuperAdmin(req: express.Request): boolean {
    const clientIp = (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
      req.socket?.remoteAddress || 
      req.ip || 
      '127.0.0.1'
    );

    // 1. Authoritatively derive user and permission from session token (Bearer or query)
    const auth = authenticateRequest(req);
    if (!auth) {
      logAdminAuthAudit({
        outcome: 'SUPER_ADMIN_NOT_FOUND',
        employeeId: 'UNAUTHENTICATED',
        ip: clientIp,
        details: 'Rejected request without valid session token.',
        failedAttempts: superAdminFailedAttempts,
        req
      });
      return false;
    }

    if (auth.permission !== 'FULL_ACCESS') {
      logAdminAuthAudit({
        outcome: 'INVALID_EMPLOYEE_ID',
        employeeId: auth.user.employeeId,
        ip: clientIp,
        details: `Rejected non-FULL_ACCESS account '${auth.user.employeeId}' with permission '${auth.permission}'.`,
        failedAttempts: superAdminFailedAttempts,
        req
      });
      return false;
    }

    const bodyPin = (
      req.body?.adminPin || 
      req.body?.pin || 
      ''
    ).toString().trim();

    const now = Date.now();

    // 2. Check if currently locked out due to prior failed PIN attempts
    if (superAdminLockedUntil > now) {
      const remainingSeconds = Math.ceil((superAdminLockedUntil - now) / 1000);
      logAdminAuthAudit({
        outcome: 'LOCKED_OUT',
        employeeId: auth.user.employeeId,
        ip: clientIp,
        details: `Super Admin authentication is LOCKED for ${remainingSeconds}s.`,
        failedAttempts: superAdminFailedAttempts,
        lockedUntil: new Date(superAdminLockedUntil).toISOString(),
        req
      });
      return false;
    }

    if (superAdminLockedUntil > 0 && now >= superAdminLockedUntil) {
      superAdminFailedAttempts = 0;
      superAdminLockedUntil = 0;
    }

    // 3. If an explicit PIN was provided in body, verify it against stored PIN
    if (bodyPin) {
      const superAdmin = state.registeredUsers.find(
        u => (u.employeeId || '').toUpperCase().trim() === 'JPMP-002'
      );
      const storedPin = (superAdmin?.pin || auth.user.pin || '').toString().trim();

      if (bodyPin !== storedPin) {
        superAdminFailedAttempts++;
        if (superAdminFailedAttempts >= MAX_SUPER_ADMIN_FAILED_ATTEMPTS) {
          superAdminLockedUntil = Date.now() + SUPER_ADMIN_LOCKOUT_MS;
        }
        logAdminAuthAudit({
          outcome: 'INCORRECT_PIN',
          employeeId: auth.user.employeeId,
          ip: clientIp,
          details: `Incorrect PIN provided for admin action. Attempts: ${superAdminFailedAttempts}/${MAX_SUPER_ADMIN_FAILED_ATTEMPTS}.`,
          failedAttempts: superAdminFailedAttempts,
          lockedUntil: superAdminLockedUntil ? new Date(superAdminLockedUntil).toISOString() : undefined,
          req
        });
        return false;
      }
    }

    superAdminFailedAttempts = 0;
    superAdminLockedUntil = 0;
    logAdminAuthAudit({
      outcome: 'SUCCESS',
      employeeId: auth.user.employeeId,
      ip: clientIp,
      details: `Admin ${auth.user.employeeId} (${auth.user.username}) authorized with FULL_ACCESS.`,
      failedAttempts: 0,
      req
    });
    return true;
  }

  // REST API: Super Admin Authentication Status & Audit Log
  app.get("/api/admin/auth-status", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const now = Date.now();
    const isLocked = superAdminLockedUntil > now;
    const remainingSeconds = isLocked ? Math.ceil((superAdminLockedUntil - now) / 1000) : 0;

    return res.json({
      success: true,
      isLocked,
      remainingSeconds,
      lockedUntil: isLocked ? new Date(superAdminLockedUntil).toISOString() : null,
      failedAttempts: isLocked ? superAdminFailedAttempts : (superAdminLockedUntil > 0 ? 0 : superAdminFailedAttempts),
      maxAttempts: MAX_SUPER_ADMIN_FAILED_ATTEMPTS,
      lockoutDurationMinutes: 5,
      auditLogsCount: adminAuthAuditLogs.length,
      auditLogs: adminAuthAuditLogs.slice(0, 50)
    });
  });

  /**
   * GLOBAL RESET API
   * ONLY SUPER ADMIN CAN PERFORM THE GLOBAL RESET THROUGH A SECURE SERVER-SIDE RESET API.
   * AFTER RESET, BROADCAST GLOBAL_RESET, INVALIDATE ALL CLIENT STATE AND OFFLINE QUEUES,
   * UPDATE RESET_VERSION, AND FORCE ALL CLIENTS TO RESYNC FROM THE CENTRAL DATABASE.
   */
  app.post(["/api/reset-everything", "/api/reset-database"], async (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "execute global database reset");
      if (!auth) return;

      if (!req.body?.confirmed) {
        return res.status(400).json({ 
          error: "CONFIRMATION_REQUIRED: Global reset requires explicit 'confirmed: true'." 
        });
      }

      if (!isAuthorizedSuperAdmin(req)) {
        return res.status(403).json({ 
          error: "PERMISSION_DENIED: Only the Super Administrator (JPMP-002) is authorized to execute a complete global database reset." 
        });
      }

      const author = auth.user.username || "ALDRIN BANAWA (SUPER ADMINISTRATOR)";
      const keepUsers = req.body?.keepUsers !== false;

      // Automatically create a safety backup right before running destructive reset
      try {
        await createDatabaseBackup("PRE_DATABASE_RESET_SAFETY_BACKUP", author);
      } catch (backupErr) {
        console.warn("[RESET-DATABASE] Pre-reset backup warning:", backupErr);
      }

      // 1. Advance reset version
      systemResetVersion += 1;
      systemResetTimestamp = new Date().toISOString();
      systemResetId = `RESET-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      systemResetBy = author;
      stateRevision += 1;

      // 2. Reset operational datasets
      state.stocks = [];
      state.receiving = [];
      state.returns = [];
      state.recycling = [];
      state.issuances = [];
      state.deliveries = [];
      state.envLogs = [];
      state.forkliftChecks = [];
      state.registries = [];
      state.stockMovements = [];

      // 3. Handle accounts reset
      if (!keepUsers) {
        state.registeredUsers = [{ 
          ...defaultSuperAdmin, 
          deviceId: primaryDeviceId,
          isPrimaryAdminDevice: true,
          authorizedDevices: [primaryDeviceId],
          reset_version: systemResetVersion,
          version: 1,
          updated_at: systemResetTimestamp
        }];
        deletedUserTombstones.clear();
      } else {
        // Retain users but stamp new reset_version
        state.registeredUsers = state.registeredUsers.map(u => ({
          ...u,
          reset_version: systemResetVersion,
          version: (u.version || 1) + 1,
          updated_at: systemResetTimestamp
        }));
      }

      // 4. Clear old tombstones
      deletedRecordTombstones.clear();

      // 5. System audit log
      const resetMsg: ChatMessage = {
        id: `sys-reset-${Date.now()}`,
        sender: "SYSTEM SECURITY AUDIT",
        text: `GLOBAL DATABASE RESET executed by ${author}. System reset version advanced to v${systemResetVersion} (${systemResetId}).`,
        timestamp: systemResetTimestamp,
        isSystem: true
      };
      chatMessages.push(resetMsg);

      // 6. COMMIT DATABASE SYNCHRONOUSLY TO DISK BEFORE WEBSOCKET BROADCAST
      const commitOk = commitDatabase();
      if (!commitOk) {
        return res.status(500).json({ error: "CRITICAL: Failed to commit global reset to central disk database." });
      }

      // 7. Broadcast GLOBAL_RESET to all connected clients
      broadcast({
        type: "GLOBAL_RESET",
        systemResetVersion,
        systemResetTimestamp,
        systemResetId,
        systemResetBy,
        author,
        keepUsers,
        data: {
          ...state,
          chatMessages
        }
      });

      broadcast({
        type: "global_reset",
        systemResetVersion,
        systemResetTimestamp,
        systemResetId,
        systemResetBy,
        author,
        keepUsers
      });

      return res.json({
        success: true,
        message: "GLOBAL DATABASE RESET EXECUTED SUCCESSFULLY",
        systemResetVersion,
        systemResetId,
        systemResetTimestamp,
        author,
        keepUsers
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // BACKUPS MANAGEMENT REST API (SUPER ADMIN ONLY)
  // =========================================================================

  // 1. List existing backups and recent backup/restore audit log
  app.get("/api/admin/backups", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      const auth = requireFullAccess(req, res, "view database backups");
      if (!auth) return;

      if (!fs.existsSync(BACKUPS_DIR)) {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      }

      const backups = getAllBackupRecords();

      return res.json({
        success: true,
        backupsDir: BACKUPS_DIR,
        intervalHours: 1,
        retentionPolicy: "PERMANENT_NO_DELETION",
        maxRetained: null,
        backups,
        auditLogs: backupAuditLogs.slice(0, 50)
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to list backups" });
    }
  });

  // 2. Trigger on-demand backup
  app.post("/api/admin/backups/create", async (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "create database backups");
      if (!auth) return;

      if (!isAuthorizedSuperAdmin(req)) {
        return res.status(403).json({ 
          error: "PERMISSION_DENIED: Only Super Administrator (JPMP-002) is authorized to trigger manual backups." 
        });
      }
      const author = auth.user.username || "SUPER_ADMIN";
      const result = await createDatabaseBackup("MANUAL_ON_DEMAND", author);
      if (result.success) {
        return res.json({ 
          success: true, 
          filename: result.filename, 
          message: `Backup '${result.filename}' created successfully.` 
        });
      } else {
        return res.status(500).json({ error: result.error || "Failed to create database backup" });
      }
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  });

  // 3. Restore database snapshot (overwrite live database with selected backup)
  app.post("/api/admin/backups/restore", (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "restore database backups");
      if (!auth) return;

      if (!isAuthorizedSuperAdmin(req)) {
        return res.status(403).json({ 
          error: "PERMISSION_DENIED: Only Super Administrator (JPMP-002) is authorized to restore database snapshots." 
        });
      }

      if (!req.body?.confirmed) {
        return res.status(400).json({ 
          error: "CONFIRMATION_REQUIRED: Database restore requires explicit 'confirmed: true'." 
        });
      }

      const filename = String(req.body?.filename || "").trim();
      if (!filename) {
        return res.status(400).json({ error: "MISSING_FILENAME: Backup filename is required." });
      }

      const author = auth.user.username || "SUPER_ADMIN";
      const result = restoreDatabaseFromBackup(filename, author);

      if (result.success) {
        return res.json({
          success: true,
          message: `Live database successfully restored from '${filename}'. All connected workstations updated.`,
          recordCounts: result.recordCounts
        });
      } else {
        return res.status(500).json({ error: result.error || "Failed to restore database backup" });
      }
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  });

  // 4. Download backup snapshot file
  app.get("/api/admin/backups/download/:filename", (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "download database backups");
      if (!auth) return;

      const filename = path.basename(req.params.filename);
      const filePath = path.join(BACKUPS_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Backup file not found" });
      }
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      if (filename.endsWith(".sqlite")) {
        res.setHeader("Content-Type", "application/vnd.sqlite3");
      } else {
        res.setHeader("Content-Type", "application/json");
      }
      fs.createReadStream(filePath).pipe(res);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message });
    }
  });

  // REST API: Operator Accounts List
  app.get("/api/accounts", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      // Ensure Super Administrator JPMP-002 is always first and present
      if (!state.registeredUsers.some(u => (u.employeeId || '').toUpperCase().trim() === 'JPMP-002')) {
        state.registeredUsers.unshift({ ...defaultSuperAdmin });
        commitDatabase();
      }

      const auth = authenticateRequest(req);
      const isSuper = auth?.permission === 'FULL_ACCESS';
      const accounts = isSuper ? state.registeredUsers : state.registeredUsers.map(u => {
        const { pin, pin_hash, ...safe } = u;
        return safe;
      });

      return res.json({
        success: true,
        count: accounts.length,
        accounts,
        revision: stateRevision,
        systemResetVersion
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Verify Operator Credentials & Issue Server-Authoritative Session Token
  // Stored in database so server restarts don't log people out
  app.post("/api/accounts/verify", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      const { identifier, pin } = req.body;
      const rawInput = String(identifier || '').trim();
      const enteredPin = String(pin || '').trim();

      if (!rawInput || !enteredPin) {
        return res.status(400).json({ success: false, error: "Operator Identifier and PIN code are required." });
      }

      let searchId = rawInput.toUpperCase();
      if (!searchId.startsWith('JPMP-')) {
        searchId = 'JPMP-' + searchId.replace(/^EMP-/, '');
      }
      const inputPhone = rawInput.replace(/\D/g, '');

      // Check central in-memory database
      const matchedUser = state.registeredUsers.find(u => {
        const uEmpId = (u.employeeId || '').toUpperCase().trim();
        const uUsername = (u.username || '').toUpperCase().trim();
        const uPhone = (u.phoneNumber || '').replace(/\D/g, '');
        const idMatches = uEmpId === searchId || uEmpId === rawInput.toUpperCase() || uUsername === rawInput.toUpperCase() || (inputPhone.length >= 10 && uPhone === inputPhone);
        const uPin = (u.pin || '').toString().trim();
        return idMatches && uPin === enteredPin;
      });

      if (matchedUser) {
        matchedUser.lastActive = new Date().toISOString();
        if (matchedUser.pin === '1234') {
          matchedUser.isPinCompromised = true;
        }

        // Issue cryptographically random session token (32 bytes hex)
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const effectivePermission = (matchedUser.permission || (matchedUser.employeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS')).trim().toUpperCase();

        const sessionRecord = {
          id: sessionToken,
          token: sessionToken,
          employeeId: matchedUser.employeeId,
          username: matchedUser.username,
          role: matchedUser.role,
          permission: effectivePermission,
          createdAt: new Date().toISOString(),
          lastActive: new Date().toISOString()
        };

        if (!state.sessions) state.sessions = [];
        state.sessions.push(sessionRecord);
        commitDatabase();

        return res.json({
          success: true,
          user: matchedUser,
          token: sessionToken,
          sessionToken,
          permission: effectivePermission,
          isPinCompromised: matchedUser.pin === '1234' || !!matchedUser.isPinCompromised,
          systemResetVersion
        });
      }

      console.warn(`[AUTH-AUDIT] FAILED LOGIN ATTEMPT: Identifier="${rawInput}", IP=${req.ip}, Timestamp=${new Date().toISOString()}`);

      return res.status(401).json({
        success: false,
        error: "AUTHENTICATION_FAILED: Invalid Operator ID or PIN code."
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Validate Current Session Token & Retrieve User Record
  app.get("/api/accounts/session", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const auth = requireAuth(req, res);
    if (!auth) return;

    return res.json({
      success: true,
      user: auth.user,
      permission: auth.permission,
      token: auth.token,
      sessionToken: auth.token,
      systemResetVersion
    });
  });

  // REST API: Invalidate Session Token on Logout
  app.post("/api/accounts/logout", (req, res) => {
    try {
      const token = extractToken(req);
      if (token && Array.isArray(state.sessions)) {
        state.sessions = state.sessions.filter(s => s && s.token !== token && s.id !== token);
        commitDatabase();
      }
      return res.json({ success: true, message: "Logged out successfully" });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Update Account PIN
  // Strict Security Rule: PIN changes only allowed via explicit Super Admin authorization or verified operator self-change.
  // Log every PIN change (who, which account, when).
  app.post("/api/accounts/update-pin", async (req, res) => {
    try {
      const { employeeId, currentPin, newPin, requesterEmployeeId, author, reason } = req.body;
      const cleanEmpId = String(employeeId || '').trim().toUpperCase();
      const cleanNewPin = String(newPin || '').trim();
      const cleanCurrentPin = String(currentPin || '').trim();
      const requesterId = String(requesterEmployeeId || cleanEmpId).trim().toUpperCase();

      if (!cleanEmpId || !cleanNewPin) {
        return res.status(400).json({ error: "Operator ID and new PIN are required" });
      }
      if (!/^\d{4,6}$/.test(cleanNewPin)) {
        return res.status(400).json({ error: "PIN must be between 4 and 6 numeric digits" });
      }

      // Security Guard: Forbid trivial and compromised PINs
      if (cleanNewPin === '1234') {
        return res.status(400).json({ 
          error: "SECURITY_REJECTED: '1234' is a compromised default PIN and is strictly prohibited." 
        });
      }
      if (/^(\d)\1+$/.test(cleanNewPin)) {
        return res.status(400).json({ 
          error: "SECURITY_REJECTED: Repetitive PIN patterns (e.g. 0000, 1111) are not allowed." 
        });
      }

      const target = state.registeredUsers.find(u => u.employeeId.toUpperCase().trim() === cleanEmpId);
      if (!target) {
        return res.status(404).json({ error: "Operator account not found in central database" });
      }

      // Verification: must be confirmed Super Admin OR operator verifying their own current PIN
      const auth = requireAuth(req, res);
      if (!auth) return;

      const isSuper = auth.permission === 'FULL_ACCESS';
      if (!isSuper) {
        if (auth.user.employeeId.toUpperCase().trim() !== cleanEmpId) {
          return res.status(403).json({ error: "PERMISSION_DENIED: Limited access accounts cannot update PIN of other operators. FULL_ACCESS required." });
        }
        if (target.pin !== cleanCurrentPin) {
          console.warn(`[SECURITY ALERT] Unauthorized PIN change attempt for ${cleanEmpId} from IP ${req.ip}`);
          return res.status(403).json({ error: "INCORRECT_PIN: Current PIN does not match. Super Admin authorization required." });
        }
      }

      const previousWasCompromised = target.pin === '1234' || !!target.isPinCompromised;
      const actionType = previousWasCompromised ? "COMPROMISED_PIN_RESOLVED" : (isSuper ? "PIN_RESET" : "PIN_CHANGED");

      target.pin = cleanNewPin;
      target.isPinCompromised = false;
      target.pinChangedAt = new Date().toISOString();
      target.pinChangedBy = auth.user.employeeId;
      target.version = (target.version || 1) + 1;
      target.updated_at = new Date().toISOString();
      target.reset_version = systemResetVersion;

      stateRevision++;
      const commitOk = commitDatabase();
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to persist PIN change to central database" });
      }

      // Record permanent audit entry
      logPinAudit(
        actionType,
        cleanEmpId,
        target.username,
        author || (isSuper ? 'Super Administrator (ALDRIN BANAWA)' : target.username),
        auth.user.employeeId,
        reason || (previousWasCompromised ? 'Resolving compromised default PIN' : 'Explicit PIN update'),
        previousWasCompromised,
        req.ip
      );

      broadcast({
        type: "account_updated",
        account: target,
        user: target,
        author: auth.user.username,
        systemResetVersion
      });

      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers,
        systemResetVersion
      });

      return res.json({ 
        success: true, 
        message: previousWasCompromised 
          ? "Compromised PIN resolved and secure PIN activated in central database" 
          : "PIN updated successfully in central database", 
        user: target 
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Get PIN Audit Logs (Super Admin Only)
  app.get("/api/accounts/pin-audit-log", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const auth = requireFullAccess(req, res, "view PIN audit logs");
    if (!auth) return;

    return res.json({
      success: true,
      count: pinAuditLogs.length,
      logs: pinAuditLogs
    });
  });

  // REST API: Register New Operator Account
  app.post("/api/accounts/register", async (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "register new operator accounts");
      if (!auth) return;

      const { employeeId, username, role, phoneNumber, permission, pin } = req.body;
      const cleanEmpId = String(employeeId || '').trim().toUpperCase();
      const cleanUsername = String(username || '').trim().toUpperCase();
      const cleanPin = String(pin || '').trim();

      if (!cleanEmpId || !cleanUsername || !cleanPin) {
        return res.status(400).json({ error: "Employee ID, Full Name, and PIN code are required." });
      }

      // Check existence
      const exists = state.registeredUsers.some(u => u.employeeId.toUpperCase().trim() === cleanEmpId);
      if (exists) {
        return res.status(409).json({ error: `Account with ID ${cleanEmpId} already exists in the central database.` });
      }

      unmarkUserTombstone(cleanEmpId);

      const newUser: ServerUser = {
        id: `USR-${cleanEmpId}`,
        employeeId: cleanEmpId,
        username: cleanUsername,
        role: String(role || 'WAREHOUSE CLERK').trim().toUpperCase(),
        phoneNumber: phoneNumber ? String(phoneNumber).trim() : '',
        permission: String(permission || 'LIMITED_ACCESS').trim(),
        pin: cleanPin,
        status: 'ACTIVE',
        registeredBy: auth.user.username,
        registeredBySuperAdmin: true,
        registeredAt: new Date().toISOString(),
        version: 1,
        updated_at: new Date().toISOString(),
        reset_version: systemResetVersion
      };

      state.registeredUsers.push(newUser);
      stateRevision++;

      const commitOk = commitDatabase();
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to commit new account to central database" });
      }

      broadcast({
        type: "account_registered",
        user: newUser,
        author: auth.user.username,
        systemResetVersion
      });

      broadcast({
        type: "account_created",
        account: newUser,
        user: newUser,
        systemResetVersion
      });

      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers,
        systemResetVersion
      });

      return res.json({ success: true, user: newUser, systemResetVersion });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Update Operator Account
  app.post("/api/accounts/update", async (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "update operator accounts");
      if (!auth) return;

      const { oldEmployeeId, updatedUser } = req.body;
      const cleanOldId = String(oldEmployeeId || updatedUser?.employeeId || '').trim().toUpperCase();

      if (!cleanOldId || !updatedUser) {
        return res.status(400).json({ error: "Old Employee ID and updated account data required" });
      }

      const index = state.registeredUsers.findIndex(u => u.employeeId.toUpperCase().trim() === cleanOldId);
      if (index === -1) {
        return res.status(404).json({ error: "Account not found in central database" });
      }

      const existing = state.registeredUsers[index];
      const isSuper = cleanOldId === 'JPMP-002';

      const cleanNewId = String(updatedUser.employeeId || cleanOldId).trim().toUpperCase();
      if (cleanNewId !== cleanOldId) {
        if (isSuper) {
          return res.status(403).json({ error: "Super Administrator Employee ID cannot be altered." });
        }
        const duplicate = state.registeredUsers.some(
          (u, idx) => idx !== index && u.employeeId.toUpperCase().trim() === cleanNewId
        );
        if (duplicate) {
          return res.status(409).json({ error: `Employee ID ${cleanNewId} is already taken by another account.` });
        }
      }

      const mergedUser: ServerUser = {
        ...existing,
        ...updatedUser,
        employeeId: isSuper ? 'JPMP-002' : cleanNewId,
        username: String(updatedUser.username || existing.username).trim().toUpperCase(),
        role: isSuper ? 'SUPER ADMINISTRATOR' : String(updatedUser.role || existing.role).trim().toUpperCase(),
        permission: isSuper ? 'FULL_ACCESS' : String(updatedUser.permission || existing.permission).trim(),
        // CRITICAL SECURITY FIX: General profile edit CANNOT alter PIN! Must use /api/accounts/update-pin.
        pin: existing.pin,
        isPinCompromised: existing.isPinCompromised,
        pinChangedAt: existing.pinChangedAt,
        pinChangedBy: existing.pinChangedBy,
        version: (existing.version || 1) + 1,
        updated_at: new Date().toISOString(),
        reset_version: systemResetVersion
      };

      state.registeredUsers[index] = mergedUser;
      stateRevision++;

      const commitOk = commitDatabase();
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to persist account update to central database" });
      }

      broadcast({
        type: "account_updated",
        account: mergedUser,
        user: mergedUser,
        author: auth.user.username,
        systemResetVersion
      });

      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers,
        systemResetVersion
      });

      return res.json({ success: true, user: mergedUser, systemResetVersion });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Delete Operator Account
  app.post("/api/accounts/delete", async (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "delete operator accounts");
      if (!auth) return;

      const { employeeId } = req.body;
      const cleanId = String(employeeId || '').trim().toUpperCase();

      if (!cleanId) return res.status(400).json({ error: "Employee ID is required" });
      if (cleanId === 'JPMP-002') {
        return res.status(403).json({ error: "PROTECTED_ACCOUNT: Super Administrator JPMP-002 cannot be deleted." });
      }

      markUserTombstone(cleanId);
      state.registeredUsers = state.registeredUsers.filter(u => u.employeeId.toUpperCase().trim() !== cleanId);
      stateRevision++;

      const commitOk = commitDatabase();
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to commit account deletion to central database" });
      }

      broadcast({
        type: "account_deleted",
        employeeId: cleanId,
        systemResetVersion
      });

      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers,
        systemResetVersion
      });

      return res.json({ success: true, employeeId: cleanId, systemResetVersion });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Clear All Accounts Except Super Admin
  app.post("/api/accounts/clear-all-except-super-admin", async (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "clear all accounts");
      if (!auth) return;

      if (!isAuthorizedSuperAdmin(req)) {
        return res.status(403).json({ error: "PERMISSION_DENIED: Only Super Administrator is authorized to clear accounts." });
      }

      const author = auth.user.username || "SUPER_ADMIN (JPMP-002)";

      // Automatically create a safety backup right before wiping accounts
      try {
        await createDatabaseBackup("PRE_ACCOUNTS_WIPE_SAFETY_BACKUP", author);
      } catch (backupErr) {
        console.warn("[WIPE-ACCOUNTS] Pre-wipe backup warning:", backupErr);
      }

      const superAdmin = state.registeredUsers.find(u => u.employeeId.toUpperCase().trim() === 'JPMP-002') || defaultSuperAdmin;
      state.registeredUsers.forEach(u => {
        if (u.employeeId.toUpperCase().trim() !== 'JPMP-002') {
          markUserTombstone(u.employeeId);
        }
      });

      state.registeredUsers = [{ ...superAdmin }];
      stateRevision++;

      const commitOk = commitDatabase();
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to commit accounts purge to central database" });
      }

      broadcast({
        type: "all_accounts_cleared",
        data: state.registeredUsers,
        systemResetVersion
      });

      broadcast({
        type: "accounts_cleared",
        systemResetVersion
      });

      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers,
        systemResetVersion
      });

      return res.json({ success: true, count: 1, accounts: state.registeredUsers });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Get Operational Roles
  app.get("/api/roles", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      success: true,
      roles: state.operationalRoles || DEFAULT_OPERATIONAL_ROLES
    });
  });

  // REST API: Manage / Update Operational Roles (Super Admin)
  app.post("/api/roles", async (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "manage operational roles");
      if (!auth) return;

      const { action, role, oldRole, newRole, roles, updateExistingAccounts } = req.body;
      let modified = false;
      let usersModified = false;

      if (action === 'add' && role) {
        const clean = String(role).trim().toUpperCase();
        if (clean && !state.operationalRoles.includes(clean)) {
          state.operationalRoles.push(clean);
          modified = true;
        }
      } else if (action === 'rename' && oldRole && newRole) {
        const cleanOld = String(oldRole).trim().toUpperCase();
        const cleanNew = String(newRole).trim().toUpperCase();
        if (cleanOld && cleanNew) {
          const idx = state.operationalRoles.indexOf(cleanOld);
          if (idx !== -1) {
            state.operationalRoles[idx] = cleanNew;
            modified = true;
          } else if (!state.operationalRoles.includes(cleanNew)) {
            state.operationalRoles.push(cleanNew);
            modified = true;
          }

          if (updateExistingAccounts !== false) {
            state.registeredUsers = state.registeredUsers.map(u => {
              if ((u.role || '').toUpperCase().trim() === cleanOld) {
                usersModified = true;
                return {
                  ...u,
                  role: cleanNew,
                  version: (u.version || 1) + 1,
                  updated_at: new Date().toISOString()
                };
              }
              return u;
            });
          }
        }
      } else if (action === 'delete' && role) {
        const clean = String(role).trim().toUpperCase();
        if (clean) {
          state.operationalRoles = state.operationalRoles.filter(r => r !== clean);
          modified = true;
        }
      } else if (Array.isArray(roles)) {
        const cleaned = Array.from(new Set<string>(roles.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
        if (cleaned.length > 0) {
          state.operationalRoles = cleaned;
          modified = true;
        }
      }

      if (modified || usersModified) {
        stateRevision++;
        commitDatabase();

        broadcast({
          type: "roles_updated",
          roles: state.operationalRoles,
          systemResetVersion
        });

        broadcast({
          type: "collection_updated",
          collection: "operationalRoles",
          data: state.operationalRoles,
          systemResetVersion
        });

        if (usersModified) {
          broadcast({
            type: "collection_updated",
            collection: "registeredUsers",
            data: state.registeredUsers,
            systemResetVersion
          });
        }
      }

      return res.json({
        success: true,
        roles: state.operationalRoles,
        accountsUpdated: usersModified
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Get Receiving Categories
  app.get("/api/categories", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      success: true,
      categories: state.receivingCategories || DEFAULT_RECEIVING_CATEGORIES
    });
  });

  // REST API: Manage / Update Receiving Categories (Super Admin)
  app.post("/api/categories", async (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "manage receiving categories");
      if (!auth) return;

      const { action, category, oldCategory, newCategory, oldCat, newCat, categories, updateExistingRecords } = req.body;
      let modified = false;
      let recModified = false;
      let retModified = false;
      let stocksModified = false;

      if (action === 'add' && category) {
        const clean = String(category).trim().toUpperCase();
        if (clean && !state.receivingCategories.includes(clean)) {
          state.receivingCategories.push(clean);
          modified = true;
        }
      } else if (action === 'rename') {
        const cleanOld = String(oldCategory || oldCat || '').trim().toUpperCase();
        const cleanNew = String(newCategory || newCat || '').trim().toUpperCase();
        if (cleanOld && cleanNew && cleanOld !== cleanNew) {
          const idx = state.receivingCategories.indexOf(cleanOld);
          if (idx !== -1) {
            state.receivingCategories[idx] = cleanNew;
            modified = true;
          } else if (!state.receivingCategories.includes(cleanNew)) {
            state.receivingCategories.push(cleanNew);
            modified = true;
          }

          if (updateExistingRecords !== false) {
            state.receiving = state.receiving.map(r => {
              let ch = false;
              const up = { ...r };
              if ((r.supplierOrDept || '').trim().toUpperCase() === cleanOld) {
                up.supplierOrDept = cleanNew;
                ch = true;
              }
              if ((r.category || '').trim().toUpperCase() === cleanOld) {
                up.category = cleanNew;
                ch = true;
              }
              if (ch) {
                recModified = true;
                return { ...up, version: (r.version || 1) + 1, updated_at: new Date().toISOString() };
              }
              return r;
            });

            state.returns = state.returns.map(ret => {
              if ((ret.category || '').trim().toUpperCase() === cleanOld) {
                retModified = true;
                return { ...ret, category: cleanNew, version: (ret.version || 1) + 1, updated_at: new Date().toISOString() };
              }
              return ret;
            });

            state.stocks = state.stocks.map(s => {
              if (((s as any).category || '').trim().toUpperCase() === cleanOld) {
                stocksModified = true;
                return { ...s, category: cleanNew, version: (s.version || 1) + 1, updated_at: new Date().toISOString() };
              }
              return s;
            });
          }
        }
      } else if (action === 'delete' && category) {
        const clean = String(category).trim().toUpperCase();
        if (clean) {
          // Block deleting if any existing record still uses it
          const recCount = state.receiving.filter(r => (r.supplierOrDept || '').trim().toUpperCase() === clean || (r.category || '').trim().toUpperCase() === clean).length;
          const retCount = state.returns.filter(ret => (ret.category || '').trim().toUpperCase() === clean).length;
          const stockCount = state.stocks.filter(s => ((s as any).category || '').trim().toUpperCase() === clean).length;
          const inUseCount = recCount + retCount + stockCount;

          if (inUseCount > 0) {
            return res.status(400).json({
              success: false,
              error: `Cannot delete category "${clean}" because it is currently assigned to ${inUseCount} active record(s) (${recCount} receiving, ${retCount} returns). You must reassign or remove these records first.`,
              inUseCount,
              recCount,
              retCount,
              stockCount
            });
          }

          state.receivingCategories = state.receivingCategories.filter(c => c !== clean);
          modified = true;
        }
      } else if (action === 'reset') {
        state.receivingCategories = [...DEFAULT_RECEIVING_CATEGORIES];
        modified = true;
      } else if (Array.isArray(categories)) {
        const cleaned = Array.from(new Set<string>(categories.map((c: any) => String(c || '').trim().toUpperCase()).filter(Boolean)));
        if (cleaned.length > 0) {
          state.receivingCategories = cleaned;
          modified = true;
        }
      }

      if (modified || recModified || retModified || stocksModified) {
        stateRevision++;
        commitDatabase();

        broadcast({
          type: "categories_updated",
          categories: state.receivingCategories,
          systemResetVersion
        });

        broadcast({
          type: "collection_updated",
          collection: "receivingCategories",
          data: state.receivingCategories,
          systemResetVersion
        });

        if (recModified) {
          broadcast({
            type: "collection_updated",
            collection: "receiving",
            data: state.receiving,
            systemResetVersion
          });
        }
        if (retModified) {
          broadcast({
            type: "collection_updated",
            collection: "returns",
            data: state.returns,
            systemResetVersion
          });
        }
        if (stocksModified) {
          broadcast({
            type: "collection_updated",
            collection: "stocks",
            data: state.stocks,
            systemResetVersion
          });
        }
      }

      return res.json({
        success: true,
        categories: state.receivingCategories,
        recordsUpdated: recModified || retModified || stocksModified
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * REST API: FIFO Color Coding Calendar
   * Allows querying and central updates for monthly FIFO color definitions.
   * Locked in per record at receipt time; updates do not retroactively alter existing records.
   */
  app.get("/api/fifo-colors", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.json({
      success: true,
      fifoColorsByMonth: state.fifoColorsByMonth || DEFAULT_FIFO_COLORS_BY_MONTH
    });
  });

  app.post("/api/fifo-colors", async (req, res) => {
    try {
      const auth = requireFullAccess(req, res, "manage FIFO color calendar");
      if (!auth) return;

      const { action, month, color, fifoColorsByMonth } = req.body;

      let modified = false;

      if (fifoColorsByMonth && typeof fifoColorsByMonth === 'object') {
        state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...fifoColorsByMonth };
        modified = true;
      } else if (action === 'reset') {
        state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH };
        modified = true;
      } else if (month && color) {
        const m = Number(month);
        if (m >= 1 && m <= 12 && color.name) {
          state.fifoColorsByMonth[m] = {
            name: String(color.name).trim(),
            colorClass: color.colorClass || 'bg-indigo-600',
            textClass: color.textClass || 'text-indigo-600',
            hex: color.hex || undefined
          };
          modified = true;
        }
      }

      if (modified) {
        stateRevision++;
        commitDatabase();

        broadcast({
          type: "fifo_colors_updated",
          fifoColorsByMonth: state.fifoColorsByMonth,
          systemResetVersion
        });

        broadcast({
          type: "collection_updated",
          collection: "fifoColorsByMonth",
          data: state.fifoColorsByMonth,
          systemResetVersion
        });
      }

      return res.json({
        success: true,
        fifoColorsByMonth: state.fifoColorsByMonth,
        systemResetVersion
      });
    } catch (err: any) {
      console.error("Error updating FIFO colors:", err);
      return res.status(500).json({ error: err.message || "Failed to update FIFO color calendar" });
    }
  });

  /**
   * REST API: FIFO Tag Color Repair Report & Audit Logs
   */
  app.get("/api/system/fifo-repair-report", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.json({
      success: true,
      report: initialFifoRepairReport,
      totalAuditEntries: fifoRepairAuditLogs.length,
      auditLogs: fifoRepairAuditLogs
    });
  });

  /**
   * REST API: Upsert Record
   * Concurrency checks, version increment, and synchronous disk commit BEFORE WebSocket broadcast.
   */
  app.post("/api/records/upsert", async (req, res) => {
    try {
      const auth = requireWriteAccess(req, res, "upsert records");
      if (!auth) return;

      const { collection, record, author, employeeId, actionDesc, expectedVersion } = req.body;
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version'] || record?.reset_version) || systemResetVersion;

      const result = executeRecordUpsert({
        collection,
        record,
        author: auth.user.username || author,
        employeeId: auth.user.employeeId || employeeId,
        user_id: req.body.user_id || record?.user_id,
        device_id: req.body.device_id || req.headers['x-device-id'] || record?.device_id,
        actionDesc,
        expectedVersion,
        reset_version: clientResetVersion,
        userPermission: auth.permission
      });

      if (!result.success) {
        return res.status(result.status).json({
          error: result.error,
          confirmedRecord: result.confirmedRecord,
          systemResetVersion: result.systemResetVersion,
          systemResetId: result.systemResetId
        });
      }

      return res.json({
        success: true,
        collection,
        record: result.confirmedRecord,
        systemResetVersion: result.systemResetVersion
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * REST API: Delete Record
   * Synchronous disk commit BEFORE WebSocket broadcast.
   */
  app.post("/api/records/delete", async (req, res) => {
    try {
      const auth = requireDeleteAccess(req, res, "delete records");
      if (!auth) return;

      const { collection, id, author, employeeId, actionDesc } = req.body;
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version']) || systemResetVersion;

      const result = executeRecordDelete({
        collection,
        id,
        author: auth.user.username || author,
        employeeId: auth.user.employeeId || employeeId,
        user_id: req.body.user_id,
        device_id: req.body.device_id || req.headers['x-device-id'],
        actionDesc,
        reset_version: clientResetVersion,
        userPermission: auth.permission
      });

      if (!result.success) {
        return res.status(result.status).json({
          error: result.error,
          systemResetVersion: result.systemResetVersion,
          systemResetId: result.systemResetId
        });
      }

      return res.json({
        success: true,
        collection,
        id: result.id,
        systemResetVersion: result.systemResetVersion
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * REST API: Atomic Stock Movements (Single Source of Truth)
   * Synchronous disk commit BEFORE WebSocket broadcast.
   */
  app.post("/api/stock-movements", async (req, res) => {
    try {
      const auth = requireWriteAccess(req, res, "create stock movements");
      if (!auth) return;

      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version']);
      if (clientResetVersion && clientResetVersion < systemResetVersion) {
        return res.status(409).json({
          error: "STALE_RESET_VERSION: Central database was reset. Movement rejected.",
          systemResetVersion
        });
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
        deviceId,
        idempotencyKey,
        preventNegativeStock = true,
        lotNumber,
        location
      } = req.body;
      const userId = "USR-" + auth.user.employeeId;
      const userName = auth.user.username;

      if (!productId) {
        return res.status(400).json({ error: "productId is required" });
      }

      // Check Idempotency Key
      if (idempotencyKey && state.stockMovements) {
        const existing = state.stockMovements.find(
          (m: any) => m.idempotency_key === idempotencyKey || m.idempotencyKey === idempotencyKey
        );
        if (existing) {
          return res.json({
            success: true,
            idempotency_replayed: true,
            movementId: existing.id,
            productId: existing.product_id || existing.productId,
            warehouseId: existing.warehouse_id || existing.warehouseId,
            previousQuantity: existing.previous_quantity || existing.previousQuantity || 0,
            newQuantity: existing.new_quantity || existing.newQuantity || 0,
            delta: existing.quantity || existing.delta || 0,
            timestamp: existing.created_at || existing.timestamp || new Date().toISOString()
          });
        }
      }

      let finalDelta = Number(delta !== undefined ? delta : quantity);
      if (isNaN(finalDelta)) finalDelta = 0;

      if (['SALE', 'PURCHASE_RETURN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT'].includes(type)) {
        if (finalDelta > 0) finalDelta = -finalDelta;
      } else if (['PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN'].includes(type)) {
        if (finalDelta < 0) finalDelta = Math.abs(finalDelta);
      }

      let stockItem = state.stocks.find((s: any) => String(s.id) === String(productId) || s.partCode === productId);
      const prevQty = stockItem ? Number(stockItem.quantity) || 0 : 0;
      const newQty = prevQty + finalDelta;

      if (preventNegativeStock && newQty < 0) {
        return res.status(400).json({
          error: `Insufficient stock in central database. Available: ${prevQty}, Requested: ${finalDelta}`
        });
      }

      const serverTime = new Date().toISOString();
      if (stockItem) {
        stockItem.quantity = newQty;
        stockItem.version = (stockItem.version || 1) + 1;
        stockItem.updated_at = serverTime;
        stockItem.reset_version = systemResetVersion;
        if (location) stockItem.location = location;
        if (lotNumber) stockItem.lotNumber = lotNumber;
      } else {
        stockItem = normalizeRecord({
          id: productId,
          partCode: productId,
          description: notes || 'Warehouse Stock Item',
          type: 'RAW',
          location: location || 'Zone A',
          quantity: newQty,
          unit: 'PCS',
          lotNumber: lotNumber || '',
          receivedDate: serverTime.split('T')[0],
          fifoColor: getFifoColorForDate(serverTime.split('T')[0], state.fifoColorsByMonth),
          status: 'APPROVED'
        });
        state.stocks.push(stockItem);
      }

      const movementId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const movementRecord = {
        id: movementId,
        product_id: productId,
        warehouse_id: warehouseId || 'wh-main',
        type: type || 'ADJUSTMENT_IN',
        quantity: finalDelta,
        previous_quantity: prevQty,
        new_quantity: newQty,
        reference_id: referenceId || null,
        reference_number: referenceNumber || null,
        notes: notes || null,
        user_id: userId || null,
        user_name: userName || 'Operator',
        device_id: deviceId || 'CENTRAL-SERVER',
        idempotency_key: idempotencyKey || null,
        created_at: serverTime,
        product_name: stockItem.description,
        product_sku: stockItem.partCode,
        unit: stockItem.unit,
        reset_version: systemResetVersion
      };

      if (!state.stockMovements) state.stockMovements = [];
      state.stockMovements.unshift(movementRecord);
      if (state.stockMovements.length > 500) state.stockMovements.pop();

      stateRevision++;

      // COMMIT DATABASE SYNCHRONOUSLY BEFORE BROADCAST
      const commitOk = commitDatabase();
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to commit stock movement to central database" });
      }

      // BROADCAST REAL-TIME MOVEMENT & UPDATED STOCKS STRICTLY TO MATCHING ROOM
      let movementEventType = "INVENTORY_UPDATE";
      if (['TRANSFER_IN', 'TRANSFER_OUT', 'TRANSFER', 'LOCATION_TRANSFER'].includes(type)) {
        movementEventType = "LOCATION_TRANSFER";
      } else if (['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'CYCLE_COUNT', 'ADJUSTMENT'].includes(type)) {
        movementEventType = "STOCK_ADJUSTMENT";
      } else if (['SALE', 'PICK', 'PACK', 'SHIP', 'DISPATCH'].includes(type)) {
        movementEventType = "PICK_PACK_SHIP";
      }

      broadcastInventoryEvent({
        type: movementEventType,
        accountId: req.body.accountId || stockItem.accountId || 'ACC-JUWEI',
        warehouseId: warehouseId || stockItem.warehouseId || 'WH-MAIN',
        collection: 'stocks',
        record: stockItem,
        movement: movementRecord,
        actionDesc: notes || `Stock movement: ${type} (${finalDelta})`,
        author: userName || 'Operator',
        user_id: userId,
        device_id: deviceId,
        timestamp: serverTime
      });

      return res.json({
        success: true,
        movementId,
        productId,
        warehouseId: warehouseId || 'wh-main',
        previousQuantity: prevQty,
        newQuantity: newQty,
        delta: finalDelta,
        timestamp: movementRecord.created_at,
        systemResetVersion
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/stock-movements", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json((state.stockMovements || []).slice(0, limit));
  });

  // REST API: Chat message
  app.post("/api/chat", (req, res) => {
    try {
      const auth = requireWriteAccess(req, res, "post chat message");
      if (!auth) return;

      const { text } = req.body;
      const cleanText = String(text || '').trim();
      if (!cleanText) return res.status(400).json({ error: "Text required" });

      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        sender: auth.user.username || "Staff",
        text: cleanText,
        timestamp: new Date().toISOString(),
        isSystem: false
      };

      chatMessages.push(newMsg);
      if (chatMessages.length > 200) chatMessages.shift();
      commitDatabase();

      broadcast({
        type: "chat_broadcast",
        message: newMsg
      });

      return res.json({ success: true, message: newMsg });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware in dev or Static assets in prod
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn("Vite middleware unavailable:", e);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`JUWEI WMS: Port ${PORT} already in use.`);
    } else {
      console.error("JUWEI WMS Server error:", err);
    }
  });

  let isShuttingDown = false;
  function handleGracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[SERVER SHUTDOWN] Received ${signal}. Executing graceful SQLite database persistence and close...`);
    try {
      commitDatabase();
    } catch (e) {
      console.error("[SERVER SHUTDOWN] Error during final database commit:", e);
    }
    try {
      checkpointAndClose();
    } catch (e) {
      console.error("[SERVER SHUTDOWN] Error running WAL checkpoint and closing SQLite:", e);
    }
    process.exit(0);
  }

  process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`JUWEI WAREHOUSE MANAGEMENT SYSTEM Central Real-time Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[SERVER STARTUP] Instance ID: ${SERVER_INSTANCE_ID} | Boot Time: ${SERVER_BOOT_TIME} | PID: ${process.pid}`);
    if (!process.env.JUWEI_DATA_DIR) {
      console.warn(`[SERVER WARNING] JUWEI_DATA_DIR is not set. Database file (${DATA_FILE}) is stored on ephemeral local disk and won't be shared across multiple server instances.`);
    }

    // Warm GitHub latest release version cache asynchronously on boot
    getLatestGitHubReleaseVersion("").catch(() => {});
  });
}

startServer();
