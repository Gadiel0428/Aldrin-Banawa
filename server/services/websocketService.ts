/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebSocket Connection Registry, Room Routing & Real-Time Event Engine
 */

import http from "http";
import type { Socket } from "net";
import { WebSocket } from "ws";
import type {
  ChatMessage,
  ReceivingRecord,
  RegisteredAccount,
  ReturnRecord,
} from "../../shared/types.ts";
import logger from "../../src/lib/logger.ts";
import {
  mapStockMovementFromApi,
  mapSyncCollectionInputFromApi,
} from "../api/mapper.ts";
import { recordAuditTrail } from "./auditService.ts";
import {
  ensureSuperAdminSeed,
  generateSecureRandom4DigitPin,
  hashPinScrypt,
  isDeviceRevoked,
  markUserTombstone,
  unmarkUserTombstone,
} from "./authService.ts";
import { resolveEffectiveMaxDevices, validateMaxDevices } from "../../shared/deviceLimit.ts";
import { commitDatabase } from "./backupService.ts";
import { recordMaxDevicesChangeAudit } from "./deviceLimitService.ts";
import {
  DEFAULT_FIFO_COLORS_BY_MONTH,
  type ActiveConnectionRecord,
  type ServerContext,
} from "./context.ts";
import {
  assignSocketToGroup,
  broadcast,
  broadcastInventoryEvent,
  broadcastPresenceSync,
  closeDeviceSockets,
  filterDataForClient,
  getActiveOperatorsCount,
  getActivePresenceList,
  getActiveTerminalsCount,
  getActiveUsersList,
  normalizeGroupId,
  queryDatabaseInventory,
  removeSocketFromGroups,
  sanitizeUserForClient,
} from "./realtimeService.ts";
import {
  INVENTORY_COLLECTIONS,
  executeRecordDelete,
  executeRecordUpsert,
  executeStockMovement,
} from "./recordService.ts";
import {
  computeDerivedBalanceForStock,
  deriveAllStockBalances,
  ensureMovementsForBusinessRecord,
  findMovementByIdempotencyKey,
  resolveStockItemForMovement,
  roundStockQuantity,
} from "./stockLedgerService.ts";

