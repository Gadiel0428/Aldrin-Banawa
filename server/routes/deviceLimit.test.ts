/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration tests for per-operator maximum device limits, device binding/unbinding,
 * Super Admin exemption, limit reduction behavior, and audit logging.
 */

import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocketServer } from 'ws';
import type { ServerConfig } from '../config.ts';
import { hashPinScrypt } from '../services/authService.ts';
import { createServerContext, type ServerContext } from '../services/context.ts';
import { checkpointAndClose, initSqliteStore } from '../sqliteStore.ts';
import { registerAccountsRoutes } from './accounts.ts';
import { registerAdminRoutes } from './admin.ts';
import { countBoundDevicesForOperator } from '../../shared/validation.ts';

interface HttpJsonResult {
  status: number;
  body: any;
}

const tempDirs: string[] = [];

function createTestEnv(): {
  ctx: ServerContext;
  app: express.Express;
  superAdminToken: string;
  superAdminPin: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'juwei-device-limit-'));
  tempDirs.push(tempDir);

  const sqlitePath = path.join(tempDir, 'central-database.sqlite');
  const config: ServerConfig = {
    port: 3000,
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
    publicServerUrl: 'http://localhost:3000',
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
    serverBootTime: '2026-11-26T00:00:00.000Z',
    config,
    wss: mockWss,
  });

  const superAdminPin = '7391';
  const superHashed = hashPinScrypt(superAdminPin);
  ctx.state.registeredUsers = [
    {
      id: 'USR-JPMP-002',
      employeeId: 'JPMP-002',
      username: 'ALDRIN BANAWA',
      role: 'SYSTEM ADMINISTRATOR',
      permission: 'FULL_ACCESS',
      status: 'ACTIVE',
      maxDevices: 2,
      pinHash: superHashed.pinHash,
      pinSalt: superHashed.pinSalt,
      mustChangePin: false,
    },
  ];

  const opHashed = hashPinScrypt('4829');
  ctx.state.registeredUsers.push({
    id: 'USR-JPMP-101',
    employeeId: 'JPMP-101',
    username: 'MARIA SANTOS',
    role: 'WAREHOUSE CLERK',
    permission: 'LIMITED_ACCESS',
    status: 'ACTIVE',
    maxDevices: 2,
    pinHash: opHashed.pinHash,
    pinSalt: opHashed.pinSalt,
    mustChangePin: false,
  });

  ctx.primaryDeviceId = 'PRIMARY-PC';
  ctx.authorizedDevicesMap.set('PRIMARY-PC', {
    deviceId: 'PRIMARY-PC',
    deviceName: 'Primary Super Admin PC',
    isPrimaryAdminDevice: true,
    status: 'AUTHORIZED',
    boundEmployeeId: 'JPMP-002',
    employeeId: 'JPMP-002',
    username: 'ALDRIN BANAWA',
    boundAt: '2026-11-26T00:00:00.000Z',
  });

  const registerAuthorizedDevice = (deviceId: string, deviceName: string) => {
    ctx.authorizedDevicesMap.set(deviceId, {
      deviceId,
      deviceName,
      isPrimaryAdminDevice: false,
      status: 'AUTHORIZED',
      authorizedBy: 'JPMP-002',
      authorizedAt: '2026-11-26T00:00:00.000Z',
    });
  };

  registerAuthorizedDevice('DEV-PC-1', 'Receiving Workstation 1');
  registerAuthorizedDevice('DEV-PC-2', 'Issuance Workstation 2');
  registerAuthorizedDevice('DEV-PHONE-3', 'Warehouse Scanner Phone 3');
  registerAuthorizedDevice('DEV-TAB-4', 'Forklift Tablet 4');
  registerAuthorizedDevice('SA-LAPTOP-2', 'Super Admin Laptop');
  registerAuthorizedDevice('SA-PHONE-3', 'Super Admin Mobile');

  const superAdminToken = 'test-super-admin-token';
  ctx.sessionTokensMap.set(superAdminToken, {
    employeeId: 'JPMP-002',
    deviceId: 'PRIMARY-PC',
    createdAt: Date.now(),
  });

  const app = express();
  app.use(express.json());
  registerAccountsRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  return { ctx, app, superAdminToken, superAdminPin };
}

