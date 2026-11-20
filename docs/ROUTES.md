# JUWEI WMS Server API Routes

Inventory of all HTTP endpoints registered by `server.ts` and `server/routes/*`, including HTTP methods, route module assignment, and enforced server-side permissions.

> **Compatibility guarantee:** Every route path, request payload shape, and response structure is preserved verbatim when modularized into `server/routes/`.

---

## Route Modules Overview

| Module File | Scope |
| :--- | :--- |
| `server/routes/stock.ts` | Stock movements, FIFO monthly color calendar, FIFO startup repair audit report, `stocks` collection hooks |
| `server/routes/receiving.ts` | Receiving/return categories & category rename cascading, `receiving` / `returns` / `recycling` collection hooks |
| `server/routes/issuance.ts` | Issuance & shop-floor material requisition (`issuances`) collection hooks and `PICK_PACK_SHIP` coordination |
| `server/routes/delivery.ts` | Outbound delivery, gate pass, forklift checklist, and environmental inspection (`deliveries`, `forkliftChecks`, `envLogs`) collection hooks |
| `server/routes/master-data.ts` | Operational roles (`roles`) and master registry (`registries`) management |
| `server/routes/accounts.ts` | Operator authentication, scrypt PIN management, account lifecycle, PIN audit logs, initial setup PIN |
| `server/routes/backups.ts` | SQLite/JSON snapshot listing, on-demand creation, restore, and download |
| `server/routes/sync.ts` | Full state snapshot, collection sync, offline batch reconciliation, record upsert/delete, live presence, team chat |
| `server/routes/admin.ts` | Health, diagnostics, GitHub release/build info, device authorization/revocation, fresh install binding, global reset, audit log viewer |

---

## Complete HTTP Route Matrix

### 1. Stock & FIFO (`server/routes/stock.ts`)

| Method | Path | Required Permission | Notes |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/stock-movements` | Authenticated / Non-`VIEW_ONLY` | Rejects `REVOKED`/`PENDING` devices, stale `reset_version`, and `VIEW_ONLY` accounts; supports idempotency keys and negative-stock guard. |
| `GET` | `/api/stock-movements` | Public (Read-only) | Returns recent `stockMovements` entries (optional `?limit=`). |
| `GET` | `/api/fifo-colors` | Public (Read-only) | Returns the 12-month `fifoColorsByMonth` calendar. |
| `POST` | `/api/fifo-colors` | Super Admin (`JPMP-002` or `FULL_ACCESS`) | Rejects `REVOKED`/`PENDING` devices. Updates or resets monthly FIFO color definitions. |
| `GET` | `/api/system/fifo-repair-report` | Public (Read-only) | Returns startup FIFO color repair summary and `fifoRepairAuditLogs`. |

---

### 2. Receiving & Categories (`server/routes/receiving.ts`)

| Method | Path | Required Permission | Notes |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/categories` | Public (Read-only) | Returns `receivingCategories` list. |
| `POST` | `/api/categories` | Authenticated / Non-`VIEW_ONLY` | Rejects `REVOKED`/`PENDING` devices and `VIEW_ONLY` accounts. Supports `add`, `rename` (cascading to `receiving`, `returns`, `stocks`), `delete` (blocked if in use), `reset`, and array replacement. |

> Receiving (`receiving`), Material Returns (`returns`), and Packaging Recycling (`recycling`) records are persisted and synchronized via `POST /api/records/upsert`, `POST /api/records/delete`, `POST /api/sync`, and `POST /api/sync/batch`.

---

### 3. Issuance (`server/routes/issuance.ts`)

> Material Issuance (`issuances`) records and outbound stock deductions are persisted and synchronized via `POST /api/records/upsert`, `POST /api/records/delete`, `POST /api/stock-movements` (`SALE`), `POST /api/sync`, `POST /api/sync/batch`, and WebSocket `PICK_PACK_SHIP` events.

---

### 4. Delivery & Compliance (`server/routes/delivery.ts`)

> Outbound Deliveries (`deliveries`), Forklift Checklists (`forkliftChecks`), and Environmental Logs (`envLogs`) are persisted and synchronized via `POST /api/records/upsert`, `POST /api/records/delete`, `POST /api/sync`, and `POST /api/sync/batch`.

---

### 5. Master Data (`server/routes/master-data.ts`)

