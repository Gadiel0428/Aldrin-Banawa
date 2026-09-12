/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Database, Server, Wifi, RefreshCw, CheckCircle2, ShieldAlert, Laptop, Clock, Activity, HardDrive, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getApiBaseUrl, getCentralServerUrl } from '../config/serverConfig';

interface CentralDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  systemResetVersion: number;
  systemResetId: string;
  onForceSync: () => void;
  isManualSyncing: boolean;
  totalRecordsCount?: number;
  totalUsersCount?: number;
}

export default function CentralDatabaseModal({
  isOpen,
  onClose,
  connectionStatus,
  systemResetVersion,
  systemResetId,
  onForceSync,
  isManualSyncing,
  totalRecordsCount = 0,
  totalUsersCount = 1,
}: CentralDatabaseModalProps) {
  const [healthInfo, setHealthInfo] = useState<{
    status: string;
    uptime?: number;
    dbCommitted?: boolean;
  } | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const checkServerHealth = async () => {
    setIsChecking(true);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setHealthInfo({ status: 'OK', uptime: data.uptime, dbCommitted: true });
      } else {
        setHealthInfo({ status: 'ERROR', dbCommitted: false });
      }
    } catch {
      setHealthInfo({ status: 'OFFLINE', dbCommitted: false });
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkServerHealth();
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="central-db-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
        >
          <motion.div
            key="central-db-modal-content"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-white tracking-wide">
                    Central Database & Realtime Engine
                  </h3>
                  <p className="text-xs text-slate-400">
                    Self-hosted authoritative single source of truth for all terminals
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-sm">
              {/* Architecture Banner */}
              <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-start gap-3">
                <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg shrink-0 mt-0.5">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider">
                    Pure Centralized Architecture Active
                  </h4>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    All operator accounts, PINs, inventory stocks, and transactions are committed directly to the central backend database on the server before WebSocket events are broadcast. No third-party cloud services, Supabase, or unauthoritative client caches are used.
                  </p>
                </div>
              </div>

              {/* Status Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                    WebSocket Status
                  </span>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        connectionStatus === 'connected'
                          ? 'bg-emerald-400 animate-pulse'
                          : connectionStatus === 'connecting'
                          ? 'bg-amber-400 animate-spin'
                          : 'bg-rose-500'
                      }`}
                    />
                    <span className="font-bold text-xs font-mono text-white capitalize">
                      {connectionStatus}
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                    Reset Version
                  </span>
                  <span className="font-mono font-bold text-xs text-indigo-400 mt-1.5 block">
                    v{systemResetVersion}
                  </span>
                </div>

                <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                    Total Records
                  </span>
                  <span className="font-mono font-bold text-xs text-white mt-1.5 block">
                    {totalRecordsCount} Items
                  </span>
                </div>

                <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                    Authorized Users
                  </span>
                  <span className="font-mono font-bold text-xs text-white mt-1.5 block">
                    {totalUsersCount} Operators
                  </span>
                </div>
              </div>

              {/* Server Details */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Backend Server Identity
                </h4>
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2 font-mono text-xs text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Central Endpoint:</span>
                    <span className="text-emerald-400 font-bold truncate max-w-[280px]" title={getCentralServerUrl()}>{getCentralServerUrl()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Service:</span>
                    <span className="text-slate-200">Express REST + WS Server</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">System Reset ID:</span>
                    <span className="text-slate-200 truncate max-w-[200px]">{systemResetId || 'RESET-INIT'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Durability Mode:</span>
                    <span className="text-emerald-400">Synchronous Disk Commit Before Broadcast</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between p-4 border-t border-slate-800 bg-slate-950/50">
              <button
                type="button"
                onClick={checkServerHealth}
                disabled={isChecking}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition px-3 py-2 rounded-lg hover:bg-slate-800"
              >
                <Activity className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                Check Server Health
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onForceSync}
                  disabled={isManualSyncing}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isManualSyncing ? 'animate-spin' : ''}`} />
                  Resync from Central DB
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
