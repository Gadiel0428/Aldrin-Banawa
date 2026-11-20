/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real-Time WebSocket Room Broadcasts, Presence Tracking & Socket Cleanup
 */

import { WebSocket } from "ws";
import logger from "../../src/lib/logger.ts";
import type { ActiveConnectionRecord, ServerContext } from "./context.ts";

export function sanitizeUserForClient(u: any): any {
  if (!u || typeof u !== "object") return u;
  const hasConfiguredPin = Boolean(
    u.pinHash || u.hasPin || (u.pin && String(u.pin).trim() !== "")
  );
  const { pin: _pin, pinHash: _pinHash, pinSalt: _pinSalt, pin_hash: _pinHashLegacy, ...safe } = u;
  return {
    ...safe,
    hasPin: hasConfiguredPin,
    mustChangePin: Boolean(u.mustChangePin),
  };
}

export function filterDataForClient(
  data: any,
  _clientPermission?: string,
  _clientEmployeeId?: string
): any {
  const cloned = { ...data };
  if (Array.isArray(cloned.registeredUsers)) {
    cloned.registeredUsers = cloned.registeredUsers.map((u: any) => sanitizeUserForClient(u));
  }
  return cloned;
}

export function normalizeGroupId(id?: unknown, defaultVal: string = "WH-MAIN"): string {
  if (!id || typeof id !== "string") return defaultVal;
  const clean = id.trim();
  return clean.length > 0 ? clean : defaultVal;
}

export function removeSocketFromGroups(ctx: ServerContext, ws: WebSocket): void {
  const meta = ctx.socketToRoomMeta.get(ws);
  if (meta) {
    const accSet = ctx.accountRooms.get(meta.accountId);
    if (accSet) {
      accSet.delete(ws);
      if (accSet.size === 0) ctx.accountRooms.delete(meta.accountId);
    }
    const whSet = ctx.warehouseRooms.get(meta.warehouseId);
    if (whSet) {
      whSet.delete(ws);
      if (whSet.size === 0) ctx.warehouseRooms.delete(meta.warehouseId);
    }
  }
  ctx.socketToRoomMeta.delete(ws);
}

export function assignSocketToGroup(
  ctx: ServerContext,
  ws: WebSocket,
  accountIdInput?: string,
  warehouseIdInput?: string
): void {
  const accountId = normalizeGroupId(accountIdInput, "ACC-JUWEI");
  const warehouseId = normalizeGroupId(warehouseIdInput, "WH-MAIN");

  removeSocketFromGroups(ctx, ws);

  if (!ctx.accountRooms.has(accountId)) {
    ctx.accountRooms.set(accountId, new Set());
  }
  ctx.accountRooms.get(accountId)!.add(ws);

  if (!ctx.warehouseRooms.has(warehouseId)) {
    ctx.warehouseRooms.set(warehouseId, new Set());
  }
  ctx.warehouseRooms.get(warehouseId)!.add(ws);

  ctx.socketToRoomMeta.set(ws, { accountId, warehouseId });

  const connId = ctx.socketToConnectionId.get(ws);
  if (connId) {
    const conn = ctx.connectionRegistry.get(connId);
    if (conn) {
      conn.accountId = accountId;
      conn.warehouseId = warehouseId;
    }
  }
  logger.debug(`[WS ROOM] Assigned socket to Group -> Account: [${accountId}], Warehouse: [${warehouseId}]`);
}

export function closeDeviceSockets(
  ctx: ServerContext,
  deviceId?: string,
  reason: string = "DEVICE_REVOKED"
): void {
  const clean = String(deviceId || "").trim();
  if (!clean) return;
  ctx.activeDevices.delete(clean);
  const closedSockets = new Set<WebSocket>();
  for (const [cId, conn] of Array.from(ctx.connectionRegistry.entries())) {
    if (conn.device_id === clean || conn.deviceId === clean) {
      ctx.connectionRegistry.delete(cId);
      if (conn.ws) closedSockets.add(conn.ws);
    }
  }
  for (const client of ctx.wss.clients) {
    if ((client as any)?._deviceId === clean) {
      closedSockets.add(client);
    }
  }
  for (const client of closedSockets) {
    if (client) {
      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: "DEVICE_REVOKED",
              deviceId: clean,
              error: reason,
              systemResetVersion: ctx.systemResetVersion,
            })
          );
        }
      } catch {
        // Ignore socket send error during disconnect
      }
      ctx.socketToConnectionId.delete(client);
      removeSocketFromGroups(ctx, client);
      try {
        client.close(4003, reason);
      } catch {
        // Ignore socket close error
      }
    }
  }
}

