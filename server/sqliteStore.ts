import { createRequire } from "module";
import path from "path";
import fs from "fs";

// Use createRequire(path.join(process.cwd(), "noop.cjs")) so esbuild bundle does not break
const dynamicRequire = createRequire(path.join(process.cwd(), "noop.cjs"));

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...args: any[]): any[];
    get(...args: any[]): any;
  };
  close(): void;
}

// Collection definitions: table name -> property name in state / payload
export const COLLECTION_TABLE_MAP: Record<string, string> = {
  stocks: "stocks",
  receiving: "receiving",
  returns_log: "returns",
  recycling: "recycling",
  issuances: "issuances",
  deliveries: "deliveries",
  env_logs: "envLogs",
  forklift_checks: "forkliftChecks",
  registries: "registries",
  registered_users: "registeredUsers",
  stock_movements: "stockMovements"
};

export const ALL_COLLECTION_TABLES = [
  "stocks",
  "receiving",
  "returns_log",
  "recycling",
  "issuances",
  "deliveries",
  "env_logs",
  "forklift_checks",
  "registries",
  "registered_users",
  "stock_movements",
  "authorized_devices",
  "chat_messages"
];

interface CacheStore {
  collections: Record<string, Map<string, string>>; // tableName -> Map<id, JSON_data>
  meta: Map<string, string>; // key -> value
  recordTombstones: Set<string>;
  userTombstones: Set<string>;
  initialized: boolean;
}

let activeDb: SqliteDatabase | null = null;
let activeDbPath: string = "";

const dbCache: CacheStore = {
  collections: {},
  meta: new Map<string, string>(),
  recordTombstones: new Set<string>(),
  userTombstones: new Set<string>(),
  initialized: false
};

// Statements cache for the active database connection
let statements: {
  upsert: Record<string, any>;
  delete: Record<string, any>;
  upsertMeta: any;
  deleteMeta: any;
  insertRecTombstone: any;
  deleteRecTombstone: any;
  insertUserTombstone: any;
  deleteUserTombstone: any;
} | null = null;

/**
 * Open SQLite database using better-sqlite3 if available, falling back to node:sqlite
 */
export function openSqliteDatabase(dbPath: string, options?: { readonly?: boolean }): SqliteDatabase {
  // Ensure target folder exists
  const targetDir = path.dirname(dbPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 1. Try better-sqlite3 first
  try {
    const betterSqlite = dynamicRequire("better-sqlite3");
    if (typeof betterSqlite === "function") {
      return new betterSqlite(dbPath, options);
    }
  } catch (e) {
    // Fall through to node:sqlite
  }

  // 2. Fall back to Node's built-in node:sqlite
  try {
    const nodeSqlite = dynamicRequire("node:sqlite");
    if (nodeSqlite && nodeSqlite.DatabaseSync) {
      return new nodeSqlite.DatabaseSync(dbPath, {
        readOnly: options?.readonly || false,
        open: true
      });
    }
  } catch (e) {
    throw new Error("Failed to load SQLite driver (neither better-sqlite3 nor node:sqlite available): " + (e as Error).message);
  }

  throw new Error("No compatible SQLite driver found");
}

/**
 * Configure database pragmas
 */
export function configurePragmas(db: SqliteDatabase) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = FULL;");
  db.exec("PRAGMA busy_timeout = 5000;");
}

/**
 * Initialize schema for all collections, tombstones, and meta tables
 */
