/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Master Data & Operational Role Configuration Routes
 */

import type { Express, Request, Response } from "express";
import type { RegisteredAccount } from "../../shared/types.ts";
import { mapRoleActionFromApi } from "../api/mapper.ts";
import type { ServerContext } from "../services/context.ts";
import { DEFAULT_OPERATIONAL_ROLES } from "../services/context.ts";
import { recordAuditTrail } from "../services/auditService.ts";
import { rejectIfDeviceRevokedHttp, resolveRequestAuthContext } from "../services/authService.ts";
import { commitDatabase } from "../services/backupService.ts";
import { broadcast } from "../services/realtimeService.ts";

export function registerMasterDataRoutes(app: Express, ctx: ServerContext): void {
  // REST API: Get Operational Roles
  app.get("/api/roles", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      success: true,
      roles: ctx.state.operationalRoles || DEFAULT_OPERATIONAL_ROLES,
    });
  });

  // REST API: Manage / Update Operational Roles
  app.post("/api/roles", async (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res
          .status(403)
          .json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }
      const { action, role, oldRole, newRole, roles, updateExistingAccounts } =
        mapRoleActionFromApi(req.body);
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
                  updated_at: new Date().toISOString(),
                };
              }
              return u;
            });
          }
        }
      } else if (action === "delete" && role) {
        const clean = String(role).trim().toUpperCase();
        if (clean) {
          ctx.state.operationalRoles = ctx.state.operationalRoles.filter(
            (r: string) => r !== clean
          );
          modified = true;
        }
      } else if (Array.isArray(roles)) {
        const cleaned = Array.from(
          new Set<string>(roles.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean))
        );
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
          deviceId: auth.deviceId || undefined,
        });

        broadcast(ctx, {
          type: "roles_updated",
          roles: ctx.state.operationalRoles,
          systemResetVersion: ctx.systemResetVersion,
        });

        broadcast(ctx, {
          type: "collection_updated",
          collection: "operationalRoles",
          data: ctx.state.operationalRoles,
          systemResetVersion: ctx.systemResetVersion,
        });

        if (usersModified) {
          broadcast(ctx, {
            type: "collection_updated",
            collection: "registeredUsers",
            data: ctx.state.registeredUsers,
            systemResetVersion: ctx.systemResetVersion,
          });
        }
      }

      return res.json({
        success: true,
        roles: ctx.state.operationalRoles,
        accountsUpdated: usersModified,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });
}
