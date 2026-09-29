import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

try {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  let version = '';
  let versionSource = '';

  // 1. Fetch remote tags if inside a git repository (essential for shallow clones on Render or CI)
  try {
    execSync('git fetch --tags origin', {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 10000,
      windowsHide: true
    });
    console.log('[WRITE-BUILD-INFO] Successfully fetched tags from origin.');
  } catch (fetchOriginErr) {
    try {
      execSync('git fetch --tags', {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 10000,
        windowsHide: true
      });
      console.log('[WRITE-BUILD-INFO] Successfully fetched tags.');
    } catch (fetchErr) {
      // Ignored if offline, shallow with no remote, or not a git repository
    }
  }

  // 2. Try git describe --tags --abbrev=0 at build time
  try {
    const gitTag = execSync('git describe --tags --abbrev=0', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    }).trim();

    if (gitTag) {
      // Strip leading 'v' or 'V' if present to normalize version string
      version = gitTag.replace(/^v/i, '');
      versionSource = 'git describe --tags';
      console.log(`[WRITE-BUILD-INFO] Resolved version from git tag: ${gitTag} -> ${version}`);
    }
  } catch (gitErr) {
    // If git describe fails, try getting the latest release tag from git tag -l
    try {
      const allTagsRaw = execSync('git tag -l "v*"', {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      }).trim();

      const allTags = allTagsRaw.split('\n').map(t => t.trim()).filter(Boolean);
      if (allTags.length > 0) {
        // Sort tags by semver descending
        allTags.sort((a, b) => {
          const parse = (str) => str.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
          const pa = parse(a);
          const pb = parse(b);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pb[i] || 0) - (pa[i] || 0);
            if (diff !== 0) return diff;
          }
          return b.localeCompare(a);
        });
        version = allTags[0].replace(/^v/i, '');
        versionSource = 'git tag -l (latest semver tag)';
        console.log(`[WRITE-BUILD-INFO] Resolved version from latest git tag: ${allTags[0]} -> ${version}`);
      }
    } catch (tagErr) {
      console.log('[WRITE-BUILD-INFO] git describe/tag failed or has no tags. Falling back to package.json.');
    }
  }

  // 3. Fall back to package.json version field
  if (!version) {
    version = (pkgData.version || '').replace(/^v/i, '');
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
