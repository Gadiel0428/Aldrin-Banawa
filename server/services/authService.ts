/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authentication, Scrypt PIN Security, Device Authorization & Tombstone Helpers
 */

import crypto from "crypto";
import type { Request, Response } from "express";
import type { AuthorizedDevice, RegisteredAccount } from "../../shared/types.ts";
import logger from "../../src/lib/logger.ts";
import {
  DEFAULT_SUPER_ADMIN,
  type RequestAuthContext,
  type ServerContext,
} from "./context.ts";
import { closeDeviceSockets } from "./realtimeService.ts";

export function markRecordTombstone(ctx: ServerContext, id: string): void {
  if (!id) return;
  ctx.deletedRecordTombstones.add(id);
  if (ctx.deletedRecordTombstones.size > 10000) {
    const first = ctx.deletedRecordTombstones.values().next().value;
    if (first) ctx.deletedRecordTombstones.delete(first);
  }
}

export function markUserTombstone(ctx: ServerContext, employeeId: string): void {
  if (!employeeId) return;
  const clean = employeeId.trim().toUpperCase();
  if (clean === "JPMP-002") return;
  ctx.deletedUserTombstones.add(clean);
}

export function unmarkUserTombstone(ctx: ServerContext, employeeId: string): void {
  if (!employeeId) return;
  ctx.deletedUserTombstones.delete(employeeId.trim().toUpperCase());
}

export function isDeviceRevoked(ctx: ServerContext, deviceId?: string): boolean {
  const clean = String(deviceId || "").trim();
  if (!clean) return false;
  const record = ctx.authorizedDevicesMap.get(clean);
  return Boolean(record && (record.status === "REVOKED" || record.status === "PENDING"));
}

export function hashPinScrypt(
  pin: string,
  existingSalt?: string
): { pinHash: string; pinSalt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(pin).trim(), salt, 64).toString("hex");
  return { pinHash: derived, pinSalt: salt };
}