export function setupWebSocketServer(server: http.Server, ctx: ServerContext): void {
  const { wss } = ctx;

  server.on("upgrade", (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
    const pathname = request.url?.split("?")[0] || "";
    if (pathname === "/ws" || pathname === "/" || pathname === "") {
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  const heartbeatInterval = setInterval(() => {
    let changed = false;
    const now = Date.now();
    for (const [connId, conn] of ctx.connectionRegistry.entries()) {
      if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
        if (conn.ws) {
          removeSocketFromGroups(ctx, conn.ws);
        }
        ctx.connectionRegistry.delete(connId);
        changed = true;
        broadcast(ctx, {
          type: "USER_OFFLINE",
          connection_id: connId,
          user_id: conn.user_id,
          session_id: conn.session_id,
          device_id: conn.device_id,
          employeeId: conn.employeeId,
          username: conn.username,
          systemResetVersion: ctx.systemResetVersion,
        });
      } else if (now - conn.lastPing > 45000) {
        try {
          conn.ws.terminate();
        } catch {
          // Ignore terminate errors
        }
        removeSocketFromGroups(ctx, conn.ws);
        ctx.connectionRegistry.delete(connId);
        changed = true;
        broadcast(ctx, {
          type: "USER_OFFLINE",
          connection_id: connId,
          user_id: conn.user_id,
          session_id: conn.session_id,
          device_id: conn.device_id,
          employeeId: conn.employeeId,
          username: conn.username,
          systemResetVersion: ctx.systemResetVersion,
        });
      }
    }
    if (changed) {
      broadcastPresenceSync(ctx);
    }
  }, 15000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (ws: WebSocket & { isAlive?: boolean; _deviceId?: string }, req: http.IncomingMessage) => {
    ws.isAlive = true;

    const connection_id = `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    ctx.socketToConnectionId.set(ws, connection_id);
    logger.debug(
      `[WS Connection] New client connected (${connection_id}) on server instance: ${ctx.serverInstanceId}`
    );

    const ip =
      (req.headers["x-forwarded-for"] as string) || req.socket?.remoteAddress || "127.0.0.1";
    const userAgent = req.headers["user-agent"] || "";
    const platform = userAgent.includes("Android")
      ? "Android"
      : userAgent.includes("iPhone") || userAgent.includes("iPad")
        ? "iOS"
        : userAgent.includes("Windows")
          ? "Windows"
          : "Desktop";

    let queryAccountId = "ACC-JUWEI";
    let queryWarehouseId = "WH-MAIN";
    let queryDeviceId = "";
    try {
      const host = req.headers.host || `127.0.0.1:${ctx.config.port}`;
      const parsedUrl = new URL(req.url || "/ws", `http://${host}`);
      const qAcc =
        parsedUrl.searchParams.get("accountId") ||
        parsedUrl.searchParams.get("account_id") ||
        (req.headers["x-account-id"] as string);
      const qWh =
        parsedUrl.searchParams.get("warehouseId") ||
        parsedUrl.searchParams.get("warehouse_id") ||
        (req.headers["x-warehouse-id"] as string);
      const qDev =
        parsedUrl.searchParams.get("deviceId") ||
        parsedUrl.searchParams.get("device_id") ||
        (req.headers["x-device-id"] as string);
      const authToken =
        parsedUrl.searchParams.get("token") ||
        parsedUrl.searchParams.get("auth_token") ||
        (req.headers["authorization"]
          ? req.headers["authorization"].replace(/^Bearer\s+/i, "")
          : "");

      if (qAcc) queryAccountId = qAcc.trim();
      if (qWh) queryWarehouseId = qWh.trim();
      if (qDev) queryDeviceId = qDev.trim();

      if (authToken) {
        try {
          if (authToken.startsWith("{") && authToken.endsWith("}")) {
            const parsedToken = JSON.parse(authToken);
            if (parsedToken.accountId || parsedToken.account_id) {
              queryAccountId = String(parsedToken.accountId || parsedToken.account_id).trim();
            }
            if (parsedToken.warehouseId || parsedToken.warehouse_id) {
              queryWarehouseId = String(parsedToken.warehouseId || parsedToken.warehouse_id).trim();
            }
            if (parsedToken.deviceId || parsedToken.device_id) {
              queryDeviceId = String(parsedToken.deviceId || parsedToken.device_id).trim();
            }
          } else if (authToken.includes(".")) {
            const parts = authToken.split(".");
            if (parts.length >= 2) {
              const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
              const parsedJwt = JSON.parse(payloadJson);
              if (parsedJwt.accountId || parsedJwt.account_id) {
                queryAccountId = String(parsedJwt.accountId || parsedJwt.account_id).trim();
              }
              if (parsedJwt.warehouseId || parsedJwt.warehouse_id) {
                queryWarehouseId = String(parsedJwt.warehouseId || parsedJwt.warehouse_id).trim();
              }
            }
          }
        } catch {
          // Ignore malformed WS token
        }
      }
    } catch (urlErr) {
      console.warn("Failed parsing WS connection url:", urlErr);
    }

    if (queryDeviceId && isDeviceRevoked(ctx, queryDeviceId)) {
      ws._deviceId = queryDeviceId;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "DEVICE_REVOKED",
              deviceId: queryDeviceId,
              error: "DEVICE_REVOKED",
              systemResetVersion: ctx.systemResetVersion,
            })
          );
        }
      } catch {
        // Ignore send failure
      }
      closeDeviceSockets(ctx, queryDeviceId, "DEVICE_REVOKED");
      ctx.socketToConnectionId.delete(ws);
      try {
        ws.close(4003, "DEVICE_REVOKED");
      } catch {
        // Ignore close failure
      }
      return;
    }
    if (queryDeviceId) {
      ws._deviceId = queryDeviceId;
    }

    const initialInventory = queryDatabaseInventory(ctx, queryAccountId, queryWarehouseId);
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(
          JSON.stringify({
            type: "FULL_INVENTORY_SYNC",
            serverInstanceId: ctx.serverInstanceId,
            accountId: queryAccountId,
            warehouseId: queryWarehouseId,
            inventory: initialInventory,
            stocks: initialInventory,
            count: initialInventory.length,
            timestamp: new Date().toISOString(),
            systemResetVersion: ctx.systemResetVersion,
            systemResetId: ctx.systemResetId,
          })
        );
      } catch (err) {
        console.warn("Error sending FULL_INVENTORY_SYNC to connecting socket:", err);
      }
    }

    assignSocketToGroup(ctx, ws, queryAccountId, queryWarehouseId);

    const initialDevRecord = queryDeviceId ? ctx.authorizedDevicesMap.get(queryDeviceId) : undefined;
    const initialBoundEmp =
      initialDevRecord?.status === "AUTHORIZED"
        ? initialDevRecord.employeeId || (initialDevRecord.isPrimaryAdminDevice ? "JPMP-002" : "")
        : "";
    const initialBoundUser = initialBoundEmp
      ? ctx.state.registeredUsers.find(
          (u: RegisteredAccount) =>
            (u.employeeId || "").toUpperCase().trim() === initialBoundEmp.toUpperCase()
        )
      : undefined;
    const initialServerPermission = initialBoundUser
      ? initialBoundUser.status === "INACTIVE"
        ? "VIEW_ONLY"
        : initialBoundUser.permission
      : initialDevRecord?.status === "AUTHORIZED" && initialDevRecord.isPrimaryAdminDevice
        ? "FULL_ACCESS"
        : "LIMITED_ACCESS";

    const initialRecord: ActiveConnectionRecord = {
      connection_id,
      user_id: "ANONYMOUS",
      session_id: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      device_id: queryDeviceId || `dev_${Math.random().toString(36).substring(2, 9)}`,
      ...(queryDeviceId ? { deviceId: queryDeviceId } : {}),
      stationId: "",
      employeeId: initialBoundUser?.employeeId || initialBoundEmp || "",
      username: initialBoundUser?.username || "CONNECTING TERMINAL",
      role: initialBoundUser?.role || "OPERATOR",
      permission: initialServerPermission,
      platform,
      deviceName: `${platform} Terminal`,
      activeView: "dashboard",
      connectedAt: new Date().toISOString(),
      lastPing: Date.now(),
      resetVersion: ctx.systemResetVersion,
      ws,
      ip,
      userAgent,
      accountId: queryAccountId,
      warehouseId: queryWarehouseId,
    };
    ctx.connectionRegistry.set(connection_id, initialRecord);

    const rejectIfDeviceRevokedWs = (
      payload: any,
      conn?: ActiveConnectionRecord | null,
      extra?: { collection?: string; recordId?: string; clientMutationId?: any }
    ): { revoked: boolean; reqDevId: string } => {
      const reqDevId = String(
        payload?.device_id ||
          payload?.deviceId ||
          conn?.device_id ||
          conn?.deviceId ||
          ws._deviceId ||
          payload?.record?.device_id ||
          payload?.record?.deviceId ||
          ""
      ).trim();
      if (isDeviceRevoked(ctx, reqDevId)) {
        ws._deviceId = reqDevId;
        try {
          ws.send(
            JSON.stringify({
              type: "ERROR",
              error: "DEVICE_REVOKED",
              status: 403,
              deviceId: reqDevId,
              ...(extra?.collection ? { collection: extra.collection } : {}),
              ...(extra?.recordId ? { recordId: extra.recordId } : {}),
              ...(extra?.clientMutationId ? { clientMutationId: extra.clientMutationId } : {}),
              systemResetVersion: ctx.systemResetVersion,
            })
          );
        } catch {
          // Ignore send error
        }
        closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
        return { revoked: true, reqDevId };
      }
      return { revoked: false, reqDevId };
    };

    ws.on("pong", () => {
      ws.isAlive = true;
      const cId = ctx.socketToConnectionId.get(ws);
      if (cId) {
        const c = ctx.connectionRegistry.get(cId);
        if (c) c.lastPing = Date.now();
      }
    });

    try {
      const presenceList = getActivePresenceList(ctx);
      ws.send(
        JSON.stringify({
          type: "init",
          serverInstanceId: ctx.serverInstanceId,
          connection_id,
          connectionId: connection_id,
          systemResetVersion: ctx.systemResetVersion,
          systemResetTimestamp: ctx.systemResetTimestamp,
          systemResetId: ctx.systemResetId,
          systemResetBy: ctx.systemResetBy,
          data: filterDataForClient(
            { ...ctx.state, chatMessages: ctx.chatMessages },
            initialRecord.permission,
            initialRecord.employeeId
          ),
          activeUsers: getActiveUsersList(ctx),
          activePresence: presenceList,
          presenceList,
          connectedOperators: getActiveOperatorsCount(ctx),
          liveActiveTerminals: getActiveTerminalsCount(ctx),
        })
      );

      ws.send(
        JSON.stringify({
          type: "PRESENCE_SYNC",
          connection_id,
          presenceList,
          activePresence: presenceList,
          activeUsers: getActiveUsersList(ctx),
          connectedOperators: getActiveOperatorsCount(ctx),
          liveActiveTerminals: getActiveTerminalsCount(ctx),
          systemResetVersion: ctx.systemResetVersion,
          timestamp: new Date().toISOString(),
        })
      );
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
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const info = ctx.connectionRegistry.get(connId);
            if (info) info.lastPing = Date.now();
            ws.send(
              JSON.stringify({
                type: "pong",
                clientPingTime: payload.clientPingTime,
                serverTime: Date.now(),
              })
            );
            break;
          }

          case "authenticate":
          case "join": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (!conn) break;

            const deviceId = String(payload.device_id || payload.deviceId || conn.device_id).trim();
            if (isDeviceRevoked(ctx, deviceId)) {
              ws._deviceId = deviceId;
              try {
                ws.send(
                  JSON.stringify({
                    type: "DEVICE_REVOKED",
                    deviceId,
                    error: "DEVICE_REVOKED",
                    systemResetVersion: ctx.systemResetVersion,
                  })
                );
              } catch {
                // Ignore send failure
              }
              closeDeviceSockets(ctx, deviceId, "DEVICE_REVOKED");
              break;
            }
            ws._deviceId = deviceId;

            const wsSessionToken = String(payload.sessionToken || payload.token || "").trim();
            const tokenSession = wsSessionToken ? ctx.sessionTokensMap.get(wsSessionToken) : undefined;
            const deviceRecord = deviceId ? ctx.authorizedDevicesMap.get(deviceId) : undefined;

            const requestedEmpId = String(payload.employeeId || "").trim().toUpperCase();
            let authoritativeEmpId = "";
            if (deviceRecord && deviceRecord.status === "AUTHORIZED") {
              authoritativeEmpId = String(
                deviceRecord.employeeId ||
                  (deviceRecord.isPrimaryAdminDevice ? "JPMP-002" : "") ||
                  tokenSession?.employeeId ||
                  requestedEmpId
              )
                .trim()
                .toUpperCase();
            } else if (tokenSession) {
              authoritativeEmpId = String(tokenSession.employeeId || "").trim().toUpperCase();
            } else {
              authoritativeEmpId = requestedEmpId;
            }

            const serverAccount = authoritativeEmpId
              ? ctx.state.registeredUsers.find(
                  (u: RegisteredAccount) =>
                    (u.employeeId || "").toUpperCase().trim() === authoritativeEmpId
                )
              : undefined;

            const employeeId = serverAccount?.employeeId || authoritativeEmpId;
            const username =
              serverAccount?.username ||
              String(
                payload.username || (employeeId === "JPMP-002" ? "ALDRIN BANAWA" : "OPERATOR")
              )
                .trim()
                .toUpperCase();
            const role =
              serverAccount?.role ||
              String(payload.role || "WAREHOUSE OPERATOR").trim().toUpperCase();

            let permission = "LIMITED_ACCESS";
            if (deviceRecord && deviceRecord.status === "AUTHORIZED") {
              if (serverAccount) {
                permission =
                  serverAccount.status === "INACTIVE"
                    ? "VIEW_ONLY"
                    : String(serverAccount.permission || "LIMITED_ACCESS").trim().toUpperCase();
              } else {
                permission = deviceRecord.isPrimaryAdminDevice
                  ? "FULL_ACCESS"
                  : String(deviceRecord.permission || "LIMITED_ACCESS").trim().toUpperCase();
              }
            } else if (tokenSession && serverAccount) {
              permission =
                serverAccount.status === "INACTIVE"
                  ? "VIEW_ONLY"
                  : String(serverAccount.permission || "LIMITED_ACCESS").trim().toUpperCase();
            } else if (serverAccount) {
              permission =
                serverAccount.status === "INACTIVE" || serverAccount.permission === "VIEW_ONLY"
                  ? "VIEW_ONLY"
                  : "LIMITED_ACCESS";
            }

            const activeView = String(payload.activeView || "dashboard").trim();
            const stationId = String(payload.stationId || "").trim();
            const sessionId = String(
              payload.session_id || payload.sessionId || conn.session_id
            ).trim();
            const userId = String(
              payload.user_id ||
                payload.userId ||
                (employeeId ? `USR-${employeeId}` : conn.user_id)
            ).trim();
            const devPlatform = String(payload.platform || conn.platform || "Web").trim();
            const devName = String(payload.deviceName || `${devPlatform} Terminal`).trim();
            const clientResetVersion =
              Number(payload.reset_version || payload.currentResetVersion) || ctx.systemResetVersion;

            conn.user_id = userId;
            conn.session_id = sessionId;
            conn.device_id = deviceId;
            conn.deviceId = deviceId;
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

            const authenticatedInventory = queryDatabaseInventory(
              ctx,
              conn.accountId,
              conn.warehouseId
            );
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(
                  JSON.stringify({
                    type: "FULL_INVENTORY_SYNC",
                    serverInstanceId: ctx.serverInstanceId,
                    accountId: conn.accountId,
                    warehouseId: conn.warehouseId,
                    inventory: authenticatedInventory,
                    stocks: authenticatedInventory,
                    count: authenticatedInventory.length,
                    timestamp: new Date().toISOString(),
                    systemResetVersion: ctx.systemResetVersion,
                    systemResetId: ctx.systemResetId,
                  })
                );
              } catch {
                // Ignore send failure
              }
            }

            assignSocketToGroup(ctx, ws, conn.accountId, conn.warehouseId);

            ctx.activeDevices.set(deviceId, {
              deviceId,
              deviceName: devName,
              employeeId,
              username,
              role,
              ip: conn.ip,
              userAgent: conn.userAgent,
              appVersion: payload.appVersion || ctx.cachedGitHubVersion || "Live",
              platform: devPlatform,
              connectedAt: conn.connectedAt,
              lastSeen: Date.now(),
              currentView: activeView,
            });

            const requiresResync = clientResetVersion < ctx.systemResetVersion;
            ws.send(
              JSON.stringify({
                type: "auth_confirmed",
                connection_id: connId,
                user_id: userId,
                session_id: sessionId,
                device_id: deviceId,
                permission,
                systemResetVersion: ctx.systemResetVersion,
                systemResetId: ctx.systemResetId,
                systemResetTimestamp: ctx.systemResetTimestamp,
                requiresResync,
                connectedOperators: getActiveOperatorsCount(ctx),
                liveActiveTerminals: getActiveTerminalsCount(ctx),
              })
            );

            if (requiresResync) {
              ws.send(
                JSON.stringify({
                  type: "SYNC_REQUIRED",
                  reason: "STALE_RESET_VERSION",
                  systemResetVersion: ctx.systemResetVersion,
                  systemResetId: ctx.systemResetId,
                })
              );
            }

            ws.send(
              JSON.stringify({
                type: "init",
                serverInstanceId: ctx.serverInstanceId,
                connection_id: connId,
                connectionId: connId,
                systemResetVersion: ctx.systemResetVersion,
                systemResetTimestamp: ctx.systemResetTimestamp,
                systemResetId: ctx.systemResetId,
                systemResetBy: ctx.systemResetBy,
                data: filterDataForClient(
                  { ...ctx.state, chatMessages: ctx.chatMessages },
                  conn.permission,
                  conn.employeeId
                ),
                activeUsers: getActiveUsersList(ctx),
                activePresence: getActivePresenceList(ctx),
                presenceList: getActivePresenceList(ctx),
                connectedOperators: getActiveOperatorsCount(ctx),
                liveActiveTerminals: getActiveTerminalsCount(ctx),
              })
            );

            broadcast(ctx, {
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
              systemResetVersion: ctx.systemResetVersion,
            });

            broadcastPresenceSync(ctx);

            const joinMsg: ChatMessage = {
              id: `sys-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              sender: "System",
              text: `${username} (${employeeId || stationId || devName}) connected.`,
              timestamp: new Date().toISOString(),
              isSystem: true,
            };
            ctx.chatMessages.push(joinMsg);
            if (ctx.chatMessages.length > 200) ctx.chatMessages.shift();
            broadcast(ctx, { type: "chat_broadcast", message: joinMsg });
            break;
          }

          case "SUBSCRIBE_WAREHOUSE":
          case "JOIN_ROOM":
          case "subscribe_room":
          case "set_warehouse": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            const targetAcc = normalizeGroupId(payload.accountId || conn?.accountId, "ACC-JUWEI");
            const targetWh = normalizeGroupId(
              payload.warehouseId || payload.room || conn?.warehouseId,
              "WH-MAIN"
            );

            if (conn) {
              conn.accountId = targetAcc;
              conn.warehouseId = targetWh;
            }

            const roomInventory = queryDatabaseInventory(ctx, targetAcc, targetWh);

            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(
                  JSON.stringify({
                    type: "FULL_INVENTORY_SYNC",
                    serverInstanceId: ctx.serverInstanceId,
                    accountId: targetAcc,
                    warehouseId: targetWh,
                    inventory: roomInventory,
                    stocks: roomInventory,
                    count: roomInventory.length,
                    timestamp: new Date().toISOString(),
                    systemResetVersion: ctx.systemResetVersion,
                    systemResetId: ctx.systemResetId,
                  })
                );
              } catch {
                // Ignore send failure
              }
            }

            assignSocketToGroup(ctx, ws, targetAcc, targetWh);

            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(
                  JSON.stringify({
                    type: "ROOM_SUBSCRIBED",
                    accountId: targetAcc,
                    warehouseId: targetWh,
                    systemResetVersion: ctx.systemResetVersion,
                  })
                );
              } catch {
                // Ignore send failure
              }
            }
            break;
          }

          case "GET_INVENTORY":
          case "REQUEST_INVENTORY_SYNC": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            const targetAcc = normalizeGroupId(payload.accountId || conn?.accountId, "ACC-JUWEI");
            const targetWh = normalizeGroupId(payload.warehouseId || conn?.warehouseId, "WH-MAIN");

            const currentInv = queryDatabaseInventory(ctx, targetAcc, targetWh);
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(
                  JSON.stringify({
                    type: "FULL_INVENTORY_SYNC",
                    serverInstanceId: ctx.serverInstanceId,
                    accountId: targetAcc,
                    warehouseId: targetWh,
                    inventory: currentInv,
                    stocks: currentInv,
                    count: currentInv.length,
                    timestamp: new Date().toISOString(),
                    systemResetVersion: ctx.systemResetVersion,
                    systemResetId: ctx.systemResetId,
                  })
                );
              } catch {
                // Ignore send failure
              }
            }
            break;
          }

          case "STOCK_ADJUSTMENT":
          case "adjust_stock": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            const revCheck = rejectIfDeviceRevokedWs(payload, conn);
            if (revCheck.revoked) break;
            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }
            const targetAcc = normalizeGroupId(payload.accountId || conn?.accountId, "ACC-JUWEI");
            const targetWh = normalizeGroupId(payload.warehouseId || conn?.warehouseId, "WH-MAIN");
            const appliedDelta =
              Number(
                payload.delta !== undefined
                  ? payload.delta
                  : payload.quantity !== undefined
                    ? payload.quantity
                    : 0
              ) || 0;
            const adjType =
              payload.type && ["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "PURCHASE", "SALE", "SALE_RETURN", "PURCHASE_RETURN", "TRANSFER_IN", "TRANSFER_OUT", "RECYCLING"].includes(payload.type)
                ? payload.type
                : appliedDelta < 0
                  ? "ADJUSTMENT_OUT"
                  : "ADJUSTMENT_IN";

            const movRes = executeStockMovement(ctx, {
              reqDevId: conn?.device_id || "TERMINAL",
              actorName: conn?.username || "Operator",
              actorEmployeeId: conn?.employeeId,
              clientResetVersion: Number(payload.reset_version) || conn?.resetVersion,
              userPermission: conn?.permission,
              body: {
                productId: payload.productId || payload.product_id,
                warehouseId: targetWh,
                accountId: targetAcc,
                type: adjType,
                quantity: appliedDelta,
                delta: appliedDelta,
                location: payload.location,
                lotNumber: payload.lotNumber || payload.lot_number,
                notes: payload.notes || "Stock adjustment via WebSocket",
                userId: conn?.user_id || "OPERATOR",
                userName: conn?.username || "Operator",
                deviceId: conn?.device_id || "TERMINAL",
                idempotencyKey:
                  payload.idempotency_key ||
                  payload.idempotencyKey ||
                  payload.clientMutationId ||
                  `WS-ADJ:${Date.now()}:${Math.random().toString(36).substring(2, 7)}`,
                preventNegativeStock: payload.preventNegativeStock !== false,
              },
            });

            if (movRes.status >= 400) {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: movRes.payload?.error || "Stock adjustment rejected",
                  status: movRes.status,
                })
              );
            }
            break;
          }

          case "LOCATION_TRANSFER":
          case "transfer_location": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            const revCheck = rejectIfDeviceRevokedWs(payload, conn);
            if (revCheck.revoked) break;
            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }
            const targetAcc = normalizeGroupId(payload.accountId || conn?.accountId, "ACC-JUWEI");
            const sourceWh = normalizeGroupId(
              payload.fromWarehouseId || payload.warehouseId || conn?.warehouseId,
              "WH-MAIN"
            );
            const targetWh = normalizeGroupId(
              payload.toWarehouseId || payload.warehouseId || conn?.warehouseId,
              "WH-MAIN"
            );
            const { productId, fromLocation, toLocation, quantity, notes } = payload;
            const idempotencyKey =
              payload.idempotency_key ||
              payload.idempotencyKey ||
              payload.clientMutationId ||
              `WS-XFER:${Date.now()}:${Math.random().toString(36).substring(2, 7)}`;

            if (findMovementByIdempotencyKey(ctx, idempotencyKey)) {
              break;
            }

            const stockItem = resolveStockItemForMovement(ctx, productId, payload.lotNumber);
            const serverTime = new Date().toISOString();
            if (stockItem) {
              if (toLocation) stockItem.location = toLocation;
              stockItem.warehouseId = targetWh;
              stockItem.version = (stockItem.version || 1) + 1;
              stockItem.updated_at = serverTime;
              stockItem.reset_version = ctx.systemResetVersion;
            }

            const movementId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const movementRecord = mapStockMovementFromApi({
              id: movementId,
              product_id: stockItem ? stockItem.id : productId,
              product_sku: stockItem?.partCode || productId,
              warehouse_id: targetWh,
              account_id: targetAcc,
              type: "LOCATION_TRANSFER",
              quantity: Number(quantity) || 0,
              previous_quantity: stockItem ? Number(stockItem.quantity) || 0 : undefined,
              new_quantity: stockItem ? Number(stockItem.quantity) || 0 : undefined,
              notes:
                notes || `Transferred from ${fromLocation || sourceWh} to ${toLocation || targetWh}`,
              user_id: conn?.user_id || "OPERATOR",
              user_name: conn?.username || "Operator",
              device_id: conn?.device_id || "TERMINAL",
              idempotency_key: idempotencyKey,
              created_at: serverTime,
              reset_version: ctx.systemResetVersion,
            });

            if (!ctx.state.stockMovements) ctx.state.stockMovements = [];
            ctx.state.stockMovements.unshift(movementRecord);
            ctx.stateRevision++;

            commitDatabase(ctx);

            broadcastInventoryEvent(ctx, {
              type: "LOCATION_TRANSFER",
              accountId: targetAcc,
              warehouseId: targetWh,
              collection: "stocks",
              record: stockItem,
              movement: movementRecord,
              actionDesc: notes || `Location transfer for ${productId} to ${toLocation || targetWh}`,
              author: conn?.username || "Operator",
              user_id: conn?.user_id,
              device_id: conn?.device_id,
            });
            break;
          }

          case "PICK_PACK_SHIP":
          case "pick_pack_ship": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            const revCheck = rejectIfDeviceRevokedWs(payload, conn);
            if (revCheck.revoked) break;
            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }
            const targetAcc = normalizeGroupId(payload.accountId || conn?.accountId, "ACC-JUWEI");
            const targetWh = normalizeGroupId(payload.warehouseId || conn?.warehouseId, "WH-MAIN");
            const { orderId, operationType, items, notes } = payload;

            const isOutbound = operationType === "SHIP" || operationType === "PICK";
            const itemList = Array.isArray(items) ? items : [];
            for (const item of itemList) {
              const pId = item.productId || item.id || item.partCode;
              const qty = Math.abs(Number(item.quantity) || 0);
              if (!pId || qty <= 0 || !isOutbound) continue;
              const baseKey =
                item.idempotencyKey ||
                item.idempotency_key ||
                payload.idempotencyKey ||
                payload.idempotency_key ||
                `WS-PPS:${orderId || Date.now()}:${pId}`;
              executeStockMovement(ctx, {
                reqDevId: conn?.device_id || "TERMINAL",
                actorName: conn?.username || "Operator",
                actorEmployeeId: conn?.employeeId,
                clientResetVersion: Number(payload.reset_version) || conn?.resetVersion,
                userPermission: conn?.permission,
                body: {
                  productId: pId,
                  warehouseId: targetWh,
                  accountId: targetAcc,
                  type: "SALE",
                  quantity: qty,
                  delta: -qty,
                  referenceNumber: orderId,
                  notes:
                    notes || `${operationType || "Pick/Pack/Ship"} operation for order ${orderId}`,
                  userId: conn?.user_id || "OPERATOR",
                  userName: conn?.username || "Operator",
                  deviceId: conn?.device_id || "TERMINAL",
                  idempotencyKey: baseKey,
                  preventNegativeStock: true,
                },
              });
            }
            break;
          }

          case "record_upsert":
          case "upsert_record":
          case "DATA_CREATE":
          case "DATA_UPDATE":
          case "create_record":
          case "update_record": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            const clientResetVersion =
              Number(payload.reset_version || payload.currentResetVersion) ||
              conn?.resetVersion ||
              ctx.systemResetVersion;
            const reqDevId = String(
              payload.device_id ||
                payload.deviceId ||
                conn?.device_id ||
                conn?.deviceId ||
                payload.record?.device_id ||
                payload.record?.deviceId ||
                ""
            ).trim();
            const clientMutationId = payload.clientMutationId || payload.id;

            if (isDeviceRevoked(ctx, reqDevId)) {
              ws._deviceId = reqDevId;
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: "DEVICE_REVOKED",
                  status: 403,
                  deviceId: reqDevId,
                  collection: payload.collection,
                  recordId: payload.record?.id || payload.record_id,
                  clientMutationId,
                  systemResetVersion: ctx.systemResetVersion,
                })
              );
              closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
              break;
            }

            const upsertRes = executeRecordUpsert(ctx, {
              collection: payload.collection,
              record: payload.record,
              author: payload.author || conn?.username || "Operator",
              employeeId: payload.employeeId || conn?.employeeId,
              user_id: payload.user_id || conn?.user_id,
              device_id: reqDevId,
              actionDesc: payload.actionDesc,
              expectedVersion: payload.expectedVersion,
              reset_version: clientResetVersion,
              userPermission: conn?.permission,
              excludeSocket: ws,
            });

            if (!upsertRes.success) {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: upsertRes.error,
                  ...(upsertRes.fieldErrors
                    ? { fieldErrors: upsertRes.fieldErrors, errors: upsertRes.fieldErrors }
                    : {}),
                  status: upsertRes.status,
                  collection: payload.collection,
                  recordId: payload.record?.id || payload.record_id,
                  clientMutationId,
                  currentRecord: upsertRes.currentRecord || upsertRes.confirmedRecord,
                  confirmedRecord: upsertRes.confirmedRecord || upsertRes.currentRecord,
                  systemResetVersion: ctx.systemResetVersion,
                  systemResetId: ctx.systemResetId,
                })
              );
              if (
                upsertRes.status === 409 &&
                typeof upsertRes.error === "string" &&
                upsertRes.error.includes("STALE_RESET_VERSION")
              ) {
                ws.send(
                  JSON.stringify({
                    type: "SYNC_REQUIRED",
                    reason: "STALE_RESET_VERSION",
                    systemResetVersion: ctx.systemResetVersion,
                    systemResetId: ctx.systemResetId,
                  })
                );
              }
            } else {
              ws.send(
                JSON.stringify({
                  type: "UPSERT_CONFIRMED",
                  clientMutationId,
                  collection: payload.collection,
                  record: upsertRes.confirmedRecord,
                  isCreation: upsertRes.isCreation,
                  systemResetVersion: ctx.systemResetVersion,
                })
              );
            }
            break;
          }

          case "record_delete":
          case "delete_record":
          case "DATA_DELETE": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            const clientResetVersion =
              Number(payload.reset_version || payload.currentResetVersion) ||
              conn?.resetVersion ||
              ctx.systemResetVersion;
            const targetId = String(payload.id || payload.record_id || payload.recordId || "");
            const reqDevId = String(
              payload.device_id || payload.deviceId || conn?.device_id || conn?.deviceId || ""
            ).trim();
            const clientMutationId = payload.clientMutationId;

            if (isDeviceRevoked(ctx, reqDevId)) {
              ws._deviceId = reqDevId;
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: "DEVICE_REVOKED",
                  status: 403,
                  deviceId: reqDevId,
                  collection: payload.collection,
                  recordId: targetId,
                  clientMutationId,
                  systemResetVersion: ctx.systemResetVersion,
                })
              );
              closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
              break;
            }

            const deleteRes = executeRecordDelete(ctx, {
              collection: payload.collection,
              id: targetId,
              author: payload.author || conn?.username || "Operator",
              employeeId: payload.employeeId || conn?.employeeId,
              user_id: payload.user_id || conn?.user_id,
              device_id: reqDevId,
              actionDesc: payload.actionDesc,
              expectedVersion: payload.expectedVersion,
              reset_version: clientResetVersion,
              userPermission: conn?.permission,
              excludeSocket: ws,
            });

            if (!deleteRes.success) {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: deleteRes.error,
                  status: deleteRes.status,
                  collection: payload.collection,
                  recordId: targetId,
                  clientMutationId,
                  currentRecord: deleteRes.currentRecord || deleteRes.confirmedRecord,
                  confirmedRecord: deleteRes.confirmedRecord || deleteRes.currentRecord,
                  systemResetVersion: ctx.systemResetVersion,
                  systemResetId: ctx.systemResetId,
                })
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "DELETE_CONFIRMED",
                  clientMutationId,
                  collection: payload.collection,
                  id: targetId,
                  systemResetVersion: ctx.systemResetVersion,
                })
              );
            }
            break;
          }

          case "update_collection":
          case "sync_collection": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            const clientResetVersion =
              Number(payload.reset_version || payload.currentResetVersion) ||
              conn?.resetVersion ||
              ctx.systemResetVersion;
            const col = payload.collection;
            const reqDevId = String(
              payload.device_id || payload.deviceId || conn?.device_id || conn?.deviceId || ""
            ).trim();

            if (isDeviceRevoked(ctx, reqDevId)) {
              ws._deviceId = reqDevId;
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: "DEVICE_REVOKED",
                  status: 403,
                  deviceId: reqDevId,
                  collection: col,
                })
              );
              closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
              break;
            }

            if (clientResetVersion < ctx.systemResetVersion) {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: "STALE_RESET_VERSION: Central database was reset. Stale sync rejected.",
                  status: 409,
                  systemResetVersion: ctx.systemResetVersion,
                  systemResetId: ctx.systemResetId,
                })
              );
              break;
            }

            if (!col || !(col in ctx.state)) {
              ws.send(JSON.stringify({ type: "ERROR", error: `Unknown collection: ${col}`, status: 400 }));
              break;
            }

            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }

            if (col === "operationalRoles") {
              if (Array.isArray(payload.data)) {
                const cleaned = Array.from(
                  new Set<string>(
                    payload.data.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean)
                  )
                );
                if (cleaned.length > 0) {
                  ctx.state.operationalRoles = cleaned;
                  ctx.stateRevision++;
                  commitDatabase(ctx);
                  recordAuditTrail(ctx, {
                    actor: conn?.username || payload.author || "Admin",
                    actorId: conn?.employeeId || payload.employeeId || "ADMIN",
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
              break;
            }

            if (col === "receivingCategories") {
              if (Array.isArray(payload.data)) {
                const cleaned = Array.from(
                  new Set<string>(
                    payload.data.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean)
                  )
                );
                if (cleaned.length > 0) {
                  ctx.state.receivingCategories = cleaned;
                  ctx.stateRevision++;
                  commitDatabase(ctx);
                  recordAuditTrail(ctx, {
                    actor: conn?.username || payload.author || "Admin",
                    actorId: conn?.employeeId || payload.employeeId || "ADMIN",
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
              break;
            }

            if (col === "fifoColorsByMonth") {
              if (payload.data && typeof payload.data === "object") {
                ctx.state.fifoColorsByMonth = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...payload.data };
                ctx.stateRevision++;
                commitDatabase(ctx);
                recordAuditTrail(ctx, {
                  actor: conn?.username || payload.author || "Admin",
                  actorId: conn?.employeeId || payload.employeeId || "ADMIN",
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
              break;
            }

            const mappedSyncItems = mapSyncCollectionInputFromApi(col, payload.data);
            const items: any[] = Array.isArray(mappedSyncItems) ? mappedSyncItems : [];
            const currentList: any[] = (ctx.state as any)[col] || [];
            const listMap = new Map<string, any>(
              currentList.map((item: any) => [String(item.id || item.record_id), item])
            );
            const existingMovementKeys =
              col === "stockMovements"
                ? new Set<string>(
                    currentList
                      .map((m: any) => String(m?.idempotency_key || "").trim())
                      .filter(Boolean)
                  )
                : null;

            let modifiedCount = 0;
            const serverTime = new Date().toISOString();
            const effectiveAuthor = payload.author || conn?.username || "Operator";
            const effectiveEmpId = payload.employeeId || conn?.employeeId;
            const effectiveDevId = payload.device_id || conn?.deviceId || "DEV-CENTRAL";
            const effectiveUserId =
              payload.user_id ||
              conn?.user_id ||
              (effectiveEmpId ? `USR-${effectiveEmpId}` : `USR-${effectiveAuthor}`);

            for (const item of items) {
              if (!item) continue;
              const recId = String(
                item.id ||
                  item.record_id ||
                  `REC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
              );
              if (ctx.deletedRecordTombstones.has(recId)) continue;

              if (col === "stockMovements" && existingMovementKeys) {
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

                if (col === "stocks") {
                  const savedQty = roundStockQuantity(Number(updatedRec.quantity) || 0);
                  updatedRec.quantity = savedQty;
                  ensureMovementsForBusinessRecord(ctx, "stocks", updatedRec, false, existing);
                  updatedRec.quantity = savedQty;
                }

                if (col === "registeredUsers") {
                  if (existing.pinHash) updatedRec.pinHash = existing.pinHash;
                  if (existing.pinSalt) updatedRec.pinSalt = existing.pinSalt;
                  if (existing.pin) updatedRec.pin = existing.pin;
                  if (existing.pin_hash) updatedRec.pin_hash = existing.pin_hash;
                  if (existing.mustChangePin !== undefined) {
                    updatedRec.mustChangePin = existing.mustChangePin;
                  }
                  if (existing.isPinCompromised !== undefined) {
                    updatedRec.isPinCompromised = existing.isPinCompromised;
                  }
                  if (existing.pinChangedAt) updatedRec.pinChangedAt = existing.pinChangedAt;
                  if (existing.pinChangedBy) updatedRec.pinChangedBy = existing.pinChangedBy;
                  const oldMaxDevices = resolveEffectiveMaxDevices(existing);
                  const check =
                    item.maxDevices !== undefined
                      ? validateMaxDevices(item.maxDevices, { defaultIfEmpty: false })
                      : { valid: true, value: oldMaxDevices };
                  updatedRec.maxDevices = check.valid ? check.value : oldMaxDevices;
                }

                listMap.set(recId, updatedRec);
                modifiedCount++;
              } else {
                if (col === "registeredUsers") {
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
                if (col === "stocks") {
                  const savedQty = roundStockQuantity(Number(newRec.quantity) || 0);
                  newRec.quantity = savedQty;
                  ensureMovementsForBusinessRecord(ctx, "stocks", newRec, true);
                  newRec.quantity = savedQty;
                }
                listMap.set(recId, newRec);
                modifiedCount++;
              }
            }

            if (modifiedCount > 0) {
              (ctx.state as any)[col] = Array.from(listMap.values());
              if (col === "stockMovements") {
                deriveAllStockBalances(ctx);
              }
              ctx.stateRevision++;
              commitDatabase(ctx);

              recordAuditTrail(ctx, {
                timestamp: serverTime,
                actor: effectiveAuthor,
                actorId: effectiveEmpId || effectiveUserId,
                action: "SYNC",
                recordType: col,
                recordId: `${modifiedCount} records`,
                summary: `Synced ${col} (${modifiedCount} item(s) modified)`,
                deviceId: effectiveDevId,
              });

              logger.debug(
                `[CENTRAL-DB] [WS-SYNC-COLLECTION] Collection: ${col} | Items: ${items.length} | Modified: ${modifiedCount} | User: ${effectiveUserId} | Device: ${effectiveDevId}`
              );

              if (INVENTORY_COLLECTIONS.has(col)) {
                broadcastInventoryEvent(ctx, {
                  type: "INVENTORY_UPDATE",
                  collection: col,
                  actionDesc: `Synchronized ${col} collection (${modifiedCount} items modified)`,
                  author: effectiveAuthor,
                  user_id: effectiveUserId,
                  device_id: effectiveDevId,
                });
              } else {
                broadcast(ctx, {
                  type: "collection_updated",
                  collection: col,
                  data: (ctx.state as any)[col],
                  systemResetVersion: ctx.systemResetVersion,
                });
              }
            }

            ws.send(
              JSON.stringify({
                type: "COLLECTION_SYNC_CONFIRMED",
                collection: col,
                count: (ctx.state as any)[col]?.length || 0,
                systemResetVersion: ctx.systemResetVersion,
              })
            );
            break;
          }

          case "batch_mutations":
          case "sync_batch": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            const clientResetVersion =
              Number(payload.reset_version || payload.currentResetVersion) ||
              conn?.resetVersion ||
              ctx.systemResetVersion;
            const reqDevId = String(
              payload.device_id || payload.deviceId || conn?.device_id || conn?.deviceId || ""
            ).trim();

            if (isDeviceRevoked(ctx, reqDevId)) {
              ws._deviceId = reqDevId;
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: "DEVICE_REVOKED",
                  status: 403,
                  deviceId: reqDevId,
                })
              );
              closeDeviceSockets(ctx, reqDevId, "DEVICE_REVOKED");
              break;
            }

            if (clientResetVersion < ctx.systemResetVersion) {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: "STALE_RESET_VERSION: Central database was reset.",
                  status: 409,
                  systemResetVersion: ctx.systemResetVersion,
                  systemResetId: ctx.systemResetId,
                })
              );
              break;
            }

            const mutations = Array.isArray(payload.mutations) ? payload.mutations : [];
            let processed = 0;
            const results: any[] = [];
            let batchAbortedRevoked = false;
            for (const m of mutations) {
              const mutDevId = String(m.device_id || m.deviceId || reqDevId).trim();
              if (isDeviceRevoked(ctx, mutDevId)) {
                ws._deviceId = mutDevId;
                ws.send(
                  JSON.stringify({
                    type: "ERROR",
                    error: "DEVICE_REVOKED",
                    status: 403,
                    deviceId: mutDevId,
                  })
                );
                closeDeviceSockets(ctx, mutDevId, "DEVICE_REVOKED");
                batchAbortedRevoked = true;
                break;
              }
              if (m.type === "upsert" && m.collection && m.record) {
                const res = executeRecordUpsert(ctx, {
                  collection: m.collection,
                  record: m.record,
                  author: m.author || conn?.username || "Operator",
                  employeeId: m.employeeId || conn?.employeeId,
                  user_id: m.user_id || conn?.user_id,
                  device_id: m.device_id || m.deviceId || reqDevId,
                  actionDesc: m.actionDesc,
                  expectedVersion: m.expectedVersion,
                  reset_version: clientResetVersion,
                  userPermission: conn?.permission,
                  excludeSocket: ws,
                });
                if (res.success) processed++;
                results.push({
                  id: m.id,
                  mutationId: m.id,
                  type: m.type,
                  collection: m.collection,
                  recordId: String(m.record?.id || m.record?.record_id || ""),
                  success: res.success,
                  status: res.status,
                  error: res.error,
                  record: res.confirmedRecord,
                  currentRecord: res.currentRecord || res.confirmedRecord,
                });
              } else if (m.type === "delete" && m.collection && (m.id || m.recordId)) {
                const targetId = String(m.id || m.recordId);
                const res = executeRecordDelete(ctx, {
                  collection: m.collection,
                  id: targetId,
                  author: m.author || conn?.username || "Operator",
                  employeeId: m.employeeId || conn?.employeeId,
                  user_id: m.user_id || conn?.user_id,
                  device_id: m.device_id || m.deviceId || reqDevId,
                  actionDesc: m.actionDesc,
                  expectedVersion: m.expectedVersion,
                  reset_version: clientResetVersion,
                  userPermission: conn?.permission,
                  excludeSocket: ws,
                });
                if (res.success) processed++;
                results.push({
                  id: m.id,
                  mutationId: m.id,
                  type: m.type,
                  collection: m.collection,
                  recordId: targetId,
                  success: res.success,
                  status: res.status,
                  error: res.error,
                  currentRecord: res.currentRecord || res.confirmedRecord,
                });
              }
            }

            if (batchAbortedRevoked) break;

            logger.debug(
              `[CENTRAL-DB] [WS-BATCH-MUTATIONS] Processed ${processed}/${mutations.length} mutations | User: ${conn?.username || "Operator"} | Device: ${reqDevId || "Terminal"}`
            );

            ws.send(
              JSON.stringify({
                type: "BATCH_SYNC_CONFIRMED",
                processed,
                total: mutations.length,
                results,
                systemResetVersion: ctx.systemResetVersion,
              })
            );
            break;
          }

          case "request_sync":
          case "resync":
          case "get_state": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            const presenceList = getActivePresenceList(ctx);
            ws.send(
              JSON.stringify({
                type: "init",
                serverInstanceId: ctx.serverInstanceId,
                connection_id: connId,
                connectionId: connId,
                systemResetVersion: ctx.systemResetVersion,
                systemResetTimestamp: ctx.systemResetTimestamp,
                systemResetId: ctx.systemResetId,
                systemResetBy: ctx.systemResetBy,
                data: filterDataForClient(
                  { ...ctx.state, chatMessages: ctx.chatMessages },
                  conn?.permission || "LIMITED_ACCESS",
                  conn?.employeeId
                ),
                activeUsers: getActiveUsersList(ctx),
                activePresence: presenceList,
                presenceList,
                connectedOperators: getActiveOperatorsCount(ctx),
                liveActiveTerminals: getActiveTerminalsCount(ctx),
              })
            );
            ws.send(
              JSON.stringify({
                type: "PRESENCE_SYNC",
                connection_id: connId,
                presenceList,
                activePresence: presenceList,
                activeUsers: getActiveUsersList(ctx),
                connectedOperators: getActiveOperatorsCount(ctx),
                liveActiveTerminals: getActiveTerminalsCount(ctx),
                systemResetVersion: ctx.systemResetVersion,
                timestamp: new Date().toISOString(),
              })
            );
            break;
          }

          case "presence_update": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            if (conn) {
              if (payload.activeView) conn.activeView = payload.activeView;
              if (payload.stationId) conn.stationId = payload.stationId;
              if (payload.username && !conn.employeeId) {
                conn.username = payload.username.toUpperCase();
              }
              conn.lastPing = Date.now();
              broadcastPresenceSync(ctx);
            }
            break;
          }

          case "force_sync_all":
          case "sync_all_workstations": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            const author = payload.author || conn?.username || "SUPER ADMINISTRATOR";
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
            break;
          }

          case "get_presence": {
            const presenceList = getActivePresenceList(ctx);
            ws.send(
              JSON.stringify({
                type: "PRESENCE_SYNC",
                presenceList,
                activePresence: presenceList,
                activeUsers: getActiveUsersList(ctx),
                connectedOperators: getActiveOperatorsCount(ctx),
                liveActiveTerminals: getActiveTerminalsCount(ctx),
                systemResetVersion: ctx.systemResetVersion,
                timestamp: new Date().toISOString(),
              })
            );
            break;
          }

          case "chat": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }
            const newMsg: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              sender: payload.username || payload.sender || "Staff",
              text: String(payload.text || "").trim(),
              timestamp: new Date().toISOString(),
              isSystem: false,
            };
            ctx.chatMessages.push(newMsg);
            if (ctx.chatMessages.length > 200) ctx.chatMessages.shift();
            commitDatabase(ctx);

            broadcast(ctx, {
              type: "chat_broadcast",
              message: newMsg,
            });
            break;
          }

          case "register_account": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }
            const newUser = payload.user;
            if (!newUser || !newUser.employeeId) break;
            const cleanEmpId = String(newUser.employeeId).trim().toUpperCase();
            const cleanUsername = String(newUser.username || "").trim().toUpperCase();

            unmarkUserTombstone(ctx, cleanEmpId);

            const existingIdx = ctx.state.registeredUsers.findIndex(
              (u: RegisteredAccount) => u.employeeId.toUpperCase() === cleanEmpId
            );

            let cleanPin = String(newUser.pin || "").trim().replace(/\D/g, "").slice(0, 6);
            if (!cleanPin || cleanPin.length < 4 || cleanPin === "1234") {
              cleanPin = generateSecureRandom4DigitPin();
            }
            const { pinHash, pinSalt } = hashPinScrypt(cleanPin);

            const maxDevCheck = validateMaxDevices(newUser.maxDevices ?? newUser.max_devices, {
              defaultIfEmpty: true,
            });
            if (!maxDevCheck.valid) {
              ws.send(JSON.stringify({ type: "ERROR", error: maxDevCheck.error, status: 400 }));
              break;
            }

            const userToStore: RegisteredAccount = {
              id: newUser.id || `USR-${cleanEmpId}`,
              employeeId: cleanEmpId,
              username: cleanUsername,
              role: String(newUser.role || "WAREHOUSE CLERK").trim().toUpperCase(),
              phoneNumber: newUser.phoneNumber ? String(newUser.phoneNumber).trim() : "",
              permission: String(newUser.permission || "LIMITED_ACCESS").trim(),
              maxDevices: maxDevCheck.value,
              pinHash,
              pinSalt,
              isPinCompromised: false,
              status: "ACTIVE",
              registeredBy:
                payload.author || newUser.registeredBy || "JPMP-002 (ALDRIN BANAWA)",
              registeredBySuperAdmin: true,
              registeredAt: newUser.registeredAt || new Date().toISOString(),
              version: 1,
              updated_at: new Date().toISOString(),
              reset_version: ctx.systemResetVersion,
            };

            if (existingIdx !== -1) {
              ctx.state.registeredUsers[existingIdx] = userToStore;
            } else {
              ctx.state.registeredUsers.push(userToStore);
            }
            ctx.stateRevision++;
            commitDatabase(ctx);

            const authorName = payload.author || "Super Administrator";
            recordAuditTrail(ctx, {
              actor: conn?.username || authorName,
              actorId: conn?.employeeId || payload.requesterEmployeeId || "JPMP-002",
              action: "CREATE",
              recordType: "registeredUsers",
              recordId: cleanEmpId,
              summary: `Registered account ${cleanUsername} (${cleanEmpId}) — Role: ${userToStore.role}, Permission: ${userToStore.permission}, Max Devices: ${userToStore.maxDevices}`,
              details: `Account: ${cleanUsername} (${cleanEmpId}) | maxDevices: ${userToStore.maxDevices}`,
              deviceId: conn?.deviceId || payload.device_id || undefined,
            });
            broadcast(ctx, {
              type: "account_registered",
              user: sanitizeUserForClient(userToStore),
              author: authorName,
              systemResetVersion: ctx.systemResetVersion,
            });
            broadcast(ctx, {
              type: "account_created",
              account: sanitizeUserForClient(userToStore),
              user: sanitizeUserForClient(userToStore),
              systemResetVersion: ctx.systemResetVersion,
            });
            broadcast(ctx, {
              type: "collection_updated",
              collection: "registeredUsers",
              data: ctx.state.registeredUsers,
              systemResetVersion: ctx.systemResetVersion,
            });
            break;
          }

          case "update_account": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }
            const updated = payload.user;
            if (!updated || !updated.employeeId) break;
            const cleanEmpId = String(updated.employeeId).trim().toUpperCase();
            const existingIdx = ctx.state.registeredUsers.findIndex(
              (u: RegisteredAccount) => u.employeeId.toUpperCase() === cleanEmpId
            );
            if (existingIdx === -1) break;

            const existing = ctx.state.registeredUsers[existingIdx];
            const isSuper = cleanEmpId === "JPMP-002";
            const oldMaxDevices = resolveEffectiveMaxDevices(existing);
            const rawMaxDevices = updated.maxDevices ?? updated.max_devices;
            let nextMaxDevices = oldMaxDevices;
            if (
              rawMaxDevices !== undefined &&
              rawMaxDevices !== null &&
              String(rawMaxDevices).trim() !== ""
            ) {
              const maxDevCheck = validateMaxDevices(rawMaxDevices, { defaultIfEmpty: false });
              if (!maxDevCheck.valid) {
                ws.send(JSON.stringify({ type: "ERROR", error: maxDevCheck.error, status: 400 }));
                break;
              }
              nextMaxDevices = maxDevCheck.value;
            }

            const mergedUser: RegisteredAccount = {
              ...existing,
              ...updated,
              employeeId: isSuper ? "JPMP-002" : cleanEmpId,
              username: String(updated.username || existing.username).trim().toUpperCase(),
              role: isSuper
                ? "SUPER ADMINISTRATOR"
                : String(updated.role || existing.role).trim().toUpperCase(),
              permission: isSuper
                ? "FULL_ACCESS"
                : String(updated.permission || existing.permission).trim(),
              maxDevices: nextMaxDevices,
              pinHash: existing.pinHash,
              pinSalt: existing.pinSalt,
              ...(existing.pin && !existing.pinHash ? { pin: existing.pin } : {}),
              mustChangePin: existing.mustChangePin,
              isPinCompromised: existing.isPinCompromised,
              pinChangedAt: existing.pinChangedAt,
              pinChangedBy: existing.pinChangedBy,
              version: (existing.version || 1) + 1,
              updated_at: new Date().toISOString(),
              reset_version: ctx.systemResetVersion,
            };
            if (mergedUser.pinHash) delete mergedUser.pin;

            ctx.state.registeredUsers[existingIdx] = mergedUser;
            ctx.stateRevision++;
            commitDatabase(ctx);

            const authorName = conn?.username || payload.author || "Admin";
            if (oldMaxDevices !== nextMaxDevices) {
              recordMaxDevicesChangeAudit(ctx, {
                actorName: authorName,
                actorEmployeeId: conn?.employeeId || "JPMP-002",
                targetAccount: mergedUser,
                oldMaxDevices,
                newMaxDevices: nextMaxDevices,
                deviceId: conn?.deviceId || payload.device_id || undefined,
                timestamp: mergedUser.updated_at,
              });
            }

            broadcast(ctx, {
              type: "account_updated",
              user: sanitizeUserForClient(mergedUser),
              account: sanitizeUserForClient(mergedUser),
              author: payload.author || "Admin",
              systemResetVersion: ctx.systemResetVersion,
            });
            broadcast(ctx, {
              type: "collection_updated",
              collection: "registeredUsers",
              data: ctx.state.registeredUsers,
              systemResetVersion: ctx.systemResetVersion,
            });
            break;
          }

          case "delete_account": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }
            const cleanId = String(payload.employeeId || "").trim().toUpperCase();
            if (!cleanId || cleanId === "JPMP-002") break;

            markUserTombstone(ctx, cleanId);
            ctx.state.registeredUsers = ctx.state.registeredUsers.filter(
              (u: RegisteredAccount) => u.employeeId.toUpperCase().trim() !== cleanId
            );
            ctx.stateRevision++;
            commitDatabase(ctx);

            broadcast(ctx, {
              type: "account_deleted",
              employeeId: cleanId,
              systemResetVersion: ctx.systemResetVersion,
            });
            broadcast(ctx, {
              type: "collection_updated",
              collection: "registeredUsers",
              data: ctx.state.registeredUsers,
              systemResetVersion: ctx.systemResetVersion,
            });
            break;
          }

          case "all_accounts_cleared": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            if (conn?.permission !== "FULL_ACCESS") {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: "PERMISSION DENIED: Only Super Administrator can clear accounts.",
                  status: 403,
                })
              );
              break;
            }
            const superAdmin = ctx.state.registeredUsers.find(
              (u: RegisteredAccount) => u.employeeId.toUpperCase().trim() === "JPMP-002"
            );
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
            commitDatabase(ctx);

            broadcast(ctx, {
              type: "all_accounts_cleared",
              data: ctx.state.registeredUsers,
              systemResetVersion: ctx.systemResetVersion,
            });
            broadcast(ctx, {
              type: "accounts_cleared",
              systemResetVersion: ctx.systemResetVersion,
            });
            broadcast(ctx, {
              type: "collection_updated",
              collection: "registeredUsers",
              data: ctx.state.registeredUsers,
              systemResetVersion: ctx.systemResetVersion,
            });
            break;
          }

          case "update_roles":
          case "manage_roles": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }
            if (Array.isArray(payload.roles)) {
              const cleaned = Array.from(
                new Set<string>(
                  payload.roles.map((r: any) => String(r || "").trim().toUpperCase()).filter(Boolean)
                )
              );
              if (cleaned.length > 0) {
                ctx.state.operationalRoles = cleaned;
                ctx.stateRevision++;
                commitDatabase(ctx);
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
            break;
          }

          case "update_categories":
          case "manage_categories": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }
            let recModified = false;
            let retModified = false;
            let stocksModified = false;
            let categoriesModified = false;

            if (payload.renameData && payload.renameData.oldCat && payload.renameData.newCat) {
              const cleanOld = String(payload.renameData.oldCat).trim().toUpperCase();
              const cleanNew = String(payload.renameData.newCat).trim().toUpperCase();
              if (cleanOld && cleanNew && cleanOld !== cleanNew) {
                ctx.state.receiving = ctx.state.receiving.map((r: ReceivingRecord) => {
                  let ch = false;
                  const up: any = { ...r };
                  if ((r.supplierOrDept || "").trim().toUpperCase() === cleanOld) {
                    up.supplierOrDept = cleanNew;
                    ch = true;
                  }
                  if (((r as any).category || "").trim().toUpperCase() === cleanOld) {
                    up.category = cleanNew;
                    ch = true;
                  }
                  if (ch) {
                    recModified = true;
                    return {
                      ...up,
                      version: (r.version || 1) + 1,
                      updated_at: new Date().toISOString(),
                    };
                  }
                  return r;
                });

                ctx.state.returns = ctx.state.returns.map((ret: ReturnRecord) => {
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

            if (Array.isArray(payload.categories)) {
              const cleaned = Array.from(
                new Set<string>(
                  payload.categories
                    .map((r: any) => String(r || "").trim().toUpperCase())
                    .filter(Boolean)
                )
              );
              if (cleaned.length > 0) {
                ctx.state.receivingCategories = cleaned;
                categoriesModified = true;
              }
            }

            if (categoriesModified || recModified || retModified || stocksModified) {
              ctx.stateRevision++;
              commitDatabase(ctx);
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
            break;
          }

          case "update_fifo_colors":
          case "manage_fifo_colors": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            if (conn?.permission === "VIEW_ONLY") {
              ws.send(
                JSON.stringify({ type: "ERROR", error: "PERMISSION DENIED: VIEW_ONLY", status: 403 })
              );
              break;
            }
            if (payload.fifoColorsByMonth && typeof payload.fifoColorsByMonth === "object") {
              ctx.state.fifoColorsByMonth = {
                ...DEFAULT_FIFO_COLORS_BY_MONTH,
                ...payload.fifoColorsByMonth,
              };
              ctx.stateRevision++;
              commitDatabase(ctx);
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
            } else if (payload.month && payload.color) {
              const m = Number(payload.month);
              if (m >= 1 && m <= 12 && payload.color.name) {
                ctx.state.fifoColorsByMonth[m] = {
                  name: String(payload.color.name).trim(),
                  colorClass: payload.color.colorClass || "bg-indigo-600",
                  textClass: payload.color.textClass || "text-indigo-600",
                  hex: payload.color.hex || undefined,
                };
                ctx.stateRevision++;
                commitDatabase(ctx);
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
            }
            break;
          }

          case "client_installed": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            const { stationId, installId, username, employeeId, platform: plat, timestamp } = payload;
            logger.info(
              `[CENTRAL-DB] Client installed: Station ${stationId} by ${username} (${employeeId}) on ${plat}`
            );
            broadcast(
              ctx,
              {
                type: "client_installed_broadcast",
                stationId: stationId || "STATION",
                installId,
                username: username || "Operator",
                employeeId,
                platform: plat || "Terminal",
                timestamp: timestamp || new Date().toISOString(),
                systemResetVersion: ctx.systemResetVersion,
              },
              ws
            );
            break;
          }

          case "system_activity": {
            const connId = ctx.socketToConnectionId.get(ws) || connection_id;
            const conn = ctx.connectionRegistry.get(connId);
            if (rejectIfDeviceRevokedWs(payload, conn).revoked) break;
            const actText = String(payload.text || payload.action || "").trim();
            if (actText) {
              const newMsg: ChatMessage = {
                id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                sender: "SYSTEM",
                text: actText,
                timestamp: new Date().toISOString(),
                isSystem: true,
              };
              ctx.chatMessages.push(newMsg);
              if (ctx.chatMessages.length > 200) ctx.chatMessages.shift();
              commitDatabase(ctx);

              broadcast(ctx, {
                type: "chat_broadcast",
                message: newMsg,
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
      removeSocketFromGroups(ctx, ws);
      const connId = ctx.socketToConnectionId.get(ws);
      if (connId) {
        const conn = ctx.connectionRegistry.get(connId);
        ctx.connectionRegistry.delete(connId);
        ctx.socketToConnectionId.delete(ws);

        if (conn) {
          const otherUsingDevice = Array.from(ctx.connectionRegistry.values()).some(
            (c: ActiveConnectionRecord) => c.device_id === conn.device_id
          );
          if (!otherUsingDevice) {
            ctx.activeDevices.delete(conn.device_id);
          }

          broadcast(ctx, {
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
            systemResetVersion: ctx.systemResetVersion,
          });

          broadcastPresenceSync(ctx);
        }
      }
    });
  });
}
