import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {defineConfig} from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  const buildTimestamp = Date.now();
  const normalizeVer = (v: unknown) => String(v || '').replace(/^v/i, '').trim();
  const cmpVer = (a: string, b: string) => {
    const pa = normalizeVer(a).split(/[.-]/).map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : 0));
    const pb = normalizeVer(b).split(/[.-]/).map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : 0));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
  };

  const candidates: string[] = [];
  try {
    const buildInfoPath = path.resolve(__dirname, 'public/build-info.json');
    if (fs.existsSync(buildInfoPath)) {
      const bInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
      if (bInfo.version) candidates.push(normalizeVer(bInfo.version));
    }
  } catch (e) {}

  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
    if (pkg.version) candidates.push(normalizeVer(pkg.version));
  } catch (e) {}

  let appVersion = candidates.filter(Boolean).sort((a, b) => cmpVer(b, a))[0] || '';
  if (!appVersion) {
    try {
      const relPath = path.resolve(__dirname, 'latest-github-release.json');
      if (fs.existsSync(relPath)) {
        const rInfo = JSON.parse(fs.readFileSync(relPath, 'utf8'));
        if (rInfo.version) appVersion = normalizeVer(rInfo.version);
      }
    } catch (e) {}
  }

  return {
    base: './',
    define: {
      __BUILD_ID__: JSON.stringify(buildTimestamp),
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'react': path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      },
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
