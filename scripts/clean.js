import fs from 'node:fs';
import path from 'node:path';

// SAFETY GUARANTEE:
// This build cleanup script ONLY deletes ephemeral build output directories ('dist', 'release', 'server.js')
// inside the project root repository. It NEVER accesses, modifies, or deletes anything inside
// JUWEI_DATA_DIR, backups, or persistent database locations.

const targets = ['dist', 'release', 'server.js'];

for (const target of targets) {
  try {
    const fullPath = path.resolve(process.cwd(), target);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  } catch (err) {
    // Non-fatal cleanup
  }
}

