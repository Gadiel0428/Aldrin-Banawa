/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Database Snapshot Backups & Restore Routes
 */

import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import type { ServerContext } from "../services/context.ts";
import { mapRequestMetaFromApi } from "../api/mapper.ts";
import { recordAuditTrail } from "../services/auditService.ts";
import { isAuthorizedSuperAdmin, rejectIfDeviceRevokedHttp } from "../services/authService.ts";
import {
  commitDatabase,
  createDatabaseBackup,
  getAllBackupRecords,
  restoreDatabaseFromBackup,
} from "../services/backupService.ts";

export function registerBackupsRoutes(app: Express, ctx: ServerContext): void {
  // BACKUPS MANAGEMENT REST API
  app.get("/api/admin/backups", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      if (!fs.existsSync(ctx.config.backupsDir)) {
        fs.mkdirSync(ctx.config.backupsDir, { recursive: true });
      }

      const backups = getAllBackupRecords(ctx);

      return res.json({
        success: true,
        backupsDir: ctx.config.backupsDir,
        intervalHours: 1,
        retentionPolicy: "PERMANENT_NO_DELETION",
        maxRetained: null,
        backups,
        auditLogs: ctx.backupAuditLogs.slice(0, 50),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to list backups" });
    }
  });

  app.post("/api/admin/backups/create", async (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
        return res.status(403).json({
          error:
            "PERMISSION_DENIED: Only Super Administrator (JPMP-002) is authorized to trigger manual backups.",
        });
      }
      const meta = mapRequestMetaFromApi(req);
      const author = meta.author || "SUPER_ADMIN";
      const result = await createDatabaseBackup(ctx, "MANUAL_ON_DEMAND", author);
      if (result.success) {
        recordAuditTrail(ctx, {
          actor: author,
          actorId: meta.employeeId || "JPMP-002",
          action: "BACKUP_CREATED",
          recordType: "system",
          recordId: result.filename || "backup",
          summary: `Created manual database backup '${result.filename}'`,
        });
        return res.json({
          success: true,
          filename: result.filename,
          message: `Backup '${result.filename}' created successfully.`,
        });
      } else {
        return res.status(500).json({ error: result.error || "Failed to create database backup" });
      }
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  });

  app.post("/api/admin/backups/restore", (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
        return res.status(403).json({
          error:
            "PERMISSION_DENIED: Only Super Administrator (JPMP-002) is authorized to restore database snapshots.",
        });
      }

      if (!req.body?.confirmed) {
        return res.status(400).json({
          error: "CONFIRMATION_REQUIRED: Database restore requires explicit 'confirmed: true'.",
        });
      }

      const filename = String(req.body?.filename || "").trim();
      if (!filename) {
        return res.status(400).json({ error: "MISSING_FILENAME: Backup filename is required." });
      }

      const meta = mapRequestMetaFromApi(req);
      const author = meta.author || "SUPER_ADMIN";
      const result = restoreDatabaseFromBackup(ctx, filename, author);

      if (result.success) {
        recordAuditTrail(ctx, {
          actor: author,
          actorId: meta.employeeId || "JPMP-002",
          action: "DATABASE_RESTORED",
          recordType: "system",
          recordId: filename,
          summary: `Restored live database from snapshot '${filename}'`,
        });
        return res.json({
          success: true,
          message: `Live database successfully restored from '${filename}'. All connected workstations updated.`,
          recordCounts: result.recordCounts,
        });
      } else {
        return res.status(500).json({ error: result.error || "Failed to restore database backup" });
      }
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  });

  app.get("/api/admin/backups/download/:filename", (req: Request, res: Response) => {
    try {
      const filename = path.basename(req.params.filename);
      const resolvedBackupsDir = path.resolve(ctx.config.backupsDir);
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
}
