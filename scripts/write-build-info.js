import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function normalizeVersion(v) {
  return String(v || '').replace(/^v/i, '').trim();
}

function compareSemver(a, b) {
  const cleanA = normalizeVersion(a);
  const cleanB = normalizeVersion(b);
  if (!cleanA && !cleanB) return 0;
  if (!cleanA) return -1;
  if (!cleanB) return 1;

  const pa = cleanA.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? parseInt(part, 10) : 0));
  const pb = cleanB.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? parseInt(part, 10) : 0));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

try {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const pkgVersion = normalizeVersion(pkgData.version);

  let version = '';
  let versionSource = '';

  // 1. Honor explicit CI / GitHub Actions release version env var first
  const envBuildVersion = normalizeVersion(
    process.env.BUILD_VERSION || process.env.GITHUB_RELEASE_VERSION || ''
  );
  if (envBuildVersion) {
    version = envBuildVersion;
    versionSource = 'BUILD_VERSION env';
    console.log(`[WRITE-BUILD-INFO] Resolved authoritative version from BUILD_VERSION env: ${version}`);
  }

  // 2. Otherwise inspect git tags and compare against package.json (picking highest semver)
  let gitTagVersion = '';
  let gitTagSource = '';
  if (!version) {
    try {
      execSync('git fetch --tags origin', {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 10000,
        windowsHide: true
      });
      console.log('[WRITE-BUILD-INFO] Successfully fetched tags from origin.');
    } catch {
      try {
        execSync('git fetch --tags', {
          stdio: ['ignore', 'ignore', 'ignore'],
          timeout: 10000,
          windowsHide: true
        });
        console.log('[WRITE-BUILD-INFO] Successfully fetched tags.');
      } catch {
        // Ignored if offline, shallow with no remote, or not a git repository
      }
    }

    try {
      const gitTag = execSync('git describe --tags --abbrev=0', {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      }).trim();

      if (gitTag) {
        gitTagVersion = normalizeVersion(gitTag);
        gitTagSource = 'git describe --tags';
      }
    } catch {
      // Fallback to listing semver tags
    }

    if (!gitTagVersion) {
      try {
        const allTagsRaw = execSync('git tag -l "v*"', {
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true
        }).trim();

        const allTags = allTagsRaw.split('\n').map((t) => t.trim()).filter(Boolean);
        if (allTags.length > 0) {
          allTags.sort((a, b) => compareSemver(b, a));
          gitTagVersion = normalizeVersion(allTags[0]);
          gitTagSource = 'git tag -l (latest semver tag)';
        }
      } catch {
        // Ignore if not a git repo
      }
    }

    // Never downgrade a newer package.json version to an older git tag
    if (pkgVersion && gitTagVersion) {
      if (compareSemver(pkgVersion, gitTagVersion) >= 0) {
        version = pkgVersion;
        versionSource = 'package.json';
      } else {
        version = gitTagVersion;
        versionSource = gitTagSource;
      }
    } else if (pkgVersion) {
      version = pkgVersion;
      versionSource = 'package.json';
    } else if (gitTagVersion) {
      version = gitTagVersion;
      versionSource = gitTagSource;
    }
  }

  // 3. Fall back to latest-github-release.json if present
  if (!version) {
    try {
      const relPath = path.resolve(process.cwd(), 'latest-github-release.json');
      if (fs.existsSync(relPath)) {
        const relData = JSON.parse(fs.readFileSync(relPath, 'utf8'));
        if (relData && relData.version) {
          version = normalizeVersion(relData.version);
          versionSource = 'latest-github-release.json';
        }
      }
    } catch {}
  }

  const buildId = Date.now();
  const repository = (process.env.GITHUB_REPOSITORY || process.env.GITHUB_REPO || 'Gadiel0428/Aldrin-Banawa').trim();

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
    repository,
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