export function getSocketsInGroup(
  ctx: ServerContext,
  params: { accountId?: string; warehouseId?: string }
): Set<WebSocket> {
  const matchingSockets = new Set<WebSocket>();
  const targetAcc = normalizeGroupId(params.accountId, "");
  const targetWh = normalizeGroupId(params.warehouseId, "");

  if (targetWh && targetWh !== "ALL" && targetWh !== "GLOBAL" && targetWh.toLowerCase() !== "all") {
    const whSet = ctx.warehouseRooms.get(targetWh);
    if (whSet) {
      for (const s of whSet) {
        if (s && s.readyState === WebSocket.OPEN) {
          const meta = ctx.socketToRoomMeta.get(s);
          if (
            !targetAcc ||
            targetAcc === "ALL" ||
            targetAcc === "GLOBAL" ||
            (meta && meta.accountId === targetAcc)
          ) {
            matchingSockets.add(s);
          }
        }
      }
    }
  } else if (
    targetAcc &&
    targetAcc !== "ALL" &&
    targetAcc !== "GLOBAL" &&
    targetAcc.toLowerCase() !== "all"
  ) {
    const accSet = ctx.accountRooms.get(targetAcc);
    if (accSet) {
      for (const s of accSet) {
        if (s && s.readyState === WebSocket.OPEN) {
          matchingSockets.add(s);
        }
      }
    }
  } else {
    for (const client of ctx.wss.clients) {
      if (client && client.readyState === WebSocket.OPEN) {
        matchingSockets.add(client);
      }
    }
  }

  for (const globalWh of ["ALL", "GLOBAL"]) {
    const gSet = ctx.warehouseRooms.get(globalWh);
    if (gSet) {
      for (const s of gSet) {
        if (s && s.readyState === WebSocket.OPEN) {
          matchingSockets.add(s);
        }
      }
    }
  }
  for (const globalAcc of ["ALL", "GLOBAL"]) {
    const gSet = ctx.accountRooms.get(globalAcc);
    if (gSet) {
      for (const s of gSet) {
        if (s && s.readyState === WebSocket.OPEN) {
          matchingSockets.add(s);
        }
      }
    }
  }
  for (const client of ctx.wss.clients) {
    if (client && client.readyState === WebSocket.OPEN) {
      const connId = ctx.socketToConnectionId.get(client);
      if (connId) {
        const conn = ctx.connectionRegistry.get(connId);
        if (
          conn &&
          (conn.permission === "FULL_ACCESS" ||
            (conn.employeeId || "").toUpperCase() === "JPMP-002" ||
            conn.role === "SUPER ADMINISTRATOR")
        ) {
          matchingSockets.add(client);
        }
      }
    }
  }

  return matchingSockets;
}

export function queryDatabaseInventory(
  ctx: ServerContext,
  accountId?: string,
  warehouseId?: string
): any[] {
  const allStocks = Array.isArray(ctx.state.stocks) ? ctx.state.stocks : [];
  const cleanWh = (warehouseId || "").trim().toUpperCase();
  const cleanAcc = (accountId || "").trim().toUpperCase();

  const isAllWh = !cleanWh || cleanWh === "ALL" || cleanWh === "GLOBAL";
  const isAllAcc = !cleanAcc || cleanAcc === "ALL" || cleanAcc === "GLOBAL";

  if (isAllWh && isAllAcc) {
    return allStocks;
  }

  return allStocks.filter((item: any) => {
    if (!item) return false;
    const itemWh = String(item.warehouseId || item.warehouse_id || item.warehouse || "WH-MAIN")
      .trim()
      .toUpperCase();
    const itemAcc = String(item.accountId || item.account_id || item.account || "ACC-JUWEI")
      .trim()
      .toUpperCase();

    const whMatch = isAllWh || itemWh === cleanWh;
    const accMatch = isAllAcc || itemAcc === cleanAcc;

    return whMatch && accMatch;
  });
}

