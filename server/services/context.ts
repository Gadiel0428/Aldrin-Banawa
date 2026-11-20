/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Server Runtime Context, Constants & Collection State Container
 */

import fs from "fs";
import type { WebSocket, WebSocketServer } from "ws";
import type { ServerConfig } from "../config.ts";
import type {
  AuditTrailEntry,
  AuthorizedDevice,
  BackupAuditEntry,
  CentralDatabaseState,
  ChatMessage,
  DeliveryRecord,
  EnvironmentalLog,
  FifoColorsMap,
  FifoRepairAuditEntry,
  ForkliftChecklist,
  IssuanceRecord,
  MasterRegistryItem,
  MaterialStockItem,
  PinAuditEntry,
  ReceivingRecord,
  RecyclingRecord,
  RegisteredAccount,
  ReturnRecord,
} from "../../shared/types.ts";

export const MAX_AUDIT_TRAIL_ENTRIES = 5000;

export const INITIAL_STOCK: MaterialStockItem[] = [];
export const INITIAL_RECEIVING: ReceivingRecord[] = [];
export const INITIAL_RETURNS: ReturnRecord[] = [];
export const INITIAL_RECYCLING: RecyclingRecord[] = [];
export const INITIAL_ISSUANCE: IssuanceRecord[] = [];
export const INITIAL_DELIVERIES: DeliveryRecord[] = [];
export const INITIAL_ENV_LOGS: EnvironmentalLog[] = [];
export const INITIAL_FORKLIFT_CHECKS: ForkliftChecklist[] = [];

export const DEFAULT_OPERATIONAL_ROLES: string[] = [
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
  "INTERNAL AUDITOR",
];

export const DEFAULT_RECEIVING_CATEGORIES: string[] = [
  "RESIN/RAW MATERIALS",
  "INDIRECT BOM",
  "DIRECT BOM",
  "CONSUMABLES",
  "PACKAGING MATERIALS",
  "WIP (WORK IN PROGRESS)",
  "FG (FINISHED GOOD)",
  "OFFICE SUPPLIES",
];

export const DEFAULT_FIFO_COLORS_BY_MONTH: FifoColorsMap = {
  1: { name: "Magenta", colorClass: "bg-fuchsia-600", textClass: "text-fuchsia-600", hex: "#c026d3" },
  2: { name: "Orange", colorClass: "bg-orange-500", textClass: "text-orange-500", hex: "#f97316" },
  3: { name: "Dark Green", colorClass: "bg-emerald-800", textClass: "text-emerald-800", hex: "#065f46" },
  4: { name: "Yellow", colorClass: "bg-yellow-400", textClass: "text-yellow-600", hex: "#facc15" },
  5: { name: "Navy Blue", colorClass: "bg-blue-900", textClass: "text-blue-900", hex: "#1e3a8a" },
  6: { name: "Brown", colorClass: "bg-amber-800", textClass: "text-amber-800", hex: "#92400e" },
  7: { name: "Pink", colorClass: "bg-pink-400", textClass: "text-pink-400", hex: "#f472b6" },
  8: { name: "Violet", colorClass: "bg-violet-600", textClass: "text-violet-600", hex: "#7c3aed" },
  9: { name: "Black", colorClass: "bg-stone-900", textClass: "text-stone-900", hex: "#1c1917" },
  10: { name: "Light Orange", colorClass: "bg-orange-300", textClass: "text-orange-400", hex: "#fdba74" },
  11: { name: "Grey", colorClass: "bg-slate-500", textClass: "text-slate-500", hex: "#64748b" },
  12: { name: "Silver", colorClass: "bg-slate-300", textClass: "text-slate-400", hex: "#cbd5e1" },
};

