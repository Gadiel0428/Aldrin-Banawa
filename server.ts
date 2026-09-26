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
  const PORT = 3000;

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
  const DATA_FILE = getStorageFilePath("central-database.json");

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
    operationalRoles: string[];
    receivingCategories: string[];
  } = {
    stocks: INITIAL_STOCK.map((item: any) => normalizeRecord(item)),
    receiving: INITIAL_RECEIVING.map((item: any) => normalizeRecord(item)),
    returns: INITIAL_RETURNS.map((item: any) => normalizeRecord(item)),
    recycling: INITIAL_RECYCLING.map((item: any) => normalizeRecord(item)),
    issuances: INITIAL_ISSUANCE.map((item: any) => normalizeRecord(item)),
    deliveries: INITIAL_DELIVERIES.map((item: any) => normalizeRecord(item)),
    envLogs: INITIAL_ENV_LOGS.map((item: any) => normalizeRecord(item)),
    forkliftChecks: INITIAL_FORKLIFT_CHECKS.map((item: any) => normalizeRecord(item)),
    registries: [],
    registeredUsers: [{ ...defaultSuperAdmin }],
    stockMovements: [],
    operationalRoles: [...DEFAULT_OPERATIONAL_ROLES],
    receivingCategories: [...DEFAULT_RECEIVING_CATEGORIES],
  };

  /**
   * Authoritative Disk Persistence: Synchronous Commit
   * DATABASE COMMIT MUST ALWAYS HAPPEN BEFORE A WEBSOCKET EVENT IS BROADCAST.
   */
  function commitDatabase(): boolean {
    try {
      const payload = JSON.stringify({
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
        operationalRoles: state.operationalRoles || [...DEFAULT_OPERATIONAL_ROLES],
        receivingCategories: state.receivingCategories || [...DEFAULT_RECEIVING_CATEGORIES],
        authorizedDevices: Array.from(authorizedDevicesMap.values()),
        deletedRecordTombstones: Array.from(deletedRecordTombstones),
        deletedUserTombstones: Array.from(deletedUserTombstones),
        chatMessages: chatMessages.slice(-200)
      }, null, 2);

      const targetDir = path.dirname(DATA_FILE);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Write atomically using temporary file rename
      const tempPath = `${DATA_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, payload, "utf-8");
      fs.renameSync(tempPath, DATA_FILE);
      return true;
    } catch (err) {
      console.error("CRITICAL: Failed atomic database commit to disk:", err);
      try {
        // Direct write fallback
        fs.writeFileSync(DATA_FILE, JSON.stringify({
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
          operationalRoles: state.operationalRoles || [...DEFAULT_OPERATIONAL_ROLES],
          receivingCategories: state.receivingCategories || [...DEFAULT_RECEIVING_CATEGORIES],
          authorizedDevices: Array.from(authorizedDevicesMap.values())
        }, null, 2), "utf-8");
        return true;
      } catch (fallbackErr) {
        console.error("CRITICAL: Direct database write fallback also failed:", fallbackErr);
        return false;
      }
    }
  }

  // Load persisted state from disk on server initialization
  function loadDatabaseFromDisk() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw);

        if (parsed) {
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
                } else {
                  // Ensure all loaded records have mandatory fields
                  (state as any)[key] = parsed.state[key].map((rec: any) => normalizeRecord(rec));
                }
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

          if (Array.isArray(parsed.deletedRecordTombstones)) {
            parsed.deletedRecordTombstones.forEach((id: string) => markRecordTombstone(id));
          }
          if (Array.isArray(parsed.deletedUserTombstones)) {
            parsed.deletedUserTombstones.forEach((empId: string) => markUserTombstone(empId));
          }
          if (Array.isArray(parsed.chatMessages)) {
            chatMessages.length = 0;
            chatMessages.push(...parsed.chatMessages);
          }

          console.log(`JUWEI WMS: Central Database loaded from disk. Reset Version: v${systemResetVersion} (${systemResetId})`);
        }
      } else {
        // Save initial seed state
        commitDatabase();
        console.log(`JUWEI WMS: Central Database initialized with seed datasets.`);
      }

      // Ensure Super Administrator JPMP-002 is always present and active, bound to primary device
      const superAdminIndex = state.registeredUsers.findIndex(
        u => (u.employeeId || '').toUpperCase().trim() === 'JPMP-002'
      );
      if (superAdminIndex === -1) {
        state.registeredUsers.unshift({ ...defaultSuperAdmin, deviceId: primaryDeviceId });
        commitDatabase();
      } else {
        const existing = state.registeredUsers[superAdminIndex];
        state.registeredUsers[superAdminIndex] = {
          ...existing,
          deviceId: existing.deviceId || primaryDeviceId,
          isPrimaryAdminDevice: true,
          authorizedDevices: Array.from(new Set([...(existing.authorizedDevices || []), primaryDeviceId]))
        };
      }
    } catch (err) {
      console.warn("JUWEI WMS: Notice loading database from disk:", err);
    }
  }

  loadDatabaseFromDisk();

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
      return { success: false, status: 403, error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." };
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
      return { success: false, status: 403, error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." };
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
      const authToken = parsedUrl.searchParams.get("token") || parsedUrl.searchParams.get("auth_token") || (req.headers["authorization"] ? req.headers["authorization"].replace(/^Bearer\s+/i, "") : "");

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
      user_id: "ANONYMOUS",
      session_id: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      device_id: `dev_${Math.random().toString(36).substring(2, 9)}`,
      stationId: "",
      employeeId: "",
      username: "CONNECTING TERMINAL",
      role: "OPERATOR",
      permission: "LIMITED_ACCESS",
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

            const employeeId = String(payload.employeeId || "").trim().toUpperCase();
            const username = String(payload.username || (employeeId === 'JPMP-002' ? 'ALDRIN BANAWA' : 'OPERATOR')).trim().toUpperCase();
            const role = String(payload.role || (employeeId === 'JPMP-002' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE OPERATOR')).trim().toUpperCase();
            const permission = String(payload.permission || (employeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS')).trim();
            const activeView = String(payload.activeView || "dashboard").trim();
            const stationId = String(payload.stationId || "").trim();
            const deviceId = String(payload.device_id || payload.deviceId || conn.device_id).trim();
            const sessionId = String(payload.session_id || payload.sessionId || conn.session_id).trim();
            const userId = String(payload.user_id || payload.userId || (employeeId ? `USR-${employeeId}` : conn.user_id)).trim();
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
              appVersion: '1.0.0',
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
                fifoColor: 'Dark Green',
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
              user_id: conn?.user_id || 'OPERATOR',
              user_name: conn?.username || 'Operator',
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
              author: conn?.username || "Operator",
              user_id: conn?.user_id,
              device_id: conn?.device_id
            });
            break;
          }

          case "LOCATION_TRANSFER":
          case "transfer_location": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
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
              user_id: conn?.user_id || 'OPERATOR',
              user_name: conn?.username || 'Operator',
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
              author: conn?.username || "Operator",
              user_id: conn?.user_id,
              device_id: conn?.device_id
            });
            break;
          }

          case "PICK_PACK_SHIP":
          case "pick_pack_ship": {
            const connId = socketToConnectionId.get(ws) || connection_id;
            const conn = connectionRegistry.get(connId);
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
              user_id: conn?.user_id || 'OPERATOR',
              user_name: conn?.username || 'Operator',
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
              author: conn?.username || "Operator",
              user_id: conn?.user_id,
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
            const clientResetVersion = Number(payload.reset_version || payload.currentResetVersion) || conn?.resetVersion || systemResetVersion;

            const upsertRes = executeRecordUpsert({
              collection: payload.collection,
              record: payload.record,
              author: payload.author || conn?.username || "Operator",
              employeeId: payload.employeeId || conn?.employeeId,
              user_id: payload.user_id || conn?.user_id,
              device_id: payload.device_id || conn?.deviceId || payload.record?.device_id,
              actionDesc: payload.actionDesc,
              expectedVersion: payload.expectedVersion,
              reset_version: clientResetVersion,
              userPermission: conn?.permission,
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
            const clientResetVersion = Number(payload.reset_version || payload.currentResetVersion) || conn?.resetVersion || systemResetVersion;
            const targetId = String(payload.id || payload.record_id || payload.recordId || "");

            const deleteRes = executeRecordDelete({
              collection: payload.collection,
              id: targetId,
              author: payload.author || conn?.username || "Operator",
              employeeId: payload.employeeId || conn?.employeeId,
              user_id: payload.user_id || conn?.user_id,
              device_id: payload.device_id || conn?.deviceId,
              actionDesc: payload.actionDesc,
              reset_version: clientResetVersion,
              userPermission: conn?.permission,
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

            if (conn?.permission === 'VIEW_ONLY') {
              ws.send(JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 }));
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

            const items: any[] = Array.isArray(payload.data) ? payload.data : [];
            const currentList: any[] = (state as any)[col] || [];
            const listMap = new Map<string, any>(currentList.map(item => [String(item.id || item.record_id), item]));

            let modifiedCount = 0;
            const serverTime = new Date().toISOString();
            const effectiveAuthor = payload.author || conn?.username || "Operator";
            const effectiveEmpId = payload.employeeId || conn?.employeeId;
            const effectiveDevId = payload.device_id || conn?.deviceId || 'DEV-CENTRAL';
            const effectiveUserId = payload.user_id || conn?.user_id || (effectiveEmpId ? `USR-${effectiveEmpId}` : `USR-${effectiveAuthor}`);

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
                listMap.set(recId, updatedRec);
                modifiedCount++;
              } else {
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
                  author: m.author || conn?.username || "Operator",
                  employeeId: m.employeeId || conn?.employeeId,
                  user_id: m.user_id || conn?.user_id,
                  device_id: m.device_id || conn?.deviceId,
                  reset_version: clientResetVersion
                });
                if (res.success) processed++;
              } else if (m.type === 'delete' && m.collection && (m.id || m.recordId)) {
                const res = executeRecordDelete({
                  collection: m.collection,
                  id: String(m.id || m.recordId),
                  author: m.author || conn?.username || "Operator",
                  employeeId: m.employeeId || conn?.employeeId,
                  user_id: m.user_id || conn?.user_id,
                  device_id: m.device_id || conn?.deviceId,
                  reset_version: clientResetVersion
                });
                if (res.success) processed++;
              }
            }

            console.log(`[CENTRAL-DB] [WS-BATCH-MUTATIONS] Processed ${processed}/${mutations.length} mutations | User: ${conn?.username || 'Operator'} | Device: ${conn?.deviceId || 'Terminal'}`);

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
              data: filterDataForClient({ ...state, chatMessages }, conn?.permission || "LIMITED_ACCESS", conn?.employeeId),
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
              if (payload.activeView) conn.activeView = payload.activeView;
              if (payload.stationId) conn.stationId = payload.stationId;
              if (payload.username) conn.username = payload.username.toUpperCase();
              if (payload.employeeId) conn.employeeId = payload.employeeId.toUpperCase();
              if (payload.role) conn.role = payload.role.toUpperCase();
              if (payload.permission) conn.permission = payload.permission;
              conn.lastPing = Date.now();
              broadcastPresenceSync();
            }
            break;
          }

          case "force_sync_all":
          case "sync_all_workstations": {
            const author = payload.author || "SUPER ADMINISTRATOR";
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
            const newMsg: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              sender: payload.username || payload.sender || "Staff",
              text: String(payload.text || '').trim(),
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
            const newUser = payload.user;
            if (!newUser || !newUser.employeeId) break;
            const cleanEmpId = String(newUser.employeeId).trim().toUpperCase();
            const cleanUsername = String(newUser.username || '').trim().toUpperCase();

            unmarkUserTombstone(cleanEmpId);

            const existingIdx = state.registeredUsers.findIndex(u => u.employeeId.toUpperCase() === cleanEmpId);
            const userToStore: ServerUser = {
              id: newUser.id || `USR-${cleanEmpId}`,
              employeeId: cleanEmpId,
              username: cleanUsername,
              role: String(newUser.role || 'WAREHOUSE CLERK').trim().toUpperCase(),
              phoneNumber: newUser.phoneNumber ? String(newUser.phoneNumber).trim() : '',
              permission: String(newUser.permission || 'LIMITED_ACCESS').trim(),
              pin: String(newUser.pin || '1234').trim().slice(0, 4),
              status: 'ACTIVE',
              registeredBy: payload.author || newUser.registeredBy || 'JPMP-002 (ALDRIN BANAWA)',
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

            const authorName = payload.author || "Super Administrator";
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
              pin: updated.pin ? String(updated.pin).trim().slice(0, 4) : existing.pin,
              version: (existing.version || 1) + 1,
              updated_at: new Date().toISOString(),
              reset_version: systemResetVersion
            };

            state.registeredUsers[existingIdx] = mergedUser;
            stateRevision++;
            commitDatabase();

            const authorName = payload.author || "Admin";
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

          case "client_installed": {
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
            const actText = String(payload.text || payload.action || '').trim();
            if (actText) {
              const newMsg: ChatMessage = {
                id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                sender: "SYSTEM",
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

  // REST API: Build Info for Live Application Updates
  app.get(["/api/build-info", "/build-info.json"], (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const possiblePaths = [
      path.join(process.cwd(), "dist", "build-info.json"),
      path.join(process.cwd(), "public", "build-info.json"),
      path.join(process.cwd(), "build-info.json"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          const content = JSON.parse(fs.readFileSync(p, "utf8"));
          return res.json(content);
        } catch (e) {}
      }
    }

    // Dynamic fallback if running in dev mode or prior to write-build-info
    let dynamicVersion = "";
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
      if (pkg.version) dynamicVersion = String(pkg.version).replace(/^v/i, "");
    } catch (e) {}

    return res.json({
      buildId: 0,
      version: dynamicVersion,
      isDevelopmentFallback: true
    });
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
    const author = req.body?.author || "SUPER ADMINISTRATOR";
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

    const clientEmpId = (req.headers['x-employee-id'] as string) || '';
    const clientPermission = (req.headers['x-permission'] as string) || '';

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
      const { collection, data, reset_version, author, employeeId, device_id } = req.body;
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

      const clientPermission = (req.headers['x-user-permission'] || req.body.permission || '').toString().toUpperCase();
      if (clientPermission === 'VIEW_ONLY') {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
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

      const items: any[] = Array.isArray(data) ? data : [];
      const currentList: any[] = (state as any)[collection] || [];
      const listMap = new Map<string, any>(currentList.map(it => [String(it.id || it.record_id), it]));

      let modifiedCount = 0;
      const serverTime = new Date().toISOString();
      const effectiveAuthor = author || employeeId || "Operator";
      const effectiveDevId = String(device_id || req.headers['x-device-id'] || 'DEV-CENTRAL').trim();
      const effectiveUserId = String(req.body.user_id || (employeeId ? `USR-${employeeId}` : `USR-${effectiveAuthor}`)).trim();

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
          listMap.set(recId, updatedRec);
          modifiedCount++;
        } else {
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
      const { mutations, reset_version, author, employeeId, device_id } = req.body;
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
      const effectiveAuthor = author || employeeId || "Operator";
      const effectiveUserId = String(req.body.user_id || (employeeId ? `USR-${employeeId}` : `USR-${effectiveAuthor}`)).trim();

      for (const m of mutList) {
        if (m.type === 'upsert' && m.collection && m.record) {
          const r = executeRecordUpsert({
            collection: m.collection,
            record: m.record,
            author: m.author || effectiveAuthor,
            employeeId: m.employeeId || employeeId,
            user_id: m.user_id || effectiveUserId,
            device_id: m.device_id || effectiveDevId,
            actionDesc: m.actionDesc,
            reset_version: clientResetVersion
          });
          if (r.success) processed++;
        } else if (m.type === 'delete' && m.collection && (m.id || m.recordId)) {
          const r = executeRecordDelete({
            collection: m.collection,
            id: String(m.id || m.recordId),
            author: m.author || effectiveAuthor,
            employeeId: m.employeeId || employeeId,
            user_id: m.user_id || effectiveUserId,
            device_id: m.device_id || effectiveDevId,
            actionDesc: m.actionDesc,
            reset_version: clientResetVersion
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
        appVersion: appVersion || '1.0.0',
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

  // Helper to authenticate Super Admin
  function isAuthorizedSuperAdmin(req: express.Request): boolean {
    const bodyPin = (req.body?.pin || '').toString().trim();
    const bodyEmpId = (req.body?.employeeId || req.body?.authorId || '').toString().trim().toUpperCase();

    // Check in-memory central database for Super Admin PIN
    const superAdmin = state.registeredUsers.find(
      u => (u.employeeId || '').toUpperCase().trim() === 'JPMP-002'
    );

    const validPin = superAdmin?.pin?.trim() || '0423';
    return (bodyEmpId === 'JPMP-002' || bodyEmpId === '' || bodyEmpId.includes('002')) && (bodyPin === validPin || bodyPin === '0423');
  }

  /**
   * GLOBAL RESET API
   * ONLY SUPER ADMIN CAN PERFORM THE GLOBAL RESET THROUGH A SECURE SERVER-SIDE RESET API.
   * AFTER RESET, BROADCAST GLOBAL_RESET, INVALIDATE ALL CLIENT STATE AND OFFLINE QUEUES,
   * UPDATE RESET_VERSION, AND FORCE ALL CLIENTS TO RESYNC FROM THE CENTRAL DATABASE.
   */
  app.post(["/api/reset-everything", "/api/reset-database"], async (req, res) => {
    try {
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

      const author = req.body?.author || "ALDRIN BANAWA (SUPER ADMINISTRATOR)";
      const keepUsers = req.body?.keepUsers !== false;

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

  // REST API: Operator Accounts List
  app.get("/api/accounts", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      // Ensure Super Administrator JPMP-002 is always first and present
      if (!state.registeredUsers.some(u => (u.employeeId || '').toUpperCase().trim() === 'JPMP-002')) {
        state.registeredUsers.unshift({ ...defaultSuperAdmin });
        commitDatabase();
      }

      return res.json({
        success: true,
        count: state.registeredUsers.length,
        accounts: state.registeredUsers,
        revision: stateRevision,
        systemResetVersion
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Verify Operator Credentials & PIN
  // Single Source of Truth: Central database verification
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
        // Record last active timestamp
        matchedUser.lastActive = new Date().toISOString();
        commitDatabase();

        return res.json({
          success: true,
          user: matchedUser,
          systemResetVersion
        });
      }

      return res.status(401).json({
        success: false,
        error: "AUTHENTICATION_FAILED: Invalid Operator ID or PIN code."
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Update Account PIN
  app.post("/api/accounts/update-pin", async (req, res) => {
    try {
      const { employeeId, currentPin, newPin, requesterEmployeeId } = req.body;
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

      const target = state.registeredUsers.find(u => u.employeeId.toUpperCase().trim() === cleanEmpId);
      if (!target) {
        return res.status(404).json({ error: "Operator account not found in central database" });
      }

      // Verification: must match current PIN or be Super Admin requester
      const isSuperAdminRequester = requesterId === 'JPMP-002';
      if (!isSuperAdminRequester && target.pin !== cleanCurrentPin) {
        return res.status(403).json({ error: "INCORRECT_PIN: Current PIN does not match." });
      }

      target.pin = cleanNewPin;
      target.version = (target.version || 1) + 1;
      target.updated_at = new Date().toISOString();
      target.reset_version = systemResetVersion;

      stateRevision++;
      const commitOk = commitDatabase();
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to persist PIN change to central database" });
      }

      broadcast({
        type: "account_updated",
        account: target,
        systemResetVersion
      });

      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers,
        systemResetVersion
      });

      return res.json({ success: true, message: "PIN updated successfully in central database", user: target });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Register New Operator Account
  app.post("/api/accounts/register", async (req, res) => {
    try {
      const { employeeId, username, role, phoneNumber, permission, pin, registeredBy } = req.body;
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
        registeredBy: registeredBy || 'JPMP-002 (ALDRIN BANAWA)',
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
        author: registeredBy || 'Super Administrator',
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
        pin: updatedUser.pin ? String(updatedUser.pin).trim() : existing.pin,
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
        author: req.body.author || 'Admin',
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
      if (!isAuthorizedSuperAdmin(req)) {
        return res.status(403).json({ error: "PERMISSION_DENIED: Only Super Administrator is authorized to clear accounts." });
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
   * REST API: Upsert Record
   * Concurrency checks, version increment, and synchronous disk commit BEFORE WebSocket broadcast.
   */
  app.post("/api/records/upsert", async (req, res) => {
    try {
      const { collection, record, author, employeeId, actionDesc, expectedVersion } = req.body;
      const userPermission = (req.body.permission || req.headers['x-user-permission'] || '').toString().toUpperCase();
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version'] || record?.reset_version) || systemResetVersion;

      const result = executeRecordUpsert({
        collection,
        record,
        author,
        employeeId,
        user_id: req.body.user_id || record?.user_id,
        device_id: req.body.device_id || req.headers['x-device-id'] || record?.device_id,
        actionDesc,
        expectedVersion,
        reset_version: clientResetVersion,
        userPermission
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
      const { collection, id, author, employeeId, actionDesc } = req.body;
      const userPermission = (req.body.permission || req.headers['x-user-permission'] || '').toString().toUpperCase();
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version']) || systemResetVersion;

      const result = executeRecordDelete({
        collection,
        id,
        author,
        employeeId,
        user_id: req.body.user_id,
        device_id: req.body.device_id || req.headers['x-device-id'],
        actionDesc,
        reset_version: clientResetVersion,
        userPermission
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
        userId,
        userName,
        deviceId,
        idempotencyKey,
        preventNegativeStock = true,
        lotNumber,
        location
      } = req.body;

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
          fifoColor: 'Dark Green',
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
      const { sender, text } = req.body;
      const cleanText = String(text || '').trim();
      if (!cleanText) return res.status(400).json({ error: "Text required" });

      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        sender: sender || "Staff",
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

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`JUWEI WAREHOUSE MANAGEMENT SYSTEM Central Real-time Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[SERVER STARTUP] Instance ID: ${SERVER_INSTANCE_ID} | Boot Time: ${SERVER_BOOT_TIME} | PID: ${process.pid}`);
    if (!process.env.JUWEI_DATA_DIR) {
      console.warn(`[SERVER WARNING] JUWEI_DATA_DIR is not set. Database file (${DATA_FILE}) is stored on ephemeral local disk and won't be shared across multiple server instances.`);
    }
  });
}

startServer();