export function broadcastInventoryEvent(
  ctx: ServerContext,
  event: {
    type: string;
    accountId?: string;
    warehouseId?: string;
    collection?: string;
    record?: any;
    movement?: any;
    actionDesc?: string;
    author?: string;
    user_id?: string;
    device_id?: string;
    timestamp?: string;
    isCreation?: boolean;
    isDelete?: boolean;
    excludeSocket?: WebSocket;
  }
): void {
  const targetAccountId = normalizeGroupId(
    event.accountId || event.record?.accountId || event.record?.account_id,
    "ACC-JUWEI"
  );
  const targetWarehouseId = normalizeGroupId(
    event.warehouseId ||
      event.record?.warehouseId ||
      event.record?.warehouse_id ||
      event.movement?.warehouse_id,
    "WH-MAIN"
  );

  const updatedInventory = queryDatabaseInventory(ctx, targetAccountId, targetWarehouseId);
  const eventTime = event.timestamp || new Date().toISOString();
  const recordId = event.record?.id || event.record?.record_id;

  const payloadObj = {
    type: event.type,
    accountId: targetAccountId,
    warehouseId: targetWarehouseId,
    inventory: updatedInventory,
    stocks: updatedInventory,
    collection: event.collection || "stocks",
    record: event.record,
    id: recordId,
    record_id: recordId,
    movement: event.movement,
    actionDesc: event.actionDesc || `Inventory event: ${event.type}`,
    author: event.author || "Operator",
    user_id: event.user_id,
    device_id: event.device_id,
    timestamp: eventTime,
    systemResetVersion: ctx.systemResetVersion,
    systemResetId: ctx.systemResetId,
  };

  const payloadString = JSON.stringify(payloadObj);

  const legacyCollectionMsg = JSON.stringify({
    type: "collection_updated",
    collection: event.collection || "stocks",
    data: (ctx.state as any)[event.collection || "stocks"],
    systemResetVersion: ctx.systemResetVersion,
  });

  const messagesToSend: string[] = [payloadString, legacyCollectionMsg];

  if (event.isDelete) {
    messagesToSend.push(
      JSON.stringify({
        type: "DATA_DELETE",
        collection: event.collection || "stocks",
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        actionDesc: event.actionDesc || `Deleted ${event.collection || "stocks"} record`,
        timestamp: eventTime,
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
      })
    );
    messagesToSend.push(
      JSON.stringify({
        type: "RECORD_DELETED",
        collection: event.collection || "stocks",
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        timestamp: eventTime,
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
      })
    );
    messagesToSend.push(
      JSON.stringify({
        type: "record_deleted",
        collection: event.collection || "stocks",
        id: recordId,
        systemResetVersion: ctx.systemResetVersion,
      })
    );
  } else if (event.isCreation || event.record?._isNew) {
    messagesToSend.push(
      JSON.stringify({
        type: "DATA_CREATE",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        actionDesc: event.actionDesc || `Created ${event.collection || "stocks"} record`,
        timestamp: eventTime,
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
      })
    );
    messagesToSend.push(
      JSON.stringify({
        type: "RECORD_CREATED",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        timestamp: eventTime,
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
      })
    );
    messagesToSend.push(
      JSON.stringify({
        type: "record_upserted",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        systemResetVersion: ctx.systemResetVersion,
      })
    );
  } else if (event.record) {
    messagesToSend.push(
      JSON.stringify({
        type: "DATA_UPDATE",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        actionDesc: event.actionDesc || `Updated ${event.collection || "stocks"} record`,
        timestamp: eventTime,
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
      })
    );
    messagesToSend.push(
      JSON.stringify({
        type: "RECORD_UPDATED",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        record_id: recordId,
        author: event.author || "Operator",
        user_id: event.user_id,
        device_id: event.device_id,
        timestamp: eventTime,
        systemResetVersion: ctx.systemResetVersion,
        systemResetId: ctx.systemResetId,
      })
    );
    messagesToSend.push(
      JSON.stringify({
        type: "record_upserted",
        collection: event.collection || "stocks",
        record: event.record,
        id: recordId,
        systemResetVersion: ctx.systemResetVersion,
      })
    );
  }

  if (event.movement) {
    messagesToSend.push(
      JSON.stringify({
        type: "stock_movement_created",
        movement: event.movement,
        stock: event.record,
        stocks: updatedInventory,
        warehouseId: targetWarehouseId,
        accountId: targetAccountId,
        systemResetVersion: ctx.systemResetVersion,
      })
    );
  }

  const targetSockets = getSocketsInGroup(ctx, {
    accountId: targetAccountId,
    warehouseId: targetWarehouseId,
  });

  for (const client of targetSockets) {
    if (client && client.readyState === WebSocket.OPEN && client !== event.excludeSocket) {
      try {
        for (const msg of messagesToSend) {
          client.send(msg);
        }
      } catch (sendErr) {
        console.warn("WebSocket client send warning in inventory room:", sendErr);
      }
    }
  }

  logger.debug(
    `[INVENTORY-BROADCAST] [${event.type}] Dispatched ${messagesToSend.length} messages to ${targetSockets.size} active sockets in Room [${targetAccountId}:${targetWarehouseId}]`
  );
}

