/**
 * Unit & Server Integration Tests for Save-Time Validation Rules
 * Covers receiving, issuance, and delivery checks across shared helpers,
 * HTTP /api/records/upsert, and WebSocket record_upsert.
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import {
  validateDeliveryRecord,
  validateIssuanceRecord,
  validateReceivingRecord,
  validateStockRecord,
} from '../shared/validation.ts';

function runUnitTests() {
  console.log('1. Running unit tests for shared/validation.ts...');

  const existingReceiving = [
    {
      id: 'RCV-EXISTING-1',
      rrNumber: 'RR-2026-0001',
      poNumber: 'PO-2026-0001',
      drNumber: 'DR-00001',
      siNumber: 'SI-00001',
      quantity: 100,
      receivedDate: '2026-05-10',
      expirationDate: '2026-08-10',
    },
  ];

  // Valid receiving record (different doc numbers, expiry == receipt)
  const validRec = validateReceivingRecord(
    {
      id: 'RCV-NEW-1',
      supplierOrDept: 'RESIN/RAW MATERIALS',
      partCode: 'RM-ABS-001',
      location: 'Zone A',
      unit: 'KG',
      quantity: 25,
      receivedDate: '2026-05-10',
      expirationDate: '2026-05-10',
      rrNumber: 'RR-2026-0002',
      poNumber: 'PO-2026-0002',
      drNumber: 'DR-00002',
      siNumber: 'SI-00002',
    },
    existingReceiving,
    { requireOperationalFields: true }
  );
  assert.equal(validRec.valid, true, `Expected valid receiving record, got: ${JSON.stringify(validRec)}`);

  // Updating the same receiving record should NOT trigger duplicate errors against itself
  const selfUpdateRec = validateReceivingRecord(
    {
      ...existingReceiving[0],
      supplierOrDept: 'RESIN/RAW MATERIALS',
      partCode: 'RM-ABS-001',
      location: 'Zone A',
      unit: 'KG',
    },
    existingReceiving,
    { requireOperationalFields: true }
  );
  assert.equal(selfUpdateRec.valid, true, 'Self-update should not count as duplicate');

  // Duplicate RR, PO, DR, SI (case-insensitive against existing records)
  const mixedCaseExisting = [
    {
      id: 'RCV-EXISTING-2',
      rrNumber: 'rr-2026-0009',
      poNumber: 'po-2026-0009',
      drNumber: 'dr-00009',
      siNumber: 'si-00009',
    },
  ];
  const dupRec = validateReceivingRecord(
    {
      id: 'RCV-DUP-1',
      quantity: 10,
      receivedDate: '2026-05-10',
      rrNumber: 'RR-2026-0009',
      poNumber: 'PO-2026-0009',
      drNumber: 'DR-00009',
      siNumber: 'SI-00009',
    },
    mixedCaseExisting
  );
  assert.equal(dupRec.valid, false);
  assert.ok(dupRec.fieldErrors.rrNumber?.includes('Duplicate'));
  assert.ok(dupRec.fieldErrors.poNumber?.includes('Duplicate'));
  assert.ok(dupRec.fieldErrors.drNumber?.includes('Duplicate'));
  assert.ok(dupRec.fieldErrors.siNumber?.includes('Duplicate'));

  // Format mismatches on RR, PO, DR, SI
  const badFormatRec = validateReceivingRecord({
    id: 'RCV-FMT-1',
    quantity: 10,
    receivedDate: '2026-05-10',
    rrNumber: 'RR-26-0001',
    poNumber: 'PO-2026-123',
    drNumber: 'DR-1234',
    siNumber: 'SI-123456',
  });
  assert.equal(badFormatRec.valid, false);
  assert.ok(badFormatRec.fieldErrors.rrNumber?.includes('RR-YYYY-NNNN'));
  assert.ok(badFormatRec.fieldErrors.poNumber?.includes('PO-YYYY-NNNN'));
  assert.ok(badFormatRec.fieldErrors.drNumber?.includes('DR-NNNNN'));
  assert.ok(badFormatRec.fieldErrors.siNumber?.includes('SI-NNNNN'));

  // Negative and zero quantities + expiry earlier than receipt
  const negRec = validateReceivingRecord({
    id: 'RCV-NEG-1',
    quantity: -5,
    receivedDate: '2026-05-10',
    expirationDate: '2026-05-09',
  });
  assert.equal(negRec.valid, false);
  assert.ok(negRec.fieldErrors.quantity);
  assert.ok(negRec.fieldErrors.expirationDate?.includes('earlier'));

  const zeroRec = validateReceivingRecord({
    id: 'RCV-ZERO-1',
    quantity: 0,
    receivedDate: '2026-05-10',
  });
  assert.equal(zeroRec.valid, false);
  assert.ok(zeroRec.fieldErrors.quantity);

  // Issuance validation
  const badIss = validateIssuanceRecord({
    id: 'ISS-BAD-1',
    quantityRequested: 0,
    quantityIssued: -3,
  });
  assert.equal(badIss.valid, false);
  assert.ok(badIss.fieldErrors.quantityRequested);
  assert.ok(badIss.fieldErrors.quantityIssued);

  const overrideIss = validateIssuanceRecord(
    {
      id: 'ISS-OVR-1',
      requisitionNumber: 'REQ-2026-001',
      partCode: 'RM-ABS-001',
      lotNumber: 'LOT-NEW',
      receivedBy: 'Juan',
      quantityRequested: 10,
      quantityIssued: 10,
    },
    { requireOperationalFields: true, isNewerLotSelected: true, superAdminApproved: false }
  );
  assert.equal(overrideIss.valid, false);
  assert.ok(overrideIss.fieldErrors.overrideReason);
  assert.ok(overrideIss.fieldErrors.superAdminApproved);

  // Delivery validation
  const existingDeliveries = [
    {
      id: 'DEL-EXISTING-1',
      pickingListNumber: 'DPL-2026-001',
      poNumber: 'PO-2026-1001',
      drNumber: 'DR-10001',
      salesInvoice: 'SI-10001',
      modelName: 'Model X',
      partCode: 'FG-001',
      quantity: 20,
      unit: 'PCS',
      status: 'RELEASED' as const,
    },
  ];

  const badDel = validateDeliveryRecord(
    {
      id: 'DEL-BAD-1',
      pickingListNumber: 'DPL-2026-002',
      poNumber: 'PO-2026-1001', // dup
      drNumber: 'DR-99', // bad format
      salesInvoice: 'SI-10001', // dup
      quantity: 0,
      status: 'RELEASED',
    },
    existingDeliveries,
    { requireReleaseDocs: true }
  );
  assert.equal(badDel.valid, false);
  assert.ok(badDel.fieldErrors.poNumber?.includes('Duplicate'));
  assert.ok(badDel.fieldErrors.drNumber?.includes('DR-NNNNN'));
  assert.ok(badDel.fieldErrors.salesInvoice?.includes('Duplicate'));
  assert.ok(badDel.fieldErrors.quantity);
  assert.ok(badDel.fieldErrors.wayBill);

  // Stock expiry earlier than receipt check
  const badStock = validateStockRecord({
    id: 'STK-1',
    quantity: 10,
    receivedDate: '2026-06-15',
    expirationDate: '2026-06-01',
  });
  assert.equal(badStock.valid, false);
  assert.ok(badStock.fieldErrors.expirationDate);

  console.log('   PASS: All shared unit tests passed.');
}

async function waitForServer(baseUrl: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/sync`);
      if (res.ok) return;
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${baseUrl} did not respond within ${timeoutMs}ms`);
}

async function postUpsert(baseUrl: string, collection: string, record: any) {
  const res = await fetch(`${baseUrl}/api/records/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collection,
      record,
      author: 'TEST ADMIN',
      employeeId: 'JPMP-002',
      device_id: 'dev_test_validation',
    }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function runServerIntegrationTests() {
  console.log('2. Starting isolated server for HTTP & WebSocket validation tests...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'juwei-validation-test-'));
  const port = 3499;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  let serverProc: ChildProcess | null = null;
  let wsClient: WebSocket | null = null;

  try {
    const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    serverProc = spawn(tsxBin, ['server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        JUWEI_DATA_DIR: tempDir,
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitForServer(baseUrl);
    console.log('   Server ready on port', port);

    // A. Receiving valid record
    const recOk = await postUpsert(baseUrl, 'receiving', {
      id: 'RCV-SRV-1',
      date: '2026-05-10',
      receivedDate: '2026-05-10',
      expirationDate: '2026-12-31',
      location: 'Zone A',
      vendorSupplier: 'Test Supplier',
      source: 'EXTERNAL',
      itemDescription: 'ABS Resin',
      partCode: 'RM-ABS-001',
      quantity: 50,
      unit: 'KG',
      lotNumber: 'LOT-001',
      rrNumber: 'RR-2026-0001',
      poNumber: 'PO-2026-0001',
      drNumber: 'DR-00001',
      siNumber: 'SI-00001',
      supplierOrDept: 'RESIN/RAW MATERIALS',
      iqcStatus: 'PENDING_IQC',
      status: 'DRAFT',
      fifoColorCode: 'Magenta',
      physicalCondition: {},
    });
    assert.equal(recOk.status, 200, `Expected 200 for valid receiving, got ${recOk.status}: ${JSON.stringify(recOk.data)}`);

    // B. Duplicate RR/PO/DR/SI on HTTP /api/records/upsert
    const recDup = await postUpsert(baseUrl, 'receiving', {
      id: 'RCV-SRV-DUP',
      date: '2026-05-11',
      receivedDate: '2026-05-11',
      location: 'Zone A',
      vendorSupplier: 'Test Supplier',
      source: 'EXTERNAL',
      itemDescription: 'ABS Resin',
      partCode: 'RM-ABS-001',
      quantity: 10,
      unit: 'KG',
      lotNumber: 'LOT-002',
      rrNumber: 'RR-2026-0001',
      poNumber: 'PO-2026-0001',
      drNumber: 'DR-00001',
      siNumber: 'SI-00001',
      supplierOrDept: 'RESIN/RAW MATERIALS',
      iqcStatus: 'PENDING_IQC',
      status: 'DRAFT',
      fifoColorCode: 'Magenta',
      physicalCondition: {},
    });
    assert.equal(recDup.status, 400);
    assert.ok(recDup.data.fieldErrors?.rrNumber);
    assert.ok(recDup.data.fieldErrors?.poNumber);
    assert.ok(recDup.data.fieldErrors?.drNumber);
    assert.ok(recDup.data.fieldErrors?.siNumber);

    // C. Negative quantity + expiry earlier than receipt + bad formats
    const recBad = await postUpsert(baseUrl, 'receiving', {
      id: 'RCV-SRV-BAD',
      date: '2026-05-15',
      receivedDate: '2026-05-15',
      expirationDate: '2026-05-01',
      location: 'Zone A',
      vendorSupplier: 'Test Supplier',
      source: 'EXTERNAL',
      itemDescription: 'ABS Resin',
      partCode: 'RM-ABS-001',
      quantity: -10,
      unit: 'KG',
      lotNumber: 'LOT-003',
      rrNumber: 'RR-26-01',
      poNumber: 'PO-2026-99',
      drNumber: 'DR-12',
      siNumber: 'SI-123456',
      supplierOrDept: 'RESIN/RAW MATERIALS',
      iqcStatus: 'PENDING_IQC',
      status: 'DRAFT',
      fifoColorCode: 'Magenta',
      physicalCondition: {},
    });
    assert.equal(recBad.status, 400);
    assert.ok(recBad.data.fieldErrors?.quantity);
    assert.ok(recBad.data.fieldErrors?.expirationDate);
    assert.ok(recBad.data.fieldErrors?.rrNumber);
    assert.ok(recBad.data.fieldErrors?.poNumber);
    assert.ok(recBad.data.fieldErrors?.drNumber);
    assert.ok(recBad.data.fieldErrors?.siNumber);

    // D. Issuance zero/negative quantity rejected on server
    const issBad = await postUpsert(baseUrl, 'issuances', {
      id: 'ISS-SRV-BAD',
      date: '2026-05-15',
      requisitionNumber: 'REQ-2026-001',
      department: 'Injection Molding Dept',
      partCode: 'RM-ABS-001',
      description: 'ABS Resin',
      quantityRequested: 0,
      quantityIssued: -2,
      unit: 'KG',
      lotNumber: 'LOT-001',
      fifoVerified: true,
      issuedBy: 'Staff',
      receivedBy: 'Operator',
    });
    assert.equal(issBad.status, 400);
    assert.ok(issBad.data.fieldErrors?.quantityRequested);
    assert.ok(issBad.data.fieldErrors?.quantityIssued);

    // E. Delivery valid vs duplicate/bad formats + WebSocket rejection test
    const delOk = await postUpsert(baseUrl, 'deliveries', {
      id: 'DEL-SRV-1',
      date: '2026-05-15',
      pickingListNumber: 'DPL-2026-001',
      poNumber: 'PO-2026-5001',
      modelName: 'Housing A',
      partCode: 'FG-001',
      quantity: 30,
      unit: 'PCS',
      packagingConditionOk: true,
      fifoVerified: true,
      forkliftChecklistSigned: true,
      gatePassNumber: 'MGP-2026-001',
      status: 'RELEASED',
      drNumber: 'DR-50001',
      salesInvoice: 'SI-50001',
      wayBill: 'WB-50001',
      preparedBy: 'Aldrin',
    });
    assert.equal(delOk.status, 200);

    wsClient = new WebSocket(`${wsUrl}?accountId=ACC-JUWEI&warehouseId=WH-MAIN`);
    await new Promise<void>((resolve, reject) => {
      wsClient!.on('open', () => resolve());
      wsClient!.on('error', reject);
    });

    wsClient.send(
      JSON.stringify({
        type: 'authenticate',
        accountId: 'ACC-JUWEI',
        warehouseId: 'WH-MAIN',
        user_id: 'USR-JPMP-002',
        session_id: 'sess_val_test',
        device_id: 'dev_ws_val_test',
        employeeId: 'JPMP-002',
        username: 'ALDRIN REYES',
        role: 'SUPER ADMINISTRATOR',
        permission: 'FULL_ACCESS',
      })
    );

    await new Promise((r) => setTimeout(r, 250));

    const wsErrorResponse: any = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for WS ERROR response')), 5000);
      wsClient!.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ERROR') {
          clearTimeout(timer);
          resolve(msg);
        }
      });
      wsClient!.send(
        JSON.stringify({
          type: 'record_upsert',
          collection: 'deliveries',
          mutationId: 'mut-bad-del-1',
          record: {
            id: 'DEL-WS-BAD',
            date: '2026-05-15',
            pickingListNumber: 'DPL-2026-002',
            poNumber: 'PO-2026-5001', // duplicate PO
            modelName: 'Housing A',
            partCode: 'FG-001',
            quantity: 0, // zero quantity
            unit: 'PCS',
            packagingConditionOk: true,
            fifoVerified: true,
            forkliftChecklistSigned: true,
            gatePassNumber: 'MGP-2026-002',
            status: 'RELEASED',
            drNumber: 'DR-BAD', // invalid DR
            salesInvoice: 'SI-BAD', // invalid SI
            wayBill: 'WB-50002',
            preparedBy: 'Aldrin',
          },
        })
      );
    });

    assert.equal(wsErrorResponse.status, 400);
    assert.ok(wsErrorResponse.fieldErrors?.poNumber);
    assert.ok(wsErrorResponse.fieldErrors?.quantity);
    assert.ok(wsErrorResponse.fieldErrors?.drNumber);
    assert.ok(wsErrorResponse.fieldErrors?.salesInvoice);

    // Verify invalid records were NOT persisted in /api/sync
    const syncRes = await fetch(`${baseUrl}/api/sync`);
    const syncJson: any = await syncRes.json();
    assert.equal(syncJson.data.receiving.length, 1, 'Invalid receiving records must not persist');
    assert.equal(syncJson.data.issuances.length, 0, 'Invalid issuance record must not persist');
    assert.equal(syncJson.data.deliveries.length, 1, 'Invalid delivery record must not persist');

    console.log('   PASS: Server HTTP + WebSocket validation & persistence integrity verified.');
  } finally {
    if (wsClient) {
      try { wsClient.terminate(); } catch {}
    }
    if (serverProc && !serverProc.killed) {
      try {
        serverProc.kill('SIGTERM');
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
      if (!serverProc.killed) {
        try { serverProc.kill('SIGKILL'); } catch {}
      }
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

async function main() {
  runUnitTests();
  await runServerIntegrationTests();
  console.log('ALL VALIDATION TESTS PASSED.');
  process.exit(0);
}

main().catch((err) => {
  console.error('VALIDATION TEST FAILED:', err);
  process.exit(1);
});