async function requestJson(
  app: express.Express,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<HttpJsonResult> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const parsed = await res.json().catch(() => ({}));
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(() => {
  checkpointAndClose();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Per-operator maximum devices enforcement', () => {
  it('1) allows sign-in and binds a new AUTHORIZED device under the limit', async () => {
    const { ctx, app } = createTestEnv();

    const signIn1 = await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PC-1',
    });

    expect(signIn1.status).toBe(200);
    expect(signIn1.body.success).toBe(true);
    expect(signIn1.body.user.maxDevices).toBe(2);

    const boundDevice = ctx.authorizedDevicesMap.get('DEV-PC-1');
    expect(boundDevice?.boundEmployeeId).toBe('JPMP-101');
    expect(countBoundDevicesForOperator(ctx.authorizedDevicesMap.values(), 'JPMP-101')).toBe(1);

    const bindAudit = ctx.auditTrailLogs.find(
      (entry) => entry.action === 'DEVICE_BIND' && entry.recordId === 'DEV-PC-1'
    );
    expect(bindAudit).toBeDefined();

    // Signing in again on the already-bound device succeeds without consuming another slot
    const repeatSignIn = await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PC-1',
    });
    expect(repeatSignIn.status).toBe(200);
    expect(countBoundDevicesForOperator(ctx.authorizedDevicesMap.values(), 'JPMP-101')).toBe(1);

    // Signing in on a second unbound AUTHORIZED device consumes slot 2 of 2
    const signIn2 = await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PC-2',
    });
    expect(signIn2.status).toBe(200);
    expect(countBoundDevicesForOperator(ctx.authorizedDevicesMap.values(), 'JPMP-101')).toBe(2);
  });

  it('2) refuses a new device at the limit without leaking PIN or account details', async () => {
    const { ctx, app } = createTestEnv();

    await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PC-1',
    });
    await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PC-2',
    });
    expect(countBoundDevicesForOperator(ctx.authorizedDevicesMap.values(), 'JPMP-101')).toBe(2);

    const blockedSignIn = await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PHONE-3',
    });

    expect(blockedSignIn.status).toBe(403);
    expect(blockedSignIn.body.success).toBe(false);
    expect(blockedSignIn.body.error).toBe(
      'You have reached your device limit (2). Ask your Super Administrator to remove an old device or raise your limit.'
    );
    expect(JSON.stringify(blockedSignIn.body)).not.toContain('4829');
    expect(JSON.stringify(blockedSignIn.body)).not.toContain('MARIA SANTOS');
    expect(ctx.authorizedDevicesMap.get('DEV-PHONE-3')?.boundEmployeeId).toBeUndefined();
  });

  it('3) unbinding a device by Super Admin frees a slot and records an audit entry', async () => {
    const { ctx, app, superAdminToken } = createTestEnv();

    await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PC-1',
    });
    await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PC-2',
    });

    // Non-Super Admin cannot unbind
    const opToken = Array.from(ctx.sessionTokensMap.entries()).find(
      ([, v]) => v.employeeId === 'JPMP-101'
    )?.[0];
    const unauthorizedUnbind = await requestJson(
      app,
      'POST',
      '/api/devices/unbind',
      { targetDeviceId: 'DEV-PC-1' },
      { Authorization: `Bearer ${opToken}`, 'x-device-id': 'DEV-PC-1' }
    );
    expect(unauthorizedUnbind.status).toBe(403);

    // Super Admin unbinds DEV-PC-1
    const unbindRes = await requestJson(
      app,
      'POST',
      '/api/devices/unbind',
      { targetDeviceId: 'DEV-PC-1' },
      { Authorization: `Bearer ${superAdminToken}`, 'x-device-id': 'PRIMARY-PC' }
    );
    expect(unbindRes.status).toBe(200);
    expect(unbindRes.body.success).toBe(true);
    expect(ctx.authorizedDevicesMap.get('DEV-PC-1')?.status).toBe('AUTHORIZED');
    expect(ctx.authorizedDevicesMap.get('DEV-PC-1')?.boundEmployeeId).toBeUndefined();
    expect(countBoundDevicesForOperator(ctx.authorizedDevicesMap.values(), 'JPMP-101')).toBe(1);

    const unbindAudit = ctx.auditTrailLogs.find(
      (entry) => entry.action === 'DEVICE_UNBIND' && entry.recordId === 'DEV-PC-1'
    );
    expect(unbindAudit).toBeDefined();

    // Operator can now bind the new 3rd device into the freed slot
    const retrySignIn = await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PHONE-3',
    });
    expect(retrySignIn.status).toBe(200);
    expect(ctx.authorizedDevicesMap.get('DEV-PHONE-3')?.boundEmployeeId).toBe('JPMP-101');
    expect(countBoundDevicesForOperator(ctx.authorizedDevicesMap.values(), 'JPMP-101')).toBe(2);
  });

  it('4) exempts Super Administrator from the device limit when signing in on a new device at the limit', async () => {
    const { ctx, app, superAdminPin } = createTestEnv();

    // PRIMARY-PC is already bound to JPMP-002; bind SA-LAPTOP-2 to reach maxDevices=2
    const saSignIn2 = await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-002',
      pin: superAdminPin,
      deviceId: 'SA-LAPTOP-2',
    });
    expect(saSignIn2.status).toBe(200);
    expect(countBoundDevicesForOperator(ctx.authorizedDevicesMap.values(), 'JPMP-002')).toBe(2);

    // Super Admin signs in on a 3rd new device while already at limit (2 of 2) -> allowed
    const saSignIn3 = await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-002',
      pin: superAdminPin,
      deviceId: 'SA-PHONE-3',
    });
    expect(saSignIn3.status).toBe(200);
    expect(saSignIn3.body.success).toBe(true);
    expect(ctx.authorizedDevicesMap.get('SA-PHONE-3')?.boundEmployeeId).toBe('JPMP-002');
    expect(countBoundDevicesForOperator(ctx.authorizedDevicesMap.values(), 'JPMP-002')).toBe(3);
  });

  it('5) lowering maxDevices keeps existing devices working, blocks only new devices, validates 1..10, and audits changes', async () => {
    const { ctx, app, superAdminToken } = createTestEnv();

    await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PC-1',
    });
    await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PC-2',
    });

    // Reject out-of-range maxDevices updates
    const invalidLow = await requestJson(
      app,
      'POST',
      '/api/accounts/update',
      { oldEmpId: 'JPMP-101', updated: { employeeId: 'JPMP-101', username: 'MARIA SANTOS', maxDevices: 0 } },
      { Authorization: `Bearer ${superAdminToken}`, 'x-device-id': 'PRIMARY-PC' }
    );
    expect(invalidLow.status).toBe(400);

    const invalidHigh = await requestJson(
      app,
      'POST',
      '/api/accounts/update',
      { oldEmpId: 'JPMP-101', updated: { employeeId: 'JPMP-101', username: 'MARIA SANTOS', maxDevices: 11 } },
      { Authorization: `Bearer ${superAdminToken}`, 'x-device-id': 'PRIMARY-PC' }
    );
    expect(invalidHigh.status).toBe(400);

    // Lower maxDevices from 2 -> 1 while 2 devices are bound
    const lowerRes = await requestJson(
      app,
      'POST',
      '/api/accounts/update',
      {
        oldEmpId: 'JPMP-101',
        updated: {
          employeeId: 'JPMP-101',
          username: 'MARIA SANTOS',
          role: 'WAREHOUSE CLERK',
          permission: 'LIMITED_ACCESS',
          status: 'ACTIVE',
          maxDevices: 1,
        },
      },
      { Authorization: `Bearer ${superAdminToken}`, 'x-device-id': 'PRIMARY-PC' }
    );
    expect(lowerRes.status).toBe(200);
    expect(lowerRes.body.account.maxDevices).toBe(1);

    // Audit trail records actor, account, old value (2), new value (1), and timestamp
    const maxDevAudit = ctx.auditTrailLogs.find((entry) => entry.action === 'MAX_DEVICES_UPDATED');
    expect(maxDevAudit).toBeDefined();
    expect(maxDevAudit?.actorId).toBe('JPMP-002');
    expect(maxDevAudit?.recordId).toBe('JPMP-101');
    expect(maxDevAudit?.details).toContain('old: 2');
    expect(maxDevAudit?.details).toContain('new: 1');
    expect(maxDevAudit?.timestamp).toBeTruthy();

    // Existing sessions stay intact and already-bound devices keep working
    expect(
      Array.from(ctx.sessionTokensMap.values()).some((s) => s.employeeId === 'JPMP-101')
    ).toBe(true);
    const existingDeviceSignIn = await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-PC-2',
    });
    expect(existingDeviceSignIn.status).toBe(200);

    // Only new unbound devices are blocked
    const newDeviceBlocked = await requestJson(app, 'POST', '/api/accounts/verify', {
      identifier: 'JPMP-101',
      pin: '4829',
      deviceId: 'DEV-TAB-4',
    });
    expect(newDeviceBlocked.status).toBe(403);
    expect(newDeviceBlocked.body.error).toBe(
      'You have reached your device limit (1). Ask your Super Administrator to remove an old device or raise your limit.'
    );
  });
});
