/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Outbound Delivery, Forklift Checklists & Environmental Log Routes
 *
 * Delivery (`deliveries`), Forklift Inspection (`forkliftChecks`), and
 * Environmental Monitoring (`envLogs`) records flow through the authoritative
 * sync & record mutation endpoints (`/api/records/upsert`, `/api/records/delete`,
 * `/api/sync`, `/api/sync/batch`).
 */

import type { Express } from "express";
import type { ServerContext } from "../services/context.ts";

export const DELIVERY_COLLECTIONS = ["deliveries", "forkliftChecks", "envLogs"] as const;

export function registerDeliveryRoutes(_app: Express, _ctx: ServerContext): void {
  // All delivery & compliance persistence events are routed via
  // /api/records/upsert, /api/records/delete, /api/sync, and /api/sync/batch
  // to preserve exact API compatibility.
}
