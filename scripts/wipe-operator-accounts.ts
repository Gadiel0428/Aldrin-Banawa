import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

async function promptForConfirm(): Promise<void> {
  if (!input.isTTY) {
    console.error("[ABORTED] Interactive terminal required. Type CONFIRM to wipe operator accounts.");
    process.exit(1);
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      "DANGER: This will wipe all non-admin operator accounts (preserving only Super Admin JPMP-002).\nType the word CONFIRM to proceed: "
    );
    if (answer.trim() !== "CONFIRM") {
      console.error("[ABORTED] Confirmation did not match CONFIRM. Accounts untouched.");
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
  const targetPath = fs.existsSync(centralJsonPath) ? centralJsonPath : cwdJsonPath;
  const timestamp = new Date().toISOString();

  let store: any = { state: {} };
  if (fs.existsSync(targetPath)) {
    try {
      store = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
    } catch {}
  }
  if (!store.state || typeof store.state !== "object") store.state = {};

  const existingUsers: any[] = Array.isArray(store.state.registeredUsers) ? store.state.registeredUsers : [];
  const superAdmin = existingUsers.find(
    (u) => String(u?.employeeId || "").toUpperCase().trim() === "JPMP-002"
  ) || {
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
    reset_version: 1,
  };

  store.state.registeredUsers = [superAdmin];
  store.systemResetVersion = Number(store.systemResetVersion || 1) + 1;
  store.systemResetTimestamp = timestamp;
  store.systemResetId = `WIPE-ACC-${Date.now()}`;
  store.systemResetBy = "SERVER CLI";

  fs.writeFileSync(centralJsonPath, JSON.stringify(store, null, 2), "utf-8");
  if (cwdJsonPath !== centralJsonPath) {
    try {
      fs.writeFileSync(cwdJsonPath, JSON.stringify(store, null, 2), "utf-8");
    } catch {}
  }

  console.log("Operator accounts wiped (Super Admin JPMP-002 retained). Restart server or resync terminals.");
}

run().catch((err) => {
  console.error("Fatal error wiping operator accounts:", err);
  process.exit(1);
});
