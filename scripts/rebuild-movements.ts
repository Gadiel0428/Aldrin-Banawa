/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Standalone Idempotent Migration Script: Rebuild Stock Movements from Current Data
 * Run with: npx tsx scripts/rebuild-movements.ts
 */

import { WebSocketServer } from "ws";
import { loadAndValidateServerConfig } from "../server/config.ts";
import { createServerContext } from "../server/services/context.ts";
import {
  commitDatabase,
  loadDatabaseFromDisk,
} from "../server/services/backupService.ts";
import {
  rebuildMovementsMigration,
  reconcileStockBalances,
} from "../server/services/stockLedgerService.ts";
import { checkpointAndClose } from "../server/sqliteStore.ts";

function main(): void {
  const config = loadAndValidateServerConfig();
  const wss = new WebSocketServer({ noServer: true });
  const ctx = createServerContext({
    serverInstanceId: `cli-migration-${Date.now()}`,
    serverBootTime: new Date().toISOString(),
    config,
    wss,
  });

  loadDatabaseFromDisk(ctx);
  const migrationResult = rebuildMovementsMigration(ctx);
  commitDatabase(ctx);
  const reconcileReport = reconcileStockBalances(ctx);
  checkpointAndClose();
  wss.close();

  console.log("=== JUWEI WMS MOVEMENT MIGRATION SUMMARY ===");
  console.log(JSON.stringify({ migrationResult, reconcileReport }, null, 2));
}

main();