| Method | Path | Required Permission | Notes |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/roles` | Public (Read-only) | Returns `operationalRoles` list. |
| `POST` | `/api/roles` | Authenticated / Non-`VIEW_ONLY` | Rejects `REVOKED`/`PENDING` devices and `VIEW_ONLY` accounts. Supports `add`, `rename` (optionally cascades to `registeredUsers`), `delete`, and array replacement. |

> Master Registry items (`registries`: `LOCATION`, `CATEGORY`, `CUSTOMER`, `SUPPLIER`, `BARCODE_PRESET`) are persisted and synchronized via `POST /api/records/upsert`, `POST /api/records/delete`, `POST /api/sync`, and `POST /api/sync/batch`.

---

### 6. Accounts & Authentication (`server/routes/accounts.ts`)

| Method | Path | Required Permission | Notes |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/setup/initial-pin` | Non-revoked device | Returns one-time fresh-install Super Admin setup PIN only until first PIN change completes. |
| `GET` | `/api/accounts` | Non-revoked device | Returns `registeredUsers` scrubbed of `pin`, `pinHash`, `pinSalt`, and `pin_hash`. |
| `POST` | `/api/accounts/verify` | Non-revoked device | Verifies Operator ID / username / phone + scrypt PIN (upgrading legacy plaintext PINs), issues Bearer session token, and binds authorized device. |
| `POST` | `/api/accounts/update-pin` | Super Admin (`FULL_ACCESS` / Super Admin PIN) **or** Target Operator (`currentPin`) | Rejects `REVOKED`/`PENDING` devices. Rejects compromised/repetitive PINs (`1234`, `0000`, etc.) and writes to `pin-audit-log.json` and `audit-trail.json`. |
| `GET` | `/api/accounts/pin-audit-log` | Non-revoked device | Returns `pinAuditLogs` history. |
| `POST` | `/api/accounts/register` | Non-`VIEW_ONLY` | Rejects `REVOKED`/`PENDING` devices and `VIEW_ONLY` accounts. Stores scrypt hash + salt; never plaintext PIN. |
| `POST` | `/api/accounts/update` | Non-`VIEW_ONLY` | Rejects `REVOKED`/`PENDING` devices and `VIEW_ONLY` accounts. Preserves existing PIN hash/salt (`JPMP-002` ID/role/permission immutable). |
| `POST` | `/api/accounts/delete` | Non-`VIEW_ONLY` | Rejects `REVOKED`/`PENDING` devices and `VIEW_ONLY` accounts. Blocks deleting `JPMP-002`. |
| `POST` | `/api/accounts/clear-all-except-super-admin` | Super Admin (`FULL_ACCESS` / Super Admin PIN) | Rejects `REVOKED`/`PENDING` devices. Purges all non-Super-Admin accounts and tombstones their IDs. |

---

### 7. Backups & Recovery (`server/routes/backups.ts`)

| Method | Path | Required Permission | Notes |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/backups` | Public (Read-only) | Lists `.sqlite` and `.json` snapshots in `BACKUPS_DIR` and recent `backupAuditLogs`. |
| `POST` | `/api/admin/backups/create` | Super Admin (`FULL_ACCESS` / Super Admin PIN) | Rejects `REVOKED`/`PENDING` devices. Triggers non-blocking SQLite `VACUUM INTO` snapshot with plaintext PINs scrubbed. |
| `POST` | `/api/admin/backups/restore` | Super Admin (`FULL_ACCESS` / Super Admin PIN) | Rejects `REVOKED`/`PENDING` devices. Requires `confirmed: true`. Validates snapshot, creates pre-restore safety copy, restores state, and broadcasts `GLOBAL_RESET`. |
| `GET` | `/api/admin/backups/download/:filename` | Public (Direct browser download) | Streams snapshot file confined via `path.basename` and `path.resolve` inside `BACKUPS_DIR`. |

---

### 8. Sync, Records, Presence & Chat (`server/routes/sync.ts`)

| Method | Path | Required Permission | Notes |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/presence` | Public (Read-only) | Returns active WebSocket connections and operator counts. |
| `POST` | `/api/sync/all-workstations` | Non-revoked device | Broadcasts `SYNC_REQUIRED` and `force_sync` over WebSockets. |
| `POST` | `/api/sync-all-workstations` | Non-revoked device | Alias for `/api/sync/all-workstations`. |
| `GET` | `/api/sync` | Non-revoked device | Returns full central state snapshot (PIN fields scrubbed) and revision metadata. |
| `POST` | `/api/sync` | Non-`VIEW_ONLY` | Rejects `REVOKED`/`PENDING` devices, stale `reset_version`, and `VIEW_ONLY` accounts. Blocks new `registeredUsers` inserts and PIN overwrites. |
| `POST` | `/api/sync/batch` | Non-`VIEW_ONLY` | Reconciles offline mutation queues (`upsert` / `delete`); enforces device revocation, `reset_version`, `expectedVersion`, and `VIEW_ONLY` checks. |
| `GET` | `/api/sync/state-summary` | Public (Read-only) | Returns record counts per collection and current `stateRevision`. |
| `GET` | `/api/sync/digest` | Public (Read-only) | Alias for `/api/sync/state-summary`. |
| `POST` | `/api/records/upsert` | Non-`VIEW_ONLY` | Single-record authoritative upsert with optimistic concurrency (`expectedVersion`), SQLite commit, audit trail, and WebSocket broadcast. |
| `POST` | `/api/records/delete` | Non-`VIEW_ONLY` | Single-record tombstone delete with optimistic concurrency (`expectedVersion`), SQLite commit, audit trail, and WebSocket broadcast. |
| `POST` | `/api/chat` | Non-`VIEW_ONLY` | Rejects `REVOKED`/`PENDING` devices and `VIEW_ONLY` accounts. Persists and broadcasts operator/system chat message. |

