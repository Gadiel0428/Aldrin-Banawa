/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BellRing, 
  ArrowDownCircle, 
  X, 
  Check, 
  User, 
  Clock, 
  Layers, 
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Database,
  Eye
} from 'lucide-react';

export interface PendingOnlineUpdate {
  id: string;
  type: 'DATA_CREATE' | 'DATA_UPDATE' | 'DATA_DELETE' | 'FORCE_SYNC' | 'GLOBAL_RESET' | 'SYNC';
  collection?: string;
  record?: any;
  recordId?: string;
  author: string;
  employeeId?: string;
  device_id?: string;
  stationId?: string;
  actionDesc?: string;
  timestamp: string;
  systemResetVersion?: number;
  // Callback when user accepts the update
  applyUpdate: () => void;
  // Dismiss without applying (or dismiss notification)
  dismissUpdate: () => void;
}

interface OnlineUpdatePromptModalProps {
  pendingUpdates: PendingOnlineUpdate[];
  onAcceptUpdate: (updateId: string) => void;
  onAcceptAllUpdates: () => void;
  onDismissUpdate: (updateId: string) => void;
  onDismissAllUpdates: () => void;
  autoAcceptCountdownSec?: number; // Optional auto-accept timer, e.g. 15s or 0 for manual only
}

