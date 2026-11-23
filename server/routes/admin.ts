/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Diagnostics, Health, Releases, Device Authorization, Fresh Install, Reset & Audit Log Routes
 */

import fs from "fs";
import type { Express, Request, Response } from "express";
import type { AuthorizedDevice, ChatMessage, RegisteredAccount } from "../../shared/types.ts";
import logger from "../../src/lib/logger.ts";
import {
  mapAccountToApi,
  mapAuditLogsQueryFromApi,
  mapDeviceAuthorizeFromApi,
  mapDeviceHeartbeatFromApi,
  mapReleasePublishFromApi,
  mapRequestMetaFromApi,
} from "../api/mapper.ts";
import {
  compareServerSemver,
  maxSemverVersion,
  normalizeGitHubRepo,
  resolveServerBundleVersion,
} from "../config.ts";
import type { ServerContext } from "../services/context.ts";
import { MAX_AUDIT_TRAIL_ENTRIES } from "../services/context.ts";
import { recordAuditTrail } from "../services/auditService.ts";
import {
  ensureSuperAdminSeed,
  extractDeviceIdFromHttp,
  isAuthorizedSuperAdmin,
  isDeviceRevoked,
  rejectIfDeviceRevokedHttp,
} from "../services/authService.ts";
import { commitDatabase } from "../services/backupService.ts";
import {
  broadcast,
  closeDeviceSockets,
  getActiveOperatorsCount,
  sanitizeUserForClient,
} from "../services/realtimeService.ts";
import { getLatestGitHubReleaseVersion } from "../services/releaseService.ts";
import {
  getReconcileReportPath,
  rebuildMovementsMigration,
  reconcileStockBalances,
} from "../services/stockLedgerService.ts";

