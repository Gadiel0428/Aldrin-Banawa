/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Sparkles, RefreshCw, X } from 'lucide-react';

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
  return (
    <div
      id="version-update-banner"
      className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white px-4 py-2.5 shadow-md border-b border-indigo-500/30 relative z-50 flex items-center justify-between flex-wrap gap-2 transition-all duration-300"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="h-7 w-7 rounded-lg bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shrink-0">
          <Sparkles className="h-4 w-4 text-amber-300 animate-pulse" />
        </div>
        <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
          <span className="font-semibold text-white tracking-tight">
            A new version of JUWEI WMS is available.
          </span>
          {newVersion && (
            <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
              v{newVersion}
            </span>
          )}
          <span className="text-[11px] text-indigo-200 hidden md:inline">
            Reload to apply the latest updates and improvements.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <button
          type="button"
          id="btn-update-later"
          onClick={onLater}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1"
        >
          <span>Later</span>
        </button>
        <button
          type="button"
          id="btn-update-reload"
          onClick={onReload}
          className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 shadow-sm transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
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
