import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

try {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  let version = '';
  let versionSource = '';

  // 1. Try git describe --tags --abbrev=0 at build time
  try {
    const gitTag = execSync('git describe --tags --abbrev=0', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim();

    if (gitTag) {
      // Strip leading 'v' or 'V' if present to normalize version string
      version = gitTag.replace(/^v/i, '');
      versionSource = 'git describe --tags';
      console.log(`[WRITE-BUILD-INFO] Resolved version from git tag: ${gitTag} -> ${version}`);
    }
  } catch (gitErr) {
    // Git clone has no tags, shallow clone, or not a git repository (e.g. Render build environment)
    console.log('[WRITE-BUILD-INFO] git describe --tags failed or has no tags. Falling back to package.json.');
  }

  // 2. Fall back to package.json version field
  if (!version) {
    version = (pkgData.version || '1.0.79').replace(/^v/i, '');
    versionSource = 'package.json';
    console.log(`[WRITE-BUILD-INFO] Resolved version from package.json: ${version}`);
  }

  const buildId = Date.now();

  const distDir = path.resolve(process.cwd(), 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const publicDir = path.resolve(process.cwd(), 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const buildInfo = {
    buildId,
    version,
    versionSource,
    builtAt: new Date(buildId).toISOString()
  };

  const distPath = path.join(distDir, 'build-info.json');
  fs.writeFileSync(distPath, JSON.stringify(buildInfo, null, 2), 'utf8');

  // Also write to public/build-info.json so dev server and root static hosting can serve it immediately
  const publicPath = path.join(publicDir, 'build-info.json');
  fs.writeFileSync(publicPath, JSON.stringify(buildInfo, null, 2), 'utf8');

  console.log(`[WRITE-BUILD-INFO] Successfully generated build-info.json (version=${version}, source=${versionSource}, buildId=${buildId})`);
} catch (err) {
  console.error('[WRITE-BUILD-INFO] Error generating build-info.json:', err);
  process.exit(1);
}
