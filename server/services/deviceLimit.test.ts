/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration & Unit Tests for Per-Operator Maximum Devices Limit & Unbind Flow
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import express from 'express';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocketServer } from 'ws';
import {
  DEFAULT_MAX_DEVICES,
  validateMaxDevices,
} from '../../shared/deviceLimit.ts';
import type { AuthorizedDevice, RegisteredAccount } from '../../shared/types.ts';
import type { ServerConfig } from '../config.ts';
import { registerAccountsRoutes } from '../routes/accounts.ts';
import { registerAdminRoutes } from '../routes/admin.ts';
import { checkpointAndClose, initSqliteStore, readDatabaseFromSqlite } from '../sqliteStore.ts';
import { hashPinScrypt } from './authService.ts';
import { applyDatabaseObject } from './backupService.ts';
import { createServerContext, type ServerContext } from './context.ts';

function createTestServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'juwei-device-limit-'));
  const sqlitePath = path.join(tempDir, 'central-database.sqlite');
  const config: ServerConfig = {
    port: 0,
    dataDir: tempDir,
    backupsDir: path.join(tempDir, 'backups'),
    configuredDataDirRaw: tempDir,
    configuredDataDir: tempDir,
    isDataDirConfigured: true,
    isInsideProjectSource: false,
    dataFileSqlite: sqlitePath,
    dataFileJson: path.join(tempDir, 'central-database.json'),
    dataFile: sqlitePath,
    githubRepo: 'owner/repo',
    publicServerUrl: 'http://localhost:0',
    publicServerSource: 'test',
    nodeEnv: 'test',
    isProduction: false,
    version: '1.0.0',
    getStorageFilePath: (filename: string) => path.join(tempDir, filename),
  };

  initSqliteStore(sqlitePath);

  const mockWss = {
    clients: new Set(),
  } as unknown as WebSocketServer;

  const ctx = createServerContext({
    serverInstanceId: 'test-device-limit',
    serverBootTime: new Date().toISOString(),
    config,
    wss: mockWss,
  });

  const adminPinCreds = hashPinScrypt('9876');
  const opPinCreds = hashPinScrypt('4567');

  const superAdmin: RegisteredAccount = {
    id: 'USR-JPMP-002',
    employeeId: 'JPMP-002',
    username: 'ALDRIN BANAWA',
    role: 'SUPER ADMINISTRATOR',
    permission: 'FULL_ACCESS',
    maxDevices: 2,
    pinHash: adminPinCreds.pinHash,
    pinSalt: adminPinCreds.pinSalt,
    status: 'ACTIVE',
    version: 1,
  };

  const operator: RegisteredAccount = {
    id: 'USR-JPMP-010',
    employeeId: 'JPMP-010',
    username: 'MARIA SANTOS',
    role: 'WAREHOUSE CLERK',
    permission: 'LIMITED_ACCESS',
    maxDevices: 2,
    pinHash: opPinCreds.pinHash,
    pinSalt: opPinCreds.pinSalt,
    status: 'ACTIVE',
    version: 1,
  };

  ctx.state.registeredUsers = [superAdmin, operator];

  const app = express();
  app.use(express.json());
  registerAccountsRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  return { ctx, app, tempDir, sqlitePath };
}

