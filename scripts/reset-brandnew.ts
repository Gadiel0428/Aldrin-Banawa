import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://bbzqmmlhcwwjiewdfdmq.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

console.log("Connecting to Supabase at:", supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey);

async function resetAllData() {
  const tables = [
    'stocks',
    'receiving',
    'returns',
    'recycling',
    'issuances',
    'deliveries',
    'env_logs',
    'forklift_checks',
    'registries',
    'chat_messages'
  ];

  for (const table of tables) {
    try {
      console.log(`Clearing table: ${table}...`);
      const { error } = await supabase.from(table).delete().neq('id', '___NEVER_MATCH___');
      if (error) {
        console.warn(`Error clearing ${table}:`, error.message);
      } else {
        console.log(`Successfully cleared ${table}`);
      }
    } catch (e: any) {
      console.warn(`Exception on ${table}:`, e.message);
    }
  }

  // Registered users: Delete all accounts except JPMP-002
  try {
    console.log("Purging all non-super-admin accounts from registered_users...");
    const { error: delErr } = await supabase.from('registered_users').delete().neq('employee_id', 'JPMP-002');
    if (delErr) {
      console.warn("Error deleting non-admin users:", delErr.message);
    }

    // Ensure Super Admin JPMP-002 is present with PIN 0423
    const superAdminRecord = {
      employee_id: 'JPMP-002',
      username: 'ALDRIN BANAWA',
      role: 'SUPER ADMINISTRATOR',
      permission: 'FULL_ACCESS',
      pin_hash: '0423',
      updated_at: new Date().toISOString()
    };
    const { error: upsertErr } = await supabase.from('registered_users').upsert([superAdminRecord]);
    if (upsertErr) {
      console.warn("Error upserting super admin:", upsertErr.message);
    } else {
      console.log("Super Administrator (JPMP-002) set successfully.");
    }
  } catch (e: any) {
    console.warn("Exception on registered_users:", e.message);
  }

  // Insert fresh system init message
  try {
    const initMsg = {
      id: 'sys-init',
      sender: 'System',
      text: 'JUWEI WAREHOUSE MANAGEMENT SYSTEM ISO 9001:2015 Real-time Database Initialized.',
      timestamp: new Date().toISOString(),
      is_system: true
    };
    await supabase.from('chat_messages').upsert([initMsg]);
    console.log("Clean system chat message initialized.");
  } catch (e: any) {
    console.warn("Exception inserting initial chat message:", e.message);
  }

  // Reset local data-store.json
  const DATA_FILE = path.join(process.cwd(), "data-store.json");
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
      registeredUsers: [
        {
          employeeId: "JPMP-002",
          username: "ALDRIN BANAWA",
          role: "SUPER ADMINISTRATOR",
          phoneNumber: "+639669858846",
          permission: "FULL_ACCESS",
          pin: "0423"
        }
      ]
    },
    chatMessages: [
      {
        id: "sys-init",
        sender: "System",
        text: "JUWEI WAREHOUSE MANAGEMENT SYSTEM ISO 9001:2015 Real-time Database Initialized.",
        timestamp: new Date().toISOString(),
        isSystem: true
      }
    ]
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(brandNewStore, null, 2), "utf-8");
  console.log("data-store.json successfully reset to brand new empty factory state.");
}

resetAllData().then(() => {
  console.log("Brand new database reset completed successfully!");
  process.exit(0);
}).catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
