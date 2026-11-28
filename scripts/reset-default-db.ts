import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

async function promptForConfirm(): Promise<void> {
  if (!input.isTTY) {
    console.error("[ABORTED] Interactive terminal required. Type CONFIRM to reset default database.");
    process.exit(1);
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      "DANGER: This will erase operational warehouse records (keeping operator accounts).\nType the word CONFIRM to proceed: "
    );
    if (answer.trim() !== "CONFIRM") {
      console.error("[ABORTED] Confirmation did not match CONFIRM. Database untouched.");
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}

function getStorageFilePath(filename: string): string {
  const customDir = process.env.JUWEI_DATA_DIR;
  if (customDir) {
    try {
      if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
      return path.join(customDir, filename);
    } catch {}
  }
  return path.join(process.cwd(), filename);
}

async function run() {
  await promptForConfirm();

  const centralJsonPath = getStorageFilePath("central-database.json");
  const cwdJsonPath = path.join(process.cwd(), "central-database.json");
  const sourceJsonPath = fs.existsSync(centralJsonPath) ? centralJsonPath : cwdJsonPath;

  let existingUsers: unknown[] = [];
  if (fs.existsSync(sourceJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(sourceJsonPath, "utf-8"));
      if (Array.isArray(parsed?.state?.registeredUsers)) {
        existingUsers = parsed.state.registeredUsers;
      }
    } catch {}
  }

  const timestamp = new Date().toISOString();
  const fileTimestamp = timestamp.replace(/[:.]/g, "-");

  for (const sqliteName of ["central-database.sqlite", "central-database.sqlite-wal", "central-database.sqlite-shm"]) {
    for (const candidate of Array.from(new Set([getStorageFilePath(sqliteName), path.join(process.cwd(), sqliteName)]))) {
      if (fs.existsSync(candidate)) {
        try {
          fs.renameSync(candidate, `${candidate}.pre-reset-${fileTimestamp}`);
        } catch {}
      }
    }
  }

  const nextStore = {
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
      registeredUsers: existingUsers,
    },
    chatMessages: [
      {
        id: `sys-reset-${Date.now()}`,
        sender: "SYSTEM SECURITY AUDIT",
        text: `SERVER COMMAND: Default warehouse database reset executed at ${timestamp} (operator accounts preserved).`,
        timestamp,
        isSystem: true,
      },
    ],
    stateRevision: Date.now(),
    systemResetVersion: Date.now(),
    systemResetTimestamp: timestamp,
    systemResetId: `RESET-${Date.now()}`,
    systemResetBy: "SERVER CLI",
  };

  fs.writeFileSync(centralJsonPath, JSON.stringify(nextStore, null, 2), "utf-8");
  if (cwdJsonPath !== centralJsonPath) {
    try {
      fs.writeFileSync(cwdJsonPath, JSON.stringify(nextStore, null, 2), "utf-8");
    } catch {}
  }

  console.log("Default warehouse database reset completed. Restart the server to apply.");
}

run().catch((err) => {
  console.error("Fatal error resetting default database:", err);
  process.exit(1);
});