---

### 9. Admin, Health, Devices & Releases (`server/routes/admin.ts`)

| Method | Path | Required Permission | Notes |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/diagnostics` | Public (Read-only) | Returns server instance ID, boot time, uptime, record counts, and DB/WS readiness. |
| `GET` | `/api/health` | Public (Read-only) | Health probe used by monitoring scripts (`scripts/monitor-health.ps1`) and CI. |
| `POST` | `/api/build-info/publish` | Public (Release webhook) | Updates active release version cache and `latest-github-release.json`. |
| `POST` | `/api/release/latest` | Public (Release webhook) | Alias for `/api/build-info/publish`. |
| `GET` | `/api/build-info` | Public (Read-only) | Returns active bundle + latest GitHub release semver (`?refresh=1` forces live GitHub query). |
| `GET` | `/build-info.json` | Public (Read-only) | Alias for `/api/build-info`. |
| `GET` | `/api/download/latest-installer` | Public (Read-only) | Redirects `302` to latest GitHub release Windows `.exe` installer asset. |
| `GET` | `/api/devices` | Public (Read-only) | Lists active devices from heartbeat map with 5-minute online status. |
| `POST` | `/api/devices/heartbeat` | Public (Device telemetry) | Registers/updates terminal heartbeat metadata. |
| `GET` | `/api/devices/authorized` | Public (Read-only) | Lists `authorizedDevicesMap` along with `installationId` and `primaryDeviceId`. |
| `POST` | `/api/devices/authorize` | Super Admin (`FULL_ACCESS` / Super Admin PIN) | Rejects `REVOKED`/`PENDING` devices. Authorizes or marks pending a terminal `deviceId`. |
| `POST` | `/api/devices/revoke` | Super Admin (`FULL_ACCESS` / Super Admin PIN) | Rejects `REVOKED`/`PENDING` devices. Blocks revoking `primaryDeviceId`; disconnects live WebSockets for revoked device. |
| `POST` | `/api/terminal/fresh-install` | Non-revoked device | Binds `primaryDeviceId` and Super Admin `JPMP-002` to the installing workstation. |
| `POST` | `/api/reset-everything` | Super Admin (`FULL_ACCESS` / Super Admin PIN) | Rejects `REVOKED`/`PENDING` devices. Requires `confirmed: true`. Advances `systemResetVersion`, wipes operational collections, and broadcasts `GLOBAL_RESET`. |
| `POST` | `/api/reset-database` | Super Admin (`FULL_ACCESS` / Super Admin PIN) | Alias for `/api/reset-everything`. |
| `GET` | `/api/admin/audit-logs` | Super Admin (`FULL_ACCESS` / Super Admin PIN) | Rejects `REVOKED`/`PENDING` devices. Filterable by `dateFrom`, `dateTo`, `user`, `recordType`, `action`, `q`, and `limit`. |

---

### 10. Static SPA Catch-All (`server.ts`, production only)

| Method | Path | Required Permission | Notes |
| :--- | :--- | :--- | :--- |
| `GET` | `*` | Public (Read-only) | Serves `dist/index.html` when `NODE_ENV=production`. |
