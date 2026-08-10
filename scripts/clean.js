import fs from 'node:fs';

try {
  if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true, force: true });
  }
} catch (err) {
  console.error('Error removing dist:', err);
}

try {
  if (fs.existsSync('release')) {
    fs.rmSync('release', { recursive: true, force: true });
  }
} catch (err) {
  console.error('Error removing release:', err);
}

try {
  if (fs.existsSync('server.js')) {
    fs.unlinkSync('server.js');
  }
} catch (err) {
  // ignore
}

