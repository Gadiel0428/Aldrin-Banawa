/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Receiving, Returns, Recycling & Category Management Routes
 */

import type { Express, Request, Response } from "express";
import type { ServerContext } from "../services/context.ts";
import { DEFAULT_RECEIVING_CATEGORIES } from "../services/context.ts";
import { recordAuditTrail } from "../services/auditService.ts";
import { rejectIfDeviceRevokedHttp, resolveRequestAuthContext } from "../services/authService.ts";
import { commitDatabase } from "../services/backupService.ts";
import { broadcast } from "../services/realtimeService.ts";

export function registerReceivingRoutes(app: Express, ctx: ServerContext): void {
  // REST API: Get Receiving Categories
  app.get("/api/categories", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      success: true,
      categories: ctx.state.receivingCategories || DEFAULT_RECEIVING_CATEGORIES,
    });
  });

  // REST API: Manage / Update Receiving Categories
  app.post("/api/categories", async (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res
          .status(403)
          .json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }
      const {
        action,
        category,
        oldCategory,
        newCategory,
        oldCat,
        newCat,
        categories,
        updateExistingRecords,
      } = req.body;
      let modified = false;
      let recModified = false;
      let retModified = false;
      let stocksModified = false;

      if (action === "add" && category) {
        const clean = String(category).trim().toUpperCase();
        if (clean && !ctx.state.receivingCategories.includes(clean)) {
          ctx.state.receivingCategories.push(clean);
          modified = true;
        }
      } else if (action === "rename") {
        const cleanOld = String(oldCategory || oldCat || "").trim().toUpperCase();
        const cleanNew = String(newCategory || newCat || "").trim().toUpperCase();
        if (cleanOld && cleanNew && cleanOld !== cleanNew) {
          const idx = ctx.state.receivingCategories.indexOf(cleanOld);
          if (idx !== -1) {
            ctx.state.receivingCategories[idx] = cleanNew;
            modified = true;
          } else if (!ctx.state.receivingCategories.includes(cleanNew)) {
            ctx.state.receivingCategories.push(cleanNew);
            modified = true;
          }

          if (updateExistingRecords !== false) {
            ctx.state.receiving = ctx.state.receiving.map((r: any) => {
              let ch = false;
              const up = { ...r };
              if ((r.supplierOrDept || "").trim().toUpperCase() === cleanOld) {
                up.supplierOrDept = cleanNew;
                ch = true;
              }
              if ((r.category || "").trim().toUpperCase() === cleanOld) {
                up.category = cleanNew;
                ch = true;
              }
              if (ch) {
                recModified = true;
                return { ...up, version: (r.version || 1) + 1, updated_at: new Date().toISOString() };
              }
              return r;
            });

            ctx.state.returns = ctx.state.returns.map((ret: any) => {
              if ((ret.category || "").trim().toUpperCase() === cleanOld) {
                retModified = true;
                return {
                  ...ret,
                  category: cleanNew,
                  version: (ret.version || 1) + 1,
                  updated_at: new Date().toISOString(),
                };
              }
              return ret;
            });

            ctx.state.stocks = ctx.state.stocks.map((s: any) => {
              if ((s.category || "").trim().toUpperCase() === cleanOld) {
                stocksModified = true;
                return {
                  ...s,
                  category: cleanNew,
                  version: (s.version || 1) + 1,
                  updated_at: new Date().toISOString(),
                };
              }
              return s;
            });
          }
        }
      } else if (action === "delete" && category) {
        const clean = String(category).trim().toUpperCase();
        if (clean) {
          const recCount = ctx.state.receiving.filter(
            (r: any) =>
              (r.supplierOrDept || "").trim().toUpperCase() === clean ||
              (r.category || "").trim().toUpperCase() === clean
          ).length;
          const retCount = ctx.state.returns.filter(
            (ret: any) => (ret.category || "").trim().toUpperCase() === clean
          ).length;
          const stockCount = ctx.state.stocks.filter(
            (s: any) => (s.category || "").trim().toUpperCase() === clean
          ).length;
          const inUseCount = recCount + retCount + stockCount;

          if (inUseCount > 0) {
            return res.status(400).json({
              success: false,
              error: `Cannot delete category "${clean}" because it is currently assigned to ${inUseCount} active record(s) (${recCount} receiving, ${retCount} returns). You must reassign or remove these records first.`,
              inUseCount,
              recCount,
              retCount,
              stockCount,
            });
          }

          ctx.state.receivingCategories = ctx.state.receivingCategories.filter(
            (c: string) => c !== clean
          );
          modified = true;
        }
      } else if (action === "reset") {
        ctx.state.receivingCategories = [...DEFAULT_RECEIVING_CATEGORIES];
        modified = true;
      } else if (Array.isArray(categories)) {
        const cleaned = Array.from(
          new Set<string>(
            categories.map((c: any) => String(c || "").trim().toUpperCase()).filter(Boolean)
          )
        );
        if (cleaned.length > 0) {
          ctx.state.receivingCategories = cleaned;
          modified = true;
        }
      }

      if (modified || recModified || retModified || stocksModified) {
        ctx.stateRevision++;
        commitDatabase(ctx);

        recordAuditTrail(ctx, {
          actor: auth.account?.username || req.body?.author || "Admin",
          actorId: auth.employeeId || "ADMIN",
          action: "UPDATE",
          recordType: "receivingCategories",
          recordId: "receivingCategories",
          summary: `Updated receiving categories (${action || "replace"}${category ? `: ${category}` : oldCategory || oldCat ? `: ${oldCategory || oldCat} -> ${newCategory || newCat}` : ""})`,
          deviceId: auth.deviceId || undefined,
        });

        broadcast(ctx, {
          type: "categories_updated",
          categories: ctx.state.receivingCategories,
          systemResetVersion: ctx.systemResetVersion,
        });

        broadcast(ctx, {
          type: "collection_updated",
          collection: "receivingCategories",
          data: ctx.state.receivingCategories,
          systemResetVersion: ctx.systemResetVersion,
        });

        if (recModified) {
          broadcast(ctx, {
            type: "collection_updated",
            collection: "receiving",
            data: ctx.state.receiving,
            systemResetVersion: ctx.systemResetVersion,
          });
        }
        if (retModified) {
          broadcast(ctx, {
            type: "collection_updated",
            collection: "returns",
            data: ctx.state.returns,
            systemResetVersion: ctx.systemResetVersion,
          });
        }
        if (stocksModified) {
          broadcast(ctx, {
            type: "collection_updated",
            collection: "stocks",
            data: ctx.state.stocks,
            systemResetVersion: ctx.systemResetVersion,
          });
        }
      }

      return res.json({
        success: true,
        categories: ctx.state.receivingCategories,
        recordsUpdated: recModified || retModified || stocksModified,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });
}
