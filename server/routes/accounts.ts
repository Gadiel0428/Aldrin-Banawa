/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Operator Accounts, Setup PIN & Scrypt Authentication Routes
 */

import crypto from "crypto";
import type { Express, Request, Response } from "express";
import type { RegisteredAccount } from "../../shared/types.ts";
import logger from "../../src/lib/logger.ts";
import {
  mapAccountFromApi,
  mapAccountToApi,
  mapRequestMetaFromApi,
  mapUpdateAccountInputFromApi,
  mapUpdatePinInputFromApi,
  mapVerifyCredentialsInputFromApi,
  mapVerifyCredentialsResponseToApi,
} from "../api/mapper.ts";
import type { ServerContext } from "../services/context.ts";
import {
  describeRecordDiff,
  logPinAudit,
  recordAuditTrail,
} from "../services/auditService.ts";
import {
  ensureSuperAdminSeed,
  extractDeviceIdFromHttp,
  hashPinScrypt,
  isAuthorizedSuperAdmin,
  markUserTombstone,
  rejectIfDeviceRevokedHttp,
  resolveRequestAuthContext,
  unmarkUserTombstone,
  verifyUserPin,
} from "../services/authService.ts";
import { resolveEffectiveMaxDevices, validateMaxDevices } from "../../shared/deviceLimit.ts";
import { commitDatabase } from "../services/backupService.ts";
import {
  evaluateSignInDeviceBinding,
  recordMaxDevicesChangeAudit,
} from "../services/deviceLimitService.ts";
import { broadcast, sanitizeUserForClient } from "../services/realtimeService.ts";

