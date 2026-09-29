import fs from 'node:fs';
import path from 'node:path';

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

