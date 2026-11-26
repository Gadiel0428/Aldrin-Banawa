/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * State Synchronization, Batch Mutations, Presence & Chat Routes
 */

import type { Express, Request, Response } from "express";
import logger from "../../src/lib/logger.ts";
import {
  mapBatchMutationFromApi,
  mapBatchMutationResultToApi,
  mapChatMessageFromApi,
  mapDeleteRecordInputFromApi,
  mapRecordFromApi,
  mapRecordToApi,
  mapRequestMetaFromApi,
  mapSyncCollectionInputFromApi,
} from "../api/mapper.ts";
import type { ServerContext } from "../services/context.ts";
import { DEFAULT_FIFO_COLORS_BY_MONTH } from "../services/context.ts";
import { recordAuditTrail } from "../services/auditService.ts";
import {
  isDeviceRevoked,
  rejectIfDeviceRevokedHttp,
  resolveRequestAuthContext,
} from "../services/authService.ts";
import { commitDatabase } from "../services/backupService.ts";
import {
  broadcast,
  closeDeviceSockets,
  filterDataForClient,
  getActiveOperatorsCount,
  getActivePresenceList,
  getActiveUsersList,
} from "../services/realtimeService.ts";
import { executeRecordDelete, executeRecordUpsert } from "../services/recordService.ts";
import {
  backfillAndFlagUnits,
  computeDerivedBalanceForStock,
  deriveAllStockBalances,
  ensureMovementsForBusinessRecord,
  resolveAndApplyRecordUnit,
  roundStockQuantity,
} from "../services/stockLedgerService.ts";
import {
  validateDeliveryRecord,
  validateIssuanceRecord,
  validateReceivingRecord,
  validateStockRecord,
  type ValidationResult,
} from "../../shared/validation.ts";