export function registerAccountsRoutes(app: Express, ctx: ServerContext): void {
  // REST API: One-time initial random PIN display on fresh install
  app.get("/api/setup/initial-pin", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    const superAdmin = ctx.state.registeredUsers.find(
      (u: RegisteredAccount) => (u.employeeId || "").toUpperCase().trim() === "JPMP-002"
    );
    if (ctx.oneTimeSetupPin && superAdmin?.mustChangePin && !superAdmin?.pinChangedAt) {
      return res.json({
        hasInitialPin: true,
        employeeId: "JPMP-002",
        initialPin: ctx.oneTimeSetupPin,
        mustChangePin: true,
      });
    }
    ctx.oneTimeSetupPin = null;
    return res.json({
      hasInitialPin: false,
      initialPin: null,
      mustChangePin: Boolean(superAdmin?.mustChangePin),
    });
  });

  // REST API: Operator Accounts List
  app.get("/api/accounts", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      ensureSuperAdminSeed(ctx, false);

      const safeAccounts = ctx.state.registeredUsers.map(mapAccountToApi);
      return res.json({
        success: true,
        count: safeAccounts.length,
        accounts: safeAccounts,
        revision: ctx.stateRevision,
        systemResetVersion: ctx.systemResetVersion,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Verify Operator Credentials & PIN
  app.post("/api/accounts/verify", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;

      const { identifier: rawInput, pin: enteredPin, deviceId: reqDevId } =
        mapVerifyCredentialsInputFromApi(req);

      if (!rawInput || !enteredPin) {
        return res
          .status(400)
          .json({ success: false, error: "Operator Identifier and PIN code are required." });
      }

      let searchId = rawInput.toUpperCase();
      if (!searchId.startsWith("JPMP-")) {
        searchId = "JPMP-" + searchId.replace(/^EMP-/, "");
      }
      const inputPhone = rawInput.replace(/\D/g, "");

      let matchedUser: RegisteredAccount | undefined;
      let upgradedLegacyPin = false;
      for (const u of ctx.state.registeredUsers) {
        if (u.status === "INACTIVE") continue;
        const uEmpId = (u.employeeId || "").toUpperCase().trim();
        const uUsername = (u.username || "").toUpperCase().trim();
        const uPhone = (u.phoneNumber || "").replace(/\D/g, "");
        const idMatches =
          uEmpId === searchId ||
          uEmpId === rawInput.toUpperCase() ||
          uUsername === rawInput.toUpperCase() ||
          (inputPhone.length >= 10 && uPhone === inputPhone);
        if (!idMatches) continue;
        const check = verifyUserPin(u, enteredPin);
        if (check.matched) {
          matchedUser = u;
          upgradedLegacyPin = check.upgradedFromPlaintext;
          break;
        }
      }

      if (matchedUser) {
        const deviceBindingCheck = evaluateSignInDeviceBinding(ctx, matchedUser, reqDevId);
        if (!deviceBindingCheck.allowed) {
          return res.status(deviceBindingCheck.status || 403).json({
            success: false,
            errorCode: deviceBindingCheck.errorCode,
            error: deviceBindingCheck.error,
          });
        }

        matchedUser.lastActive = new Date().toISOString();
        if (enteredPin === "1234") {
          matchedUser.isPinCompromised = true;
        }

        const sessionToken = crypto.randomBytes(32).toString("hex");
        ctx.sessionTokensMap.set(sessionToken, {
          employeeId: matchedUser.employeeId,
          ...(reqDevId ? { deviceId: reqDevId } : {}),
          createdAt: Date.now(),
        });

        if (reqDevId) {
          for (const conn of ctx.connectionRegistry.values()) {
            if (conn.device_id === reqDevId || conn.deviceId === reqDevId) {
              conn.employeeId = matchedUser.employeeId;
              conn.username = matchedUser.username;
              conn.role = matchedUser.role;
              conn.permission =
                matchedUser.status === "INACTIVE" ? "VIEW_ONLY" : matchedUser.permission;
            }
          }
        }

        commitDatabase(ctx);
        if (upgradedLegacyPin) {
          logger.info(
            `[SECURITY] Upgraded legacy plain-text PIN to scrypt hash for operator ${matchedUser.employeeId}.`
          );
        }

        return res.json(
          mapVerifyCredentialsResponseToApi({
            sessionToken,
            user: matchedUser,
            mustChangePin: Boolean(matchedUser.mustChangePin),
            isPinCompromised: enteredPin === "1234" || !!matchedUser.isPinCompromised,
            systemResetVersion: ctx.systemResetVersion,
          })
        );
      }

      console.warn(
        `[AUTH-AUDIT] FAILED LOGIN ATTEMPT: Identifier="${rawInput}", IP=${req.ip}, Timestamp=${new Date().toISOString()}`
      );

      return res.status(401).json({
        success: false,
        error: "AUTHENTICATION_FAILED: Invalid Operator ID or PIN code.",
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Update Account PIN
  app.post("/api/accounts/update-pin", async (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;

      const {
        employeeId: cleanEmpId,
        currentPin: cleanCurrentPin,
        newPin: cleanNewPin,
        requesterEmployeeId: requesterId,
        author,
        reason,
      } = mapUpdatePinInputFromApi(req.body);

      if (!cleanEmpId || !cleanNewPin) {
        return res.status(400).json({ error: "Operator ID and new PIN are required" });
      }
      if (!/^\d{4,6}$/.test(cleanNewPin)) {
        return res.status(400).json({ error: "PIN must be between 4 and 6 numeric digits" });
      }

      if (cleanNewPin === "1234") {
        return res.status(400).json({
          error: "SECURITY_REJECTED: '1234' is a compromised default PIN and is strictly prohibited.",
        });
      }
      if (/^(\d)\1+$/.test(cleanNewPin)) {
        return res.status(400).json({
          error: "SECURITY_REJECTED: Repetitive PIN patterns (e.g. 0000, 1111) are not allowed.",
        });
      }

      const target = ctx.state.registeredUsers.find(
        (u: RegisteredAccount) => u.employeeId.toUpperCase().trim() === cleanEmpId
      );
      if (!target) {
        return res.status(404).json({ error: "Operator account not found in central database" });
      }

      const isSuper = isAuthorizedSuperAdmin(ctx, req, commitDatabase);
      if (!isSuper) {
        const currentCheck = verifyUserPin(target, cleanCurrentPin);
        if (!currentCheck.matched) {
          console.warn(
            `[SECURITY ALERT] Unauthorized PIN change attempt for ${cleanEmpId} from IP ${req.ip}`
          );
          return res.status(403).json({
            error: "INCORRECT_PIN: Current PIN does not match. Super Admin authorization required.",
          });
        }
      }

      const previousWasCompromised = target.pin === "1234" || !!target.isPinCompromised;
      const actionType = previousWasCompromised
        ? "COMPROMISED_PIN_RESOLVED"
        : isSuper
          ? "PIN_RESET"
          : "PIN_CHANGED";

      const { pinHash, pinSalt } = hashPinScrypt(cleanNewPin);
      target.pinHash = pinHash;
      target.pinSalt = pinSalt;
      delete target.pin;
      delete (target as any).pin_hash;
      target.mustChangePin = false;
      target.isPinCompromised = false;
      target.pinChangedAt = new Date().toISOString();
      target.pinChangedBy = requesterId;
      if (cleanEmpId === "JPMP-002") {
        ctx.oneTimeSetupPin = null;
      }
      target.version = (target.version || 1) + 1;
      target.updated_at = new Date().toISOString();
      target.reset_version = ctx.systemResetVersion;

      ctx.stateRevision++;
      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to persist PIN change to central database" });
      }

      logPinAudit(
        ctx,
        actionType,
        cleanEmpId,
        target.username,
        author || (isSuper ? "Super Administrator (ALDRIN BANAWA)" : target.username),
        requesterId,
        reason || (previousWasCompromised ? "Resolving compromised default PIN" : "Explicit PIN update"),
        previousWasCompromised,
        req.ip
      );

      recordAuditTrail(ctx, {
        actor: author || (isSuper ? "ALDRIN BANAWA" : target.username),
        actorId: requesterId,
        action: actionType,
        recordType: "registeredUsers",
        recordId: cleanEmpId,
        summary: `${actionType} for ${target.username} (${cleanEmpId})`,
        details: reason || undefined,
        deviceId: extractDeviceIdFromHttp(req) || undefined,
      });

      const safeTarget = mapAccountToApi(target);

      broadcast(ctx, {
        type: "account_updated",
        account: safeTarget,
        user: safeTarget,
        author: author || requesterId,
        systemResetVersion: ctx.systemResetVersion,
      });

      broadcast(ctx, {
        type: "collection_updated",
        collection: "registeredUsers",
        data: ctx.state.registeredUsers,
        systemResetVersion: ctx.systemResetVersion,
      });

      return res.json({
        success: true,
        message: previousWasCompromised
          ? "Compromised PIN resolved and secure PIN activated in central database"
          : "PIN updated successfully in central database",
        user: safeTarget,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Get PIN Audit Logs
  app.get("/api/accounts/pin-audit-log", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
    return res.json({
      success: true,
      count: ctx.pinAuditLogs.length,
      logs: ctx.pinAuditLogs,
    });
  });

  // REST API: Register New Operator Account
  app.post("/api/accounts/register", async (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res
          .status(403)
          .json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }

      const mappedAccountInput = mapAccountFromApi(req.body);
      const { employeeId: cleanEmpId, username, role, phoneNumber, permission, registeredBy } =
        mappedAccountInput;
      const cleanUsername = String(username || "").trim().toUpperCase();
      const cleanPin = String(req.body?.pin || "").trim();

      if (!cleanEmpId || !cleanUsername || !cleanPin) {
        return res
          .status(400)
          .json({ error: "Employee ID, Full Name, and PIN code are required." });
      }
      if (!/^\d{4,6}$/.test(cleanPin)) {
        return res.status(400).json({ error: "PIN must be between 4 and 6 numeric digits." });
      }
      if (cleanPin === "1234" || /^(\d)\1+$/.test(cleanPin)) {
        return res.status(400).json({
          error:
            "SECURITY_REJECTED: Compromise/trivial PINs ('1234', repetitive digits) are not allowed.",
        });
      }

      const exists = ctx.state.registeredUsers.some(
        (u: RegisteredAccount) => u.employeeId.toUpperCase().trim() === cleanEmpId
      );
      if (exists) {
        return res
          .status(409)
          .json({ error: `Account with ID ${cleanEmpId} already exists in the central database.` });
      }

      const rawMaxDevices = req.body?.maxDevices ?? req.body?.max_devices;
      const maxDevCheck = validateMaxDevices(rawMaxDevices, { defaultIfEmpty: true });
      if (!maxDevCheck.valid) {
        return res.status(400).json({ error: maxDevCheck.error });
      }

      unmarkUserTombstone(ctx, cleanEmpId);

      const { pinHash, pinSalt } = hashPinScrypt(cleanPin);

      const newUser: RegisteredAccount = mapAccountFromApi({
        ...mappedAccountInput,
        id: `USR-${cleanEmpId}`,
        employeeId: cleanEmpId,
        username: cleanUsername,
        role: String(role || "WAREHOUSE CLERK").trim().toUpperCase(),
        phoneNumber: phoneNumber ? String(phoneNumber).trim() : "",
        permission: String(permission || "LIMITED_ACCESS").trim(),
        maxDevices: maxDevCheck.value,
        pinHash,
        pinSalt,
        status: "ACTIVE",
        registeredBy: registeredBy || "JPMP-002 (ALDRIN BANAWA)",
        registeredBySuperAdmin: true,
        registeredAt: new Date().toISOString(),
        version: 1,
        updated_at: new Date().toISOString(),
        reset_version: ctx.systemResetVersion,
      });

      ctx.state.registeredUsers.push(newUser);
      ctx.stateRevision++;

      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to commit new account to central database" });
      }

      const authCtx = resolveRequestAuthContext(ctx, req);
      recordAuditTrail(ctx, {
        actor: authCtx.account?.username || registeredBy || "Super Administrator",
        actorId: authCtx.employeeId || "JPMP-002",
        action: "CREATE",
        recordType: "registeredUsers",
        recordId: cleanEmpId,
        summary: `Registered account ${cleanUsername} (${cleanEmpId}) — Role: ${newUser.role}, Permission: ${newUser.permission}, Max Devices: ${newUser.maxDevices}`,
        details: `Account: ${cleanUsername} (${cleanEmpId}) | maxDevices: ${newUser.maxDevices}`,
        deviceId: authCtx.deviceId || undefined,
      });

      const safeUser = mapAccountToApi(newUser);

      broadcast(ctx, {
        type: "account_registered",
        user: safeUser,
        author: registeredBy || "Super Administrator",
        systemResetVersion: ctx.systemResetVersion,
      });

      broadcast(ctx, {
        type: "account_created",
        account: safeUser,
        user: safeUser,
        systemResetVersion: ctx.systemResetVersion,
      });

      broadcast(ctx, {
        type: "collection_updated",
        collection: "registeredUsers",
        data: ctx.state.registeredUsers,
        systemResetVersion: ctx.systemResetVersion,
      });

      return res.json({
        success: true,
        user: safeUser,
        systemResetVersion: ctx.systemResetVersion,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Update Operator Account
  app.post("/api/accounts/update", async (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res
          .status(403)
          .json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }

      const { oldEmployeeId: cleanOldId, updatedUser } = mapUpdateAccountInputFromApi(req.body);

      if (!cleanOldId || !updatedUser) {
        return res
          .status(400)
          .json({ error: "Old Employee ID and updated account data required" });
      }

      const index = ctx.state.registeredUsers.findIndex(
        (u: RegisteredAccount) => u.employeeId.toUpperCase().trim() === cleanOldId
      );
      if (index === -1) {
        return res.status(404).json({ error: "Account not found in central database" });
      }

      const existing = ctx.state.registeredUsers[index];
      const isSuper = cleanOldId === "JPMP-002";

      const cleanNewId = String(updatedUser.employeeId || cleanOldId).trim().toUpperCase();
      if (cleanNewId !== cleanOldId) {
        if (isSuper) {
          return res
            .status(403)
            .json({ error: "Super Administrator Employee ID cannot be altered." });
        }
        const duplicate = ctx.state.registeredUsers.some(
          (u: RegisteredAccount, idx: number) =>
            idx !== index && u.employeeId.toUpperCase().trim() === cleanNewId
        );
        if (duplicate) {
          return res
            .status(409)
            .json({ error: `Employee ID ${cleanNewId} is already taken by another account.` });
        }
      }

      const oldMaxDevices = resolveEffectiveMaxDevices(existing);
      const rawUpdatedMaxDevices =
        req.body?.updatedUser?.maxDevices ??
        req.body?.updatedUser?.max_devices ??
        req.body?.maxDevices ??
        req.body?.max_devices;
      const hasMaxDevicesField =
        rawUpdatedMaxDevices !== undefined &&
        rawUpdatedMaxDevices !== null &&
        String(rawUpdatedMaxDevices).trim() !== "";
      let nextMaxDevices = oldMaxDevices;
      if (hasMaxDevicesField) {
        const maxDevCheck = validateMaxDevices(rawUpdatedMaxDevices, { defaultIfEmpty: false });
        if (!maxDevCheck.valid) {
          return res.status(400).json({ error: maxDevCheck.error });
        }
        nextMaxDevices = maxDevCheck.value;
      }

      const mergedUser: RegisteredAccount = {
        ...existing,
        ...updatedUser,
        employeeId: isSuper ? "JPMP-002" : cleanNewId,
        username: String(updatedUser.username || existing.username).trim().toUpperCase(),
        role: isSuper
          ? "SUPER ADMINISTRATOR"
          : String(updatedUser.role || existing.role).trim().toUpperCase(),
        permission: isSuper
          ? "FULL_ACCESS"
          : String(updatedUser.permission || existing.permission).trim(),
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

      ctx.state.registeredUsers[index] = mergedUser;
      ctx.stateRevision++;

      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res.status(500).json({ error: "Failed to persist account update to central database" });
      }

      const verifiedSuperAdmin = isAuthorizedSuperAdmin(ctx, req, commitDatabase);
      const actorName =
        auth.account?.username ||
        req.body.author ||
        (verifiedSuperAdmin ? "ALDRIN BANAWA" : "Admin");
      const actorEmployeeId =
        auth.employeeId || (verifiedSuperAdmin ? "JPMP-002" : "ADMIN");

      const accountDiff = describeRecordDiff(existing, mergedUser);
      recordAuditTrail(ctx, {
        actor: actorName,
        actorId: actorEmployeeId,
        action: "UPDATE",
        recordType: "registeredUsers",
        recordId: mergedUser.employeeId,
        summary: `Updated account ${mergedUser.username} (${mergedUser.employeeId})${accountDiff ? ` — ${accountDiff}` : ""}`,
        deviceId: auth.deviceId || undefined,
      });

      if (oldMaxDevices !== nextMaxDevices) {
        recordMaxDevicesChangeAudit(ctx, {
          actorName,
          actorEmployeeId,
          targetAccount: mergedUser,
          oldMaxDevices,
          newMaxDevices: nextMaxDevices,
          deviceId: auth.deviceId || undefined,
          timestamp: mergedUser.updated_at,
        });
      }

      const safeUser = mapAccountToApi(mergedUser);

      broadcast(ctx, {
        type: "account_updated",
        account: safeUser,
        user: safeUser,
        author: req.body.author || "Admin",
        systemResetVersion: ctx.systemResetVersion,
      });

      broadcast(ctx, {
        type: "collection_updated",
        collection: "registeredUsers",
        data: ctx.state.registeredUsers,
        systemResetVersion: ctx.systemResetVersion,
      });

      return res.json({
        success: true,
        user: safeUser,
        systemResetVersion: ctx.systemResetVersion,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Delete Operator Account
  app.post("/api/accounts/delete", async (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;
      const auth = resolveRequestAuthContext(ctx, req);
      if (auth.permission === "VIEW_ONLY") {
        return res
          .status(403)
          .json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges." });
      }

      const meta = mapRequestMetaFromApi(req);
      const cleanId = String(meta.employeeId || "").trim().toUpperCase();

      if (!cleanId) return res.status(400).json({ error: "Employee ID is required" });
      if (cleanId === "JPMP-002") {
        return res
          .status(403)
          .json({ error: "PROTECTED_ACCOUNT: Super Administrator JPMP-002 cannot be deleted." });
      }

      const deletedAcc = ctx.state.registeredUsers.find(
        (u: RegisteredAccount) => u.employeeId.toUpperCase().trim() === cleanId
      );
      markUserTombstone(ctx, cleanId);
      ctx.state.registeredUsers = ctx.state.registeredUsers.filter(
        (u: RegisteredAccount) => u.employeeId.toUpperCase().trim() !== cleanId
      );
      ctx.stateRevision++;

      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res
          .status(500)
          .json({ error: "Failed to commit account deletion to central database" });
      }

      recordAuditTrail(ctx, {
        actor: auth.account?.username || meta.author || "Admin",
        actorId: auth.employeeId || "ADMIN",
        action: "DELETE",
        recordType: "registeredUsers",
        recordId: cleanId,
        summary: `Deleted account ${deletedAcc?.username || cleanId} (${cleanId})`,
        deviceId: auth.deviceId || undefined,
      });

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

      return res.json({
        success: true,
        employeeId: cleanId,
        systemResetVersion: ctx.systemResetVersion,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: Clear All Accounts Except Super Admin
  app.post("/api/accounts/clear-all-except-super-admin", async (req: Request, res: Response) => {
    try {
      if (rejectIfDeviceRevokedHttp(ctx, req, res)) return;

      if (!isAuthorizedSuperAdmin(ctx, req, commitDatabase)) {
        return res.status(403).json({
          error: "PERMISSION_DENIED: Only Super Administrator is authorized to clear accounts.",
        });
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

      const commitOk = commitDatabase(ctx);
      if (!commitOk) {
        return res
          .status(500)
          .json({ error: "Failed to commit accounts purge to central database" });
      }

      const authCtx = resolveRequestAuthContext(ctx, req);
      recordAuditTrail(ctx, {
        actor: authCtx.account?.username || req.body?.author || "Super Administrator",
        actorId: authCtx.employeeId || "JPMP-002",
        action: "PURGE",
        recordType: "registeredUsers",
        recordId: "ALL_NON_ADMIN",
        summary: "Cleared all operator accounts except Super Administrator (JPMP-002)",
        deviceId: authCtx.deviceId || undefined,
      });

      const safeAccounts = ctx.state.registeredUsers.map(mapAccountToApi);

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

      return res.json({ success: true, count: safeAccounts.length, accounts: safeAccounts });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });
}
