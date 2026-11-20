/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import { checkpointAndClose } from "./server/sqliteStore.ts";
import {
  loadAndValidateServerConfig,
  printServerStartupSummary,
  compareServerSemver,
  maxSemverVersion,
  resolveServerBundleVersion,
  normalizeGitHubRepo,
} from "./server/config.ts";
import logger from "./src/lib/logger.ts";
import type {
  AuthorizedDevice,
  ChatMessage,
  RegisteredAccount,
} from "./shared/types.ts";
import {
  DEFAULT_FIFO_COLORS_BY_MONTH,
  DEFAULT_OPERATIONAL_ROLES,
  DEFAULT_RECEIVING_CATEGORIES,
  MAX_AUDIT_TRAIL_ENTRIES,
  createServerContext,
} from "./server/services/context.ts";
import {
  describeRecordDiff,
  ensureInitialAuditTrailSeed,
  logPinAudit,
  recordAuditTrail,
} from "./server/services/auditService.ts";
import { repairFifoTagColorsOnStartup } from "./server/services/fifoService.ts";
import {
  broadcast,
  closeDeviceSockets,
  filterDataForClient,
  getActiveOperatorsCount,
  getActivePresenceList,
  getActiveUsersList,
  sanitizeUserForClient,
} from "./server/services/realtimeService.ts";
import {
  ensureSuperAdminSeed,
  extractDeviceIdFromHttp,
  hashPinScrypt,
  isAuthorizedSuperAdmin,
  isDeviceRevoked,
  markRecordTombstone,
  markUserTombstone,
  rejectIfDeviceRevokedHttp,
  resolveRequestAuthContext,
  unmarkUserTombstone,
  verifyUserPin,
} from "./server/services/authService.ts";
import {
  commitDatabase,
  createDatabaseBackup,
  createPreStartupBackup,
  getAllBackupRecords,
  loadDatabaseFromDisk,
  restoreDatabaseFromBackup,
} from "./server/services/backupService.ts";
import {
  executeRecordDelete,
  executeRecordUpsert,
} from "./server/services/recordService.ts";
import {
  getLatestGitHubReleaseVersion,
  loadPersistedGitHubReleaseFallback,
} from "./server/services/releaseService.ts";
import { setupWebSocketServer } from "./server/services/websocketService.ts";
import { registerReceivingRoutes } from "./server/routes/receiving.ts";
import { registerStockRoutes } from "./server/routes/stock.ts";

// Ephemeral per-process instance identifiers (fresh every boot, never persisted)
const SERVER_INSTANCE_ID = crypto.randomUUID();
const SERVER_BOOT_TIME = new Date().toISOString();

