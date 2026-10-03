import fs from "fs";
import path from "path";

console.log("Resetting JUWEI WMS central database to brand new factory state...");

function getStorageFilePath(filename: string): string {
  const customDir = process.env.JUWEI_DATA_DIR;
  if (customDir) {
    try {
      if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
      return path.join(customDir, filename);
    } catch (e) {}
  }
  return path.join(process.cwd(), filename);
}

async function resetAllData() {
  const DATA_FILE = path.join(process.cwd(), "data-store.json");
  const timestamp = new Date().toISOString();
  const fileTimestamp = timestamp.replace(/[:.]/g, "-");

  // Move existing central-database.sqlite (and -wal/-shm) aside as .pre-reset-<timestamp> instead of deleting it
  const sqliteFiles = [
    getStorageFilePath("central-database.sqlite"),
    getStorageFilePath("central-database.sqlite-wal"),
    getStorageFilePath("central-database.sqlite-shm"),
    path.join(process.cwd(), "central-database.sqlite"),
    path.join(process.cwd(), "central-database.sqlite-wal"),
    path.join(process.cwd(), "central-database.sqlite-shm")
  ];

  const uniqueFiles = Array.from(new Set(sqliteFiles));
  for (const file of uniqueFiles) {
    if (fs.existsSync(file)) {
      const backupPath = `${file}.pre-reset-${fileTimestamp}`;
      try {
        fs.renameSync(file, backupPath);
        console.log(`[PRE-RESET BACKUP] Moved ${file} aside to ${backupPath}`);
      } catch (err) {
        console.warn(`Could not move ${file} aside:`, err);
      }
    }
  }

  const brandNewStore = {
    state: {
      stocks: [],
      receiving: [],
      returns: [],
      recycling: [],
      issuances: [],
      deliveries: [],
      envLogs: [],
      forkliftChecks: [],
      registries: [],
      stockMovements: [],
      registeredUsers: [
        {
          id: "USR-JPMP-002",
          employeeId: "JPMP-002",
          username: "ALDRIN BANAWA",
          role: "SUPER ADMINISTRATOR",
          phoneNumber: "+639669858846",
          permission: "FULL_ACCESS",
          pin: "0423",
          status: "ACTIVE",
          registeredBy: "SYSTEM",
          registeredBySuperAdmin: true,
          registeredAt: timestamp,
          version: 1,
          updated_at: timestamp,
          reset_version: 1
        }
      ]
    },
    chatMessages: [
      {
        id: "sys-init",
        sender: "SYSTEM SECURITY AUDIT",
        text: "JUWEI WAREHOUSE MANAGEMENT SYSTEM ISO 9001:2015 Central Real-time Database Initialized.",
        timestamp,
        isSystem: true
      }
    ],
    stateRevision: 1,
    systemResetVersion: 1,
    systemResetTimestamp: timestamp,
    systemResetId: `INIT-${Date.now()}`,
    systemResetBy: "ALDRIN BANAWA (SUPER ADMINISTRATOR)"
  };

  const CENTRAL_DB_FILE = getStorageFilePath("central-database.json");
  const CWD_DB_FILE = path.join(process.cwd(), "central-database.json");

  fs.writeFileSync(CENTRAL_DB_FILE, JSON.stringify(brandNewStore, null, 2), "utf-8");
  if (CWD_DB_FILE !== CENTRAL_DB_FILE) {
    try {
      fs.writeFileSync(CWD_DB_FILE, JSON.stringify(brandNewStore, null, 2), "utf-8");
    } catch (e) {}
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(brandNewStore, null, 2), "utf-8");
  console.log("central-database.json and data-store.json successfully reset to factory brand-new state.");
  console.log("The server will import central-database.json into SQLite on next start.");
}

resetAllData().then(() => {
  console.log("Central database factory reset completed successfully!");
  process.exit(0);
}).catch(err => {
  console.error("Fatal error during reset:", err);
  process.exit(1);
});