export const OnlineUpdatePromptModal: React.FC<OnlineUpdatePromptModalProps> = ({
  pendingUpdates,
  onAcceptUpdate,
  onAcceptAllUpdates,
  onDismissUpdate,
  onDismissAllUpdates,
  autoAcceptCountdownSec = 0
}) => {
  const [selectedUpdateId, setSelectedUpdateId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(autoAcceptCountdownSec);

  // Active item
  const currentUpdate = pendingUpdates.find(u => u.id === selectedUpdateId) || pendingUpdates[0] || null;

  useEffect(() => {
    if (pendingUpdates.length > 0 && (!selectedUpdateId || !pendingUpdates.some(u => u.id === selectedUpdateId))) {
      setSelectedUpdateId(pendingUpdates[0].id);
    }
  }, [pendingUpdates, selectedUpdateId]);

  // Optional countdown auto-accept
  useEffect(() => {
    if (autoAcceptCountdownSec <= 0 || pendingUpdates.length === 0) return;
    setCountdown(autoAcceptCountdownSec);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          onAcceptAllUpdates();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingUpdates.length, autoAcceptCountdownSec, onAcceptAllUpdates]);

  if (pendingUpdates.length === 0) return null;

  const getCollectionBadge = (col?: string) => {
    switch (col) {
      case 'stocks':
        return { label: 'Inventory Stocks', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' };
      case 'receiving':
        return { label: 'Receiving Dock', color: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20' };
      case 'returns':
        return { label: 'Material Returns', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' };
      case 'issuances':
        return { label: 'Production Issuance', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' };
      case 'deliveries':
        return { label: 'Outbound Delivery', color: 'bg-sky-500/10 text-sky-600 border-sky-500/20' };
      case 'recycling':
        return { label: 'Recycling Ledger', color: 'bg-teal-500/10 text-teal-600 border-teal-500/20' };
      case 'envLogs':
        return { label: 'Environment & Space', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' };
      case 'forkliftChecks':
        return { label: 'Forklift Safety', color: 'bg-orange-500/10 text-orange-600 border-orange-500/20' };
      case 'registries':
        return { label: 'Master Registry', color: 'bg-violet-500/10 text-violet-600 border-violet-500/20' };
      case 'registeredUsers':
        return { label: 'Operator Directory', color: 'bg-rose-500/10 text-rose-600 border-rose-500/20' };
      default:
        return { label: col || 'Central System', color: 'bg-slate-500/10 text-slate-600 border-slate-500/20' };
    }
  };

  const getUpdateSummary = (update: PendingOnlineUpdate) => {
    if (update.actionDesc) return update.actionDesc;
    if (update.type === 'DATA_DELETE') {
      return `Deleted record ${update.recordId || ''} from ${update.collection || 'database'}`;
    }
    if (update.type === 'DATA_CREATE') {
      return `Created new ${update.collection || 'item'}: ${update.record?.partCode || update.record?.id || 'Record'}`;
    }
    if (update.type === 'DATA_UPDATE') {
      return `Modified ${update.collection || 'item'}: ${update.record?.partCode || update.record?.id || 'Record'}`;
    }
    if (update.type === 'FORCE_SYNC') {
      return `Triggered cluster-wide refresh of central records`;
    }
    return `System update received from ${update.author}`;
  };

  const badge = getCollectionBadge(currentUpdate?.collection);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm pointer-events-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        role="dialog"
        aria-labelledby="online-update-prompt-title"
      >
        {/* Modal Top Header Bar */}
        <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 px-5 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 relative">
              <BellRing className="h-5 w-5 animate-bounce" />
              {pendingUpdates.length > 1 && (
                <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                  {pendingUpdates.length}
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="online-update-prompt-title" className="text-sm font-bold tracking-tight text-white">
                  Online Updates Available
                </h2>
                <span className="bg-emerald-500 text-slate-950 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full font-mono">
                  Live Prompt
                </span>
              </div>
              <p className="text-[11px] text-indigo-200/90 font-medium">
                Modifications broadcasted by connected operators in real time
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismissAllUpdates}
            className="text-slate-400 hover:text-white p-1 rounded-xl transition cursor-pointer"
            title="Dismiss all prompts"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Multiple updates pill list */}
          {pendingUpdates.length > 1 && (
            <div className="space-y-1.5 pb-2 border-b border-slate-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center justify-between">
                <span>Pending Updates Queue ({pendingUpdates.length})</span>
                <span className="text-indigo-600 font-semibold cursor-pointer hover:underline" onClick={onAcceptAllUpdates}>
                  Apply All at Once
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1.5">
                {pendingUpdates.map((upd, idx) => {
                  const isSel = upd.id === currentUpdate?.id;
                  return (
                    <button
                      key={upd.id}
                      type="button"
                      onClick={() => setSelectedUpdateId(upd.id)}
                      className={`px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                        isSel
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <span>#{idx + 1}</span>
                      <span className="font-mono text-[11px]">{upd.author}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {currentUpdate && (
            <div className="space-y-3">
              {/* Author & Source Details Card */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                      <User className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span>{currentUpdate.author}</span>
                        {currentUpdate.employeeId && (
                          <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-1 rounded">
                            {currentUpdate.employeeId}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                        <Clock className="h-3 w-3 text-slate-400" />
                        <span>{currentUpdate.timestamp}</span>
                        {currentUpdate.stationId && (
                          <>
                            <span>•</span>
                            <span>{currentUpdate.stationId}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border ${badge.color}`}>
                    {badge.label}
                  </span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-1">
                  <div className="text-[10px] font-mono uppercase font-bold text-slate-400">
                    Operation Description
                  </div>
                  <div className="font-semibold text-slate-900 text-xs">
                    {getUpdateSummary(currentUpdate)}
                  </div>
                </div>

                {/* Inspect modified values preview if available */}
                {currentUpdate.record && (
                  <div className="bg-white rounded-xl border border-slate-200 p-2.5 space-y-1 text-[11px]">
                    <div className="text-[10px] font-mono font-bold uppercase text-slate-400 flex items-center justify-between">
                      <span>Item Details Preview</span>
                      {currentUpdate.record.partCode && (
                        <span className="text-indigo-600 font-bold">{currentUpdate.record.partCode}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-slate-700 pt-1">
                      {currentUpdate.record.quantity !== undefined && (
                        <div>
                          <span className="text-slate-400">Quantity: </span>
                          <span className="font-bold text-slate-900 font-mono">
                            {currentUpdate.record.quantity} {currentUpdate.record.unit || 'PCS'}
                          </span>
                        </div>
                      )}
                      {currentUpdate.record.lotNumber && (
                        <div>
                          <span className="text-slate-400">Lot No: </span>
                          <span className="font-mono text-slate-900">{currentUpdate.record.lotNumber}</span>
                        </div>
                      )}
                      {currentUpdate.record.location && (
                        <div className="col-span-2">
                          <span className="text-slate-400">Location: </span>
                          <span className="font-medium text-slate-900">{currentUpdate.record.location}</span>
                        </div>
                      )}
                      {currentUpdate.record.description && (
                        <div className="col-span-2 truncate">
                          <span className="text-slate-400">Description: </span>
                          <span className="text-slate-800">{currentUpdate.record.description}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Informative notice */}
              <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100">
                <Database className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                <span>
                  The central cloud database has accepted this change. Click <strong>"Accept & Update View"</strong> to merge this modification into your active screen immediately.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Action Buttons Footer */}
        <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 font-medium">
            {countdown > 0 ? (
              <span className="flex items-center gap-1.5 font-mono text-indigo-600 font-bold">
                <Clock className="h-3.5 w-3.5 animate-spin" /> Auto-applying in {countdown}s
              </span>
            ) : (
              <span>Prompt requires user confirmation</span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                if (currentUpdate) onDismissUpdate(currentUpdate.id);
                else onDismissAllUpdates();
              }}
              className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 transition cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
            >
              <X className="h-3.5 w-3.5 text-slate-400" /> Dismiss
            </button>

            {pendingUpdates.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => currentUpdate && onAcceptUpdate(currentUpdate.id)}
                  className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Check className="h-3.5 w-3.5" /> Update This
                </button>
                <button
                  type="button"
                  onClick={onAcceptAllUpdates}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <ArrowDownCircle className="h-3.5 w-3.5" /> Accept All ({pendingUpdates.length})
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => currentUpdate && onAcceptUpdate(currentUpdate.id)}
                className="flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Check className="h-3.5 w-3.5" /> Accept & Update View
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default OnlineUpdatePromptModal;