export function verifyPinScrypt(pin: string, pinHash: string, pinSalt: string): boolean {
  try {
    const cleanPin = String(pin || "").trim();
    if (!cleanPin || !pinHash || !pinSalt) return false;
    const derivedBuf = crypto.scryptSync(cleanPin, pinSalt, 64);
    const expectedBuf = Buffer.from(pinHash, "hex");
    if (derivedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derivedBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function verifyUserPin(
  user: RegisteredAccount | undefined,
  enteredPin: string
): { matched: boolean; upgradedFromPlaintext: boolean } {
  if (!user) return { matched: false, upgradedFromPlaintext: false };
  const cleanEntered = String(enteredPin || "").trim();
  if (!cleanEntered) return { matched: false, upgradedFromPlaintext: false };

  if (user.pinHash && user.pinSalt) {
    return {
      matched: verifyPinScrypt(cleanEntered, user.pinHash, user.pinSalt),
      upgradedFromPlaintext: false,
    };
  }

  const legacyPlain = String(user.pin || "").trim();
  if (legacyPlain && legacyPlain.length === cleanEntered.length) {
    const match = crypto.timingSafeEqual(
      Buffer.from(legacyPlain, "utf-8"),
      Buffer.from(cleanEntered, "utf-8")
    );
    if (match) {
      const { pinHash, pinSalt } = hashPinScrypt(cleanEntered);
      user.pinHash = pinHash;
      user.pinSalt = pinSalt;
      delete user.pin;
      return { matched: true, upgradedFromPlaintext: true };
    }
  }
  return { matched: false, upgradedFromPlaintext: false };
}

export function generateSecureRandom4DigitPin(): string {
  for (;;) {
    const candidate = String(crypto.randomInt(1000, 10000));
    if (candidate !== "1234" && candidate !== "0423" && !/^(\d)\1+$/.test(candidate)) {
      return candidate;
    }
  }
}

export function extractDeviceIdFromHttp(req: Request, explicitDeviceId?: string): string {
  return String(
    explicitDeviceId ||
      req.body?.device_id ||
      req.body?.deviceId ||
      req.headers["x-device-id"] ||
      req.query?.deviceId ||
      req.query?.device_id ||
      ""
  ).trim();
}

export function extractBearerToken(req: Request): string {
  const authHeader = String(req.headers["authorization"] || "").trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  return "";
}

export function resolveRequestAuthContext(
  ctx: ServerContext,
  req: Request,
  explicitDeviceId?: string
): RequestAuthContext {
  const deviceId = extractDeviceIdFromHttp(req, explicitDeviceId);
  const deviceRecord: AuthorizedDevice | undefined = deviceId
    ? ctx.authorizedDevicesMap.get(deviceId)
    : undefined;
  const token = extractBearerToken(req);
  const tokenSess = token ? ctx.sessionTokensMap.get(token) : undefined;

  if (deviceRecord && (deviceRecord.status === "REVOKED" || deviceRecord.status === "PENDING")) {
    return {
      deviceId,
      deviceRecord,
      account: undefined,
      permission: "",
      employeeId: "",
      authenticated: false,
    };
  }

  let boundEmpId = "";
  if (deviceRecord && deviceRecord.status === "AUTHORIZED") {
    boundEmpId = String(
      deviceRecord.employeeId ||
        (deviceRecord.isPrimaryAdminDevice ? "JPMP-002" : "") ||
        tokenSess?.employeeId ||
        ""
    )
      .trim()
      .toUpperCase();
  } else if (tokenSess) {
    boundEmpId = String(tokenSess.employeeId || "").trim().toUpperCase();
  }

  const account = boundEmpId
    ? ctx.state.registeredUsers.find(
        (u: RegisteredAccount) => (u.employeeId || "").toUpperCase().trim() === boundEmpId
      )
    : undefined;

  let permission = "";
  let authenticated = false;
  if (account) {
    authenticated = true;
    permission =
      account.status === "INACTIVE"
        ? "VIEW_ONLY"
        : String(account.permission || "LIMITED_ACCESS").trim().toUpperCase();
  } else if (deviceRecord && deviceRecord.status === "AUTHORIZED") {
    authenticated = true;
    permission = deviceRecord.isPrimaryAdminDevice
      ? "FULL_ACCESS"
      : String(deviceRecord.permission || "LIMITED_ACCESS").trim().toUpperCase();
  } else if (tokenSess) {
    authenticated = true;
    permission = "LIMITED_ACCESS";
  }

  return {
    deviceId,
    deviceRecord,
    account,
    permission,
    employeeId: account?.employeeId || boundEmpId,
    authenticated,
  };
}

export function rejectIfDeviceRevokedHttp(
  ctx: ServerContext,
  req: Request,
  res: Response,
  explicitDeviceId?: string
): boolean {
  const devId = extractDeviceIdFromHttp(req, explicitDeviceId);
  if (isDeviceRevoked(ctx, devId)) {
    closeDeviceSockets(ctx, devId, "DEVICE_REVOKED");
    res.status(403).json({ error: "DEVICE_REVOKED" });
    return true;
  }
  return false;
}

export function ensureSuperAdminSeed(ctx: ServerContext, isFreshInstall: boolean): void {
  const idx = ctx.state.registeredUsers.findIndex(
    (u: RegisteredAccount) => (u.employeeId || "").toUpperCase().trim() === "JPMP-002"
  );
  if (idx === -1) {
    const seedUser: RegisteredAccount = {
      ...DEFAULT_SUPER_ADMIN,
      deviceId: ctx.primaryDeviceId,
      authorizedDevices: [ctx.primaryDeviceId],
    };
    if (isFreshInstall) {
      const initialPin = generateSecureRandom4DigitPin();
      const { pinHash, pinSalt } = hashPinScrypt(initialPin);
      seedUser.pinHash = pinHash;
      seedUser.pinSalt = pinSalt;
      seedUser.mustChangePin = true;
      ctx.oneTimeSetupPin = initialPin;
      logger.info(
        `[SECURITY SETUP] Generated one-time Super Admin (JPMP-002) initial PIN for fresh install. Must be changed on first login.`
      );
    }
    ctx.state.registeredUsers.unshift(seedUser);
  } else {
    const existing = ctx.state.registeredUsers[idx];
    const updated: RegisteredAccount = {
      ...existing,
      deviceId: existing.deviceId || ctx.primaryDeviceId,
      isPrimaryAdminDevice: true,
      authorizedDevices: Array.from(
        new Set([...(existing.authorizedDevices || []), ctx.primaryDeviceId])
      ),
    };
    const needsInitialPin =
      (!updated.pinHash && !updated.pin) ||
      (Boolean(updated.mustChangePin) && !updated.pinChangedAt && !ctx.oneTimeSetupPin);
    if (needsInitialPin) {
      const initialPin = generateSecureRandom4DigitPin();
      const { pinHash, pinSalt } = hashPinScrypt(initialPin);
      updated.pinHash = pinHash;
      updated.pinSalt = pinSalt;
      delete updated.pin;
      updated.mustChangePin = true;
      ctx.oneTimeSetupPin = initialPin;
      logger.info(
        `[SECURITY SETUP] Generated one-time Super Admin (JPMP-002) initial PIN requiring change on first login.`
      );
    }
    ctx.state.registeredUsers[idx] = updated;
  }
}

export function isAuthorizedSuperAdmin(
  ctx: ServerContext,
  req: Request,
  commitDatabaseFn: (ctx: ServerContext) => boolean
): boolean {
  const auth = resolveRequestAuthContext(ctx, req);
  if (auth.authenticated && auth.permission === "FULL_ACCESS") {
    return true;
  }

  const bodyPin = (
    req.body?.adminPin ||
    req.body?.pin ||
    req.headers["x-admin-pin"] ||
    req.headers["x-user-pin"] ||
    ""
  )
    .toString()
    .trim();

  if (!bodyPin) return false;

  const superAdmin = ctx.state.registeredUsers.find(
    (u: RegisteredAccount) => (u.employeeId || "").toUpperCase().trim() === "JPMP-002"
  );
  const pinCheck = verifyUserPin(superAdmin, bodyPin);
  if (pinCheck.upgradedFromPlaintext) {
    commitDatabaseFn(ctx);
  }
  return pinCheck.matched;
}