export function registerSyncRoutes(app: Express, ctx: ServerContext): void {
  // REST API: Live Connection & Active Terminals Registry
  app.get("/api/presence", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      status: "ok",
      connectedOperators: getActiveOperatorsCount(ctx),
      liveActiveTerminals: ctx.connectionRegistry.size,
      systemResetVersion: ctx.systemResetVersion,
      presence: getActivePresenceList(ctx),
      activeUsers: getActiveUsersList(ctx),
    });
  });

  // REST API: Synchronize All Workstations
  app.post(
    ["/api/sync/all-workstations", "/api/sync-all-workstations"],
    (req: Request, res: Response) => {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const author = req.body?.author || "SUPER ADMINISTRATOR";
      broadcast(ctx, {
        type: "SYNC_REQUIRED",
        author,
        reason: "CLUSTER_SYNC_REQUESTED",
        systemResetVersion: ctx.systemResetVersion,
        timestamp: new Date().toISOString(),
      });
      broadcast(ctx, {
        type: "force_sync",
        triggeredBy: author,
      });
      return res.json({
        success: true,
        message: "SYNC_REQUIRED broadcast sent to all workstations and devices",
        connectedTerminals: ctx.connectionRegistry.size,
        connectedOperators: getActiveOperatorsCount(ctx),
        systemResetVersion: ctx.systemResetVersion,
      });
    }
  );

  // REST API: Full State Snapshot
  app.get("/api/sync", (req: Request, res: Response) => {
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
      data: filterDataForClient(
        {
          ...ctx.state,
          chatMessages: ctx.chatMessages,
        },
        auth.permission,
        auth.employeeId
      ),
      connectedOperators: getActiveOperatorsCount(ctx),
      liveActiveTerminals: ctx.connectionRegistry.size,
    });
  });

  // REST API: Sync collection
  app.post("/api/sync", async (req: Request, res: Response) => {
    try {
      const { collection, data } = req.body;
      const meta = mapRequestMetaFromApi(req);
      const reqDevId = meta.deviceId;
      if (isDeviceRevoked(ctx, reqDevId)) {
        closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
        return res.status(403).json({ error: "DEVICE_REVOKED" });
      }

      const clientResetVersion = meta.resetVersion || ctx.systemResetVersion;
      if (clientResetVersion < ctx.systemResetVersion) {
        return res.status(409).json({
          error: "STALE_RESET_VERSION: Central database was reset. Stale sync rejected.",
          systemResetVersion: ctx.systemResetVersion,
          systemResetId: ctx.systemResetId,
        });
      }

      if (!collection || !(collection in ctx.state)) {
        return res.status(400).json({ error: `Unknown or invalid collection: ${collection}` });
      }

      const auth = resolveRequestAuthContext(ctx, req, reqDevId);
      if (auth.permission === "VIEW_ONLY") {
        return res
          .status(403)
          .json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }

      if (collection === "operationalRoles") {
        if (Array.isArray(data)) {
          const cleaned = Array.from(
            new Set<string>(data.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean))
          );
          if (cleaned.length > 0) {
            ctx.state.operationalRoles = cleaned;
            ctx.stateRevision++;
            commitDatabase(ctx);
            recordAuditTrail(ctx, {
              actor: auth.account?.username || meta.author || "Admin",
              actorId: auth.employeeId || meta.employeeId || "ADMIN",
              action: "UPDATE",
              recordType: "operationalRoles",
              recordId: "operationalRoles",
              summary: `Updated operational roles (${cleaned.length} roles)`,
              deviceId: reqDevId,
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
          }
        }
        return res.json({
          success: true,
          count: ctx.state.operationalRoles.length,
          systemResetVersion: ctx.systemResetVersion,
        });
      }

      if (collection === "receivingCategories") {
        if (Array.isArray(data)) {
          const cleaned = Array.from(
            new Set<string>(data.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean))
          );
          if (cleaned.length > 0) {
            ctx.state.receivingCategories = cleaned;
            ctx.stateRevision++;
            commitDatabase(ctx);
            recordAuditTrail(ctx, {
              actor: auth.account?.username || meta.author || "Admin",
              actorId: auth.employeeId || meta.employeeId || "ADMIN",
              action: "UPDATE",
              recordType: "receivingCategories",
              recordId: "receivingCategories",
              summary: `Updated receiving categories (${cleaned.length} categories)`,
              deviceId: reqDevId,
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
          }
        }
        return res.json({
          success: true,
          count: ctx.state.receivingCategories.length,
          systemResetVersion: ctx.systemResetVersion,
        });
      }

      if (collection === "fifoColorsByMonth") {
        if (data && typeof data === "object") {
          ctx.state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...data };
          ctx.stateRevision++;
          commitDatabase(ctx);
          recordAuditTrail(ctx, {
            actor: auth.account?.username || meta.author || "Admin",
            actorId: auth.employeeId || meta.employeeId || "ADMIN",
            action: "UPDATE",
            recordType: "fifoColorsByMonth",
            recordId: "fifoColorsByMonth",
            summary: "Updated monthly FIFO color calendar",
            deviceId: reqDevId,
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
          count: Object.keys(ctx.state.fifoColorsByMonth).length,
          systemResetVersion: ctx.systemResetVersion,
        });
      }

      const mappedInputItems = mapSyncCollectionInputFromApi(collection, data);
      const items: any[] = Array.isArray(mappedInputItems) ? mappedInputItems : [];
      const currentList: any[] = (ctx.state as any)[collection] || [];
      const listMap = new Map<string, any>(
        currentList.map((it: any) => [String(it.id || it.record_id), it])
      );

      const existingMovementKeys =
        collection === "stockMovements"
          ? new Set<string>(
              currentList
                .map((m: any) => String(m?.idempotency_key || "").trim())
                .filter(Boolean)
            )
          : null;

      let modifiedCount = 0;
      const serverTime = new Date().toISOString();
      const effectiveAuthor = meta.author || meta.employeeId || "Operator";
      const effectiveDevId = reqDevId || "DEV-CENTRAL";
      const effectiveUserId =
        meta.userId || (meta.employeeId ? `USR-${meta.employeeId}` : `USR-${effectiveAuthor}`);

      for (const item of items) {
        if (!item) continue;
        const recId = String(
          item.id || `REC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
        );
        if (ctx.deletedRecordTombstones.has(recId)) continue;

        if (collection === "stockMovements" && existingMovementKeys) {
          const iKey = String(item.idempotency_key || "").trim();
          if (iKey && existingMovementKeys.has(iKey)) {
            continue;
          }
          if (iKey) existingMovementKeys.add(iKey);
        }

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
            reset_version: ctx.systemResetVersion,
          };

          if (collection === "stocks") {
            const savedQty = roundStockQuantity(Number(updatedRec.quantity) || 0);
            updatedRec.quantity = savedQty;
            ensureMovementsForBusinessRecord(ctx, "stocks", updatedRec, false, existing);
            updatedRec.quantity = savedQty;
          }

          if (collection === "registeredUsers") {
            if (existing.pinHash) updatedRec.pinHash = existing.pinHash;
            if (existing.pinSalt) updatedRec.pinSalt = existing.pinSalt;
            if (existing.pin) updatedRec.pin = existing.pin;
            if (existing.pin_hash) updatedRec.pin_hash = existing.pin_hash;
            if (existing.mustChangePin !== undefined)
              updatedRec.mustChangePin = existing.mustChangePin;
            if (existing.isPinCompromised !== undefined)
              updatedRec.isPinCompromised = existing.isPinCompromised;
            if (existing.pinChangedAt) updatedRec.pinChangedAt = existing.pinChangedAt;
            if (existing.pinChangedBy) updatedRec.pinChangedBy = existing.pinChangedBy;
          }

          const tempReceivingList = collection === "receiving" ? Array.from(listMap.values()) : undefined;
          const tempDeliveriesList = collection === "deliveries" ? Array.from(listMap.values()) : undefined;
          let valRes: ValidationResult | null = null;
          if (collection === "receiving") {
            valRes = validateReceivingRecord(updatedRec, tempReceivingList || []);
          } else if (collection === "issuances") {
            valRes = validateIssuanceRecord(updatedRec);
          } else if (collection === "deliveries") {
            valRes = validateDeliveryRecord(updatedRec, tempDeliveriesList || []);
          } else if (collection === "stocks") {
            valRes = validateStockRecord(updatedRec);
          }
          if (valRes && !valRes.valid) {
            return res.status(400).json({
              error: valRes.message,
              fieldErrors: valRes.fieldErrors,
              errors: valRes.fieldErrors,
              recordId: recId,
            });
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
            reset_version: ctx.systemResetVersion,
          };
          if (collection === "stocks") {
            const savedQty = roundStockQuantity(Number(newRec.quantity) || 0);
            newRec.quantity = savedQty;
            ensureMovementsForBusinessRecord(ctx, "stocks", newRec, true);
            newRec.quantity = savedQty;
          }

          const tempReceivingList = collection === "receiving" ? Array.from(listMap.values()) : undefined;
          const tempDeliveriesList = collection === "deliveries" ? Array.from(listMap.values()) : undefined;
          let valRes: ValidationResult | null = null;
          if (collection === "receiving") {
            valRes = validateReceivingRecord(newRec, tempReceivingList || []);
          } else if (collection === "issuances") {
            valRes = validateIssuanceRecord(newRec);
          } else if (collection === "deliveries") {
            valRes = validateDeliveryRecord(newRec, tempDeliveriesList || []);
          } else if (collection === "stocks") {
            valRes = validateStockRecord(newRec);
          }
          if (valRes && !valRes.valid) {
            return res.status(400).json({
              error: valRes.message,
              fieldErrors: valRes.fieldErrors,
              errors: valRes.fieldErrors,
              recordId: recId,
            });
          }

          listMap.set(recId, newRec);
          modifiedCount++;
        }
      }

      if (modifiedCount > 0) {
        (ctx.state as any)[collection] = Array.from(listMap.values());
        if (collection === "registries") {
          backfillAndFlagUnits(ctx);
        } else {
          for (const rec of (ctx.state as any)[collection] || []) {
            resolveAndApplyRecordUnit(ctx, collection, rec);
          }
        }
        if (collection === "stockMovements") {
          deriveAllStockBalances(ctx);
        }
        ctx.stateRevision++;
        commitDatabase(ctx);

        recordAuditTrail(ctx, {
          timestamp: serverTime,
          actor: auth.account?.username || effectiveAuthor,
          actorId: auth.employeeId || meta.employeeId || effectiveUserId,
          action: "SYNC",
          recordType: collection,
          recordId: `${modifiedCount} records`,
          summary: `Synced ${collection} (${modifiedCount} item(s) modified)`,
          deviceId: effectiveDevId,
        });

        logger.debug(
          `[CENTRAL-DB] [REST-POST-SYNC] Collection: ${collection} | Items received: ${items.length} | Modified: ${modifiedCount} | User: ${effectiveUserId} | Device: ${effectiveDevId}`
        );

        broadcast(ctx, {
          type: "collection_updated",
          collection,
          data: (ctx.state as any)[collection],
          systemResetVersion: ctx.systemResetVersion,
        });
      }

      return res.json({
        success: true,
        collection,
        count: (ctx.state as any)[collection]?.length || 0,
        modified: modifiedCount,
        systemResetVersion: ctx.systemResetVersion,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Batch Mutations
  app.post("/api/sync/batch", async (req: Request, res: Response) => {
    try {
      const { mutations } = req.body;
      const meta = mapRequestMetaFromApi(req);
      const reqDevId = meta.deviceId;
      if (isDeviceRevoked(ctx, reqDevId)) {
        closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
        return res.status(403).json({ error: "DEVICE_REVOKED" });
      }

      const clientResetVersion = meta.resetVersion || ctx.systemResetVersion;

      if (clientResetVersion < ctx.systemResetVersion) {
        return res.status(409).json({
          error:
            "STALE_RESET_VERSION: Central database was reset. Stale offline queue rejected.",
          systemResetVersion: ctx.systemResetVersion,
          systemResetId: ctx.systemResetId,
        });
      }

      const mutList = Array.isArray(mutations) ? mutations : [];
      let processed = 0;
      const results: any[] = [];
      const effectiveDevId = reqDevId || "DEV-OFFLINE";
      const effectiveAuthor = meta.author || meta.employeeId || "Operator";
      const effectiveUserId =
        meta.userId || (meta.employeeId ? `USR-${meta.employeeId}` : `USR-${effectiveAuthor}`);
      const auth = resolveRequestAuthContext(ctx, req, reqDevId);
      const userPermission = auth.permission;

      for (const rawMutation of mutList) {
        const mut = mapBatchMutationFromApi(rawMutation, {
          author: effectiveAuthor,
          employeeId: meta.employeeId || undefined,
          user_id: effectiveUserId,
          device_id: effectiveDevId,
          reset_version: clientResetVersion,
        });
        if (isDeviceRevoked(ctx, mut.device_id)) {
          closeDeviceSockets(ctx, mut.device_id, "DEVICE_REVOKED");
          return res.status(403).json({ error: "DEVICE_REVOKED" });
        }

        if (mut.type === "upsert" && mut.collection && mut.record) {
          const r = executeRecordUpsert(ctx, {
            collection: mut.collection,
            record: mut.record,
            author: mut.author,
            employeeId: mut.employeeId,
            user_id: mut.user_id,
            device_id: mut.device_id,
            actionDesc: mut.actionDesc,
            expectedVersion: mut.expectedVersion,
            reset_version: mut.reset_version,
            userPermission,
          });
          if (r.success) processed++;
          results.push(
            mapBatchMutationResultToApi({
              mutationId: mut.mutationId,
              type: mut.type,
              collection: mut.collection,
              recordId: mut.targetRecordId,
              success: r.success,
              status: r.status,
              error: r.error,
              fieldErrors: r.fieldErrors,
              confirmedRecord: r.confirmedRecord,
              currentRecord: r.currentRecord,
            })
          );
        } else if (mut.type === "delete" && mut.collection && mut.targetRecordId) {
          const r = executeRecordDelete(ctx, {
            collection: mut.collection,
            id: mut.targetRecordId,
            author: mut.author,
            employeeId: mut.employeeId,
            user_id: mut.user_id,
            device_id: mut.device_id,
            actionDesc: mut.actionDesc,
            expectedVersion: mut.expectedVersion,
            reset_version: mut.reset_version,
            userPermission,
          });
          if (r.success) processed++;
          results.push(
            mapBatchMutationResultToApi({
              mutationId: mut.mutationId,
              type: mut.type,
              collection: mut.collection,
              recordId: mut.targetRecordId,
              success: r.success,
              status: r.status,
              error: r.error,
              confirmedRecord: r.confirmedRecord,
              currentRecord: r.currentRecord,
            })
          );
        }
      }

      logger.debug(
        `[CENTRAL-DB] [REST-BATCH-MUTATIONS] Processed ${processed}/${mutList.length} offline mutations from device ${effectiveDevId} | User: ${effectiveUserId}`
      );

      return res.json({
        success: true,
        processed,
        total: mutList.length,
        results,
        systemResetVersion: ctx.systemResetVersion,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: State Summary & Revision
  app.get(["/api/sync/state-summary", "/api/sync/digest"], (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const summary: Record<string, { count: number; lastUpdated?: string }> = {};

    Object.keys(ctx.state).forEach((key: string) => {
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
      timestamp: new Date().toISOString(),
    });
  });

  // REST API: Upsert Record
  app.post("/api/records/upsert", async (req: Request, res: Response) => {
    try {
      const { collection, record: rawRecord } = req.body;
      const meta = mapRequestMetaFromApi(req);
      const reqDevId = meta.deviceId;
      if (isDeviceRevoked(ctx, reqDevId)) {
        closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
        return res.status(403).json({ error: "DEVICE_REVOKED" });
      }

      const auth = resolveRequestAuthContext(ctx, req, reqDevId);
      const userPermission = auth.permission;
      const clientResetVersion = meta.resetVersion || ctx.systemResetVersion;
      const record =
        rawRecord && typeof rawRecord === "object"
          ? mapRecordFromApi(collection, rawRecord)
          : rawRecord;

      const result = executeRecordUpsert(ctx, {
        collection,
        record,
        author: auth.account?.username || meta.author,
        employeeId: auth.employeeId || meta.employeeId,
        user_id: meta.userId,
        device_id: reqDevId,
        actionDesc: meta.actionDesc,
        expectedVersion: meta.expectedVersion,
        reset_version: clientResetVersion,
        userPermission,
      });

      if (!result.success) {
        const mappedConflict = mapRecordToApi(
          collection,
          result.currentRecord || result.confirmedRecord
        );
        return res.status(result.status).json({
          error: result.error,
          ...(result.fieldErrors ? { fieldErrors: result.fieldErrors, errors: result.fieldErrors } : {}),
          currentRecord: mappedConflict,
          confirmedRecord: mappedConflict,
          systemResetVersion: result.systemResetVersion,
          systemResetId: result.systemResetId,
        });
      }

      return res.json({
        success: true,
        collection,
        record: mapRecordToApi(collection, result.confirmedRecord),
        systemResetVersion: result.systemResetVersion,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Delete Record
  app.post("/api/records/delete", async (req: Request, res: Response) => {
    try {
      const { collection, id } = mapDeleteRecordInputFromApi(req.body);
      const meta = mapRequestMetaFromApi(req);
      const reqDevId = meta.deviceId;
      if (isDeviceRevoked(ctx, reqDevId)) {
        closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
        return res.status(403).json({ error: "DEVICE_REVOKED" });
      }

      const auth = resolveRequestAuthContext(ctx, req, reqDevId);
      const userPermission = auth.permission;
      const clientResetVersion = meta.resetVersion || ctx.systemResetVersion;

      const result = executeRecordDelete(ctx, {
        collection,
        id,
        author: auth.account?.username || meta.author,
        employeeId: auth.employeeId || meta.employeeId,
        user_id: meta.userId,
        device_id: reqDevId,
        actionDesc: meta.actionDesc,
        expectedVersion: meta.expectedVersion,
        reset_version: clientResetVersion,
        userPermission,
      });

      if (!result.success) {
        const mappedConflict = mapRecordToApi(
          collection,
          result.currentRecord || result.confirmedRecord
        );
        return res.status(result.status).json({
          error: result.error,
          currentRecord: mappedConflict,
          confirmedRecord: mappedConflict,
          systemResetVersion: result.systemResetVersion,
          systemResetId: result.systemResetId,
        });
      }

      return res.json({
        success: true,
        collection,
        id: result.id,
        systemResetVersion: result.systemResetVersion,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Chat message
  app.post("/api/chat", (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res
          .status(403)
          .json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }
      const newMsg = mapChatMessageFromApi(req.body);
      if (!newMsg.text) return res.status(400).json({ error: "Text required" });

      ctx.chatMessages.push(newMsg);
      if (ctx.chatMessages.length > 200) ctx.chatMessages.shift();
      commitDatabase(ctx);

      broadcast(ctx, {
        type: "chat_broadcast",
        message: newMsg,
      });

      return res.json({ success: true, message: newMsg });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });
}
