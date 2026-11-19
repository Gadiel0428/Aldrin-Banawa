/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle, Database, CheckCircle2, Clock, Laptop, ShieldCheck, Settings2, Globe, Activity, Ban } from 'lucide-react';
import { syncManager, getMutationQueue } from '../sync/syncManager';
import { SyncStatusInfo } from '../types/sync';
import { QueuedMutation } from '../types';
import { getCentralServerUrl } from '../config/serverConfig';

interface SyncStatusProps {
  onOpenSettings?: () => void;
  onOpenDiagnostics?: () => void;
  onOpenConflicts?: () => void;
}

export const SyncStatus: React.FC<SyncStatusProps> = ({
  onOpenSettings,
  onOpenDiagnostics,
  onOpenConflicts,
}) => {
  const [status, setStatus] = useState<SyncStatusInfo>(syncManager.getStatus());
  const [isOpen, setIsOpen] = useState(false);
  const [queueItems, setQueueItems] = useState<QueuedMutation[]>(() => getMutationQueue());
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const unsub = syncManager.subscribe((newStatus) => {
      setStatus(newStatus);
      setQueueItems(getMutationQueue());
    });
    setQueueItems(getMutationQueue());
    return unsub;
  }, []);

  const handleForceSync = async () => {
    if (status.isRevoked) return;
    setIsRefreshing(true);
    try {
      await syncManager.forceSyncNow(true);
      setQueueItems(getMutationQueue());
    } finally {
      setIsRefreshing(false);
    }
  };

  const pendingCount = queueItems.length;
  const conflictCount = queueItems.filter((q) => q.status === 'CONFLICT').length;

  const getBadgeStyle = () => {
    if (status.isRevoked || status.state === 'REVOKED') {
      return {
        bg: 'bg-rose-600/15 text-rose-700 border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-300',
        dot: 'bg-rose-600',
        icon: <Ban className="w-3.5 h-3.5" />,
        label: 'This computer was removed from the system',
      };
    }
    if (status.state === 'SYNCING' || isRefreshing) {
      return {
        bg: 'bg-amber-500/10 text-amber-600 border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-400',
        dot: 'bg-amber-500 animate-spin',
        icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
        label: pendingCount > 0 ? `${pendingCount} changes waiting` : 'Synchronizing...',
      };
    }
    if (!status.isOnline || status.state === 'OFFLINE') {
      return {
        bg: 'bg-orange-500/10 text-orange-600 border-orange-500/30 dark:bg-orange-500/20 dark:text-orange-400',
        dot: 'bg-orange-500',
        icon: <WifiOff className="w-3.5 h-3.5" />,
        label: pendingCount > 0 ? `Offline (${pendingCount} changes waiting)` : 'Offline Mode',
      };
    }
    if (status.state === 'ERROR' || conflictCount > 0) {
      return {
        bg: 'bg-rose-500/10 text-rose-600 border-rose-500/30 dark:bg-rose-500/20 dark:text-rose-400',
        dot: 'bg-rose-500',
        icon: <AlertCircle className="w-3.5 h-3.5" />,
        label: `${pendingCount} changes waiting (${conflictCount} conflict${conflictCount === 1 ? '' : 's'})`,
      };
    }
    return {
      bg: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-300',
      dot: 'bg-emerald-500 animate-pulse',
      icon: <Wifi className="w-3.5 h-3.5" />,
      label: pendingCount > 0 ? `${pendingCount} changes waiting` : 'Online • Live Sync',
    };
  };

  const badge = getBadgeStyle();

  return (
    <div className="relative inline-block text-xs font-medium">
      {/* Status Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border transition-all shadow-xs hover:shadow-md cursor-pointer relative shrink-0 ${badge.bg}`}
        title={`Sync Status: ${badge.label} • Central Server: ${getCentralServerUrl()} (Click for details & diagnostics)`}
        aria-label={`Sync Status: ${badge.label}`}
      >
        <span className="relative flex items-center justify-center shrink-0">
          {badge.icon}
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-white text-[9px] font-bold rounded-full min-w-3.5 h-3.5 flex items-center justify-center px-0.5">
              {pendingCount}
            </span>
          )}
        </span>
      </button>

      {/* Detail Popover Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl z-50 text-slate-800 dark:text-slate-100">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-500" />
              <span className="font-bold text-sm">Centralized Sync Engine</span>
            </div>
            <button
              onClick={handleForceSync}
              disabled={isRefreshing || status.isRevoked}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:hover:bg-indigo-900 dark:text-indigo-300 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              Sync Now
            </button>
          </div>

          {status.isRevoked && (
            <div className="mb-3 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
              <Ban className="w-4 h-4 shrink-0" />
              <span>This computer was removed from the system</span>
            </div>
          )}

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                <span>Central Endpoint</span>
              </div>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 truncate max-w-[180px]" title={getCentralServerUrl()}>
                {getCentralServerUrl()}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                <Laptop className="w-3.5 h-3.5 text-slate-400" />
                <span>Device ID</span>
              </div>
              <span className="font-mono font-bold text-slate-900 dark:text-slate-200">{status.deviceId}</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Single Source of Truth</span>
              </div>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Central Backend Database</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Last Synchronized</span>
              </div>
              <span className="text-slate-700 dark:text-slate-300">
                {status.lastSyncTimestamp ? new Date(status.lastSyncTimestamp).toLocaleTimeString() : 'Never'}
              </span>
            </div>
          </div>

          {/* Pending Offline Transactions Queue */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-xs uppercase tracking-wider text-slate-500">
                {pendingCount > 0 ? `${pendingCount} changes waiting` : '0 changes waiting'}
              </span>
              {conflictCount > 0 && onOpenConflicts && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenConflicts();
                  }}
                  className="text-[10px] font-bold text-rose-600 hover:text-rose-500 dark:text-rose-400 cursor-pointer"
                >
                  Review {conflictCount} Conflict{conflictCount === 1 ? '' : 's'}
                </button>
              )}
            </div>

            {queueItems.length === 0 ? (
              <div className="flex items-center gap-2 py-3 px-2 text-xs text-slate-400 dark:text-slate-500 italic">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>All changes confirmed by central server.</span>
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {queueItems.map((item) => {
                  const itemStatus = item.status || 'PENDING';
                  const targetRecordId = item.recordId || item.record?.id || item.idempotencyKey || item.id;
                  return (
                    <div
                      key={item.id}
                      className="p-2 rounded border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-[11px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-700 dark:text-slate-300 uppercase">
                          {item.collection || 'stocks'} • {item.type}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            itemStatus === 'CONFLICT'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : itemStatus === 'SYNCING'
                              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                              : itemStatus === 'FAILED'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {itemStatus}
                        </span>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 mt-1 truncate">
                        Record: <span className="font-mono">{String(targetRecordId).slice(0, 20)}</span>
                        {item.retryCount ? ` • Retries: ${item.retryCount}` : ''}
                      </div>
                      {item.lastError && (
                        <div className="text-rose-600 dark:text-rose-400 mt-1 text-[10px] truncate" title={item.lastError}>
                          Err: {item.lastError}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            {onOpenDiagnostics && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenDiagnostics();
                }}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5" />
                Startup Diagnostics
              </button>
            )}
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenSettings();
                }}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors cursor-pointer ml-auto"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Central Database
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
