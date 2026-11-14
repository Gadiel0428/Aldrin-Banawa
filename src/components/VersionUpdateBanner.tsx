/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Sparkles, RefreshCw, X, Download } from 'lucide-react';

interface VersionUpdateBannerProps {
  onReload: () => void;
  onLater: () => void;
  newVersion?: string;
}

export const VersionUpdateBanner: React.FC<VersionUpdateBannerProps> = ({
  onReload,
  onLater,
  newVersion
}) => {
  const handleDownloadInstaller = async () => {
    // 1. Resolve authoritative version number
    let targetVer = (newVersion || '').replace(/^v/i, '').trim();

    if (!targetVer) {
      try {
        const res = await fetch('/api/build-info', { headers: { 'Accept': 'application/json' } });
        if (res.ok) {
          const info = await res.json();
          if (info?.version) {
            targetVer = String(info.version).replace(/^v/i, '').trim();
          }
        }
      } catch (e) {}
    }

    if (!targetVer) {
      targetVer = '1.0.94';
    }

    const repo = 'Gadiel0428/Aldrin-Banawa';
    const filename = `JUWEI.WMS.Desktop.System.Setup.${targetVer}.exe`;
    // Direct GitHub release asset download link (triggers immediate file download without visiting the GitHub website)
    const directDownloadUrl = `https://github.com/${repo}/releases/download/v${targetVer}/${filename}`;

    try {
      localStorage.setItem('juwei_wms_installed_version', targetVer);
      localStorage.setItem('juwei_wms_downloaded_version', targetVer);
    } catch (e) {}

    try {
      if (typeof window !== 'undefined' && (window as any).electronAPI?.openExternal) {
        (window as any).electronAPI.openExternal(directDownloadUrl);
        return;
      }
    } catch (e) {
      console.warn('Electron openExternal error:', e);
    }

    if (typeof window !== 'undefined') {
      const a = document.createElement('a');
      a.href = directDownloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div
      id="version-update-banner"
      className="bg-gradient-to-r from-indigo-950 via-indigo-900 to-slate-900 text-white px-4 py-2.5 shadow-md border-b border-indigo-500/30 relative z-50 flex items-center justify-between flex-wrap gap-2 transition-all duration-300"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="h-7 w-7 rounded-lg bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shrink-0">
          <Sparkles className="h-4 w-4 text-amber-300 animate-pulse" />
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium flex-wrap">
            <span className="font-semibold text-white tracking-tight">
              A new version of JUWEI WMS is available.
            </span>
            {newVersion && (
              <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                v{newVersion}
              </span>
            )}
          </div>
          <span className="text-[11px] text-indigo-200/90 hidden sm:inline">
            Most updates just need Reload. Download the installer only if Reload doesn't fix it.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-auto flex-wrap">
        <span className="text-[11px] text-indigo-200/90 sm:hidden w-full text-left">
          Most updates just need Reload. Download the installer only if Reload doesn't fix it.
        </span>
        <button
          type="button"
          id="btn-update-later"
          onClick={onLater}
          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1"
        >
          <span>Later</span>
        </button>

        <button
          type="button"
          id="btn-update-download-installer"
          onClick={handleDownloadInstaller}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-100 hover:text-white bg-indigo-800/80 hover:bg-indigo-700/90 border border-indigo-400/40 shadow-xs transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
          title="Download latest Windows setup installer (.exe) from GitHub Releases"
        >
          <Download className="h-3.5 w-3.5 text-indigo-300" />
          <span>Download Latest Installer</span>
        </button>

        <button
          type="button"
          id="btn-update-reload"
          onClick={onReload}
          className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 shadow-sm transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
          title="Reload page to load newest web bundle"
        >
          <RefreshCw className="h-3.5 w-3.5 text-slate-950 animate-spin-slow" />
          <span>Reload Now</span>
        </button>

        <button
          type="button"
          id="btn-update-dismiss"
          onClick={onLater}
          className="p-1 text-slate-400 hover:text-white rounded transition cursor-pointer"
          title="Dismiss for now"
          aria-label="Dismiss banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default VersionUpdateBanner;