async function requestJson(
  app: express.Express,
  method: 'GET' | 'POST',
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const parsed = await res.json().catch(() => ({}));
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function addAuthorizedDevice(
  ctx: ServerContext,
  deviceId: string,
  deviceName: string,
  boundEmployeeId?: string
): AuthorizedDevice {
  const dev: AuthorizedDevice = {
    deviceId,
    deviceName,
    isPrimaryAdminDevice: false,
    status: 'AUTHORIZED',
    authorizedBy: 'JPMP-002',
    authorizedAt: new Date().toISOString(),
    ...(boundEmployeeId
      ? {
          boundEmployeeId,
          employeeId: boundEmployeeId,
          boundAt: new Date().toISOString(),
        }
      : {}),
  };
  ctx.authorizedDevicesMap.set(deviceId, dev);
  return dev;
}

describe('Maximum devices per-operator account limit & unbind flow', () => {
  let harness: ReturnType<typeof createTestServer>;
  const tempDirsToClean: string[] = [];

  beforeEach(() => {
    checkpointAndClose();
    harness = createTestServer();
    tempDirsToClean.push(harness.tempDir);
  });

  afterAll(() => {
    checkpointAndClose();
    for (const dir of tempDirsToClean) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures
      }
    }
  });

  it('defaults existing accounts without maxDevices to 2 and validates range 1..10', async () => {
    expect(validateMaxDevices(undefined, { defaultIfEmpty: true })).toEqual({
      valid: true,
      value: DEFAULT_MAX_DEVICES,
    });
    expect(validateMaxDevices(0, { defaultIfEmpty: false }).valid).toBe(false);
    expect(validateMaxDevices(11, { defaultIfEmpty: false }).valid).toBe(false);
    expect(validateMaxDevices(2.5, { defaultIfEmpty: false }).valid).toBe(false);
    expect(validateMaxDevices(10, { defaultIfEmpty: false })).toEqual({ valid: true, value: 10 });

    // Legacy user without maxDevices loaded into DB receives default 2
    applyDatabaseObject(harness.ctx, {
      registeredUsers: [
        {
          id: 'USR-JPMP-099',
          employeeId: 'JPMP-099',
          username: 'LEGACY OPERATOR',
          role: 'WAREHOUSE CLERK',
          permission: 'LIMITED_ACCESS',
          pinHash: 'dummy',
          pinSalt: 'salt',
          status: 'ACTIVE',
        },
      ],
    });
    const legacy = harness.ctx.state.registeredUsers.find((u) => u.employeeId === 'JPMP-099');
    expect(legacy?.maxDevices).toBe(2);

    // Reject registering account with out-of-range maxDevices
    const badRes = await requestJson(
      harness.app,
      'POST',
      '/api/accounts/register',
      {
        employeeId: 'JPMP-011',
        username: 'JUAN CRUZ',
        role: 'WAREHOUSE CLERK',
        permission: 'LIMITED_ACCESS',
        pin: '7391',
        maxDevices: 11,
      },
      { 'x-user-employee-id': 'JPMP-002', 'x-user-pin': '9876' }
    );
    expect(badRes.status).toBe(400);

    // Register with valid maxDevices=3 and confirm SQLite persistence + audit log
    const goodRes = await requestJson(
      harness.app,
      'POST',
      '/api/accounts/register',
      {
        employeeId: 'JPMP-011',
        username: 'JUAN CRUZ',
        role: 'WAREHOUSE CLERK',
        permission: 'LIMITED_ACCESS',
        pin: '7391',
        maxDevices: 3,
      },
      { 'x-user-employee-id': 'JPMP-002', 'x-user-pin': '9876' }
    );
    expect(goodRes.status).toBe(200);
    expect(goodRes.body.user.maxDevices).toBe(3);

    const persisted = readDatabaseFromSqlite();
    const persistedUser = persisted?.registeredUsers?.find((u: any) => u.employeeId === 'JPMP-011');
    expect(persistedUser?.maxDevices).toBe(3);

    const createAudit = harness.ctx.auditTrailLogs.find(
      (a) => a.action === 'CREATE' && a.recordId === 'JPMP-011'
    );
    expect(createAudit?.summary).toContain('Max Devices: 3');
  });

  it('Scenario 1: allows signing in on a new unbound authorized device when under the limit and binds it', async () => {
    addAuthorizedDevice(harness.ctx, 'DEV-PC-1', 'Receiving PC 1');

    const res = await requestJson(harness.app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-010',
      pin: '4567',
      deviceId: 'DEV-PC-1',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.maxDevices).toBe(2);

    const dev = harness.ctx.authorizedDevicesMap.get('DEV-PC-1');
    expect(dev?.boundEmployeeId).toBe('JPMP-010');

    const bindAudit = harness.ctx.auditTrailLogs.find(
      (a) => a.action === 'DEVICE_BOUND' && a.recordId === 'DEV-PC-1'
    );
    expect(bindAudit).toBeDefined();
    expect(bindAudit?.actorId).toBe('JPMP-010');
  });

  it('Scenario 2: blocks signing in on a new unbound authorized device at the limit without leaking PIN or other details', async () => {
    addAuthorizedDevice(harness.ctx, 'DEV-PC-1', 'Workstation 1', 'JPMP-010');
    addAuthorizedDevice(harness.ctx, 'DEV-PC-2', 'Workstation 2', 'JPMP-010');
    addAuthorizedDevice(harness.ctx, 'DEV-PC-3', 'Workstation 3'); // unbound

    // Existing bound device continues to succeed
    const existingSignIn = await requestJson(harness.app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-010',
      pin: '4567',
      deviceId: 'DEV-PC-1',
    });
    expect(existingSignIn.status).toBe(200);

    // New unbound 3rd device is refused at limit (2)
    const blockedSignIn = await requestJson(harness.app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-010',
      pin: '4567',
      deviceId: 'DEV-PC-3',
    });

    expect(blockedSignIn.status).toBe(403);
    expect(blockedSignIn.body.errorCode).toBe('DEVICE_LIMIT_REACHED');
    expect(blockedSignIn.body.error).toBe(
      'You have reached your device limit (2). Ask your Super Administrator to remove an old device or raise your limit.'
    );
    // Ensure zero sensitive leakage in error response
    const serialized = JSON.stringify(blockedSignIn.body);
    expect(serialized).not.toContain('4567');
    expect(serialized).not.toContain('pinHash');
    expect(serialized).not.toContain('pinSalt');
    expect(serialized).not.toContain('DEV-PC-1');
    expect(serialized).not.toContain('MARIA');

    // Device 3 remains unbound
    expect(harness.ctx.authorizedDevicesMap.get('DEV-PC-3')?.boundEmployeeId).toBeUndefined();
  });

  it('Scenario 3: unbinding a device by Super Admin frees a slot, logs audit, and lets a new device sign in', async () => {
    addAuthorizedDevice(harness.ctx, 'DEV-PC-1', 'Workstation 1', 'JPMP-010');
    addAuthorizedDevice(harness.ctx, 'DEV-PC-2', 'Workstation 2', 'JPMP-010');
    addAuthorizedDevice(harness.ctx, 'DEV-PC-3', 'Workstation 3');

    // Non-Super Admin cannot unbind
    const forbiddenUnbind = await requestJson(
      harness.app,
      'POST',
      '/api/devices/unbind',
      { deviceId: 'DEV-PC-1' },
      { 'x-user-employee-id': 'JPMP-010', 'x-user-pin': '4567' }
    );
    expect(forbiddenUnbind.status).toBe(403);

    // Super Admin unbinds DEV-PC-1
    const unbindRes = await requestJson(
      harness.app,
      'POST',
      '/api/devices/unbind',
      { deviceId: 'DEV-PC-1', author: 'ALDRIN BANAWA' },
      { 'x-user-employee-id': 'JPMP-002', 'x-user-pin': '9876' }
    );
    expect(unbindRes.status).toBe(200);
    expect(unbindRes.body.success).toBe(true);
    expect(unbindRes.body.previousEmployeeId).toBe('JPMP-010');
    expect(harness.ctx.authorizedDevicesMap.get('DEV-PC-1')?.boundEmployeeId).toBeUndefined();

    const unbindAudit = harness.ctx.auditTrailLogs.find(
      (a) => a.action === 'DEVICE_UNBOUND' && a.recordId === 'DEV-PC-1'
    );
    expect(unbindAudit).toBeDefined();
    expect(unbindAudit?.summary).toContain('JPMP-010');

    // New device DEV-PC-3 can now sign in using the freed slot
    const signInAfterUnbind = await requestJson(harness.app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-010',
      pin: '4567',
      deviceId: 'DEV-PC-3',
    });
    expect(signInAfterUnbind.status).toBe(200);
    expect(harness.ctx.authorizedDevicesMap.get('DEV-PC-3')?.boundEmployeeId).toBe('JPMP-010');
  });

  it('Scenario 4: exempts Super Administrator from maxDevices when signing in on a new device at the limit', async () => {
    // Super Admin has maxDevices=2 and already has 2 bound authorized devices
    addAuthorizedDevice(harness.ctx, 'DEV-SA-1', 'Admin PC 1', 'JPMP-002');
    addAuthorizedDevice(harness.ctx, 'DEV-SA-2', 'Admin Phone 2', 'JPMP-002');
    addAuthorizedDevice(harness.ctx, 'DEV-SA-3', 'Admin Tablet 3'); // unbound 3rd device

    const saSignIn = await requestJson(harness.app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-002',
      pin: '9876',
      deviceId: 'DEV-SA-3',
    });

    expect(saSignIn.status).toBe(200);
    expect(saSignIn.body.success).toBe(true);
    expect(harness.ctx.authorizedDevicesMap.get('DEV-SA-3')?.boundEmployeeId).toBe('JPMP-002');
  });

  it('keeps existing bound devices working when maxDevices is lowered below bound count, audits change, and blocks only new devices', async () => {
    addAuthorizedDevice(harness.ctx, 'DEV-PC-1', 'Workstation 1', 'JPMP-010');
    addAuthorizedDevice(harness.ctx, 'DEV-PC-2', 'Workstation 2', 'JPMP-010');
    addAuthorizedDevice(harness.ctx, 'DEV-PC-3', 'Workstation 3');

    // Lower maxDevices from 2 down to 1
    const updateRes = await requestJson(
      harness.app,
      'POST',
      '/api/accounts/update',
      {
        oldEmployeeId: 'JPMP-010',
        updatedUser: {
          employeeId: 'JPMP-010',
          username: 'MARIA SANTOS',
          role: 'WAREHOUSE CLERK',
          permission: 'LIMITED_ACCESS',
          maxDevices: 1,
        },
        author: 'ALDRIN BANAWA',
      },
      { 'x-user-employee-id': 'JPMP-002', 'x-user-pin': '9876' }
    );
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.user.maxDevices).toBe(1);

    // Audit entry recorded for maxDevices change
    const maxDevAudit = harness.ctx.auditTrailLogs.find(
      (a) => a.action === 'MAX_DEVICES_UPDATED' && a.recordId === 'JPMP-010'
    );
    expect(maxDevAudit).toBeDefined();
    expect(maxDevAudit?.details).toContain('Old maxDevices: 2');
    expect(maxDevAudit?.details).toContain('New maxDevices: 1');
    expect(maxDevAudit?.details).toContain('JPMP-002');

    // Both existing bound devices keep working
    expect(
      (
        await requestJson(harness.app, 'POST', '/api/accounts/verify', {
          identifier: 'JPMP-010',
          pin: '4567',
          deviceId: 'DEV-PC-1',
        })
      ).status
    ).toBe(200);
    expect(
      (
        await requestJson(harness.app, 'POST', '/api/accounts/verify', {
          identifier: 'JPMP-010',
          pin: '4567',
          deviceId: 'DEV-PC-2',
        })
      ).status
    ).toBe(200);

    // New device is blocked (count 2 >= limit 1)
    const blocked1 = await requestJson(harness.app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-010',
      pin: '4567',
      deviceId: 'DEV-PC-3',
    });
    expect(blocked1.status).toBe(403);
    expect(blocked1.body.error).toBe(
      'You have reached your device limit (1). Ask your Super Administrator to remove an old device or raise your limit.'
    );

    // Unbind 1 device -> bound count drops from 2 to 1 (still at limit 1), so 3rd device still blocked
    await requestJson(
      harness.app,
      'POST',
      '/api/devices/unbind',
      { deviceId: 'DEV-PC-1' },
      { 'x-user-employee-id': 'JPMP-002', 'x-user-pin': '9876' }
    );
    const stillAtLimit = await requestJson(harness.app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-010',
      pin: '4567',
      deviceId: 'DEV-PC-3',
    });
    expect(stillAtLimit.status).toBe(403);

    // Unbind 2nd device -> bound count drops to 0 (< 1), so new device succeeds
    await requestJson(
      harness.app,
      'POST',
      '/api/devices/unbind',
      { deviceId: 'DEV-PC-2' },
      { 'x-user-employee-id': 'JPMP-002', 'x-user-pin': '9876' }
    );
    const nowAllowed = await requestJson(harness.app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-010',
      pin: '4567',
      deviceId: 'DEV-PC-3',
    });
    expect(nowAllowed.status).toBe(200);
  });
});
