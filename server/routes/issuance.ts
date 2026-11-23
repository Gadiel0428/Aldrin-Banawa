/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issuance & Shop-Floor Material Requisition Routes
 *
 * Issuance (`issuances`) records flow through the authoritative sync & record
 * mutation endpoints (`/api/records/upsert`, `/api/records/delete`, `/api/sync`,
 * `/api/sync/batch`) and atomic stock deductions (`/api/stock-movements`).
 */

import type { Express } from "express";
import type { ServerContext } from "../services/context.ts";

export const ISSUANCE_COLLECTIONS = ["issuances"] as const;

export function registerIssuanceRoutes(_app: Express, _ctx: ServerContext): void {
  // All issuance persistence & PICK_PACK_SHIP real-time events are routed via
  // /api/records/upsert, /api/records/delete, /api/stock-movements, /api/sync, and /api/sync/batch
  // to preserve exact API compatibility.
}
