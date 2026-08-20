import React from 'react';
import { Users, X, Activity, Server, Radio, Shield, Clock, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { RegisteredAccount } from '../types';

interface ActiveUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeUsers: string[];
  registeredUsers: RegisteredAccount[];
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  supabaseStatus: 'connected' | 'connecting' | 'disconnected';
  wsLatency: number | null;
  lastSyncedTime: Date;
  onForceSync: () => void;
  isManualSyncing: boolean;
}

export default function ActiveUsersModal({
  isOpen,
  onClose,
  activeUsers,
  registeredUsers,
  connectionStatus,
  supabaseStatus,
  wsLatency,
  lastSyncedTime,
  onForceSync,
  isManualSyncing
}: ActiveUsersModalProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2 }}
          className="glass-card-darker border border-white/20 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-200 flex flex-col max-h-[90vh] backdrop-blur-2xl"
        >
          {/* Header */}
          <div className="p-5 bg-slate-950/60 border-b border-white/10 flex items-center justify-between backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base tracking-wide flex items-center gap-2">
                  <span>LIVE ACTIVE TERMINALS</span>
                  <span className="bg-indigo-500/20 text-indigo-300 text-xs px-2 py-0.5 rounded-full border border-indigo-500/30 font-mono">
                    {activeUsers.length} ONLINE
                  </span>
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  Juwei Multi-Station Real-Time Cluster
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Sync & Health Metrics Panel */}
          <div className="p-4 bg-slate-950/40 border-b border-slate-800 grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="bg-slate-800/60 border border-slate-700/60 p-2.5 rounded-xl">
              <div className="text-[10px] text-slate-400 uppercase font-mono font-bold flex items-center gap-1">
                <Radio className="h-3 w-3 text-emerald-400" /> WebSocket
              </div>
              <div className="font-bold text-white mt-1 flex items-center gap-1.5 font-mono">
                <span className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                <span>{connectionStatus === 'connected' ? `${wsLatency !== null ? `${wsLatency}ms` : 'Active'}` : 'Offline'}</span>
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 p-2.5 rounded-xl">
              <div className="text-[10px] text-slate-400 uppercase font-mono font-bold flex items-center gap-1">
                <Server className="h-3 w-3 text-blue-400" /> Cloud Database
              </div>
              <div className="font-bold text-white mt-1 flex items-center gap-1.5 font-mono">
                <span className={`w-2 h-2 rounded-full ${supabaseStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                <span>{supabaseStatus === 'connected' ? 'Supabase RT' : 'Local Disk'}</span>
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 p-2.5 rounded-xl col-span-2 sm:col-span-1">
              <div className="text-[10px] text-slate-400 uppercase font-mono font-bold flex items-center gap-1">
                <Clock className="h-3 w-3 text-indigo-400" /> Last Sync
              </div>
              <div className="font-bold text-white mt-1 text-[11px] font-mono truncate">
                {lastSyncedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>
          </div>

          {/* Active Workstations / Operators List */}
          <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
            <div className="text-[11px] font-mono text-slate-400 uppercase font-bold tracking-wider px-1">
              Connected Operators ({activeUsers.length})
            </div>

            {activeUsers.length === 0 ? (
              <div className="p-6 text-center text-slate-500 italic text-xs bg-slate-950/30 rounded-xl border border-slate-800">
                No external operator terminals currently registered in this session.
              </div>
            ) : (
              activeUsers.map((user, idx) => {
                const matchedAccount = registeredUsers.find(
                  u => u.username.toUpperCase() === user.toUpperCase() ||
                       user.toUpperCase().includes(u.employeeId.toUpperCase())
                );

                const isSuper = user.toUpperCase().includes('ALDRIN') || user.toUpperCase().includes('JPMP-002') || (matchedAccount && matchedAccount.permission === 'FULL_ACCESS');

                return (
                  <div
                    key={`${user}-${idx}`}
                    className="p-3 bg-slate-800/70 border border-slate-700/80 rounded-xl flex items-center justify-between gap-3 hover:border-indigo-500/50 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative shrink-0">
                        <div className="w-9 h-9 rounded-lg bg-indigo-950 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-bold text-xs font-mono">
                          {user.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-900 animate-pulse" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-white text-xs truncate flex items-center gap-1.5">
                          <span>{user}</span>
                          {isSuper && (
                            <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded border border-indigo-500/30 font-mono">
                              ADMIN
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {matchedAccount ? `${matchedAccount.role} • ${matchedAccount.employeeId}` : 'Active Workstation Terminal'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-emerald-400 font-mono bg-emerald-950/40 border border-emerald-500/30 px-2 py-1 rounded-md">
                      <Activity className="h-3 w-3 animate-pulse" />
                      <span>LIVE</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Controls */}
          <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between gap-3">
            <div className="text-[10px] text-slate-400 font-mono">
              ISO 9001:2015 Real-time Cluster
            </div>
            <button
              type="button"
              onClick={onForceSync}
              disabled={isManualSyncing}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold font-mono transition flex items-center gap-1.5 shadow-md cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{isManualSyncing ? 'SYNCING...' : 'SYNC ALL WORKSTATIONS'}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
