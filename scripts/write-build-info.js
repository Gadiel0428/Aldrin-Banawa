import fs from 'node:fs';
import path from 'node:path';

try {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkgData.version || '1.0.0';
  const buildId = Date.now();

  const distDir = path.resolve(process.cwd(), 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const buildInfoPath = path.join(distDir, 'build-info.json');
  const buildInfo = {
    buildId,
    version,
    builtAt: new Date(buildId).toISOString()
  };

  fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2), 'utf8');
  console.log(`[WRITE-BUILD-INFO] Successfully generated dist/build-info.json: buildId=${buildId}, version=${version}`);
} catch (err) {
  console.error('[WRITE-BUILD-INFO] Error generating build-info.json:', err);
  process.exit(1);
}