export const FIFO_KNOWN_COLOR_NAMES = new Set<string>(
  [
    "Magenta", "Orange", "Dark Green", "Yellow", "Navy Blue", "Brown", "Pink",
    "Violet", "Black", "Light Orange", "Grey", "Silver",
    "Red", "Crimson", "Blue", "Sky Blue", "Green", "Lime", "Teal", "Cyan",
    "Purple", "Indigo", "Amber", "Gold", "White",
  ].map((s: string) => s.toLowerCase())
);

export const STARTER_BARCODE_PRESETS: MasterRegistryItem[] = [
  {
    id: "REG-BCP-RESIN-001",
    type: "BARCODE_PRESET",
    code: "SAMPLE-RESIN-001",
    name: "PC/ABS CYCOLOY RESIN PELLETS",
    description: "High-impact flame retardant engineering plastic resin pellets for injection molding",
    category: "RESIN/RAW MATERIALS",
    unit: "KGS",
    vendorSupplier: "SABIC INNOVATIVE PLASTICS",
    location: "RAW-ZONE-A1",
    presetSource: "EXTERNAL",
    status: "ACTIVE",
    dateRegistered: "2026-10-02",
  },
  {
    id: "REG-BCP-IND-001",
    type: "BARCODE_PRESET",
    code: "SAMPLE-IND-001",
    name: "THERMAL CONDUCTIVE SILICONE GREASE",
    description: "High-efficiency thermal interface compound for heatsink and PCB assembly",
    category: "INDIRECT BOM",
    unit: "TUBES",
    vendorSupplier: "SHIN-ETSU CHEMICAL CO.",
    location: "CHEM-SHELF-B2",
    presetSource: "EXTERNAL",
    status: "ACTIVE",
    dateRegistered: "2026-10-02",
  },
  {
    id: "REG-BCP-DIR-001",
    type: "BARCODE_PRESET",
    code: "SAMPLE-DIR-001",
    name: "M3X8MM STAINLESS STEEL MACHINE SCREW",
    description: "Phillips pan-head SUS304 precision fastener for chassis sub-assembly",
    category: "DIRECT BOM",
    unit: "PCS",
    vendorSupplier: "FASTENAL INDUSTRIAL SUPPLIES",
    location: "FAST-BIN-C3",
    presetSource: "EXTERNAL",
    status: "ACTIVE",
    dateRegistered: "2026-10-02",
  },
  {
    id: "REG-BCP-CON-001",
    type: "BARCODE_PRESET",
    code: "SAMPLE-CON-001",
    name: "ESD ANTISTATIC CLEANROOM WIPES",
    description: "9x9 inch lint-free polyester microfiber wipes for optical and SMT cleaning",
    category: "CONSUMABLES",
    unit: "PACKS",
    vendorSupplier: "CLEANROOM PRO DYNAMICS",
    location: "CONS-RACK-D1",
    presetSource: "EXTERNAL",
    status: "ACTIVE",
    dateRegistered: "2026-10-02",
  },
  {
    id: "REG-BCP-PKG-001",
    type: "BARCODE_PRESET",
    code: "SAMPLE-PKG-001",
    name: "CORRUGATED SHIPPER CARTON 400X300X250",
    description: "Double-wall heavy duty B/C flute export shipping carton with preprinted handling symbols",
    category: "PACKAGING MATERIALS",
    unit: "PCS",
    vendorSupplier: "INTERNATIONAL PACKAGING CORP",
    location: "PKG-MEZZ-E4",
    presetSource: "EXTERNAL",
    status: "ACTIVE",
    dateRegistered: "2026-10-02",
  },
  {
    id: "REG-BCP-WIP-001",
    type: "BARCODE_PRESET",
    code: "SAMPLE-WIP-001",
    name: "MOLDED FRONT HOUSING SUB-ASSEMBLY",
    description: "Precision injection molded bezel frame awaiting ultrasonic brass insert staking",
    category: "WIP (WORK IN PROGRESS)",
    unit: "PCS",
    vendorSupplier: "PLASTICS INJECTION LINE 2",
    location: "WIP-STAGE-F1",
    presetSource: "INTERNAL",
    status: "ACTIVE",
    dateRegistered: "2026-10-02",
  },
  {
    id: "REG-BCP-FG-001",
    type: "BARCODE_PRESET",
    code: "SAMPLE-FG-001",
    name: "SMART IOT SENSOR NODE CONTROLLER",
    description: "Fully assembled, calibrated and QC approved wireless industrial sensor unit",
    category: "FG (FINISHED GOOD)",
    unit: "PCS",
    vendorSupplier: "FINAL ASSEMBLY DEPT 1",
    location: "FG-AISLE-G2",
    presetSource: "INTERNAL",
    status: "ACTIVE",
    dateRegistered: "2026-10-02",
  },
  {
    id: "REG-BCP-OFF-001",
    type: "BARCODE_PRESET",
    code: "SAMPLE-OFF-001",
    name: "DIRECT THERMAL BARCODE LABELS 4X6",
    description: "Standard perforated warehouse shipping label rolls for Zebra industrial printers",
    category: "OFFICE SUPPLIES",
    unit: "ROLLS",
    vendorSupplier: "OFFICE SUPPLY DEPOT PH",
    location: "ADMIN-CAB-H1",
    presetSource: "EXTERNAL",
    status: "ACTIVE",
    dateRegistered: "2026-10-02",
  },
];