export function getActiveOperatorsCount(ctx: ServerContext): number {
  const operatorIds = new Set<string>();
  for (const conn of ctx.connectionRegistry.values()) {
    const id = (conn.employeeId || conn.user_id || conn.username || "").trim().toUpperCase();
    if (id && id !== "ANONYMOUS" && id !== "CONNECTING TERMINAL") {
      operatorIds.add(id);
    }
  }
  return Math.max(operatorIds.size, ctx.connectionRegistry.size > 0 ? 1 : 0);
}

export function getActiveTerminalsCount(ctx: ServerContext): number {
  return ctx.connectionRegistry.size;
}

export function getActiveUsersList(ctx: ServerContext): string[] {
  const names = new Set<string>();
  for (const conn of ctx.connectionRegistry.values()) {
    if (conn.username && conn.username !== "CONNECTING TERMINAL") {
      names.add(conn.username);
    }
  }
  return Array.from(names);
}

export function getActivePresenceList(ctx: ServerContext): Array<Record<string, any>> {
  return Array.from(ctx.connectionRegistry.values()).map((c: ActiveConnectionRecord) => ({
    connection_id: c.connection_id,
    connectionId: c.connection_id,
    user_id: c.user_id,
    userId: c.user_id,
    session_id: c.session_id,
    sessionId: c.session_id,
    device_id: c.device_id,
    deviceId: c.device_id,
    stationId: c.stationId || "",
    employeeId: c.employeeId || "",
    username: c.username,
    role: c.role || "OPERATOR",
    permission: c.permission || "LIMITED_ACCESS",
    platform: c.platform || "Web",
    deviceName: c.deviceName || "Terminal",
    activeView: c.activeView || "dashboard",
    connectedAt: c.connectedAt,
    lastPing: c.lastPing,
    accountId: c.accountId || "ACC-JUWEI",
    warehouseId: c.warehouseId || "WH-MAIN",
    source: "central_websocket" as const,
  }));
}

export function broadcast(ctx: ServerContext, msg: any, excludeSocket?: WebSocket): void {
  let payloadToBroadcast: any = msg;
  if (msg && typeof msg === "object") {
    const clonedMsg: any = { ...msg };
    if (clonedMsg.collection === "registeredUsers" && clonedMsg.record) {
      clonedMsg.record = sanitizeUserForClient(clonedMsg.record);
    }
    if (clonedMsg.user) {
      clonedMsg.user = sanitizeUserForClient(clonedMsg.user);
    }
    if (clonedMsg.account) {
      clonedMsg.account = sanitizeUserForClient(clonedMsg.account);
    }
    if (clonedMsg.data && typeof clonedMsg.data === "object") {
      if (Array.isArray(clonedMsg.data.registeredUsers)) {
        clonedMsg.data = filterDataForClient(clonedMsg.data);
      } else if (
        (clonedMsg.collection === "registeredUsers" || clonedMsg.type === "all_accounts_cleared") &&
        Array.isArray(clonedMsg.data)
      ) {
        clonedMsg.data = clonedMsg.data.map((u: any) => sanitizeUserForClient(u));
      }
    }
    payloadToBroadcast = clonedMsg;
  }

  const serializedMsg = JSON.stringify(payloadToBroadcast);

  for (const client of ctx.wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== excludeSocket) {
      try {
        client.send(serializedMsg);
      } catch (sendErr) {
        console.warn("WebSocket client send warning:", sendErr);
      }
    }
  }
}

export function broadcastPresenceSync(ctx: ServerContext): void {
  const presenceList = getActivePresenceList(ctx);
  const payload = {
    type: "PRESENCE_SYNC",
    presenceList,
    activePresence: presenceList,
    activeUsers: getActiveUsersList(ctx),
    connectedOperators: getActiveOperatorsCount(ctx),
    liveActiveTerminals: getActiveTerminalsCount(ctx),
    systemResetVersion: ctx.systemResetVersion,
    timestamp: new Date().toISOString(),
  };
  broadcast(ctx, payload);
  broadcast(ctx, {
    type: "presence_updated",
    activeUsers: getActiveUsersList(ctx),
    activePresence: presenceList,
  });
}
