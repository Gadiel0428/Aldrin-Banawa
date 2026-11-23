/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import { checkpointAndClose } from "./server/sqliteStore.ts";
import {
  loadAndValidateServerConfig,
  printServerStartupSummary,
} from "./server/config.ts";
import logger from "./src/lib/logger.ts";
import { createServerContext } from "./server/services/context.ts";
import { ensureInitialAuditTrailSeed } from "./server/services/auditService.ts";
import { repairFifoTagColorsOnStartup } from "./server/services/fifoService.ts";
import {
  commitDatabase,
  createDatabaseBackup,
  createPreStartupBackup,
  loadDatabaseFromDisk,
} from "./server/services/backupService.ts";
import {
  getLatestGitHubReleaseVersion,
  loadPersistedGitHubReleaseFallback,
} from "./server/services/releaseService.ts";
import {
  rebuildMovementsMigration,
  scheduleNightlyReconciliation,
} from "./server/services/stockLedgerService.ts";
import { setupWebSocketServer } from "./server/services/websocketService.ts";
import { registerStockRoutes } from "./server/routes/stock.ts";
import { registerReceivingRoutes } from "./server/routes/receiving.ts";
import { registerIssuanceRoutes } from "./server/routes/issuance.ts";
import { registerDeliveryRoutes } from "./server/routes/delivery.ts";
import { registerMasterDataRoutes } from "./server/routes/master-data.ts";
import { registerAccountsRoutes } from "./server/routes/accounts.ts";
import { registerBackupsRoutes } from "./server/routes/backups.ts";
import { registerSyncRoutes } from "./server/routes/sync.ts";
import { registerAdminRoutes } from "./server/routes/admin.ts";

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

  // 3b. Run idempotent movement migration & derive stock balances from movements
  rebuildMovementsMigration(ctx);
  const stopNightlyReconcile = scheduleNightlyReconciliation(ctx);

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
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-permission, x-reset-version, x-employee-id, x-device-id, x-account-id, x-warehouse-id, x-session-id, x-client-platform, x-permission, Cache-Control, Pragma"
    );
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
  registerIssuanceRoutes(app, ctx);
  registerDeliveryRoutes(app, ctx);
  registerMasterDataRoutes(app, ctx);
  registerAccountsRoutes(app, ctx);
  registerBackupsRoutes(app, ctx);
  registerSyncRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

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
      stopNightlyReconcile();
    } catch (_e) {}
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