export function initializeSchema(db: SqliteDatabase) {
  // Collection tables: seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, updated_at TEXT, version INTEGER, data TEXT CHECK(json_valid(data))
  for (const table of ALL_COLLECTION_TABLES) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE,
        updated_at TEXT,
        version INTEGER,
        data TEXT CHECK(json_valid(data))
      );
    `);
  }

  // Tombstones and Meta tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_record_tombstones (
      id TEXT PRIMARY KEY,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS deleted_user_tombstones (
      employee_id TEXT PRIMARY KEY,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

/**
 * Prepare statements for diff-based upserts and deletions
 */
function prepareStatements(db: SqliteDatabase) {
  const upsert: Record<string, any> = {};
  const del: Record<string, any> = {};

  for (const table of ALL_COLLECTION_TABLES) {
    upsert[table] = db.prepare(`
      INSERT INTO ${table} (id, updated_at, version, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        version = excluded.version,
        data = excluded.data;
    `);

    del[table] = db.prepare(`DELETE FROM ${table} WHERE id = ?;`);
  }

  const upsertMeta = db.prepare(`
    INSERT INTO meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
  `);

  const deleteMeta = db.prepare(`DELETE FROM meta WHERE key = ?;`);

  const insertRecTombstone = db.prepare(`
    INSERT INTO deleted_record_tombstones (id, created_at)
    VALUES (?, ?)
    ON CONFLICT(id) DO NOTHING;
  `);

  const deleteRecTombstone = db.prepare(`DELETE FROM deleted_record_tombstones WHERE id = ?;`);

  const insertUserTombstone = db.prepare(`
    INSERT INTO deleted_user_tombstones (employee_id, created_at)
    VALUES (?, ?)
    ON CONFLICT(employee_id) DO NOTHING;
  `);

  const deleteUserTombstone = db.prepare(`DELETE FROM deleted_user_tombstones WHERE employee_id = ?;`);

  statements = {
    upsert,
    delete: del,
    upsertMeta,
    deleteMeta,
    insertRecTombstone,
    deleteRecTombstone,
    insertUserTombstone,
    deleteUserTombstone
  };
}

/**
 * Populate in-memory diff cache from existing database
 */
function populateCacheFromDb(db: SqliteDatabase) {
  dbCache.collections = {};
  for (const table of ALL_COLLECTION_TABLES) {
    dbCache.collections[table] = new Map<string, string>();
    try {
      const rows = db.prepare(`SELECT id, data FROM ${table}`).all();
      for (const row of rows) {
        if (row && row.id) {
          dbCache.collections[table].set(String(row.id), String(row.data));
        }
      }
    } catch (e) {
      // Table might not exist yet if fresh
    }
  }

  dbCache.meta = new Map<string, string>();
  try {
    const metaRows = db.prepare(`SELECT key, value FROM meta`).all();
    for (const row of metaRows) {
      if (row && row.key) {
        dbCache.meta.set(String(row.key), String(row.value));
      }
    }
  } catch (e) {}

  dbCache.recordTombstones = new Set<string>();
  try {
    const recTombRows = db.prepare(`SELECT id FROM deleted_record_tombstones`).all();
    for (const row of recTombRows) {
      if (row && row.id) dbCache.recordTombstones.add(String(row.id));
    }
  } catch (e) {}

  dbCache.userTombstones = new Set<string>();
  try {
    const userTombRows = db.prepare(`SELECT employee_id FROM deleted_user_tombstones`).all();
    for (const row of userTombRows) {
      if (row && row.employee_id) dbCache.userTombstones.add(String(row.employee_id));
    }
  } catch (e) {}

  dbCache.initialized = true;
}

/**
 * Initialize SQLite store with the authoritative database file path
 */
export function initSqliteStore(dbPath: string): SqliteDatabase {
  if (activeDb && activeDbPath === dbPath) {
    return activeDb;
  }

  if (activeDb) {
    try {
      checkpointAndClose();
    } catch (e) {}
  }

  activeDbPath = dbPath;
  activeDb = openSqliteDatabase(dbPath);
  configurePragmas(activeDb);
  initializeSchema(activeDb);
  prepareStatements(activeDb);
  populateCacheFromDb(activeDb);

  return activeDb;
}

export function getActiveDb(): SqliteDatabase | null {
  return activeDb;
}

export function getActiveDbPath(): string {
  return activeDbPath;
}

/**
 * Extracts items for a specific collection table from payload
 */
function getCollectionItems(payload: any, table: string): any[] {
  if (table === "authorized_devices") {
    return Array.isArray(payload.authorizedDevices) ? payload.authorizedDevices : [];
  }
  if (table === "chat_messages") {
    const msgs = Array.isArray(payload.chatMessages) ? payload.chatMessages : [];
    return msgs.slice(-200);
  }

  const stateKey = COLLECTION_TABLE_MAP[table];
  if (!stateKey) return [];

  // Check top-level or payload.state
  if (Array.isArray(payload[stateKey])) {
    return payload[stateKey];
  }
  if (payload.state && Array.isArray(payload.state[stateKey])) {
    return payload.state[stateKey];
  }

  return [];
}

/**
 * Diff-based synchronous save to SQLite in ONE transaction.
 * Upserts only changed rows and deletes removed rows.
 * On error: ROLLBACK and leaves cache untouched.
 */
export function commitToSqlite(payload: any): boolean {
  if (!activeDb || !statements) {
    console.error("[SQLITE STORE] Cannot commit: SQLite database is not initialized.");
    return false;
  }

  // Clone cache into pending stage
  const pendingCollections: Record<string, Map<string, string>> = {};
  for (const table of ALL_COLLECTION_TABLES) {
    pendingCollections[table] = new Map(dbCache.collections[table] || new Map());
  }
  const pendingMeta = new Map(dbCache.meta);
  const pendingRecordTombstones = new Set(dbCache.recordTombstones);
  const pendingUserTombstones = new Set(dbCache.userTombstones);

  try {
    activeDb.exec("BEGIN IMMEDIATE;");

    // 1. Process Collection Tables
    for (const table of ALL_COLLECTION_TABLES) {
      const items = getCollectionItems(payload, table);
      const currentIds = new Set<string>();
      const cachedMap = dbCache.collections[table] || new Map<string, string>();
      const pendingMap = pendingCollections[table];

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        if (!item || typeof item !== "object") continue;

        // Tolerate missing or duplicate ids
        let id = String(item.id || item.record_id || item.deviceId || item.employeeId || "").trim();
        if (!id) {
          id = `GEN-${table}-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`;
          try {
            item.id = id;
          } catch (e) {}
        }

        if (currentIds.has(id)) {
          // Disambiguate duplicate ID in the same batch to prevent constraint violation
          id = `${id}-dup-${idx}`;
          try {
            item.id = id;
          } catch (e) {}
        }
        currentIds.add(id);

        const dataJson = JSON.stringify(item);
        const cachedJson = cachedMap.get(id);

        if (cachedJson === undefined || cachedJson !== dataJson) {
          // Changed or new row: upsert
          const updatedAt = String(item.updated_at || item.createdAt || new Date().toISOString());
          const version = Number(item.version) || 1;
          statements.upsert[table].run(id, updatedAt, version, dataJson);
          pendingMap.set(id, dataJson);
        }
      }

      // Deletions: delete rows in cache that are no longer in currentItems
      for (const [cachedId] of cachedMap.entries()) {
        if (!currentIds.has(cachedId)) {
          statements.delete[table].run(cachedId);
          pendingMap.delete(cachedId);
        }
      }
    }

    // 2. Process Meta key/value table
    const metaValues: Record<string, string> = {
      installationId: String(payload.installationId || "INS-2026-JUWEI-PRIM01"),
      primaryDeviceId: String(payload.primaryDeviceId || "dev_primary_admin_pc"),
      systemResetVersion: String(payload.systemResetVersion ?? 1),
      systemResetTimestamp: String(payload.systemResetTimestamp || new Date().toISOString()),
      systemResetId: String(payload.systemResetId || "RESET-INIT"),
      systemResetBy: String(payload.systemResetBy || "SUPER ADMINISTRATOR"),
      stateRevision: String(payload.stateRevision ?? 1),
      operationalRoles: JSON.stringify(payload.operationalRoles || payload.state?.operationalRoles || []),
      receivingCategories: JSON.stringify(payload.receivingCategories || payload.state?.receivingCategories || []),
      initialized: "true"
    };

    for (const [key, val] of Object.entries(metaValues)) {
      if (dbCache.meta.get(key) !== val) {
        statements.upsertMeta.run(key, val);
        pendingMeta.set(key, val);
      }
    }

    // 3. Process Tombstones
    const currentRecTombstones = new Set<string>(
      Array.isArray(payload.deletedRecordTombstones) ? payload.deletedRecordTombstones.map((x: any) => String(x)) : []
    );
    for (const id of currentRecTombstones) {
      if (!dbCache.recordTombstones.has(id)) {
        statements.insertRecTombstone.run(id, new Date().toISOString());
        pendingRecordTombstones.add(id);
      }
    }
    for (const id of dbCache.recordTombstones) {
      if (!currentRecTombstones.has(id)) {
        statements.deleteRecTombstone.run(id);
        pendingRecordTombstones.delete(id);
      }
    }

    const currentUserTombstones = new Set<string>(
      Array.isArray(payload.deletedUserTombstones) ? payload.deletedUserTombstones.map((x: any) => String(x).toUpperCase().trim()) : []
    );
    for (const empId of currentUserTombstones) {
      if (!dbCache.userTombstones.has(empId)) {
        statements.insertUserTombstone.run(empId, new Date().toISOString());
        pendingUserTombstones.add(empId);
      }
    }
    for (const empId of dbCache.userTombstones) {
      if (!currentUserTombstones.has(empId)) {
        statements.deleteUserTombstone.run(empId);
        pendingUserTombstones.delete(empId);
      }
    }

    activeDb.exec("COMMIT;");

    // Success: Update cache with committed changes
    dbCache.collections = pendingCollections;
    dbCache.meta = pendingMeta;
    dbCache.recordTombstones = pendingRecordTombstones;
    dbCache.userTombstones = pendingUserTombstones;

    return true;
  } catch (err) {
    try {
      activeDb.exec("ROLLBACK;");
    } catch (rbErr) {}
    console.error("CRITICAL: Failed diff-based SQLite transaction:", err);
    // On any error, leave dbCache untouched
    return false;
  }
}

/**
 * Read the full database state from SQLite into a standardized database object
 */
export function readDatabaseFromSqlite(dbInstance?: SqliteDatabase): any {
  const db = dbInstance || activeDb;
  if (!db) {
    throw new Error("No active SQLite database instance");
  }

  // 1. Read Meta
  const metaMap = new Map<string, string>();
  try {
    const metaRows = db.prepare("SELECT key, value FROM meta").all();
    for (const row of metaRows) {
      if (row && row.key) metaMap.set(String(row.key), String(row.value));
    }
  } catch (e) {}

  let operationalRoles: string[] = [];
  try {
    operationalRoles = JSON.parse(metaMap.get("operationalRoles") || "[]");
  } catch (e) {
    operationalRoles = [];
  }

  let receivingCategories: string[] = [];
  try {
    receivingCategories = JSON.parse(metaMap.get("receivingCategories") || "[]");
  } catch (e) {
    receivingCategories = [];
  }

  // 2. Read Collections
  const collectionsData: Record<string, any[]> = {};
  for (const table of ALL_COLLECTION_TABLES) {
    let orderClause = "ORDER BY seq ASC";
    if (table === "stock_movements") {
      // Preserve array order: newest first because server uses unshift
      orderClause = "ORDER BY seq DESC";
    }

    try {
      const rows = db.prepare(`SELECT data FROM ${table} ${orderClause}`).all();
      const items: any[] = [];
      for (const row of rows) {
        if (row && row.data) {
          try {
            items.push(JSON.parse(row.data));
          } catch (pErr) {}
        }
      }
      collectionsData[table] = items;
    } catch (e) {
      collectionsData[table] = [];
    }
  }

  // Preserve registered_users order: Super Admin JPMP-002 first
  const users = collectionsData["registered_users"] || [];
  const superAdminIdx = users.findIndex(
    (u: any) => (u.employeeId || "").toUpperCase().trim() === "JPMP-002"
  );
  if (superAdminIdx > 0) {
    const [superAdmin] = users.splice(superAdminIdx, 1);
    users.unshift(superAdmin);
  }

  // Keep last 200 chat messages
  const chatMessages = (collectionsData["chat_messages"] || []).slice(-200);

  // 3. Read Tombstones
  const deletedRecordTombstones: string[] = [];
  try {
    const recRows = db.prepare("SELECT id FROM deleted_record_tombstones").all();
    for (const row of recRows) {
      if (row && row.id) deletedRecordTombstones.push(String(row.id));
    }
  } catch (e) {}

  const deletedUserTombstones: string[] = [];
  try {
    const userRows = db.prepare("SELECT employee_id FROM deleted_user_tombstones").all();
    for (const row of userRows) {
      if (row && row.employee_id) deletedUserTombstones.push(String(row.employee_id));
    }
  } catch (e) {}

  const stateObj = {
    stocks: collectionsData["stocks"] || [],
    receiving: collectionsData["receiving"] || [],
    returns: collectionsData["returns_log"] || [],
    recycling: collectionsData["recycling"] || [],
    issuances: collectionsData["issuances"] || [],
    deliveries: collectionsData["deliveries"] || [],
    envLogs: collectionsData["env_logs"] || [],
    forkliftChecks: collectionsData["forklift_checks"] || [],
    registries: collectionsData["registries"] || [],
    registeredUsers: users,
    stockMovements: collectionsData["stock_movements"] || [],
    operationalRoles,
    receivingCategories
  };

  return {
    installationId: metaMap.get("installationId") || "INS-2026-JUWEI-PRIM01",
    primaryDeviceId: metaMap.get("primaryDeviceId") || "dev_primary_admin_pc",
    systemResetVersion: Number(metaMap.get("systemResetVersion")) || 1,
    systemResetTimestamp: metaMap.get("systemResetTimestamp") || new Date().toISOString(),
    systemResetId: metaMap.get("systemResetId") || "RESET-INIT",
    systemResetBy: metaMap.get("systemResetBy") || "SUPER ADMINISTRATOR",
    stateRevision: Number(metaMap.get("stateRevision")) || 1,
    operationalRoles,
    receivingCategories,
    state: stateObj,
    stocks: stateObj.stocks,
    receiving: stateObj.receiving,
    returns: stateObj.returns,
    recycling: stateObj.recycling,
    issuances: stateObj.issuances,
    deliveries: stateObj.deliveries,
    envLogs: stateObj.envLogs,
    forkliftChecks: stateObj.forkliftChecks,
    registries: stateObj.registries,
    registeredUsers: users,
    stockMovements: stateObj.stockMovements,
    authorizedDevices: collectionsData["authorized_devices"] || [],
    chatMessages,
    deletedRecordTombstones,
    deletedUserTombstones
  };
}

/**
 * Validate an SQLite database file without modifying it.
 * Verifies non-empty file, integrity_check, tables exist, and loads data.
 */
export function validateDatabaseFile(filePath: string): { valid: boolean; error?: string; data?: any } {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: "File does not exist" };
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return { valid: false, error: "File is 0 bytes (empty)" };
    }

    const testDb = openSqliteDatabase(filePath, { readonly: true });
    try {
      // 1. Integrity check
      const checkRow = testDb.prepare("PRAGMA quick_check;").get() as any;
      const checkResult = checkRow ? Object.values(checkRow)[0] : null;
      if (checkResult !== "ok") {
        testDb.close();
        return { valid: false, error: `SQLite quick_check failed: ${checkResult}` };
      }

      // 2. Read state data
      const data = readDatabaseFromSqlite(testDb);
      testDb.close();

      return { valid: true, data };
    } catch (innerErr: any) {
      try {
        testDb.close();
      } catch (cErr) {}
      return { valid: false, error: innerErr?.message || String(innerErr) };
    }
  } catch (err: any) {
    return { valid: false, error: err?.message || String(err) };
  }
}

/**
 * Backup the active database to a target path using VACUUM INTO
 */
export function vacuumInto(targetPath: string): void {
  if (!activeDb) {
    throw new Error("Cannot execute VACUUM INTO: no active SQLite database.");
  }

  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // SQLite VACUUM INTO requires target file to not exist
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }

  activeDb.prepare("VACUUM INTO ?;").run(targetPath);
}

/**
 * Checkpoint WAL and close active database connection cleanly
 */
export function checkpointAndClose(): void {
  if (!activeDb) return;
  try {
    activeDb.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch (e) {
    console.error("[SQLITE STORE] WAL checkpoint error:", e);
  }

  try {
    activeDb.close();
  } catch (e) {
    console.error("[SQLITE STORE] Close error:", e);
  }

  activeDb = null;
  statements = null;
  dbCache.initialized = false;
}
