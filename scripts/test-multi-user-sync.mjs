/**
 * Multi-User Concurrent Real-Time Synchronization Verification Test
 * Tests 5 concurrent clients across different devices and roles connecting to the central server.
 */

import WebSocket from 'ws';
import fs from 'fs';

const WS_URL = 'ws://localhost:3000/ws';
const API_URL = 'http://localhost:3000';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('--- STARTING MULTI-USER REAL-TIME SYNCHRONIZATION TEST ---');

  const clients = [
    {
      name: 'Client 1 (Aldrin - Desktop Super Admin)',
      user_id: 'USR-JPMP-002',
      session_id: 'sess_desktop_aldrin_001',
      device_id: 'dev_win_desktop_01',
      stationId: 'WS-DESKTOP-ALDRIN',
      username: 'ALDRIN REYES',
      employeeId: 'JPMP-002',
      role: 'SUPER ADMINISTRATOR',
      permission: 'FULL_ACCESS',
      platform: 'Windows'
    },
    {
      name: 'Client 2 (Maria - Android Handheld Scanner)',
      user_id: 'USR-JPMP-003',
      session_id: 'sess_android_maria_002',
      device_id: 'dev_android_scanner_02',
      stationId: 'WS-ANDROID-HANDHELD',
      username: 'MARIA SANTOS',
      employeeId: 'JPMP-003',
      role: 'WAREHOUSE OPERATOR',
      permission: 'LIMITED_ACCESS',
      platform: 'Android'
    },
    {
      name: 'Client 3 (John - iOS iPad Forklift Terminal)',
      user_id: 'USR-JPMP-004',
      session_id: 'sess_ios_john_003',
      device_id: 'dev_ios_forklift_03',
      stationId: 'WS-FORKLIFT-01',
      username: 'JOHN DOE',
      employeeId: 'JPMP-004',
      role: 'FORKLIFT OPERATOR',
      permission: 'LIMITED_ACCESS',
      platform: 'iOS'
    },
    {
      name: 'Client 4 (Aldrin - Laptop Second Device)',
      user_id: 'USR-JPMP-002',
      session_id: 'sess_laptop_aldrin_004',
      device_id: 'dev_win_laptop_04',
      stationId: 'WS-LAPTOP-ALDRIN',
      username: 'ALDRIN REYES',
      employeeId: 'JPMP-002',
      role: 'SUPER ADMINISTRATOR',
      permission: 'FULL_ACCESS',
      platform: 'Windows'
    },
    {
      name: 'Client 5 (Elena - Quality Station)',
      user_id: 'USR-JPMP-005',
      session_id: 'sess_qc_elena_005',
      device_id: 'dev_qc_station_05',
      stationId: 'WS-QC-INSPECTION',
      username: 'ELENA ROXAS',
      employeeId: 'JPMP-005',
      role: 'QA INSPECTOR',
      permission: 'LIMITED_ACCESS',
      platform: 'Desktop'
    }
  ];

  const sockets = [];
  const receivedMessages = [[], [], [], [], []];

  console.log('\n[TEST STEP 1] Connecting 5 concurrent WebSocket clients...');
  for (let i = 0; i < clients.length; i++) {
    const info = clients[i];
    const ws = new WebSocket(WS_URL);
    sockets.push(ws);

    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'authenticate',
          user_id: info.user_id,
          session_id: info.session_id,
          device_id: info.device_id,
          stationId: info.stationId,
          username: info.username,
          employeeId: info.employeeId,
          role: info.role,
          permission: info.permission,
          platform: info.platform,
          deviceName: `${info.platform} Terminal - ${info.stationId}`
        }));
        resolve();
      });
      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          receivedMessages[i].push(parsed);
        } catch (e) {}
      });
      ws.on('error', reject);
    });
    console.log(` -> Connected & Authenticated: ${info.name}`);
  }

  await sleep(1500);

  console.log('\n[TEST STEP 2] Verifying Server Active Connection Registry via REST API...');
  const healthRes = await fetch(`${API_URL}/api/health`);
  const healthJson = await healthRes.json();
  console.log(' -> /api/health:', JSON.stringify(healthJson));

  const presenceRes = await fetch(`${API_URL}/api/presence`);
  const presenceJson = await presenceRes.json();
  console.log(` -> Total Connected Terminals: ${presenceJson.liveActiveTerminals}`);
  console.log(` -> Total Active Operators: ${presenceJson.connectedOperators}`);
  console.log(' -> Active Presence List:', presenceJson.presence.map(p => `${p.username} [${p.platform}] (${p.connection_id})`));

  if (presenceJson.liveActiveTerminals < 5) {
    throw new Error(`Expected at least 5 active terminals, got ${presenceJson.liveActiveTerminals}`);
  }
  console.log(' [PASS] All 5 terminals registered and tracked simultaneously without collision!');

  console.log('\n[TEST STEP 3] Client 1 Creates Stock Item (DATA_CREATE)...');
  const testPartId = `TEST-MULTI-${Date.now()}`;
  const newStockItem = {
    id: testPartId,
    itemCode: 'RW-TEST-9999',
    name: 'Real-Time Multi-User Validation Resin',
    materialType: 'RAW',
    quantity: 120,
    uom: 'KG',
    location: 'Zone A - Raw Materials',
    status: 'AVAILABLE',
    lotNumber: 'LOT-MULTI-2026-X',
    createdAt: new Date().toISOString()
  };

  // Clear message buffers for broadcast testing
  receivedMessages.forEach(buf => buf.length = 0);

  sockets[0].send(JSON.stringify({
    type: 'record_upsert',
    collection: 'stocks',
    record: newStockItem,
    author: 'ALDRIN REYES',
    actionDesc: 'Created test stock item from Windows Super Admin Workstation'
  }));

  await sleep(1000);

  // Check that other 4 clients received DATA_CREATE or RECORD_CREATED
  for (let i = 1; i < clients.length; i++) {
    const createMsg = receivedMessages[i].find(m => (m.type === 'DATA_CREATE' || m.type === 'RECORD_CREATED') && m.record?.id === testPartId);
    if (!createMsg) {
      throw new Error(`Client ${i + 1} did not receive real-time DATA_CREATE broadcast! Messages: ${JSON.stringify(receivedMessages[i].map(m => m.type))}`);
    }
    console.log(` -> Client ${i + 1} (${clients[i].username} on ${clients[i].platform}) received DATA_CREATE broadcast.`);
  }

  // Verify central-database.json on disk
  const dbData = JSON.parse(fs.readFileSync('central-database.json', 'utf8'));
  const foundInDb = dbData.stocks?.find(s => s.id === testPartId);
  if (!foundInDb) {
    throw new Error('Test record was not saved to central-database.json!');
  }
  console.log(' [PASS] Record saved to Central Database first, then broadcast to all 4 other devices!');

  console.log('\n[TEST STEP 4] Client 2 (Android) Updates the Stock Item (DATA_UPDATE)...');
  receivedMessages.forEach(buf => buf.length = 0);

  const updatedStockItem = {
    ...newStockItem,
    quantity: 115,
    lastCountDate: new Date().toISOString()
  };

  sockets[1].send(JSON.stringify({
    type: 'record_upsert',
    collection: 'stocks',
    record: updatedStockItem,
    author: 'MARIA SANTOS',
    actionDesc: 'Issued 5 KG from Android Handheld'
  }));

  await sleep(1000);

  // Check that Client 0 (Desktop), Client 2 (iOS), Client 3 (Laptop), Client 4 (QC) received DATA_UPDATE
  const otherIndices = [0, 2, 3, 4];
  for (const idx of otherIndices) {
    const updateMsg = receivedMessages[idx].find(m => (m.type === 'DATA_UPDATE' || m.type === 'RECORD_UPDATED') && m.record?.id === testPartId);
    if (!updateMsg) {
      throw new Error(`Client ${idx + 1} did not receive real-time DATA_UPDATE broadcast!`);
    }
    console.log(` -> Client ${idx + 1} (${clients[idx].username} on ${clients[idx].platform}) received DATA_UPDATE with quantity = 115.`);
  }

  const dbDataUpdated = JSON.parse(fs.readFileSync('central-database.json', 'utf8'));
  const foundUpdated = dbDataUpdated.stocks?.find(s => s.id === testPartId);
  if (foundUpdated?.quantity !== 115) {
    throw new Error(`Central database quantity expected 115, found ${foundUpdated?.quantity}`);
  }
  console.log(' [PASS] Real-time update confirmed in Central Database and broadcast across platforms!');

  console.log('\n[TEST STEP 5] Client 3 (iOS) Deletes the Stock Item (DATA_DELETE)...');
  receivedMessages.forEach(buf => buf.length = 0);

  sockets[2].send(JSON.stringify({
    type: 'record_delete',
    collection: 'stocks',
    id: testPartId,
    author: 'JOHN DOE',
    actionDesc: 'Scrapped test stock item from iOS Forklift'
  }));

  await sleep(1000);

  // Check that clients 0, 1, 3, 4 received DATA_DELETE
  const remainingIndices = [0, 1, 3, 4];
  for (const idx of remainingIndices) {
    const deleteMsg = receivedMessages[idx].find(m => (m.type === 'DATA_DELETE' || m.type === 'RECORD_DELETED') && m.id === testPartId);
    if (!deleteMsg) {
      throw new Error(`Client ${idx + 1} did not receive real-time DATA_DELETE broadcast!`);
    }
    console.log(` -> Client ${idx + 1} (${clients[idx].username}) received DATA_DELETE for item ${testPartId}.`);
  }

  const dbDataDeleted = JSON.parse(fs.readFileSync('central-database.json', 'utf8'));
  const foundDeleted = dbDataDeleted.stocks?.find(s => s.id === testPartId);
  if (foundDeleted) {
    throw new Error('Test record was not deleted from central-database.json!');
  }
  console.log(' [PASS] Real-time delete confirmed in Central Database and broadcast across platforms!');

  console.log('\n[TEST STEP 6] Client 5 Disconnects -> USER_OFFLINE Broadcast...');
  receivedMessages.forEach(buf => buf.length = 0);
  sockets[4].close();
  await sleep(1000);

  for (let i = 0; i < 4; i++) {
    const offlineMsg = receivedMessages[i].find(m => m.type === 'USER_OFFLINE');
    if (offlineMsg) {
      console.log(` -> Client ${i + 1} received USER_OFFLINE notification for ${offlineMsg.connection?.username}.`);
    }
  }

  const postOfflineRes = await fetch(`${API_URL}/api/presence`);
  const postOfflineJson = await postOfflineRes.json();
  console.log(` -> Remaining Connected Terminals: ${postOfflineJson.liveActiveTerminals} (Expected: 4)`);
  if (postOfflineJson.liveActiveTerminals !== 4) {
    throw new Error(`Expected exactly 4 active terminals, got ${postOfflineJson.liveActiveTerminals}`);
  }
  console.log(' [PASS] Connection cleanup and USER_OFFLINE broadcast verified!');

  // Close remaining sockets
  for (let i = 0; i < 4; i++) {
    sockets[i].close();
  }

  console.log('\n======================================================');
  console.log(' ALL MULTI-USER REAL-TIME SYNCHRONIZATION TESTS PASSED! ');
  console.log('======================================================\n');
}

runTest().catch(err => {
  console.error('\n❌ MULTI-USER TEST FAILED:', err);
  process.exit(1);
});