export const DEFAULT_SUPER_ADMIN: RegisteredAccount = {
  id: "USR-JPMP-002",
  employeeId: "JPMP-002",
  username: "ALDRIN BANAWA",
  role: "SUPER ADMINISTRATOR",
  phoneNumber: "+639669858846",
  permission: "FULL_ACCESS",
  status: "ACTIVE",
  registeredBy: "INITIAL_INSTALLATION_SUPER_ADMIN",
  registeredBySuperAdmin: true,
  registeredAt: "2026-09-09T08:00:00.000Z",
  stationId: "WS-MASTER-01",
  deviceId: "dev_primary_admin_pc",
  isPrimaryAdminDevice: true,
  authorizedDevices: ["dev_primary_admin_pc"],
  version: 1,
  updated_at: "2026-09-09T08:00:00.000Z",
  reset_version: 1788945000000,
};

export interface ConnectedDevice {
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

export interface ActiveConnectionRecord {
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

export interface SessionTokenEntry {
  employeeId: string;
  deviceId?: string;
  createdAt: number;
}

export interface FifoStartupRepairReport {
  stocksScanned: number;
  stocksRepaired: number;
  receivingScanned: number;
  receivingRepaired: number;
  repairs: FifoRepairAuditEntry[];
}

export interface RequestAuthContext {
  deviceId: string;
  deviceRecord?: AuthorizedDevice;
  account?: RegisteredAccount;
  permission: string;
  employeeId: string;
  authenticated: boolean;
}

export interface UpsertExecutionResult {
  success: boolean;
  status: number;
  error?: string;
  confirmedRecord?: any;
  currentRecord?: any;
  isCreation?: boolean;
  systemResetVersion?: number;
  systemResetId?: string;
}

export interface DeleteExecutionResult {
  success: boolean;
  status: number;
  error?: string;
  id?: string;
  collection?: string;
  currentRecord?: any;
  confirmedRecord?: any;
  systemResetVersion?: number;
  systemResetId?: string;
}

export interface ServerContext {
  serverInstanceId: string;
  serverBootTime: string;
  config: ServerConfig;
  wss: WebSocketServer;

  // Authoritative state & reset metadata
  state: CentralDatabaseState;
  installationId: string;
  primaryDeviceId: string;
  systemResetVersion: number;
  systemResetTimestamp: string;
  systemResetId: string;
  systemResetBy: string;
  stateRevision: number;
  oneTimeSetupPin: string | null;