async function startServer() {
  const serverConfig = loadAndValidateServerConfig();
  printServerStartupSummary(serverConfig, {
    instanceId: SERVER_INSTANCE_ID,
    bootTime: SERVER_BOOT_TIME,
  });

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const PORT = serverConfig.port;

  // Storage Configuration Guard Rail
  const DATA_FILE = serverConfig.dataFile;
  const resolvedDataFile = path.resolve(DATA_FILE);
  const configuredDataDir = serverConfig.configuredDataDir;
  const isInsideProjectSource = serverConfig.isInsideProjectSource;

  if (!configuredDataDir || isInsideProjectSource) {
    const bannerBorder = "=".repeat(100);
    console.warn(`\n${bannerBorder}`);
    console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.warn("WARNING: JUWEI_DATA_DIR is not set correctly — data is NOT being saved to the safe location and WILL be lost on the next update.");
    console.warn(`Resolved Database File: ${resolvedDataFile}`);
    console.warn(`Configured JUWEI_DATA_DIR: ${serverConfig.configuredDataDirRaw || "(NOT SET)"}`);
    console.warn("Action Required: Set environment variable JUWEI_DATA_DIR to an external persistent folder (e.g. C:\\JuweiData or /var/juwei-data) before deploying updates!");
    console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.warn(`${bannerBorder}\n`);
  } else {
    logger.info(`[STORAGE CONFIG] Persistent safe storage verified at: ${configuredDataDir} (Database: ${resolvedDataFile})`);
  }

  // Construct shared server context
  const ctx = createServerContext({
    serverInstanceId: SERVER_INSTANCE_ID,
    serverBootTime: SERVER_BOOT_TIME,
    config: serverConfig,
    wss,
  });

  // 1. Mandatory pre-startup safety backup before touching database
  createPreStartupBackup(ctx);

  // 2. Load database state (or auto-recover from backups) on server initialization
  loadDatabaseFromDisk(ctx);

  // 2b. Seed unified audit trail from existing database history on first initialization
  ensureInitialAuditTrailSeed(ctx);

  // 3. Run startup FIFO tag color repair right after database load
  ctx.initialFifoRepairReport = repairFifoTagColorsOnStartup(ctx, commitDatabase);

  // 4. Initial backup + recurring automated non-blocking backup every 1 hour
  createDatabaseBackup(ctx, "SERVER_STARTUP", "SYSTEM_BOOT").catch((bErr: any) => {
    console.error("[SERVER STARTUP] Initial backup error:", bErr);
  });

  const ONE_HOUR_MS = 60 * 60 * 1000;
  setInterval(() => {
    createDatabaseBackup(ctx, "AUTOMATIC_1H_SCHEDULE", "SYSTEM_SCHEDULER").catch((bErr: any) => {
      console.error("[SCHEDULED BACKUP] Error executing 1h backup:", bErr);
    });
  }, ONE_HOUR_MS);

  // 5. Load persisted GitHub release fallback cache
  loadPersistedGitHubReleaseFallback(ctx);

  // 6. Initialize WebSocket server & room engine
  setupWebSocketServer(server, ctx);

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

  // Modular API Route Registration
  registerStockRoutes(app, ctx);
  registerReceivingRoutes(app, ctx);

  // REST API: Diagnostics & Connectivity Verification
  app.get("/api/diagnostics", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      status: "ok",
      serverInstanceId: ctx.serverInstanceId,
      serverBootTime: ctx.serverBootTime,
      serverTimestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
      systemResetVersion: ctx.systemResetVersion,
      systemResetId: ctx.systemResetId,
      systemResetTimestamp: ctx.systemResetTimestamp,
      totalRecords: Object.values(ctx.state).reduce((acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0), 0),
      usersCount: ctx.state.registeredUsers.length,
      connectedTerminals: ctx.connectionRegistry.size,
      connectedOperators: getActiveOperatorsCount(ctx),
      corsActive: true,
      databaseReady: true,
      websocketReady: true,
      authoritativeSource: "CENTRAL_CLOUD_DATABASE"
    });
  });

  // REST API: Webhook / Direct publish from GitHub Actions
  app.post(["/api/build-info/publish", "/api/release/latest"], (req, res) => {
    try {
      const { version, tag, repository, releaseUrl, buildId } = req.body || {};
      const newVersion = String(version || tag || "").replace(/^v/i, "").trim();
      if (!newVersion) {
        return res.status(400).json({ error: "Missing version or tag" });
      }

      ctx.cachedGitHubVersion = newVersion;
      ctx.lastGitHubFetchTimestamp = Date.now();
      if (repository && typeof repository === "string") {
        const cleanRepoUpdate = normalizeGitHubRepo(repository);
        if (cleanRepoUpdate) {
          serverConfig.githubRepo = cleanRepoUpdate;
        }
      }

      const releaseRecord = {
        version: newVersion,
        tag: tag || `v${newVersion}`,
        repository: repository || serverConfig.githubRepo,
        releaseUrl: releaseUrl || "",
        buildId: buildId || Date.now(),
        updatedAt: new Date().toISOString()
      };

      try {
        fs.writeFileSync(ctx.releasePersistFile, JSON.stringify(releaseRecord, null, 2), "utf8");
      } catch (_err) {}

      logger.info(`[RELEASE SYNC] Received authoritative release update from GitHub Actions: version ${newVersion} (tag: ${tag || newVersion})`);
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

    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";
    const { fileContent, bundleVersion } = resolveServerBundleVersion();

    const latestGitHubVersion = await getLatestGitHubReleaseVersion(ctx, bundleVersion, forceRefresh);
    const activeVersion = maxSemverVersion(latestGitHubVersion, bundleVersion);

    if (fileContent) {
      return res.json({
        ...fileContent,
        version: activeVersion,
        bundleVersion,
        latestGitHubVersion,
        versionSource: ctx.cachedGitHubVersion && compareServerSemver(ctx.cachedGitHubVersion, bundleVersion) >= 0
          ? "github-releases-latest"
          : (fileContent.versionSource || "package.json")
      });
    }

    return res.json({
      buildId: 0,
      version: activeVersion,
      bundleVersion,
      latestGitHubVersion,
      versionSource: ctx.cachedGitHubVersion ? "github-releases-latest" : "fallback",
      isDevelopmentFallback: true
    });
  });

  // REST API: Direct Installer Download Redirect
  app.get("/api/download/latest-installer", async (_req, res) => {
    const { bundleVersion } = resolveServerBundleVersion();
    const targetVer = await getLatestGitHubReleaseVersion(ctx, bundleVersion);
    const cleanVer = targetVer || bundleVersion || "1.0.94";
    const cleanRepo = normalizeGitHubRepo(serverConfig.githubRepo);
    const assetName = `JUWEI.WMS.Desktop.System.Setup.${cleanVer}.exe`;
    const directDownloadUrl = `https://github.com/${cleanRepo}/releases/download/v${cleanVer}/${assetName}`;
    return res.redirect(302, directDownloadUrl);
  });

  // REST API: Health Check
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      serverInstanceId: ctx.serverInstanceId,
      serverBootTime: ctx.serverBootTime,
      uptime: process.uptime(),
      systemResetVersion: ctx.systemResetVersion,
      systemResetId: ctx.systemResetId,
      systemResetTimestamp: ctx.systemResetTimestamp,
      totalRecords: Object.values(ctx.state).reduce((acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0), 0),
      usersCount: ctx.state.registeredUsers.length,
      connectedClients: ctx.connectionRegistry.size,
      connectedTerminals: ctx.connectionRegistry.size,
      connectedOperators: getActiveOperatorsCount(ctx),
      liveActiveTerminals: ctx.connectionRegistry.size
    });
  });

  // REST API: Live Connection & Active Terminals Registry
  app.get("/api/presence", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      status: "ok",
      connectedOperators: getActiveOperatorsCount(ctx),
      liveActiveTerminals: ctx.connectionRegistry.size,
      systemResetVersion: ctx.systemResetVersion,
      presence: getActivePresenceList(ctx),
      activeUsers: getActiveUsersList(ctx)
    });
  });

  // REST API: Synchronize All Workstations
  app.post(["/api/sync/all-workstations", "/api/sync-all-workstations"], (req, res) => {
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    const author = req.body?.author || "SUPER ADMINISTRATOR";
    broadcast(ctx, {
      type: "SYNC_REQUIRED",
      author,
      reason: "CLUSTER_SYNC_REQUESTED",
      systemResetVersion: ctx.systemResetVersion,
      timestamp: new Date().toISOString()
    });
    broadcast(ctx, {
      type: "force_sync",
      triggeredBy: author
    });
    return res.json({
      success: true,
      message: "SYNC_REQUIRED broadcast sent to all workstations and devices",
      connectedTerminals: ctx.connectionRegistry.size,
      connectedOperators: getActiveOperatorsCount(ctx),
      systemResetVersion: ctx.systemResetVersion
    });
  });

  // REST API: Full State Snapshot
  app.get("/api/sync", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    const auth = resolveRequestAuthContext(ctx, req);

    res.json({
      status: "ok",
      revision: ctx.stateRevision,
      systemResetVersion: ctx.systemResetVersion,
      systemResetTimestamp: ctx.systemResetTimestamp,
      systemResetId: ctx.systemResetId,
      systemResetBy: ctx.systemResetBy,
      data: filterDataForClient({
        ...ctx.state,
        chatMessages: ctx.chatMessages
      }, auth.permission, auth.employeeId),
      connectedOperators: getActiveOperatorsCount(ctx),
      liveActiveTerminals: ctx.connectionRegistry.size
    });
  });

  // REST API: Sync collection
  app.post("/api/sync", async (req, res) => {
    try {
      const { collection, data, reset_version, author, employeeId, device_id } = req.body;
      const reqDevId = String(device_id || req.body?.deviceId || req.headers["x-device-id"] || "").trim();
      if (isDeviceRevoked(ctx, reqDevId)) {
        closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
        return res.status(403).json({ error: "DEVICE_REVOKED" });
      }

      const clientResetVersion = Number(reset_version || req.headers["x-reset-version"]) || ctx.systemResetVersion;
      if (clientResetVersion < ctx.systemResetVersion) {
        return res.status(409).json({
          error: "STALE_RESET_VERSION: Central database was reset. Stale sync rejected.",
          systemResetVersion: ctx.systemResetVersion,
          systemResetId: ctx.systemResetId
        });
      }

      if (!collection || !(collection in ctx.state)) {
        return res.status(400).json({ error: `Unknown or invalid collection: ${collection}` });
      }

      const auth = resolveRequestAuthContext(ctx, req, reqDevId);
      if (auth.permission === "VIEW_ONLY") {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }

      if (collection === "operationalRoles") {
        if (Array.isArray(data)) {
          const cleaned = Array.from(new Set<string>(data.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean)));
          if (cleaned.length > 0) {
            ctx.state.operationalRoles = cleaned;
            ctx.stateRevision++;
            commitDatabase(ctx);
            recordAuditTrail(ctx, {
              actor: auth.account?.username || author || "Admin",
              actorId: auth.employeeId || employeeId || "ADMIN",
              action: "UPDATE",
              recordType: "operationalRoles",
              recordId: "operationalRoles",
              summary: `Updated operational roles (${cleaned.length} roles)`,
              deviceId: reqDevId
            });
            broadcast(ctx, {
              type: "roles_updated",
              roles: ctx.state.operationalRoles,
              systemResetVersion: ctx.systemResetVersion
            });
            broadcast(ctx, {
              type: "collection_updated",
              collection: "operationalRoles",
              data: ctx.state.operationalRoles,
              systemResetVersion: ctx.systemResetVersion
            });
          }
        }
        return res.json({ success: true, count: ctx.state.operationalRoles.length, systemResetVersion: ctx.systemResetVersion });
      }

      if (collection === "receivingCategories") {
        if (Array.isArray(data)) {
          const cleaned = Array.from(new Set<string>(data.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean)));
          if (cleaned.length > 0) {
            ctx.state.receivingCategories = cleaned;
            ctx.stateRevision++;
            commitDatabase(ctx);
            recordAuditTrail(ctx, {
              actor: auth.account?.username || author || "Admin",
              actorId: auth.employeeId || employeeId || "ADMIN",
              action: "UPDATE",
              recordType: "receivingCategories",
              recordId: "receivingCategories",
              summary: `Updated receiving categories (${cleaned.length} categories)`,
              deviceId: reqDevId
            });
            broadcast(ctx, {
              type: "categories_updated",
              categories: ctx.state.receivingCategories,
              systemResetVersion: ctx.systemResetVersion
            });
            broadcast(ctx, {
              type: "collection_updated",
              collection: "receivingCategories",
              data: ctx.state.receivingCategories,
              systemResetVersion: ctx.systemResetVersion
            });
          }
        }
        return res.json({ success: true, count: ctx.state.receivingCategories.length, systemResetVersion: ctx.systemResetVersion });
      }

      if (collection === "fifoColorsByMonth") {
        if (data && typeof data === "object") {
          ctx.state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...data };
          ctx.stateRevision++;
          commitDatabase(ctx);
          recordAuditTrail(ctx, {
            actor: auth.account?.username || author || "Admin",
            actorId: auth.employeeId || employeeId || "ADMIN",
            action: "UPDATE",
            recordType: "fifoColorsByMonth",
            recordId: "fifoColorsByMonth",
            summary: "Updated monthly FIFO color calendar",
            deviceId: reqDevId
          });
          broadcast(ctx, {
            type: "fifo_colors_updated",
            fifoColorsByMonth: ctx.state.fifoColorsByMonth,
            systemResetVersion: ctx.systemResetVersion
          });
          broadcast(ctx, {
            type: "collection_updated",
            collection: "fifoColorsByMonth",
            data: ctx.state.fifoColorsByMonth,
            systemResetVersion: ctx.systemResetVersion
          });
        }
        return res.json({ success: true, count: Object.keys(ctx.state.fifoColorsByMonth).length, systemResetVersion: ctx.systemResetVersion });
      }

      const items: any[] = Array.isArray(data) ? data : [];
      const currentList: any[] = (ctx.state as any)[collection] || [];
      const listMap = new Map<string, any>(currentList.map(it => [String(it.id || it.record_id), it]));

      let modifiedCount = 0;
      const serverTime = new Date().toISOString();
      const effectiveAuthor = author || employeeId || "Operator";
      const effectiveDevId = String(device_id || req.headers["x-device-id"] || "DEV-CENTRAL").trim();
      const effectiveUserId = String(req.body.user_id || (employeeId ? `USR-${employeeId}` : `USR-${effectiveAuthor}`)).trim();

      for (const item of items) {
        if (!item) continue;
        const recId = String(item.id || item.record_id || `REC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
        if (ctx.deletedRecordTombstones.has(recId)) continue;

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
            reset_version: ctx.systemResetVersion
          };

          if (collection === "registeredUsers") {
            if (existing.pinHash) updatedRec.pinHash = existing.pinHash;
            if (existing.pinSalt) updatedRec.pinSalt = existing.pinSalt;
            if (existing.pin) updatedRec.pin = existing.pin;
            if (existing.pin_hash) updatedRec.pin_hash = existing.pin_hash;
            if (existing.mustChangePin !== undefined) updatedRec.mustChangePin = existing.mustChangePin;
            if (existing.isPinCompromised !== undefined) updatedRec.isPinCompromised = existing.isPinCompromised;
            if (existing.pinChangedAt) updatedRec.pinChangedAt = existing.pinChangedAt;
            if (existing.pinChangedBy) updatedRec.pinChangedBy = existing.pinChangedBy;
          }

          listMap.set(recId, updatedRec);
          modifiedCount++;
        } else {
          if (collection === "registeredUsers") {
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
            reset_version: ctx.systemResetVersion
          };
          listMap.set(recId, newRec);
          modifiedCount++;
        }
      }

      if (modifiedCount > 0) {
        (ctx.state as any)[collection] = Array.from(listMap.values());
        ctx.stateRevision++;
        commitDatabase(ctx);

        recordAuditTrail(ctx, {
          timestamp: serverTime,
          actor: auth.account?.username || effectiveAuthor,
          actorId: auth.employeeId || employeeId || effectiveUserId,
          action: "SYNC",
          recordType: collection,
          recordId: `${modifiedCount} records`,
          summary: `Synced ${collection} (${modifiedCount} item(s) modified)`,
          deviceId: effectiveDevId
        });

        logger.debug(`[CENTRAL-DB] [REST-POST-SYNC] Collection: ${collection} | Items received: ${items.length} | Modified: ${modifiedCount} | User: ${effectiveUserId} | Device: ${effectiveDevId}`);

        broadcast(ctx, {
          type: "collection_updated",
          collection,
          data: (ctx.state as any)[collection],
          systemResetVersion: ctx.systemResetVersion
        });
      }

      return res.json({
        success: true,
        collection,
        count: (ctx.state as any)[collection]?.length || 0,
        modified: modifiedCount,
        systemResetVersion: ctx.systemResetVersion
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Batch Mutations
  app.post("/api/sync/batch", async (req, res) => {
    try {
      const { mutations, reset_version, author, employeeId, device_id } = req.body;
      const reqDevId = String(device_id || req.body?.deviceId || req.headers["x-device-id"] || "").trim();
      if (isDeviceRevoked(ctx, reqDevId)) {
        closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
        return res.status(403).json({ error: "DEVICE_REVOKED" });
      }

      const clientResetVersion = Number(reset_version || req.headers["x-reset-version"]) || ctx.systemResetVersion;

      if (clientResetVersion < ctx.systemResetVersion) {
        return res.status(409).json({
          error: "STALE_RESET_VERSION: Central database was reset. Stale offline queue rejected.",
          systemResetVersion: ctx.systemResetVersion,
          systemResetId: ctx.systemResetId
        });
      }

      const mutList = Array.isArray(mutations) ? mutations : [];
      let processed = 0;
      const results: any[] = [];
      const effectiveDevId = reqDevId || "DEV-OFFLINE";
      const effectiveAuthor = author || employeeId || "Operator";
      const effectiveUserId = String(req.body.user_id || (employeeId ? `USR-${employeeId}` : `USR-${effectiveAuthor}`)).trim();
      const auth = resolveRequestAuthContext(ctx, req, reqDevId);
      const userPermission = auth.permission;

      for (const m of mutList) {
        const mutDevId = String(m.device_id || m.deviceId || effectiveDevId).trim();
        if (isDeviceRevoked(ctx, mutDevId)) {
          closeDeviceSockets(ctx, mutDevId, "DEVICE_REVOKED");
          return res.status(403).json({ error: "DEVICE_REVOKED" });
        }

        if (m.type === "upsert" && m.collection && m.record) {
          const r = executeRecordUpsert(ctx, {
            collection: m.collection,
            record: m.record,
            author: m.author || effectiveAuthor,
            employeeId: m.employeeId || employeeId,
            user_id: m.user_id || effectiveUserId,
            device_id: mutDevId,
            actionDesc: m.actionDesc,
            expectedVersion: m.expectedVersion,
            reset_version: m.reset_version ?? clientResetVersion,
            userPermission
          });
          if (r.success) processed++;
          results.push({
            id: m.id,
            mutationId: m.id,
            type: m.type,
            collection: m.collection,
            recordId: String(m.record?.id || m.record?.record_id || ""),
            success: r.success,
            status: r.status,
            error: r.error,
            record: r.confirmedRecord,
            currentRecord: r.currentRecord || r.confirmedRecord
          });
        } else if (m.type === "delete" && m.collection && (m.id || m.recordId)) {
          const targetId = String(m.id || m.recordId);
          const r = executeRecordDelete(ctx, {
            collection: m.collection,
            id: targetId,
            author: m.author || effectiveAuthor,
            employeeId: m.employeeId || employeeId,
            user_id: m.user_id || effectiveUserId,
            device_id: mutDevId,
            actionDesc: m.actionDesc,
            expectedVersion: m.expectedVersion,
            reset_version: m.reset_version ?? clientResetVersion,
            userPermission
          });
          if (r.success) processed++;
          results.push({
            id: m.id,
            mutationId: m.id,
            type: m.type,
            collection: m.collection,
            recordId: targetId,
            success: r.success,
            status: r.status,
            error: r.error,
            currentRecord: r.currentRecord || r.confirmedRecord
          });
        }
      }

      logger.debug(`[CENTRAL-DB] [REST-BATCH-MUTATIONS] Processed ${processed}/${mutList.length} offline mutations from device ${effectiveDevId} | User: ${effectiveUserId}`);

      return res.json({
        success: true,
        processed,
        total: mutList.length,
        results,
        systemResetVersion: ctx.systemResetVersion
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: State Summary & Revision
  app.get(["/api/sync/state-summary", "/api/sync/digest"], (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const summary: Record<string, { count: number; lastUpdated?: string }> = {};
    Object.keys(ctx.state).forEach((key) => {
      const arr = (ctx.state as any)[key];
      summary[key] = {
        count: Array.isArray(arr) ? arr.length : 0,
      };
    });

    res.json({
      status: "ok",
      stateRevision: ctx.stateRevision,
      systemResetVersion: ctx.systemResetVersion,
      systemResetId: ctx.systemResetId,
      summary,
      timestamp: new Date().toISOString()
    });
  });

  // REST API: Devices & Heartbeats
  app.get("/api/devices", (_req, res) => {
    const now = Date.now();
    const threshold = 5 * 60 * 1000;
    const devices = Array.from(ctx.activeDevices.values()).map(dev => ({
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
      const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";
      const existing = ctx.activeDevices.get(deviceId);

      ctx.activeDevices.set(deviceId, {
        deviceId,
        deviceName: deviceName || existing?.deviceName || "Terminal Device",
        employeeId: employeeId || existing?.employeeId || "",
        username: username || existing?.username || "Operator",
        role: role || existing?.role || "OPERATOR",
        ip,
        userAgent: req.headers["user-agent"],
        appVersion: appVersion || ctx.cachedGitHubVersion || "Live",
        platform: platform || "Web",
        connectedAt: existing?.connectedAt || new Date().toISOString(),
        lastSeen: now,
        currentView: currentView || existing?.currentView || "dashboard"
      });

      return res.json({ success: true, serverTime: now, systemResetVersion: ctx.systemResetVersion });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Authorized Devices Management
  app.get("/api/devices/authorized", (_req, res) => {
    res.json({
      success: true,
      installationId: ctx.installationId,
      primaryDeviceId: ctx.primaryDeviceId,
      devices: Array.from(ctx.authorizedDevicesMap.values())
    });
  });

  app.post("/api/devices/authorize", (req, res) => {
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    const { deviceId, deviceName, authorId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
      return res.status(403).json({ error: "PERMISSION_DENIED: Only Super Administrator can authorize devices." });
    }

    const cleanDeviceId = String(deviceId).trim();
    const cleanDeviceName = String(deviceName || `Workstation (${cleanDeviceId})`).trim();
    const nowIso = new Date().toISOString();

    const existing = ctx.authorizedDevicesMap.get(cleanDeviceId);
    const reqEmpId = String(req.body?.employeeId || existing?.employeeId || (cleanDeviceId === ctx.primaryDeviceId ? "JPMP-002" : "")).trim().toUpperCase();
    const boundAccount = reqEmpId
      ? ctx.state.registeredUsers.find((u: RegisteredAccount) => (u.employeeId || "").toUpperCase().trim() === reqEmpId)
      : undefined;
    const requestedStatus = String(req.body?.status || "").trim().toUpperCase();
    const finalStatus: "AUTHORIZED" | "PENDING" = requestedStatus === "PENDING" ? "PENDING" : "AUTHORIZED";
    const deviceRecord: AuthorizedDevice = {
      ...(existing || {}),
      deviceId: cleanDeviceId,
      deviceName: cleanDeviceName,
      isPrimaryAdminDevice: cleanDeviceId === ctx.primaryDeviceId,
      status: finalStatus,
      ...(boundAccount ? {
        employeeId: boundAccount.employeeId,
        username: boundAccount.username,
        role: boundAccount.role,
        permission: boundAccount.permission,
        boundAt: nowIso
      } : {}),
      authorizedBy: authorId || "ALDRIN BANAWA (JPMP-002)",
      authorizedAt: nowIso
    };

    ctx.authorizedDevicesMap.set(cleanDeviceId, deviceRecord);
    commitDatabase(ctx);

    recordAuditTrail(ctx, {
      actor: authorId || "SUPER ADMINISTRATOR",
      actorId: "JPMP-002",
      action: finalStatus === "PENDING" ? "DEVICE_PENDING" : "DEVICE_AUTHORIZED",
      recordType: "authorizedDevices",
      recordId: cleanDeviceId,
      summary: `${finalStatus === "PENDING" ? "Marked device pending" : "Authorized device"} ${cleanDeviceName} (${cleanDeviceId})`,
      deviceId: cleanDeviceId
    });

    broadcast(ctx, {
      type: "DEVICE_AUTHORIZATION_UPDATED",
      device: deviceRecord,
      systemResetVersion: ctx.systemResetVersion
    });

    return res.json({ success: true, device: deviceRecord });
  });

  app.post("/api/devices/revoke", (req, res) => {
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
      return res.status(403).json({ error: "PERMISSION_DENIED: Only Super Administrator can revoke devices." });
    }

    const cleanDeviceId = String(deviceId).trim();
    if (cleanDeviceId === ctx.primaryDeviceId) {
      return res.status(400).json({ error: "CANNOT_REVOKE_PRIMARY: The primary administrator device cannot be revoked." });
    }

    const existing = ctx.authorizedDevicesMap.get(cleanDeviceId);
    const revokedRecord: AuthorizedDevice = existing
      ? { ...existing, status: "REVOKED" }
      : {
          deviceId: cleanDeviceId,
          deviceName: `Revoked Device (${cleanDeviceId})`,
          isPrimaryAdminDevice: false,
          status: "REVOKED",
          authorizedBy: "REVOKED_BY_SUPER_ADMIN",
          authorizedAt: new Date().toISOString()
        };
    ctx.authorizedDevicesMap.set(cleanDeviceId, revokedRecord);
    commitDatabase(ctx);

    recordAuditTrail(ctx, {
      actor: req.body?.author || "SUPER ADMINISTRATOR",
      actorId: "JPMP-002",
      action: "DEVICE_REVOKED",
      recordType: "authorizedDevices",
      recordId: cleanDeviceId,
      summary: `Revoked device ${revokedRecord.deviceName} (${cleanDeviceId})`,
      deviceId: cleanDeviceId
    });

    broadcast(ctx, {
      type: "DEVICE_REVOKED",
      deviceId: cleanDeviceId,
      systemResetVersion: ctx.systemResetVersion
    });
    closeDeviceSockets(ctx, cleanDeviceId, "DEVICE_REVOKED");

    return res.json({ success: true, message: `Device ${cleanDeviceId} revoked` });
  });

  // REST API: One-time initial random PIN display on fresh install
  app.get("/api/setup/initial-pin", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    const superAdmin = ctx.state.registeredUsers.find(
      (u: RegisteredAccount) => (u.employeeId || "").toUpperCase().trim() === "JPMP-002"
    );
    if (ctx.oneTimeSetupPin && superAdmin?.mustChangePin && !superAdmin?.pinChangedAt) {
      return res.json({
        hasInitialPin: true,
        employeeId: "JPMP-002",
        initialPin: ctx.oneTimeSetupPin,
        mustChangePin: true
      });
    }
    ctx.oneTimeSetupPin = null;
    return res.json({
      hasInitialPin: false,
      initialPin: null,
      mustChangePin: Boolean(superAdmin?.mustChangePin)
    });
  });

  // REST API: Terminal Fresh Install & Primary Administrator Device Binding
  app.post("/api/terminal/fresh-install", (req, res) => {
    try {
      const { deviceId, deviceName } = req.body;
      const targetDeviceId = String(deviceId || ctx.primaryDeviceId || "").trim();

      if (isDeviceRevoked(ctx, targetDeviceId)) {
        closeDeviceSockets(ctx, targetDeviceId, "DEVICE_REVOKED");
        return res.status(403).json({ error: "DEVICE_REVOKED" });
      }

      if (!ctx.authorizedDevicesMap.has(targetDeviceId)) {
        ctx.authorizedDevicesMap.set(targetDeviceId, {
          deviceId: targetDeviceId,
          deviceName: deviceName || "Primary Administrator PC",
          isPrimaryAdminDevice: true,
          status: "AUTHORIZED",
          authorizedBy: "SYSTEM_FRESH_INSTALL",
          authorizedAt: new Date().toISOString()
        });
      }

      ctx.primaryDeviceId = targetDeviceId;

      const superAdminIndex = ctx.state.registeredUsers.findIndex(
        (u: RegisteredAccount) => (u.employeeId || "").toUpperCase().trim() === "JPMP-002"
      );
      if (superAdminIndex >= 0) {
        ctx.state.registeredUsers[superAdminIndex] = {
          ...ctx.state.registeredUsers[superAdminIndex],
          deviceId: targetDeviceId,
          isPrimaryAdminDevice: true,
          authorizedDevices: [targetDeviceId]
        };
      }

      commitDatabase(ctx);

      const sa = ctx.state.registeredUsers.find((u: RegisteredAccount) => u.employeeId === "JPMP-002");
      return res.json({
        success: true,
        installationId: ctx.installationId,
        primaryDeviceId: ctx.primaryDeviceId,
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
        superAdmin: sa ? sanitizeUserForClient(sa) : null
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GLOBAL RESET API
  app.post(["/api/reset-everything", "/api/reset-database"], async (req, res) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;

      if (!req.body?.confirmed) {
        return res.status(400).json({
          error: "CONFIRMATION_REQUIRED: Global reset requires explicit 'confirmed: true'."
        });
      }

      if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
        return res.status(403).json({
          error: "PERMISSION_DENIED: Only the Super Administrator (JPMP-002) is authorized to execute a complete global database reset."
        });
      }

      const author = req.body?.author || "ALDRIN BANAWA (SUPER ADMINISTRATOR)";
      const keepUsers = req.body?.keepUsers !== false;

      ctx.systemResetVersion += 1;
      ctx.systemResetTimestamp = new Date().toISOString();
      ctx.systemResetId = `RESET-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      ctx.systemResetBy = author;
      ctx.stateRevision += 1;

      ctx.state.stocks = [];
      ctx.state.receiving = [];
      ctx.state.returns = [];
      ctx.state.recycling = [];
      ctx.state.issuances = [];
      ctx.state.deliveries = [];
      ctx.state.envLogs = [];
      ctx.state.forkliftChecks = [];
      ctx.state.registries = [];
      ctx.state.stockMovements = [];

      if (!keepUsers) {
        ctx.state.registeredUsers = [];
        ctx.deletedUserTombstones.clear();
        ensureSuperAdminSeed(ctx, true);
        const sa = ctx.state.registeredUsers[0];
        if (sa) {
          sa.reset_version = ctx.systemResetVersion;
          sa.version = 1;
          sa.updated_at = ctx.systemResetTimestamp;
        }
      } else {
        ctx.state.registeredUsers = ctx.state.registeredUsers.map((u: RegisteredAccount) => ({
          ...u,
          reset_version: ctx.systemResetVersion,
          version: (u.version || 1) + 1,
          updated_at: ctx.systemResetTimestamp
        }));
      }

      ctx.deletedRecordTombstones.clear();

      const resetMsg: ChatMessage = {
        id: `sys-reset-${Date.now()}`,
        sender: "SYSTEM SECURITY AUDIT",
        text: `GLOBAL DATABASE RESET executed by ${author}. System reset version advanced to v${ctx.systemResetVersion} (${ctx.systemResetId}).`,
        timestamp: ctx.systemResetTimestamp,
        isSystem: true
      };
      ctx.chatMessages.push(resetMsg);

      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res.status(500).json({ error: "CRITICAL: Failed to commit global reset to central disk database." });
      }

      recordAuditTrail(ctx, {
        timestamp: ctx.systemResetTimestamp,
        actor: author,
        actorId: "JPMP-002",
        action: "GLOBAL_RESET",
        recordType: "system",
        recordId: ctx.systemResetId,
        summary: `Global database reset to v${ctx.systemResetVersion} (${keepUsers ? "kept operator accounts" : "reset all accounts"})`,
        deviceId: extractDeviceIdFromHttp(req) || undefined
      });

      broadcast(ctx, {
        type: "GLOBAL_RESET",
        systemResetVersion: ctx.systemResetVersion,
        systemResetTimestamp: ctx.systemResetTimestamp,
        systemResetId: ctx.systemResetId,
        systemResetBy: ctx.systemResetBy,
        author,
        keepUsers,
        data: {
          ...ctx.state,
          registeredUsers: (ctx.state.registeredUsers || []).map(sanitizeUserForClient),
          chatMessages: ctx.chatMessages
        }
      });

      broadcast(ctx, {
        type: "global_reset",
        systemResetVersion: ctx.systemResetVersion,
        systemResetTimestamp: ctx.systemResetTimestamp,
        systemResetId: ctx.systemResetId,
        systemResetBy: ctx.systemResetBy,
        author,
        keepUsers
      });

      return res.json({
        success: true,
        message: "GLOBAL DATABASE RESET EXECUTED SUCCESSFULLY",
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
        systemResetTimestamp: ctx.systemResetTimestamp,
        author,
        keepUsers
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // BACKUPS MANAGEMENT REST API
  app.get("/api/admin/backups", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      if (!fs.existsSync(serverConfig.backupsDir)) {
        fs.mkdirSync(serverConfig.backupsDir, { recursive: true });
      }

      const backups = getAllBackupRecords(ctx);

      return res.json({
        success: true,
        backupsDir: serverConfig.backupsDir,
        intervalHours: 1,
        retentionPolicy: "PERMANENT_NO_DELETION",
        maxRetained: null,
        backups,
        auditLogs: ctx.backupAuditLogs.slice(0, 50)
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to list backups" });
    }
  });

  app.post("/api/admin/backups/create", async (req, res) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
        return res.status(403).json({
          error: "PERMISSION_DENIED: Only Super Administrator (JPMP-002) is authorized to trigger manual backups."
        });
      }
      const author = req.body?.author || "SUPER_ADMIN";
      const result = await createDatabaseBackup(ctx, "MANUAL_ON_DEMAND", author);
      if (result.success) {
        recordAuditTrail(ctx, {
          actor: author,
          actorId: req.body?.employeeId || "JPMP-002",
          action: "BACKUP_CREATED",
          recordType: "system",
          recordId: result.filename || "backup",
          summary: `Created manual database backup '${result.filename}'`
        });
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

  app.post("/api/admin/backups/restore", (req, res) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
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

      const author = req.body?.author || "SUPER_ADMIN";
      const result = restoreDatabaseFromBackup(ctx, filename, author);

      if (result.success) {
        recordAuditTrail(ctx, {
          actor: author,
          actorId: req.body?.employeeId || "JPMP-002",
          action: "DATABASE_RESTORED",
          recordType: "system",
          recordId: filename,
          summary: `Restored live database from snapshot '${filename}'`
        });
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

  app.get("/api/admin/audit-logs", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
      return res.status(403).json({
        error: "PERMISSION_DENIED: Only Super Administrator is authorized to view the system audit trail."
      });
    }

    const dateFrom = String(req.query.dateFrom || "").trim();
    const dateTo = String(req.query.dateTo || "").trim();
    const userFilter = String(req.query.user || "").trim().toLowerCase();
    const recordTypeFilter = String(req.query.recordType || "").trim();
    const actionFilter = String(req.query.action || "").trim().toUpperCase();
    const searchQuery = String(req.query.q || "").trim().toLowerCase();
    const limitParam = parseInt(String(req.query.limit || "1000"), 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_AUDIT_TRAIL_ENTRIES) : 1000;

    const availableUsersSet = new Set<string>();
    const availableTypesSet = new Set<string>();
    const availableActionsSet = new Set<string>();

    for (const entry of ctx.auditTrailLogs) {
      if (entry.actor) availableUsersSet.add(entry.actor);
      if (entry.recordType) availableTypesSet.add(entry.recordType);
      if (entry.action) availableActionsSet.add(entry.action);
    }

    const filtered = ctx.auditTrailLogs.filter(entry => {
      const entryDate = String(entry.timestamp || "").slice(0, 10);
      if (dateFrom && entryDate && entryDate < dateFrom) return false;
      if (dateTo && entryDate && entryDate > dateTo) return false;
      if (userFilter && userFilter !== "all") {
        const actorMatch = String(entry.actor || "").toLowerCase().includes(userFilter);
        const actorIdMatch = String(entry.actorId || "").toLowerCase().includes(userFilter);
        if (!actorMatch && !actorIdMatch) return false;
      }
      if (recordTypeFilter && recordTypeFilter !== "ALL") {
        if (entry.recordType !== recordTypeFilter) return false;
      }
      if (actionFilter && actionFilter !== "ALL") {
        if (entry.action !== actionFilter) return false;
      }
      if (searchQuery) {
        const haystack = [
          entry.actor,
          entry.actorId,
          entry.action,
          entry.recordType,
          entry.recordId,
          entry.summary,
          entry.details || "",
          entry.deviceId || ""
        ].join(" ").toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    });

    return res.json({
      success: true,
      total: ctx.auditTrailLogs.length,
      filteredCount: filtered.length,
      logs: filtered.slice(0, limit),
      availableUsers: Array.from(availableUsersSet).sort((a, b) => a.localeCompare(b)),
      availableRecordTypes: Array.from(availableTypesSet).sort((a, b) => a.localeCompare(b)),
      availableActions: Array.from(availableActionsSet).sort((a, b) => a.localeCompare(b))
    });
  });

  app.get("/api/admin/backups/download/:filename", (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const resolvedBackupsDir = path.resolve(serverConfig.backupsDir);
      const filePath = path.resolve(resolvedBackupsDir, filename);
      if (!filePath.startsWith(resolvedBackupsDir + path.sep)) {
        return res.status(400).json({ error: "Invalid backup filename" });
      }
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
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      ensureSuperAdminSeed(ctx, false);

      const safeAccounts = ctx.state.registeredUsers.map(sanitizeUserForClient);
      return res.json({
        success: true,
        count: safeAccounts.length,
        accounts: safeAccounts,
        revision: ctx.stateRevision,
        systemResetVersion: ctx.systemResetVersion
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Verify Operator Credentials & PIN
  app.post("/api/accounts/verify", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;

      const { identifier, pin } = req.body;
      const rawInput = String(identifier || "").trim();
      const enteredPin = String(pin || "").trim();
      const reqDevId = extractDeviceIdFromHttp(req);

      if (!rawInput || !enteredPin) {
        return res.status(400).json({ success: false, error: "Operator Identifier and PIN code are required." });
      }

      let searchId = rawInput.toUpperCase();
      if (!searchId.startsWith("JPMP-")) {
        searchId = "JPMP-" + searchId.replace(/^EMP-/, "");
      }
      const inputPhone = rawInput.replace(/\D/g, "");

      let matchedUser: RegisteredAccount | undefined;
      let upgradedLegacyPin = false;
      for (const u of ctx.state.registeredUsers) {
        if (u.status === "INACTIVE") continue;
        const uEmpId = (u.employeeId || "").toUpperCase().trim();
        const uUsername = (u.username || "").toUpperCase().trim();
        const uPhone = (u.phoneNumber || "").replace(/\D/g, "");
        const idMatches = uEmpId === searchId || uEmpId === rawInput.toUpperCase() || uUsername === rawInput.toUpperCase() || (inputPhone.length >= 10 && uPhone === inputPhone);
        if (!idMatches) continue;
        const check = verifyUserPin(u, enteredPin);
        if (check.matched) {
          matchedUser = u;
          upgradedLegacyPin = check.upgradedFromPlaintext;
          break;
        }
      }

      if (matchedUser) {
        matchedUser.lastActive = new Date().toISOString();
        if (enteredPin === "1234") {
          matchedUser.isPinCompromised = true;
        }

        const sessionToken = crypto.randomBytes(32).toString("hex");
        ctx.sessionTokensMap.set(sessionToken, {
          employeeId: matchedUser.employeeId,
          ...(reqDevId ? { deviceId: reqDevId } : {}),
          createdAt: Date.now()
        });

        if (reqDevId) {
          const devRec = ctx.authorizedDevicesMap.get(reqDevId);
          if (devRec && devRec.status === "AUTHORIZED") {
            devRec.employeeId = matchedUser.employeeId;
            devRec.username = matchedUser.username;
            devRec.role = matchedUser.role;
            devRec.permission = matchedUser.permission;
            devRec.boundAt = new Date().toISOString();
          }
          for (const conn of ctx.connectionRegistry.values()) {
            if (conn.device_id === reqDevId || conn.deviceId === reqDevId) {
              conn.employeeId = matchedUser.employeeId;
              conn.username = matchedUser.username;
              conn.role = matchedUser.role;
              conn.permission = matchedUser.status === "INACTIVE" ? "VIEW_ONLY" : matchedUser.permission;
            }
          }
        }

        commitDatabase(ctx);
        if (upgradedLegacyPin) {
          logger.info(`[SECURITY] Upgraded legacy plain-text PIN to scrypt hash for operator ${matchedUser.employeeId}.`);
        }

        const safeUser = sanitizeUserForClient(matchedUser);
        return res.json({
          success: true,
          token: sessionToken,
          sessionToken,
          permission: matchedUser.permission,
          mustChangePin: Boolean(matchedUser.mustChangePin),
          isPinCompromised: enteredPin === "1234" || !!matchedUser.isPinCompromised,
          user: safeUser,
          systemResetVersion: ctx.systemResetVersion
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

  // REST API: Update Account PIN
  app.post("/api/accounts/update-pin", async (req, res) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;

      const { employeeId, currentPin, newPin, requesterEmployeeId, author, reason } = req.body;
      const cleanEmpId = String(employeeId || "").trim().toUpperCase();
      const cleanNewPin = String(newPin || "").trim();
      const cleanCurrentPin = String(currentPin || "").trim();
      const requesterId = String(requesterEmployeeId || cleanEmpId).trim().toUpperCase();

      if (!cleanEmpId || !cleanNewPin) {
        return res.status(400).json({ error: "Operator ID and new PIN are required" });
      }
      if (!/^\d{4,6}$/.test(cleanNewPin)) {
        return res.status(400).json({ error: "PIN must be between 4 and 6 numeric digits" });
      }

      if (cleanNewPin === "1234") {
        return res.status(400).json({
          error: "SECURITY_REJECTED: '1234' is a compromised default PIN and is strictly prohibited."
        });
      }
      if (/^(\d)\1+$/.test(cleanNewPin)) {
        return res.status(400).json({
          error: "SECURITY_REJECTED: Repetitive PIN patterns (e.g. 0000, 1111) are not allowed."
        });
      }

      const target = ctx.state.registeredUsers.find((u: RegisteredAccount) => u.employeeId.toUpperCase().trim() === cleanEmpId);
      if (!target) {
        return res.status(404).json({ error: "Operator account not found in central database" });
      }

      const isSuper = isAuthorizedSuperAdmin(ctx, req, commitDatabase);
      if (!isSuper) {
        const currentCheck = verifyUserPin(target, cleanCurrentPin);
        if (!currentCheck.matched) {
          console.warn(`[SECURITY ALERT] Unauthorized PIN change attempt for ${cleanEmpId} from IP ${req.ip}`);
          return res.status(403).json({ error: "INCORRECT_PIN: Current PIN does not match. Super Admin authorization required." });
        }
      }

      const previousWasCompromised = target.pin === "1234" || !!target.isPinCompromised;
      const actionType = previousWasCompromised ? "COMPROMISED_PIN_RESOLVED" : (isSuper ? "PIN_RESET" : "PIN_CHANGED");

      const { pinHash, pinSalt } = hashPinScrypt(cleanNewPin);
      target.pinHash = pinHash;
      target.pinSalt = pinSalt;
      delete target.pin;
      delete (target as any).pin_hash;
      target.mustChangePin = false;
      target.isPinCompromised = false;
      target.pinChangedAt = new Date().toISOString();
      target.pinChangedBy = requesterId;
      if (cleanEmpId === "JPMP-002") {
        ctx.oneTimeSetupPin = null;
      }
      target.version = (target.version || 1) + 1;
      target.updated_at = new Date().toISOString();
      target.reset_version = ctx.systemResetVersion;

      ctx.stateRevision++;
      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to persist PIN change to central database" });
      }

      logPinAudit(
        ctx,
        actionType,
        cleanEmpId,
        target.username,
        author || (isSuper ? "Super Administrator (ALDRIN BANAWA)" : target.username),
        requesterId,
        reason || (previousWasCompromised ? "Resolving compromised default PIN" : "Explicit PIN update"),
        previousWasCompromised,
        req.ip
      );

      recordAuditTrail(ctx, {
        actor: author || (isSuper ? "ALDRIN BANAWA" : target.username),
        actorId: requesterId,
        action: actionType,
        recordType: "registeredUsers",
        recordId: cleanEmpId,
        summary: `${actionType} for ${target.username} (${cleanEmpId})`,
        details: reason || undefined,
        deviceId: extractDeviceIdFromHttp(req) || undefined
      });

      const safeTarget = sanitizeUserForClient(target);

      broadcast(ctx, {
        type: "account_updated",
        account: safeTarget,
        user: safeTarget,
        author: author || requesterId,
        systemResetVersion: ctx.systemResetVersion
      });

      broadcast(ctx, {
        type: "collection_updated",
        collection: "registeredUsers",
        data: ctx.state.registeredUsers,
        systemResetVersion: ctx.systemResetVersion
      });

      return res.json({
        success: true,
        message: previousWasCompromised
          ? "Compromised PIN resolved and secure PIN activated in central database"
          : "PIN updated successfully in central database",
        user: safeTarget
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Get PIN Audit Logs
  app.get("/api/accounts/pin-audit-log", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    return res.json({
      success: true,
      count: ctx.pinAuditLogs.length,
      logs: ctx.pinAuditLogs
    });
  });

  // REST API: Register New Operator Account
  app.post("/api/accounts/register", async (req, res) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }

      const { employeeId, username, role, phoneNumber, permission, pin, registeredBy } = req.body;
      const cleanEmpId = String(employeeId || "").trim().toUpperCase();
      const cleanUsername = String(username || "").trim().toUpperCase();
      const cleanPin = String(pin || "").trim();

      if (!cleanEmpId || !cleanUsername || !cleanPin) {
        return res.status(400).json({ error: "Employee ID, Full Name, and PIN code are required." });
      }
      if (!/^\d{4,6}$/.test(cleanPin)) {
        return res.status(400).json({ error: "PIN must be between 4 and 6 numeric digits." });
      }
      if (cleanPin === "1234" || /^(\d)\1+$/.test(cleanPin)) {
        return res.status(400).json({ error: "SECURITY_REJECTED: Compromise/trivial PINs ('1234', repetitive digits) are not allowed." });
      }

      const exists = ctx.state.registeredUsers.some((u: RegisteredAccount) => u.employeeId.toUpperCase().trim() === cleanEmpId);
      if (exists) {
        return res.status(409).json({ error: `Account with ID ${cleanEmpId} already exists in the central database.` });
      }

      unmarkUserTombstone(ctx, cleanEmpId);

      const { pinHash, pinSalt } = hashPinScrypt(cleanPin);

      const newUser: RegisteredAccount = {
        id: `USR-${cleanEmpId}`,
        employeeId: cleanEmpId,
        username: cleanUsername,
        role: String(role || "WAREHOUSE CLERK").trim().toUpperCase(),
        phoneNumber: phoneNumber ? String(phoneNumber).trim() : "",
        permission: String(permission || "LIMITED_ACCESS").trim(),
        pinHash,
        pinSalt,
        status: "ACTIVE",
        registeredBy: registeredBy || "JPMP-002 (ALDRIN BANAWA)",
        registeredBySuperAdmin: true,
        registeredAt: new Date().toISOString(),
        version: 1,
        updated_at: new Date().toISOString(),
        reset_version: ctx.systemResetVersion
      };

      ctx.state.registeredUsers.push(newUser);
      ctx.stateRevision++;

      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to commit new account to central database" });
      }

      const authCtx = resolveRequestAuthContext(ctx, req);
      recordAuditTrail(ctx, {
        actor: authCtx.account?.username || registeredBy || "Super Administrator",
        actorId: authCtx.employeeId || "JPMP-002",
        action: "CREATE",
        recordType: "registeredUsers",
        recordId: cleanEmpId,
        summary: `Registered account ${cleanUsername} (${cleanEmpId}) — Role: ${newUser.role}, Permission: ${newUser.permission}`,
        deviceId: authCtx.deviceId || undefined
      });

      const safeUser = sanitizeUserForClient(newUser);

      broadcast(ctx, {
        type: "account_registered",
        user: safeUser,
        author: registeredBy || "Super Administrator",
        systemResetVersion: ctx.systemResetVersion
      });

      broadcast(ctx, {
        type: "account_created",
        account: safeUser,
        user: safeUser,
        systemResetVersion: ctx.systemResetVersion
      });

      broadcast(ctx, {
        type: "collection_updated",
        collection: "registeredUsers",
        data: ctx.state.registeredUsers,
        systemResetVersion: ctx.systemResetVersion
      });

      return res.json({ success: true, user: safeUser, systemResetVersion: ctx.systemResetVersion });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Update Operator Account
  app.post("/api/accounts/update", async (req, res) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }

      const { oldEmployeeId, updatedUser } = req.body;
      const cleanOldId = String(oldEmployeeId || updatedUser?.employeeId || "").trim().toUpperCase();

      if (!cleanOldId || !updatedUser) {
        return res.status(400).json({ error: "Old Employee ID and updated account data required" });
      }

      const index = ctx.state.registeredUsers.findIndex((u: RegisteredAccount) => u.employeeId.toUpperCase().trim() === cleanOldId);
      if (index === -1) {
        return res.status(404).json({ error: "Account not found in central database" });
      }

      const existing = ctx.state.registeredUsers[index];
      const isSuper = cleanOldId === "JPMP-002";

      const cleanNewId = String(updatedUser.employeeId || cleanOldId).trim().toUpperCase();
      if (cleanNewId !== cleanOldId) {
        if (isSuper) {
          return res.status(403).json({ error: "Super Administrator Employee ID cannot be altered." });
        }
        const duplicate = ctx.state.registeredUsers.some(
          (u: RegisteredAccount, idx: number) => idx !== index && u.employeeId.toUpperCase().trim() === cleanNewId
        );
        if (duplicate) {
          return res.status(409).json({ error: `Employee ID ${cleanNewId} is already taken by another account.` });
        }
      }

      const mergedUser: RegisteredAccount = {
        ...existing,
        ...updatedUser,
        employeeId: isSuper ? "JPMP-002" : cleanNewId,
        username: String(updatedUser.username || existing.username).trim().toUpperCase(),
        role: isSuper ? "SUPER ADMINISTRATOR" : String(updatedUser.role || existing.role).trim().toUpperCase(),
        permission: isSuper ? "FULL_ACCESS" : String(updatedUser.permission || existing.permission).trim(),
        pinHash: existing.pinHash,
        pinSalt: existing.pinSalt,
        ...(existing.pin && !existing.pinHash ? { pin: existing.pin } : {}),
        mustChangePin: existing.mustChangePin,
        isPinCompromised: existing.isPinCompromised,
        pinChangedAt: existing.pinChangedAt,
        pinChangedBy: existing.pinChangedBy,
        version: (existing.version || 1) + 1,
        updated_at: new Date().toISOString(),
        reset_version: ctx.systemResetVersion
      };
      if (mergedUser.pinHash) delete mergedUser.pin;

      ctx.state.registeredUsers[index] = mergedUser;
      ctx.stateRevision++;

      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to persist account update to central database" });
      }

      const accountDiff = describeRecordDiff(existing, mergedUser);
      recordAuditTrail(ctx, {
        actor: auth.account?.username || req.body.author || "Admin",
        actorId: auth.employeeId || "ADMIN",
        action: "UPDATE",
        recordType: "registeredUsers",
        recordId: mergedUser.employeeId,
        summary: `Updated account ${mergedUser.username} (${mergedUser.employeeId})${accountDiff ? ` — ${accountDiff}` : ""}`,
        deviceId: auth.deviceId || undefined
      });

      const safeUser = sanitizeUserForClient(mergedUser);

      broadcast(ctx, {
        type: "account_updated",
        account: safeUser,
        user: safeUser,
        author: req.body.author || "Admin",
        systemResetVersion: ctx.systemResetVersion
      });

      broadcast(ctx, {
        type: "collection_updated",
        collection: "registeredUsers",
        data: ctx.state.registeredUsers,
        systemResetVersion: ctx.systemResetVersion
      });

      return res.json({ success: true, user: safeUser, systemResetVersion: ctx.systemResetVersion });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Delete Operator Account
  app.post("/api/accounts/delete", async (req, res) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }

      const { employeeId } = req.body;
      const cleanId = String(employeeId || "").trim().toUpperCase();

      if (!cleanId) return res.status(400).json({ error: "Employee ID is required" });
      if (cleanId === "JPMP-002") {
        return res.status(403).json({ error: "PROTECTED_ACCOUNT: Super Administrator JPMP-002 cannot be deleted." });
      }

      const deletedAcc = ctx.state.registeredUsers.find((u: RegisteredAccount) => u.employeeId.toUpperCase().trim() === cleanId);
      markUserTombstone(ctx, cleanId);
      ctx.state.registeredUsers = ctx.state.registeredUsers.filter((u: RegisteredAccount) => u.employeeId.toUpperCase().trim() !== cleanId);
      ctx.stateRevision++;

      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to commit account deletion to central database" });
      }

      recordAuditTrail(ctx, {
        actor: auth.account?.username || req.body?.author || "Admin",
        actorId: auth.employeeId || "ADMIN",
        action: "DELETE",
        recordType: "registeredUsers",
        recordId: cleanId,
        summary: `Deleted account ${deletedAcc?.username || cleanId} (${cleanId})`,
        deviceId: auth.deviceId || undefined
      });

      broadcast(ctx, {
        type: "account_deleted",
        employeeId: cleanId,
        systemResetVersion: ctx.systemResetVersion
      });

      broadcast(ctx, {
        type: "collection_updated",
        collection: "registeredUsers",
        data: ctx.state.registeredUsers,
        systemResetVersion: ctx.systemResetVersion
      });

      return res.json({ success: true, employeeId: cleanId, systemResetVersion: ctx.systemResetVersion });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Clear All Accounts Except Super Admin
  app.post("/api/accounts/clear-all-except-super-admin", async (req, res) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;

      if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
        return res.status(403).json({ error: "PERMISSION_DENIED: Only Super Administrator is authorized to clear accounts." });
      }

      const superAdmin = ctx.state.registeredUsers.find((u: RegisteredAccount) => u.employeeId.toUpperCase().trim() === "JPMP-002");
      ctx.state.registeredUsers.forEach((u: RegisteredAccount) => {
        if (u.employeeId.toUpperCase().trim() !== "JPMP-002") {
          markUserTombstone(ctx, u.employeeId);
        }
      });

      if (superAdmin) {
        ctx.state.registeredUsers = [{ ...superAdmin }];
      } else {
        ctx.state.registeredUsers = [];
        ensureSuperAdminSeed(ctx, true);
      }
      ctx.stateRevision++;

      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to commit accounts purge to central database" });
      }

      const authCtx = resolveRequestAuthContext(ctx, req);
      recordAuditTrail(ctx, {
        actor: authCtx.account?.username || req.body?.author || "Super Administrator",
        actorId: authCtx.employeeId || "JPMP-002",
        action: "PURGE",
        recordType: "registeredUsers",
        recordId: "ALL_NON_ADMIN",
        summary: "Cleared all operator accounts except Super Administrator (JPMP-002)",
        deviceId: authCtx.deviceId || undefined
      });

      const safeAccounts = ctx.state.registeredUsers.map(sanitizeUserForClient);

      broadcast(ctx, {
        type: "all_accounts_cleared",
        data: ctx.state.registeredUsers,
        systemResetVersion: ctx.systemResetVersion
      });

      broadcast(ctx, {
        type: "accounts_cleared",
        systemResetVersion: ctx.systemResetVersion
      });

      broadcast(ctx, {
        type: "collection_updated",
        collection: "registeredUsers",
        data: ctx.state.registeredUsers,
        systemResetVersion: ctx.systemResetVersion
      });

      return res.json({ success: true, count: safeAccounts.length, accounts: safeAccounts });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Get Operational Roles
  app.get("/api/roles", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      success: true,
      roles: ctx.state.operationalRoles || DEFAULT_OPERATIONAL_ROLES
    });
  });

  // REST API: Manage / Update Operational Roles
  app.post("/api/roles", async (req, res) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }
      const { action, role, oldRole, newRole, roles, updateExistingAccounts } = req.body;
      let modified = false;
      let usersModified = false;

      if (action === "add" && role) {
        const clean = String(role).trim().toUpperCase();
        if (clean && !ctx.state.operationalRoles.includes(clean)) {
          ctx.state.operationalRoles.push(clean);
          modified = true;
        }
      } else if (action === "rename" && oldRole && newRole) {
        const cleanOld = String(oldRole).trim().toUpperCase();
        const cleanNew = String(newRole).trim().toUpperCase();
        if (cleanOld && cleanNew) {
          const idx = ctx.state.operationalRoles.indexOf(cleanOld);
          if (idx !== -1) {
            ctx.state.operationalRoles[idx] = cleanNew;
            modified = true;
          } else if (!ctx.state.operationalRoles.includes(cleanNew)) {
            ctx.state.operationalRoles.push(cleanNew);
            modified = true;
          }

          if (updateExistingAccounts !== false) {
            ctx.state.registeredUsers = ctx.state.registeredUsers.map((u: RegisteredAccount) => {
              if ((u.role || "").toUpperCase().trim() === cleanOld) {
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
      } else if (action === "delete" && role) {
        const clean = String(role).trim().toUpperCase();
        if (clean) {
          ctx.state.operationalRoles = ctx.state.operationalRoles.filter((r: string) => r !== clean);
          modified = true;
        }
      } else if (Array.isArray(roles)) {
        const cleaned = Array.from(new Set<string>(roles.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean)));
        if (cleaned.length > 0) {
          ctx.state.operationalRoles = cleaned;
          modified = true;
        }
      }

      if (modified || usersModified) {
        ctx.stateRevision++;
        commitDatabase(ctx);

        recordAuditTrail(ctx, {
          actor: auth.account?.username || req.body?.author || "Admin",
          actorId: auth.employeeId || "ADMIN",
          action: "UPDATE",
          recordType: "operationalRoles",
          recordId: "operationalRoles",
          summary: `Updated operational roles (${action || "replace"}${role ? `: ${role}` : oldRole ? `: ${oldRole} -> ${newRole}` : ""})`,
          deviceId: auth.deviceId || undefined
        });

        broadcast(ctx, {
          type: "roles_updated",
          roles: ctx.state.operationalRoles,
          systemResetVersion: ctx.systemResetVersion
        });

        broadcast(ctx, {
          type: "collection_updated",
          collection: "operationalRoles",
          data: ctx.state.operationalRoles,
          systemResetVersion: ctx.systemResetVersion
        });

        if (usersModified) {
          broadcast(ctx, {
            type: "collection_updated",
            collection: "registeredUsers",
            data: ctx.state.registeredUsers,
            systemResetVersion: ctx.systemResetVersion
          });
        }
      }

      return res.json({
        success: true,
        roles: ctx.state.operationalRoles,
        accountsUpdated: usersModified
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });



  // REST API: Upsert Record
  app.post("/api/records/upsert", async (req, res) => {
    try {
      const { collection, record, author, employeeId, actionDesc, expectedVersion } = req.body;
      const reqDevId = String(req.body.device_id || req.body.deviceId || req.headers["x-device-id"] || record?.device_id || record?.deviceId || "").trim();
      if (isDeviceRevoked(ctx, reqDevId)) {
        closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
        return res.status(403).json({ error: "DEVICE_REVOKED" });
      }

      const auth = resolveRequestAuthContext(ctx, req, reqDevId);
      const userPermission = auth.permission;
      const clientResetVersion = Number(req.body.reset_version || req.headers["x-reset-version"] || record?.reset_version) || ctx.systemResetVersion;

      const result = executeRecordUpsert(ctx, {
        collection,
        record,
        author: auth.account?.username || author,
        employeeId: auth.employeeId || employeeId,
        user_id: req.body.user_id || record?.user_id,
        device_id: reqDevId,
        actionDesc,
        expectedVersion,
        reset_version: clientResetVersion,
        userPermission
      });

      if (!result.success) {
        return res.status(result.status).json({
          error: result.error,
          currentRecord: result.currentRecord || result.confirmedRecord,
          confirmedRecord: result.confirmedRecord || result.currentRecord,
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

  // REST API: Delete Record
  app.post("/api/records/delete", async (req, res) => {
    try {
      const { collection, id, author, employeeId, actionDesc, expectedVersion } = req.body;
      const reqDevId = String(req.body.device_id || req.body.deviceId || req.headers["x-device-id"] || "").trim();
      if (isDeviceRevoked(ctx, reqDevId)) {
        closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
        return res.status(403).json({ error: "DEVICE_REVOKED" });
      }

      const auth = resolveRequestAuthContext(ctx, req, reqDevId);
      const userPermission = auth.permission;
      const clientResetVersion = Number(req.body.reset_version || req.headers["x-reset-version"]) || ctx.systemResetVersion;

      const result = executeRecordDelete(ctx, {
        collection,
        id,
        author: auth.account?.username || author,
        employeeId: auth.employeeId || employeeId,
        user_id: req.body.user_id,
        device_id: reqDevId,
        actionDesc,
        expectedVersion,
        reset_version: clientResetVersion,
        userPermission
      });

      if (!result.success) {
        return res.status(result.status).json({
          error: result.error,
          currentRecord: result.currentRecord || result.confirmedRecord,
          confirmedRecord: result.confirmedRecord || result.currentRecord,
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


  // REST API: Chat message
  app.post("/api/chat", (req, res) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }
      const { sender, text } = req.body;
      const cleanText = String(text || "").trim();
      if (!cleanText) return res.status(400).json({ error: "Text required" });

      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        sender: sender || "Staff",
        text: cleanText,
        timestamp: new Date().toISOString(),
        isSystem: false
      };

      ctx.chatMessages.push(newMsg);
      if (ctx.chatMessages.length > 200) ctx.chatMessages.shift();
      commitDatabase(ctx);

      broadcast(ctx, {
        type: "chat_broadcast",
        message: newMsg
      });

      return res.json({ success: true, message: newMsg });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware in dev or Static assets in prod
  if (!serverConfig.isProduction) {
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
    app.get("*", (_req, res) => {
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
    logger.info(`[SERVER SHUTDOWN] Received ${signal}. Executing graceful SQLite database persistence and close...`);
    try {
      commitDatabase(ctx);
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
    logger.info(`JUWEI WAREHOUSE MANAGEMENT SYSTEM Central Real-time Server listening on http://0.0.0.0:${PORT}`);
    logger.info(`[SERVER STARTUP] Instance ID: ${SERVER_INSTANCE_ID} | Boot Time: ${SERVER_BOOT_TIME} | PID: ${process.pid}`);
    if (!configuredDataDir) {
      console.warn(`[SERVER WARNING] JUWEI_DATA_DIR is not set. Database file (${DATA_FILE}) is stored on ephemeral local disk and won't be shared across multiple server instances.`);
    }

    getLatestGitHubReleaseVersion(ctx, "").catch(() => {});
  });
}

startServer();
