/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server Device Binding, Max Devices Enforcement, Unbind & Audit Service
 */

import {
  buildDeviceLimitReachedMessage,
  countBoundAuthorizedDevicesForEmployee,
  isSuperAdminAccount,
  resolveEffectiveMaxDevices,
} from "../../shared/deviceLimit.ts";
import type { AuthorizedDevice, RegisteredAccount } from "../../shared/types.ts";
import { recordAuditTrail } from "./auditService.ts";
import { commitDatabase } from "./backupService.ts";
import type { ServerContext } from "./context.ts";
import { broadcast } from "./realtimeService.ts";

export interface DeviceSignInResult {
  allowed: boolean;
  status?: number;
  errorCode?: "DEVICE_LIMIT_REACHED" | "DEVICE_BOUND_TO_OTHER";
  error?: string;
  newlyBound?: boolean;
}

export interface UnbindDeviceResult {
  success: boolean;
  status: number;
  error?: string;
  device?: AuthorizedDevice;
  previousEmployeeId?: string;
  previousUsername?: string;
}

export function bindAuthorizedDeviceRecord(
  devRec: AuthorizedDevice,
  account: RegisteredAccount,
  boundAtIso: string = new Date().toISOString()
): AuthorizedDevice {
  devRec.boundEmployeeId = account.employeeId;
  devRec.employeeId = account.employeeId;
  devRec.username = account.username;
  devRec.role = account.role;
  devRec.permission = account.permission;
  devRec.boundAt = boundAtIso;
  return devRec;
}

export function evaluateSignInDeviceBinding(
  ctx: ServerContext,
  matchedUser: RegisteredAccount,
  reqDevId?: string
): DeviceSignInResult {
  const cleanDevId = String(reqDevId || "").trim();
  if (!cleanDevId) {
    return { allowed: true, newlyBound: false };
  }

  const devRec = ctx.authorizedDevicesMap.get(cleanDevId);
  if (!devRec || devRec.status !== "AUTHORIZED") {
    return { allowed: true, newlyBound: false };
  }

  const isSuperAdmin = isSuperAdminAccount(matchedUser);
  const empIdUpper = String(matchedUser.employeeId || "").trim().toUpperCase();
  const boundEmpUpper = String(devRec.boundEmployeeId || "").trim().toUpperCase();
  const nowIso = new Date().toISOString();

  // Super Administrator accounts are exempt from the device limit.
  if (isSuperAdmin) {
    if (!boundEmpUpper) {
      bindAuthorizedDeviceRecord(devRec, matchedUser, nowIso);
      recordAuditTrail(ctx, {
        actor: matchedUser.username,
        actorId: matchedUser.employeeId,
        action: "DEVICE_BOUND",
        recordType: "authorizedDevices",
        recordId: cleanDevId,
        summary: `Bound device ${devRec.deviceName} (${cleanDevId}) to ${matchedUser.username} (${matchedUser.employeeId})`,
        details: `Operator: ${matchedUser.username} (${matchedUser.employeeId}) | Device: ${devRec.deviceName} (${cleanDevId})`,
        deviceId: cleanDevId,
        timestamp: nowIso,
      });
      broadcast(ctx, {
        type: "DEVICE_AUTHORIZATION_UPDATED",
        device: devRec,
        systemResetVersion: ctx.systemResetVersion,
      });
      return { allowed: true, newlyBound: true };
    }
    if (boundEmpUpper === empIdUpper) {
      bindAuthorizedDeviceRecord(devRec, matchedUser, devRec.boundAt || nowIso);
    }
    return { allowed: true, newlyBound: false };
  }

  // Device already bound to this operator: continue without re-counting.
  if (boundEmpUpper === empIdUpper) {
    bindAuthorizedDeviceRecord(devRec, matchedUser, devRec.boundAt || nowIso);
    return { allowed: true, newlyBound: false };
  }

  // Device currently bound to a different operator: require Super Admin unbind first.
  if (boundEmpUpper) {
    return {
      allowed: false,
      status: 403,
      errorCode: "DEVICE_BOUND_TO_OTHER",
      error:
        "This device is currently assigned to another operator. Ask your Super Administrator to unbind this device first.",
    };
  }

  // Unbound authorized device: enforce per-operator maxDevices limit.
  const limit = resolveEffectiveMaxDevices(matchedUser);
  const currentBoundCount = countBoundAuthorizedDevicesForEmployee(
    ctx.authorizedDevicesMap.values(),
    empIdUpper
  );

  if (currentBoundCount >= limit) {
    return {
      allowed: false,
      status: 403,
      errorCode: "DEVICE_LIMIT_REACHED",
      error: buildDeviceLimitReachedMessage(limit),
    };
  }

  bindAuthorizedDeviceRecord(devRec, matchedUser, nowIso);
  recordAuditTrail(ctx, {
    actor: matchedUser.username,
    actorId: matchedUser.employeeId,
    action: "DEVICE_BOUND",
    recordType: "authorizedDevices",
    recordId: cleanDevId,
    summary: `Bound device ${devRec.deviceName} (${cleanDevId}) to ${matchedUser.username} (${matchedUser.employeeId})`,
    details: `Operator: ${matchedUser.username} (${matchedUser.employeeId}) | Device: ${devRec.deviceName} (${cleanDevId}) | Slot ${currentBoundCount + 1} of ${limit}`,
    deviceId: cleanDevId,
    timestamp: nowIso,
  });
  broadcast(ctx, {
    type: "DEVICE_AUTHORIZATION_UPDATED",
    device: devRec,
    systemResetVersion: ctx.systemResetVersion,
  });

  return { allowed: true, newlyBound: true };
}