  // Registries & collections
  authorizedDevicesMap: Map<string, AuthorizedDevice>;
  deletedRecordTombstones: Set<string>;
  deletedUserTombstones: Set<string>;
  sessionTokensMap: Map<string, SessionTokenEntry>;
  activeDevices: Map<string, ConnectedDevice>;
  connectionRegistry: Map<string, ActiveConnectionRecord>;
  socketToConnectionId: WeakMap<WebSocket, string>;
  accountRooms: Map<string, Set<WebSocket>>;
  warehouseRooms: Map<string, Set<WebSocket>>;
  socketToRoomMeta: WeakMap<WebSocket, { accountId: string; warehouseId: string }>;
  chatMessages: ChatMessage[];

  // Audit logs & file paths
  backupAuditLogFile: string;
  backupAuditLogs: BackupAuditEntry[];
  pinAuditLogFile: string;
  pinAuditLogs: PinAuditEntry[];
  auditTrailFile: string;
  auditTrailLogs: AuditTrailEntry[];
  auditTrailFileExistsOnBoot: boolean;
  fifoRepairAuditLogFile: string;
  fifoRepairAuditLogs: FifoRepairAuditEntry[];
  initialFifoRepairReport: FifoStartupRepairReport;

  // Backup & Release cache state
  isBackupInProgress: boolean;
  cachedGitHubVersion: string | null;
  lastGitHubFetchTimestamp: number;
  isFetchingGitHubRelease: boolean;
  releasePersistFile: string;
}

export function normalizeBaseRecord(
  item: Record<string, any>,
  systemResetVersion: number,
  existingItem?: Record<string, any>
): Record<string, any> {
  const id = String(
    item.id || existingItem?.id || `REC-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  );
  const version = existingItem ? (Number(existingItem.version) || 1) + 1 : Number(item.version) || 1;
  const updated_at = item.updated_at || new Date().toISOString();
  const reset_version =
    Number(item.reset_version) || Number(existingItem?.reset_version) || systemResetVersion;

  return {
    ...item,
    id,
    record_id: item.record_id || id,
    version,
    updated_at,
    reset_version,
  };
}

function readJsonArrayFile<T>(filePath: string): { exists: boolean; items: T[] } {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      return { exists: true, items: Array.isArray(parsed) ? (parsed as T[]) : [] };
    }
  } catch {
    return { exists: false, items: [] };
  }
  return { exists: false, items: [] };
}

export function createServerContext(params: {
  serverInstanceId: string;
  serverBootTime: string;
  config: ServerConfig;
  wss: WebSocketServer;
}): ServerContext {
  const { serverInstanceId, serverBootTime, config, wss } = params;
  const systemResetVersion = 1;
  const backupAuditLogFile = config.getStorageFilePath("backup-audit-log.json");
  const pinAuditLogFile = config.getStorageFilePath("pin-audit-log.json");
  const auditTrailFile = config.getStorageFilePath("audit-trail.json");
  const fifoRepairAuditLogFile = config.getStorageFilePath("fifo-repair-audit-log.json");
  const releasePersistFile = config.getStorageFilePath("latest-github-release.json");

  const backupAuditRead = readJsonArrayFile<BackupAuditEntry>(backupAuditLogFile);
  const pinAuditRead = readJsonArrayFile<PinAuditEntry>(pinAuditLogFile);
  const auditTrailRead = readJsonArrayFile<AuditTrailEntry>(auditTrailFile);
  const fifoRepairRead = readJsonArrayFile<FifoRepairAuditEntry>(fifoRepairAuditLogFile);

  return {
    serverInstanceId,
    serverBootTime,
    config,
    wss,
    state: {
      stocks: INITIAL_STOCK.map((item: MaterialStockItem) => normalizeBaseRecord(item, systemResetVersion) as MaterialStockItem),
      receiving: INITIAL_RECEIVING.map((item: ReceivingRecord) => normalizeBaseRecord(item, systemResetVersion) as ReceivingRecord),
      returns: INITIAL_RETURNS.map((item: ReturnRecord) => normalizeBaseRecord(item, systemResetVersion) as ReturnRecord),
      recycling: INITIAL_RECYCLING.map((item: RecyclingRecord) => normalizeBaseRecord(item, systemResetVersion) as RecyclingRecord),
      issuances: INITIAL_ISSUANCE.map((item: IssuanceRecord) => normalizeBaseRecord(item, systemResetVersion) as IssuanceRecord),
      deliveries: INITIAL_DELIVERIES.map((item: DeliveryRecord) => normalizeBaseRecord(item, systemResetVersion) as DeliveryRecord),
      envLogs: INITIAL_ENV_LOGS.map((item: EnvironmentalLog) => normalizeBaseRecord(item, systemResetVersion) as EnvironmentalLog),
      forkliftChecks: INITIAL_FORKLIFT_CHECKS.map((item: ForkliftChecklist) => normalizeBaseRecord(item, systemResetVersion) as ForkliftChecklist),
      registries: [...STARTER_BARCODE_PRESETS],
      registeredUsers: [{ ...DEFAULT_SUPER_ADMIN }],
      stockMovements: [],
      operationalRoles: [...DEFAULT_OPERATIONAL_ROLES],
      receivingCategories: [...DEFAULT_RECEIVING_CATEGORIES],
      fifoColorsByMonth: { ...DEFAULT_FIFO_COLORS_BY_MONTH },
    },
    installationId: "INS-2026-JUWEI-PRIM01",
    primaryDeviceId: "dev_primary_admin_pc",
    systemResetVersion,
    systemResetTimestamp: new Date().toISOString(),
    systemResetId: "RESET-INIT",
    systemResetBy: "SUPER ADMINISTRATOR",
    stateRevision: 1,
    oneTimeSetupPin: null,
    authorizedDevicesMap: new Map<string, AuthorizedDevice>([
      [
        "dev_primary_admin_pc",
        {
          deviceId: "dev_primary_admin_pc",
          deviceName: "Primary Administrator PC (Workstation)",
          isPrimaryAdminDevice: true,
          status: "AUTHORIZED",
          authorizedBy: "INITIAL_SUPER_ADMIN_BINDING",
          authorizedAt: "2026-09-09T08:00:00.000Z",
        },
      ],
    ]),
    deletedRecordTombstones: new Set<string>(),
    deletedUserTombstones: new Set<string>(),
    sessionTokensMap: new Map<string, SessionTokenEntry>(),
    activeDevices: new Map<string, ConnectedDevice>(),
    connectionRegistry: new Map(),
    socketToConnectionId: new WeakMap(),
    accountRooms: new Map(),
    warehouseRooms: new Map(),
    socketToRoomMeta: new WeakMap(),
    chatMessages: [
      {
        id: "sys-init",
        sender: "System",
        text: "JUWEI WAREHOUSE MANAGEMENT SYSTEM Central Database & WebSocket Real-time Engine Initialized.",
        timestamp: new Date().toISOString(),
        isSystem: true,
      },
    ],
    backupAuditLogFile,
    backupAuditLogs: backupAuditRead.items,
    pinAuditLogFile,
    pinAuditLogs: pinAuditRead.items,
    auditTrailFile,
    auditTrailLogs: auditTrailRead.items,
    auditTrailFileExistsOnBoot: auditTrailRead.exists,
    fifoRepairAuditLogFile,
    fifoRepairAuditLogs: fifoRepairRead.items,
    initialFifoRepairReport: {
      stocksScanned: 0,
      stocksRepaired: 0,
      receivingScanned: 0,
      receivingRepaired: 0,
      repairs: [],
    },
    isBackupInProgress: false,
    cachedGitHubVersion: null,
    lastGitHubFetchTimestamp: 0,
    isFetchingGitHubRelease: false,
    releasePersistFile,
  };
}
