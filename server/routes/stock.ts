/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stock Movements & FIFO Color Coding Routes
 */

import type { Express, Request, Response } from "express";
import type { ServerContext } from "../services/context.ts";
import { DEFAULT_FIFO_COLORS_BY_MONTH } from "../services/context.ts";
import { recordAuditTrail } from "../services/auditService.ts";
import { rejectIfDeviceRevokedHttp, resolveRequestAuthContext } from "../services/authService.ts";
import { commitDatabase } from "../services/backupService.ts";
import { broadcast } from "../services/realtimeService.ts";
import { executeStockMovement } from "../services/recordService.ts";

export function registerStockRoutes(app: Express, ctx: ServerContext): void {
  // REST API: FIFO Color Coding Calendar
  app.get("/api/fifo-colors", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.json({
      success: true,
      fifoColorsByMonth: ctx.state.fifoColorsByMonth || DEFAULT_FIFO_COLORS_BY_MONTH,
    });
  });

  app.post("/api/fifo-colors", async (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const { action, month, color, fifoColorsByMonth } = req.body;
      const auth = resolveRequestAuthContext(ctx, req);
      const isSuperAdmin = auth.employeeId === "JPMP-002" || auth.permission === "FULL_ACCESS";

      if (!isSuperAdmin) {
        return res.status(403).json({
          error: "PERMISSION DENIED: Only Super Administrator (JPMP-002) can edit the FIFO color calendar.",
        });
      }

      let modified = false;

      if (fifoColorsByMonth && typeof fifoColorsByMonth === "object") {
        ctx.state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...fifoColorsByMonth };
        modified = true;
      } else if (action === "reset") {
        ctx.state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH };
        modified = true;
      } else if (month && color) {
        const m = Number(month);
        if (m >= 1 && m <= 12 && color.name) {
          ctx.state.fifoColorsByMonth[m] = {
            name: String(color.name).trim(),
            colorClass: color.colorClass || "bg-indigo-600",
            textClass: color.textClass || "text-indigo-600",
            hex: color.hex || undefined,
          };
          modified = true;
        }
      }

      if (modified) {
        ctx.stateRevision++;
        commitDatabase(ctx);

        recordAuditTrail(ctx, {
          actor: auth.account?.username || req.body?.author || "Super Administrator",
          actorId: auth.employeeId || "JPMP-002",
          action: "UPDATE",
          recordType: "fifoColorsByMonth",
          recordId: month ? `month-${month}` : "fifoColorsByMonth",
          summary:
            month && color?.name
              ? `Updated FIFO color for month ${month} to ${color.name}`
              : `Updated FIFO color calendar (${action || "batch"})`,
          deviceId: auth.deviceId || undefined,
        });

        broadcast(ctx, {
          type: "fifo_colors_updated",
          fifoColorsByMonth: ctx.state.fifoColorsByMonth,
          systemResetVersion: ctx.systemResetVersion,
        });

        broadcast(ctx, {
          type: "collection_updated",
          collection: "fifoColorsByMonth",
          data: ctx.state.fifoColorsByMonth,
          systemResetVersion: ctx.systemResetVersion,
        });
      }

      return res.json({
        success: true,
        fifoColorsByMonth: ctx.state.fifoColorsByMonth,
        systemResetVersion: ctx.systemResetVersion,
      });
    } catch (err: any) {
      console.error("Error updating FIFO colors:", err);
      return res.status(500).json({ error: err.message || "Failed to update FIFO color calendar" });
    }
  });

  // REST API: FIFO Tag Color Repair Report & Audit Logs
  app.get("/api/system/fifo-repair-report", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.json({
      success: true,
      report: ctx.initialFifoRepairReport,
      totalAuditEntries: ctx.fifoRepairAuditLogs.length,
      auditLogs: ctx.fifoRepairAuditLogs,
    });
  });

  // REST API: Atomic Stock Movements
  app.post("/api/stock-movements", async (req: Request, res: Response) => {
    try {
      const reqDevId = String(
        req.body.deviceId || req.body.device_id || req.headers["x-device-id"] || ""
      ).trim();
      const auth = resolveRequestAuthContext(ctx, req, reqDevId);
      const clientResetVersion = Number(req.body.reset_version || req.headers["x-reset-version"]);
      const result = executeStockMovement(ctx, {
        reqDevId,
        actorName: auth.account?.username,
        actorEmployeeId: auth.employeeId,
        clientResetVersion,
        userPermission: auth.permission,
        body: req.body || {},
      });
      return res.status(result.status).json(result.payload);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/stock-movements", (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json((ctx.state.stockMovements || []).slice(0, limit));
  });
}