export function unbindDeviceFromOperator(
  ctx: ServerContext,
  params: {
    deviceId: string;
    actorName: string;
    actorEmployeeId: string;
  }
): UnbindDeviceResult {
  const cleanDeviceId = String(params.deviceId || "").trim();
  if (!cleanDeviceId) {
    return { success: false, status: 400, error: "deviceId required" };
  }

  const existing = ctx.authorizedDevicesMap.get(cleanDeviceId);
  if (!existing) {
    return { success: false, status: 404, error: `Device ${cleanDeviceId} not found` };
  }

  const prevEmployeeId = String(existing.boundEmployeeId || existing.employeeId || "").trim().toUpperCase();
  const prevUsername = String(existing.username || "").trim();
  const nowIso = new Date().toISOString();

  const unboundRecord: AuthorizedDevice = {
    deviceId: existing.deviceId,
    deviceName: existing.deviceName,
    isPrimaryAdminDevice: existing.isPrimaryAdminDevice,
    status: existing.status,
    authorizedBy: existing.authorizedBy,
    authorizedAt: existing.authorizedAt,
  };

  ctx.authorizedDevicesMap.set(cleanDeviceId, unboundRecord);
  ctx.stateRevision++;
  commitDatabase(ctx);

  recordAuditTrail(ctx, {
    timestamp: nowIso,
    actor: params.actorName || "SUPER ADMINISTRATOR",
    actorId: params.actorEmployeeId || "JPMP-002",
    action: "DEVICE_UNBOUND",
    recordType: "authorizedDevices",
    recordId: cleanDeviceId,
    summary: prevEmployeeId
      ? `Unbound device ${unboundRecord.deviceName} (${cleanDeviceId}) from ${prevUsername || prevEmployeeId} (${prevEmployeeId})`
      : `Unbound device ${unboundRecord.deviceName} (${cleanDeviceId})`,
    details: prevEmployeeId
      ? `Operator: ${prevUsername || prevEmployeeId} (${prevEmployeeId}) | Device: ${unboundRecord.deviceName} (${cleanDeviceId}) | Unbound by: ${params.actorName} (${params.actorEmployeeId})`
      : `Device: ${unboundRecord.deviceName} (${cleanDeviceId}) | Unbound by: ${params.actorName} (${params.actorEmployeeId})`,
    deviceId: cleanDeviceId,
  });

  broadcast(ctx, {
    type: "DEVICE_AUTHORIZATION_UPDATED",
    device: unboundRecord,
    systemResetVersion: ctx.systemResetVersion,
  });

  broadcast(ctx, {
    type: "DEVICE_UNBOUND",
    deviceId: cleanDeviceId,
    device: unboundRecord,
    previousEmployeeId: prevEmployeeId,
    systemResetVersion: ctx.systemResetVersion,
  });

  return {
    success: true,
    status: 200,
    device: unboundRecord,
    previousEmployeeId: prevEmployeeId || undefined,
    previousUsername: prevUsername || undefined,
  };
}

export function recordMaxDevicesChangeAudit(
  ctx: ServerContext,
  params: {
    actorName: string;
    actorEmployeeId: string;
    targetAccount: RegisteredAccount;
    oldMaxDevices: number;
    newMaxDevices: number;
    deviceId?: string;
    timestamp?: string;
  }
): void {
  if (params.oldMaxDevices === params.newMaxDevices) return;
  const ts = params.timestamp || new Date().toISOString();
  const actorName = params.actorName || "SUPER ADMINISTRATOR";
  const actorEmployeeId = params.actorEmployeeId || "JPMP-002";

  recordAuditTrail(ctx, {
    timestamp: ts,
    actor: actorName,
    actorId: actorEmployeeId,
    action: "MAX_DEVICES_UPDATED",
    recordType: "registeredUsers",
    recordId: params.targetAccount.employeeId,
    summary: `Changed maxDevices for ${params.targetAccount.username} (${params.targetAccount.employeeId}) from ${params.oldMaxDevices} to ${params.newMaxDevices}`,
    details: `Account: ${params.targetAccount.username} (${params.targetAccount.employeeId}) | Old maxDevices: ${params.oldMaxDevices} | New maxDevices: ${params.newMaxDevices} | Changed by: ${actorName} (${actorEmployeeId}) | Time: ${ts}`,
    ...(params.deviceId ? { deviceId: params.deviceId } : {}),
  });
}
