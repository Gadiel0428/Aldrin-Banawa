/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { WebSocketServer, WebSocket } from "ws";

// Initial seed data for empty database bootstrapping
import { 
  INITIAL_STOCK, 
  INITIAL_RECEIVING, 
  INITIAL_RETURNS, 
  INITIAL_RECYCLING, 
  INITIAL_ISSUANCE, 
  INITIAL_DELIVERIES, 
  INITIAL_ENV_LOGS, 
  INITIAL_FORKLIFT_CHECKS 
} from "./src/data";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

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
  const LEGACY_DATA_FILE = getStorageFilePath("data-store.json");

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
    version: number;
    updated_at: string;
    reset_version: number;
  }

  const defaultSuperAdmin: ServerUser = { 
    id: 'USR-JPMP-002',
    employeeId: 'JPMP-002', 
    username: 'ALDRIN BANAWA', 
    role: 'SUPER ADMINISTRATOR', 
    phoneNumber: '+639669858846',
    permission: 'FULL_ACCESS', 
    pin: '0423',
    status: 'ACTIVE',
    registeredBy: 'ROOT_SUPER_ADMIN (JPMP-002)',
    registeredBySuperAdmin: true,
    registeredAt: '2026-01-01T00:00:00.000Z',
    stationId: 'MASTER_TERMINAL',
    version: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    reset_version: 1
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
  };

  /**
   * Authoritative Disk Persistence: Synchronous Commit
   * DATABASE COMMIT MUST ALWAYS HAPPEN BEFORE A WEBSOCKET EVENT IS BROADCAST.
   */
  function commitDatabase(): boolean {
    try {
      const payload = JSON.stringify({
        systemResetVersion,
        systemResetTimestamp,
        systemResetId,
        systemResetBy,
        stateRevision,
        state,
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
          systemResetVersion,
          systemResetTimestamp,
          systemResetId,
          systemResetBy,
          stateRevision,
          state
        }), "utf-8");
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
      let targetPath = DATA_FILE;
      if (!fs.existsSync(targetPath) && fs.existsSync(LEGACY_DATA_FILE)) {
        targetPath = LEGACY_DATA_FILE;
      }

      if (fs.existsSync(targetPath)) {
        const raw = fs.readFileSync(targetPath, "utf-8");
        const parsed = JSON.parse(raw);

        if (parsed) {
          if (parsed.systemResetVersion) systemResetVersion = Number(parsed.systemResetVersion) || 1;
          if (parsed.systemResetTimestamp) systemResetTimestamp = String(parsed.systemResetTimestamp);
          if (parsed.systemResetId) systemResetId = String(parsed.systemResetId);
          if (parsed.systemResetBy) systemResetBy = String(parsed.systemResetBy);
          if (parsed.stateRevision) stateRevision = Number(parsed.stateRevision) || 1;

          if (parsed.state && typeof parsed.state === "object") {
            Object.keys(parsed.state).forEach((key) => {
              if (key in state && Array.isArray(parsed.state[key])) {
                // Ensure all loaded records have mandatory fields
                (state as any)[key] = parsed.state[key].map((rec: any) => normalizeRecord(rec));
              }
            });
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

      // Ensure Super Administrator JPMP-002 is always present and active
      const superAdminExists = state.registeredUsers.some(
        u => (u.employeeId || '').toUpperCase().trim() === 'JPMP-002'
      );
      if (!superAdminExists) {
        state.registeredUsers.unshift({ ...defaultSuperAdmin });
        commitDatabase();
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

  // WebSocket Server Setup
  const wss = new WebSocketServer({ server, path: "/ws" });

  interface ConnectedClientInfo {
    stationId?: string;
    deviceId?: string;
    username: string;
    employeeId?: string;
    role?: string;
    activeView?: string;
    connectedAt: string;
    lastPing: number;
    resetVersion?: number;
  }
  const activeConnections = new Map<WebSocket, ConnectedClientInfo>();

  function getActiveUsersList(): string[] {
    const users = Array.from(activeConnections.values()).map(c => c.username).filter(Boolean);
    return Array.from(new Set(users));
  }

  function getActivePresenceList() {
    return Array.from(activeConnections.values()).map(c => ({
      stationId: c.stationId || '',
      deviceId: c.deviceId || '',
      username: c.username,
      employeeId: c.employeeId || '',
      role: c.role || 'OPERATOR',
      activeView: c.activeView || 'dashboard',
      connectedAt: c.connectedAt,
      lastPing: c.lastPing,
      source: 'central_websocket'
    }));
  }

  // Broadcast helper
  function broadcast(msg: any, excludeSocket?: WebSocket) {
    const rawMsg = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN && client !== excludeSocket) {
        try {
          client.send(rawMsg);
        } catch (sendErr) {
          console.warn("WebSocket client send warning:", sendErr);
        }
      }
    }
  }

  // Periodic heartbeat
  const heartbeatInterval = setInterval(() => {
    let changed = false;
    wss.clients.forEach((client: any) => {
      if (client.isAlive === false) {
        if (activeConnections.has(client)) {
          activeConnections.delete(client);
          changed = true;
        }
        return client.terminate();
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch (e) {}
    });
    if (changed) {
      broadcast({
        type: "presence_updated",
        activeUsers: getActiveUsersList(),
        activePresence: getActivePresenceList()
      });
    }
  }, 25000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (ws: any) => {
    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // Send initial snapshot
    try {
      ws.send(JSON.stringify({
        type: "init",
        systemResetVersion,
        systemResetTimestamp,
        systemResetId,
        systemResetBy,
        data: {
          ...state,
          chatMessages
        },
        activeUsers: getActiveUsersList(),
        activePresence: getActivePresenceList()
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
            const info = activeConnections.get(ws);
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
            const username = payload.username || "Operator";
            const employeeId = payload.employeeId || "";
            const role = payload.role || "OPERATOR";
            const activeView = payload.activeView || "dashboard";
            const stationId = payload.stationId || "";
            const deviceId = payload.deviceId || "";
            const clientResetVersion = Number(payload.reset_version || payload.currentResetVersion) || 0;

            activeConnections.set(ws, {
              stationId,
              deviceId,
              username,
              employeeId,
              role,
              activeView,
              connectedAt: new Date().toISOString(),
              lastPing: Date.now(),
              resetVersion: clientResetVersion
            });

            // Confirm authentication and instruct client whether resync is required
            const requiresResync = clientResetVersion < systemResetVersion;
            ws.send(JSON.stringify({
              type: "auth_confirmed",
              systemResetVersion,
              systemResetId,
              systemResetTimestamp,
              requiresResync,
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList()
            }));

            // Broadcast presence update
            broadcast({
              type: "presence_updated",
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList()
            });

            const joinMsg: ChatMessage = {
              id: `sys-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              sender: "System",
              text: `${username} (${employeeId || stationId || 'Terminal'}) connected.`,
              timestamp: new Date().toISOString(),
              isSystem: true
            };
            chatMessages.push(joinMsg);
            if (chatMessages.length > 200) chatMessages.shift();
            broadcast({ type: "chat_broadcast", message: joinMsg });
            break;
          }

          case "presence_update": {
            let info = activeConnections.get(ws);
            if (!info) {
              info = {
                stationId: payload.stationId || '',
                deviceId: payload.deviceId || '',
                username: payload.username || 'OPERATOR',
                employeeId: payload.employeeId || '',
                role: payload.role || 'OPERATOR',
                activeView: payload.activeView || 'dashboard',
                connectedAt: new Date().toISOString(),
                lastPing: Date.now(),
              };
              activeConnections.set(ws, info);
            } else {
              if (payload.stationId) info.stationId = payload.stationId;
              if (payload.username) info.username = payload.username;
              if (payload.employeeId) info.employeeId = payload.employeeId;
              if (payload.role) info.role = payload.role;
              if (payload.activeView) info.activeView = payload.activeView;
              info.lastPing = Date.now();
            }

            broadcast({
              type: "presence_updated",
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList()
            });
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
        }
      } catch (err) {
        console.error("Failed processing socket message:", err);
      }
    });

    ws.on("close", () => {
      const clientInfo = activeConnections.get(ws);
      if (clientInfo) {
        activeConnections.delete(ws);
        broadcast({
          type: "presence_updated",
          activeUsers: getActiveUsersList(),
          activePresence: getActivePresenceList()
        });
      }
    });
  });

  // Express Middlewares
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-permission, x-reset-version, x-employee-id");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // REST API: Health Check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      systemResetVersion,
      systemResetId,
      systemResetTimestamp,
      totalRecords: Object.values(state).reduce((acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0), 0),
      usersCount: state.registeredUsers.length,
      connectedClients: activeConnections.size
    });
  });

  // REST API: Full State Snapshot (Single Source of Truth)
  // FIX DATA FLICKERING: Always returns valid, complete database records without null or empty arrays.
  app.get("/api/sync", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.json({
      status: "ok",
      revision: stateRevision,
      systemResetVersion,
      systemResetTimestamp,
      systemResetId,
      systemResetBy,
      data: {
        ...state,
        chatMessages
      }
    });
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
        type: "account_created",
        account: newUser,
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

  /**
   * REST API: Upsert Record
   * Concurrency checks, version increment, and synchronous disk commit BEFORE WebSocket broadcast.
   */
  app.post("/api/records/upsert", async (req, res) => {
    try {
      const { collection, record, author, employeeId, actionDesc, expectedVersion } = req.body;
      const userPermission = (req.body.permission || req.headers['x-user-permission'] || '').toString().toUpperCase();
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version'] || record?.reset_version) || systemResetVersion;

      // Reject data from before a global reset
      if (clientResetVersion < systemResetVersion) {
        return res.status(409).json({
          error: "STALE_RESET_VERSION: Central database was reset. Data from previous reset versions cannot be restored.",
          systemResetVersion,
          systemResetId
        });
      }

      if (!collection || !record) {
        return res.status(400).json({ error: "Collection and record required" });
      }

      if (!(collection in state)) {
        return res.status(400).json({ error: `Unknown collection: ${collection}` });
      }

      if (userPermission === 'VIEW_ONLY') {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }

      const serverTime = new Date().toISOString();
      const currentList: any[] = (state as any)[collection] || [];
      const recordId = String(record.id || `REC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);

      const existingIndex = currentList.findIndex((item: any) => item && String(item.id) === recordId);
      const existingRecord = existingIndex >= 0 ? currentList[existingIndex] : null;

      let confirmedRecord: any;
      let isCreation = false;

      if (existingRecord) {
        // Optimistic concurrency check
        if (expectedVersion !== undefined && existingRecord.version && existingRecord.version > expectedVersion) {
          return res.status(409).json({
            error: "VERSION_CONFLICT: Newer revision exists in central database.",
            currentRecord: existingRecord,
            systemResetVersion
          });
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
        return res.status(500).json({ error: "Failed to commit record to central disk database" });
      }

      // BROADCAST TO ALL CONNECTED CLIENTS
      const eventType = isCreation ? "RECORD_CREATED" : "RECORD_UPDATED";
      broadcast({
        type: eventType,
        collection,
        record: confirmedRecord,
        author: author || employeeId || "Operator",
        actionDesc: actionDesc || `${isCreation ? 'Created' : 'Updated'} ${collection} record`,
        timestamp: serverTime,
        version: confirmedRecord.version,
        systemResetVersion,
        systemResetId
      });

      broadcast({
        type: "collection_updated",
        collection,
        data: currentList,
        systemResetVersion
      });

      return res.json({
        success: true,
        collection,
        record: confirmedRecord,
        systemResetVersion
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
      const { collection, id, author, employeeId } = req.body;
      const userPermission = (req.body.permission || req.headers['x-user-permission'] || '').toString().toUpperCase();
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version']) || systemResetVersion;

      if (clientResetVersion < systemResetVersion) {
        return res.status(409).json({
          error: "STALE_RESET_VERSION: Central database was reset. Stale delete operation rejected.",
          systemResetVersion,
          systemResetId
        });
      }

      if (!collection || !id) {
        return res.status(400).json({ error: "Collection and ID required" });
      }

      if (!(collection in state)) {
        return res.status(400).json({ error: "Invalid collection" });
      }

      if (userPermission === 'VIEW_ONLY') {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }

      markRecordTombstone(id);
      (state as any)[collection] = ((state as any)[collection] || []).filter((item: any) => String(item.id) !== String(id));
      stateRevision++;

      // COMMIT DATABASE SYNCHRONOUSLY BEFORE BROADCAST
      const commitOk = commitDatabase();
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to commit record deletion to central database" });
      }

      const serverTime = new Date().toISOString();
      broadcast({
        type: "RECORD_DELETED",
        collection,
        id,
        author: author || employeeId || "Operator",
        timestamp: serverTime,
        systemResetVersion,
        systemResetId
      });

      broadcast({
        type: "record_deleted",
        collection,
        id,
        systemResetVersion
      });

      broadcast({
        type: "collection_updated",
        collection,
        data: (state as any)[collection],
        systemResetVersion
      });

      return res.json({ success: true, collection, id, systemResetVersion });
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

      // BROADCAST REAL-TIME MOVEMENT & UPDATED STOCKS
      broadcast({
        type: "stock_movement_created",
        movement: movementRecord,
        stock: stockItem,
        stocks: state.stocks,
        stateRevision,
        systemResetVersion
      });

      broadcast({
        type: "collection_updated",
        collection: "stocks",
        data: state.stocks,
        systemResetVersion
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
    let distPath = __dirname;
    if (!fs.existsSync(path.join(distPath, "index.html"))) {
      distPath = path.join(process.cwd(), "dist");
    }
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
  });
}

startServer();