export function registerAdminRoutes(app: Express, ctx: ServerContext): void {
  // REST API: Diagnostics & Connectivity Verification
  app.get("/api/diagnostics", (_req: Request, res: Response) => {
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
      totalRecords: Object.values(ctx.state).reduce(
        (acc: number, curr: unknown) => acc + (Array.isArray(curr) ? curr.length : 0),
        0
      ),
      usersCount: ctx.state.registeredUsers.length,
      connectedTerminals: ctx.connectionRegistry.size,
      connectedOperators: getActiveOperatorsCount(ctx),
      corsActive: true,
      databaseReady: true,
      websocketReady: true,
      authoritativeSource: "CENTRAL_CLOUD_DATABASE",
    });
  });

  // REST API: Webhook / Direct publish from GitHub Actions
  app.post(["/api/build-info/publish", "/api/release/latest"], (req: Request, res: Response) => {
    try {
      const { version: newVersion, tag, repository, releaseUrl, buildId } =
        mapReleasePublishFromApi(req.body);
      if (!newVersion) {
        return res.status(400).json({ error: "Missing version or tag" });
      }

      ctx.cachedGitHubVersion = newVersion;
      ctx.lastGitHubFetchTimestamp = Date.now();
      if (repository) {
        const cleanRepoUpdate = normalizeGitHubRepo(repository);
        if (cleanRepoUpdate) {
          ctx.config.githubRepo = cleanRepoUpdate;
        }
      }

      const releaseRecord = {
        version: newVersion,
        tag: tag || `v${newVersion}`,
        repository: repository || ctx.config.githubRepo,
        releaseUrl,
        buildId,
        updatedAt: new Date().toISOString(),
      };

      try {
        fs.writeFileSync(ctx.releasePersistFile, JSON.stringify(releaseRecord, null, 2), "utf8");
      } catch (_err) {}

      logger.info(
        `[RELEASE SYNC] Received authoritative release update from GitHub Actions: version ${newVersion} (tag: ${tag || newVersion})`
      );
      return res.json({ success: true, activeVersion: newVersion, release: releaseRecord });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // REST API: Build Info for Live Application Updates
  app.get(["/api/build-info", "/build-info.json"], async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";
    const { fileContent, bundleVersion } = resolveServerBundleVersion();

    const latestGitHubVersion = await getLatestGitHubReleaseVersion(
      ctx,
      bundleVersion,
      forceRefresh
    );
    const activeVersion = maxSemverVersion(latestGitHubVersion, bundleVersion);

    if (fileContent) {
      return res.json({
        ...fileContent,
        version: activeVersion,
        bundleVersion,
        latestGitHubVersion,
        versionSource:
          ctx.cachedGitHubVersion && compareServerSemver(ctx.cachedGitHubVersion, bundleVersion) >= 0
            ? "github-releases-latest"
            : fileContent.versionSource || "package.json",
      });
    }

    return res.json({
      buildId: 0,
      version: activeVersion,
      bundleVersion,
      latestGitHubVersion,
      versionSource: ctx.cachedGitHubVersion ? "github-releases-latest" : "fallback",
      isDevelopmentFallback: true,
    });
  });

  // REST API: Direct Installer Download Redirect
  app.get("/api/download/latest-installer", async (_req: Request, res: Response) => {
    const { bundleVersion } = resolveServerBundleVersion();
    const targetVer = await getLatestGitHubReleaseVersion(ctx, bundleVersion);
    const cleanVer = targetVer || bundleVersion || "1.0.94";
    const cleanRepo = normalizeGitHubRepo(ctx.config.githubRepo);
    const assetName = `JUWEI.WMS.Desktop.System.Setup.${cleanVer}.exe`;
    const directDownloadUrl = `https://github.com/${cleanRepo}/releases/download/v${cleanVer}/${assetName}`;
    return res.redirect(302, directDownloadUrl);
  });

  // REST API: Health Check
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      serverInstanceId: ctx.serverInstanceId,
      serverBootTime: ctx.serverBootTime,
      uptime: process.uptime(),
      systemResetVersion: ctx.systemResetVersion,
      systemResetId: ctx.systemResetId,
      systemResetTimestamp: ctx.systemResetTimestamp,
      totalRecords: Object.values(ctx.state).reduce(
        (acc: number, curr: unknown) => acc + (Array.isArray(curr) ? curr.length : 0),
        0
      ),
      usersCount: ctx.state.registeredUsers.length,
      connectedClients: ctx.connectionRegistry.size,
      connectedTerminals: ctx.connectionRegistry.size,
      connectedOperators: getActiveOperatorsCount(ctx),
      liveActiveTerminals: ctx.connectionRegistry.size,
    });
  });

  // REST API: Devices & Heartbeats
  app.get("/api/devices", (_req: Request, res: Response) => {
    const now = Date.now();
    const threshold = 5 * 60 * 1000;
    const devices = Array.from(ctx.activeDevices.values()).map((dev) => ({
      ...dev,
      isOnline: now - dev.lastSeen < threshold,
    }));
    res.json({ success: true, count: devices.length, devices });
  });

  app.post("/api/devices/heartbeat", (req: Request, res: Response) => {
    try {
      const {
        deviceId,
        deviceName,
        employeeId,
        username,
        role,
        currentView,
        appVersion,
        platform,
      } = mapDeviceHeartbeatFromApi(req.body);
      if (!deviceId) return res.status(400).json({ error: "deviceId required" });

      const now = Date.now();
      const ip =
        (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";
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
        currentView: currentView || existing?.currentView || "dashboard",
      });

      return res.json({
        success: true,
        serverTime: now,
        systemResetVersion: ctx.systemResetVersion,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Authorized Devices Management
  app.get("/api/devices/authorized", (_req: Request, res: Response) => {
    res.json({
      success: true,
      installationId: ctx.installationId,
      primaryDeviceId: ctx.primaryDeviceId,
      devices: Array.from(ctx.authorizedDevicesMap.values()),
    });
  });

  app.post("/api/devices/authorize", (req: Request, res: Response) => {
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    const devAuth = mapDeviceAuthorizeFromApi(req.body);
    if (!devAuth.deviceId) return res.status(400).json({ error: "deviceId required" });

    if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
      return res
        .status(403)
        .json({ error: "PERMISSION_DENIED: Only Super Administrator can authorize devices." });
    }

    const cleanDeviceId = devAuth.deviceId;
    const cleanDeviceName = String(devAuth.deviceName || `Workstation (${cleanDeviceId})`).trim();
    const nowIso = new Date().toISOString();

    const existing = ctx.authorizedDevicesMap.get(cleanDeviceId);
    const reqEmpId = (
      devAuth.employeeId ||
      existing?.employeeId ||
      (cleanDeviceId === ctx.primaryDeviceId ? "JPMP-002" : "")
    )
      .trim()
      .toUpperCase();
    const boundAccount = reqEmpId
      ? ctx.state.registeredUsers.find(
          (u: RegisteredAccount) => (u.employeeId || "").toUpperCase().trim() === reqEmpId
        )
      : undefined;
    const finalStatus: "AUTHORIZED" | "PENDING" =
      devAuth.status === "PENDING" ? "PENDING" : "AUTHORIZED";
    const deviceRecord: AuthorizedDevice = {
      ...(existing || {}),
      deviceId: cleanDeviceId,
      deviceName: cleanDeviceName,
      isPrimaryAdminDevice: cleanDeviceId === ctx.primaryDeviceId,
      status: finalStatus,
      ...(boundAccount
        ? {
            employeeId: boundAccount.employeeId,
            username: boundAccount.username,
            role: boundAccount.role,
            permission: boundAccount.permission,
            boundAt: nowIso,
          }
        : {}),
      authorizedBy: devAuth.authorId || "ALDRIN BANAWA (JPMP-002)",
      authorizedAt: nowIso,
    };

    ctx.authorizedDevicesMap.set(cleanDeviceId, deviceRecord);
    commitDatabase(ctx);

    recordAuditTrail(ctx, {
      actor: devAuth.authorId || "SUPER ADMINISTRATOR",
      actorId: "JPMP-002",
      action: finalStatus === "PENDING" ? "DEVICE_PENDING" : "DEVICE_AUTHORIZED",
      recordType: "authorizedDevices",
      recordId: cleanDeviceId,
      summary: `${finalStatus === "PENDING" ? "Marked device pending" : "Authorized device"} ${cleanDeviceName} (${cleanDeviceId})`,
      deviceId: cleanDeviceId,
    });

    broadcast(ctx, {
      type: "DEVICE_AUTHORIZATION_UPDATED",
      device: deviceRecord,
      systemResetVersion: ctx.systemResetVersion,
    });

    return res.json({ success: true, device: deviceRecord });
  });

  app.post("/api/devices/revoke", (req: Request, res: Response) => {
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    const { deviceId } = mapRequestMetaFromApi(req);
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
      return res
        .status(403)
        .json({ error: "PERMISSION_DENIED: Only Super Administrator can revoke devices." });
    }

    const cleanDeviceId = String(deviceId).trim();
    if (cleanDeviceId === ctx.primaryDeviceId) {
      return res.status(400).json({
        error: "CANNOT_REVOKE_PRIMARY: The primary administrator device cannot be revoked.",
      });
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
          authorizedAt: new Date().toISOString(),
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
      deviceId: cleanDeviceId,
    });

    broadcast(ctx, {
      type: "DEVICE_REVOKED",
      deviceId: cleanDeviceId,
      systemResetVersion: ctx.systemResetVersion,
    });
    closeDeviceSockets(ctx, cleanDeviceId, "DEVICE_REVOKED");

    return res.json({ success: true, message: `Device ${cleanDeviceId} revoked` });
  });

  // REST API: Terminal Fresh Install & Primary Administrator Device Binding
  app.post("/api/terminal/fresh-install", (req: Request, res: Response) => {
    try {
      const { deviceId, deviceName } = mapDeviceHeartbeatFromApi(req.body);
      const targetDeviceId = deviceId || ctx.primaryDeviceId || "";

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
          authorizedAt: new Date().toISOString(),
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
          authorizedDevices: [targetDeviceId],
        };
      }

      commitDatabase(ctx);

      const sa = ctx.state.registeredUsers.find(
        (u: RegisteredAccount) => u.employeeId === "JPMP-002"
      );
      return res.json({
        success: true,
        installationId: ctx.installationId,
        primaryDeviceId: ctx.primaryDeviceId,
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
        superAdmin: sa ? mapAccountToApi(sa) : null,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GLOBAL RESET API
  app.post(["/api/reset-everything", "/api/reset-database"], async (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;

      if (!req.body?.confirmed) {
        return res.status(400).json({
          error: "CONFIRMATION_REQUIRED: Global reset requires explicit 'confirmed: true'.",
        });
      }

      if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
        return res.status(403).json({
          error:
            "PERMISSION_DENIED: Only the Super Administrator (JPMP-002) is authorized to execute a complete global database reset.",
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
          updated_at: ctx.systemResetTimestamp,
        }));
      }

      ctx.deletedRecordTombstones.clear();

      const resetMsg: ChatMessage = {
        id: `sys-reset-${Date.now()}`,
        sender: "SYSTEM SECURITY AUDIT",
        text: `GLOBAL DATABASE RESET executed by ${author}. System reset version advanced to v${ctx.systemResetVersion} (${ctx.systemResetId}).`,
        timestamp: ctx.systemResetTimestamp,
        isSystem: true,
      };
      ctx.chatMessages.push(resetMsg);

      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res
          .status(500)
          .json({ error: "CRITICAL: Failed to commit global reset to central disk database." });
      }

      recordAuditTrail(ctx, {
        timestamp: ctx.systemResetTimestamp,
        actor: author,
        actorId: "JPMP-002",
        action: "GLOBAL_RESET",
        recordType: "system",
        recordId: ctx.systemResetId,
        summary: `Global database reset to v${ctx.systemResetVersion} (${keepUsers ? "kept operator accounts" : "reset all accounts"})`,
        deviceId: extractDeviceIdFromHttp(req) || undefined,
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
          chatMessages: ctx.chatMessages,
        },
      });

      broadcast(ctx, {
        type: "global_reset",
        systemResetVersion: ctx.systemResetVersion,
        systemResetTimestamp: ctx.systemResetTimestamp,
        systemResetId: ctx.systemResetId,
        systemResetBy: ctx.systemResetBy,
        author,
        keepUsers,
      });

      return res.json({
        success: true,
        message: "GLOBAL DATABASE RESET EXECUTED SUCCESSFULLY",
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
        systemResetTimestamp: ctx.systemResetTimestamp,
        author,
        keepUsers,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Super Admin Audit Trail Query
  app.get("/api/admin/audit-logs", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
      return res.status(403).json({
        error: "PERMISSION_DENIED: Only Super Administrator is authorized to view the system audit trail.",
      });
    }

    const {
      dateFrom,
      dateTo,
      user: userFilter,
      recordType: recordTypeFilter,
      action: actionFilter,
      searchQuery,
      limitParam,
    } = mapAuditLogsQueryFromApi(req.query as Record<string, any>);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, MAX_AUDIT_TRAIL_ENTRIES)
        : 1000;

    const availableUsersSet = new Set<string>();
    const availableTypesSet = new Set<string>();
    const availableActionsSet = new Set<string>();

    for (const entry of ctx.auditTrailLogs) {
      if (entry.actor) availableUsersSet.add(entry.actor);
      if (entry.recordType) availableTypesSet.add(entry.recordType);
      if (entry.action) availableActionsSet.add(entry.action);
    }

    const filtered = ctx.auditTrailLogs.filter((entry) => {
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
          entry.deviceId || "",
        ]
          .join(" ")
          .toLowerCase();
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
      availableActions: Array.from(availableActionsSet).sort((a, b) => a.localeCompare(b)),
    });
  });

  // Super Admin Stock Ledger Reconciliation Report
  app.get("/api/admin/reconcile-report", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
      return res.status(403).json({
        error: "PERMISSION_DENIED: Only Super Administrator is authorized to view reconciliation reports.",
      });
    }

    try {
      const reportPath = getReconcileReportPath();
      if (!fs.existsSync(reportPath)) {
        const report = reconcileStockBalances(ctx);
        return res.json({ success: true, report });
      }
      const raw = fs.readFileSync(reportPath, "utf-8");
      const report = JSON.parse(raw);
      return res.json({ success: true, report });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to read reconcile report" });
    }
  });

  // Super Admin Trigger On-Demand Stock Ledger Reconciliation
  app.post("/api/admin/reconcile", (req: Request, res: Response) => {
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
      return res.status(403).json({
        error: "PERMISSION_DENIED: Only Super Administrator is authorized to run stock reconciliation.",
      });
    }

    try {
      const report = reconcileStockBalances(ctx);
      return res.json({ success: true, report });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to execute stock reconciliation" });
    }
  });

  // Super Admin Rebuild Stock Movements Migration (Idempotent)
  app.post("/api/admin/migrate-movements", (req: Request, res: Response) => {
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
      return res.status(403).json({
        error: "PERMISSION_DENIED: Only Super Administrator is authorized to run movement migration.",
      });
    }

    try {
      const result = rebuildMovementsMigration(ctx);
      if (result.createdMovements > 0 || result.repairedBalances > 0) {
        broadcast(ctx, {
          type: "collection_updated",
          collection: "stocks",
          data: ctx.state.stocks,
          systemResetVersion: ctx.systemResetVersion,
        });
        broadcast(ctx, {
          type: "collection_updated",
          collection: "stockMovements",
          data: ctx.state.stockMovements,
          systemResetVersion: ctx.systemResetVersion,
        });
      }
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to rebuild stock movements" });
    }
  });
}
