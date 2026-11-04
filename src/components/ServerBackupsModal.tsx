import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Archive, 
  RefreshCw, 
  Download, 
  RotateCcw, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  HardDrive, 
  ShieldCheck, 
  Lock, 
  FileText, 
  X,
  PlusCircle,
  FolderOpen
} from 'lucide-react';
import { getApiBaseUrl } from '../config/serverConfig';
import { getAuthHeaders, getAuthToken } from '../lib/centralApi';

interface BackupItem {
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  mtime: number;
}

interface BackupAuditEntry {
  id: string;
  action: 'BACKUP_CREATED' | 'DATABASE_RESTORED' | 'PRUNE';
  filename: string;
  author: string;
  timestamp: string;
  details?: string;
  fileSizeBytes?: number;
}

interface ServerBackupsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: string;
  currentEmployeeId?: string;
}

export const ServerBackupsModal: React.FC<ServerBackupsModalProps> = ({
  isOpen,
  onClose,
  currentUser = 'ALDRIN BANAWA',
  currentEmployeeId = 'JPMP-002'
}) => {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<BackupAuditEntry[]>([]);
  const [backupsDir, setBackupsDir] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [activeTab, setActiveTab] = useState<'files' | 'audit'>('files');

  // Restore Confirmation Dialog States
  const [backupToRestore, setBackupToRestore] = useState<BackupItem | null>(null);
  const [adminPin, setAdminPin] = useState<string>('0423');
  const [isConfirmChecked, setIsConfirmChecked] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);

  const fetchBackups = async () => {
    setIsLoading(true);
    setStatusMessage(null);
    const addressTried = getApiBaseUrl();
    try {
      const res = await fetch(`${addressTried}/api/admin/backups`, {
        cache: 'no-store',
        headers: getAuthHeaders({ 'Accept': 'application/json' })
      });
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
        setAuditLogs(data.auditLogs || []);
        if (data.backupsDir) setBackupsDir(data.backupsDir);
      } else {
        const err = await res.json().catch(() => ({}));
        setStatusMessage({ text: err.error || 'Failed to fetch backups', type: 'error' });
      }
    } catch (e: any) {
      const rawMsg = e?.message || String(e);
      if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError') || rawMsg.includes('fetch') || rawMsg.includes('network')) {
        setStatusMessage({
          text: `Cannot reach the server at ${addressTried}. Check that the server PC is on and that pm2 shows juwei-wms online.`,
          type: 'error'
        });
      } else {
        setStatusMessage({ text: e?.message || 'Server communication error', type: 'error' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchBackups();
    }
  }, [isOpen]);

  const handleCreateBackup = async () => {
    setIsCreating(true);
    setStatusMessage(null);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/admin/backups/create`, {
        method: 'POST',
        headers: getAuthHeaders({ 
          'Content-Type': 'application/json',
          'x-user-employee-id': 'JPMP-002',
          'x-user-pin': adminPin
        }),
        body: JSON.stringify({
          author: currentUser || 'SUPER_ADMIN',
          employeeId: 'JPMP-002',
          requesterEmployeeId: 'JPMP-002',
          pin: adminPin
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({ text: `Backup successfully created: ${data.filename}`, type: 'success' });
        await fetchBackups();
      } else {
        setStatusMessage({ text: data.error || 'Failed to create backup', type: 'error' });
      }
    } catch (e: any) {
      setStatusMessage({ text: e?.message || 'Failed to trigger backup', type: 'error' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleExecuteRestore = async () => {
    if (!backupToRestore) return;
    if (!isConfirmChecked) {
      setStatusMessage({ text: 'Please check the confirmation box to authorize overwrite.', type: 'error' });
      return;
    }

    setIsRestoring(true);
    setStatusMessage(null);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/admin/backups/restore`, {
        method: 'POST',
        headers: getAuthHeaders({ 
          'Content-Type': 'application/json',
          'x-user-employee-id': 'JPMP-002',
          'x-user-pin': adminPin
        }),
        body: JSON.stringify({
          filename: backupToRestore.filename,
          confirmed: true,
          author: `${currentUser} (JPMP-002)`,
          employeeId: 'JPMP-002',
          requesterEmployeeId: 'JPMP-002',
          pin: adminPin
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({ 
          text: `DATABASE RESTORED! Live central database replaced with '${backupToRestore.filename}'. All workstations updated.`, 
          type: 'success' 
        });
        setBackupToRestore(null);
        setIsConfirmChecked(false);
        await fetchBackups();
      } else {
        setStatusMessage({ text: data.error || 'Failed to restore database backup', type: 'error' });
      }
    } catch (e: any) {
      setStatusMessage({ text: e?.message || 'Network error during restore', type: 'error' });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDownload = (filename: string) => {
    const baseUrl = getApiBaseUrl();
    const token = getAuthToken();
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    window.location.href = `${baseUrl}/api/admin/backups/download/${encodeURIComponent(filename)}${query}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Server Automated Backups & Disaster Recovery
                </h2>
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full uppercase">
                  Super Admin
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Automatic 1-hour snapshots & startup backups. Retains every single backup permanently without deletion inside JUWEI_DATA_DIR.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Directory & Policy Banner */}
        <div className="px-5 py-3 bg-slate-800/40 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <FolderOpen className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-slate-400">Storage Location:</span>
            <span className="font-mono bg-slate-950/80 px-2 py-0.5 rounded border border-slate-700 text-amber-300 text-[11px] select-all">
              {backupsDir || 'JUWEI_DATA_DIR/backups'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-indigo-400" /> Interval: <strong>Every 1 Hour</strong> • Retention: <strong>Permanent (All Kept)</strong>
            </span>
            <button
              onClick={handleCreateBackup}
              disabled={isCreating}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition shadow-sm cursor-pointer"
            >
              {isCreating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="h-3.5 w-3.5" />}
              Create Backup Now
            </button>
          </div>
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div className={`px-5 py-2.5 text-xs flex items-center justify-between gap-3 border-b ${
            statusMessage.type === 'success' 
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' 
              : statusMessage.type === 'error'
              ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
              : 'bg-indigo-950/40 border-indigo-800/60 text-indigo-300'
          }`}>
            <div className="flex items-center gap-2">
              {statusMessage.type === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
              {statusMessage.type === 'error' && <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />}
              <span>{statusMessage.text}</span>
            </div>
            {statusMessage.type === 'error' && (
              <button
                type="button"
                onClick={fetchBackups}
                disabled={isLoading}
                className="bg-rose-900/80 hover:bg-rose-800 text-rose-100 border border-rose-700/80 px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1.5 transition shrink-0 cursor-pointer shadow-xs active:scale-95"
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Retry</span>
              </button>
            )}
          </div>
        )}

        {/* Tabs & Controls */}
        <div className="px-5 pt-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('files')}
              className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition cursor-pointer ${
                activeTab === 'files'
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Available Snapshots ({backups.length})
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition cursor-pointer ${
                activeTab === 'audit'
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Backup & Restore History Log
            </button>
          </div>

          <button
            onClick={fetchBackups}
            disabled={isLoading}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition cursor-pointer text-xs flex items-center gap-1"
            title="Refresh backups list"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'files' ? (
            backups.length === 0 ? (
              <div className="py-14 text-center space-y-3">
                <Archive className="h-10 w-10 text-slate-600 mx-auto" />
                <p className="text-sm font-medium text-slate-400">No backup snapshots found in backups directory.</p>
                <p className="text-xs text-slate-500">Backups are automatically created on server startup and every 1 hour (non-blocking, permanently kept).</p>
                <button
                  onClick={handleCreateBackup}
                  disabled={isCreating}
                  className="mt-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-4 py-2 rounded-lg inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <PlusCircle className="h-4 w-4" /> Trigger First Backup Now
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-12 text-[11px] font-mono uppercase tracking-wider text-slate-400 px-3 py-1.5 border-b border-slate-800">
                  <div className="col-span-6 sm:col-span-5">Snapshot Filename</div>
                  <div className="col-span-3 sm:col-span-3">Created Timestamp</div>
                  <div className="col-span-3 sm:col-span-2 text-right">Size</div>
                  <div className="col-span-12 sm:col-span-2 text-right mt-1 sm:mt-0">Actions</div>
                </div>

                {backups.map((item, idx) => (
                  <div 
                    key={item.filename}
                    className="grid grid-cols-12 items-center text-xs px-3 py-2.5 rounded-xl bg-slate-800/30 hover:bg-slate-800/60 border border-slate-800 transition gap-2"
                  >
                    <div className="col-span-6 sm:col-span-5 flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-slate-500 w-5 shrink-0">#{idx + 1}</span>
                      <HardDrive className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span className="font-mono text-slate-200 truncate select-all" title={item.filename}>
                        {item.filename}
                      </span>
                    </div>

                    <div className="col-span-3 sm:col-span-3 text-slate-400 text-[11px]">
                      {new Date(item.createdAt).toLocaleString()}
                    </div>

                    <div className="col-span-3 sm:col-span-2 text-right font-mono text-slate-300 text-[11px]">
                      {item.sizeFormatted}
                    </div>

                    <div className="col-span-12 sm:col-span-2 flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleDownload(item.filename)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                        title="Download backup file"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          setBackupToRestore(item);
                          setIsConfirmChecked(false);
                        }}
                        className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                        title="Restore this backup to live database"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-2">
              {auditLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  No backup or restore events logged yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {auditLogs.map((log) => (
                    <div 
                      key={log.id} 
                      className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800 text-xs flex items-start justify-between gap-3"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded uppercase ${
                            log.action === 'DATABASE_RESTORED' 
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' 
                              : log.action === 'PRUNE'
                              ? 'bg-slate-700 text-slate-300'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          }`}>
                            {log.action.replace('_', ' ')}
                          </span>
                          <span className="font-mono text-slate-200">{log.filename}</span>
                        </div>
                        <p className="text-slate-400 text-[11px]">
                          By: <strong className="text-slate-300">{log.author}</strong> {log.details ? `• ${log.details}` : ''}
                        </p>
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 shrink-0">
                        {new Date(log.timestamp).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            ISO 9001:2015 & IATF 16949 Audit Trail: All automated snapshots and manual restores are committed to immutable disk logs.
          </div>
          <button 
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition font-medium cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>

      {/* Restore Confirmation Dialog Modal */}
      {backupToRestore && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-slate-900 border-2 border-amber-500/80 rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4 text-slate-100">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white uppercase tracking-tight">
                  Restore Live Central Database?
                </h3>
                <p className="text-xs text-amber-300">
                  Destructive Action: Overwrites live warehouse database
                </p>
              </div>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div className="text-slate-300">
                Selected Snapshot: <strong className="font-mono text-amber-300">{backupToRestore.filename}</strong>
              </div>
              <div className="text-slate-400 text-[11px]">
                Created: {new Date(backupToRestore.createdAt).toLocaleString()} • Size: {backupToRestore.sizeFormatted}
              </div>
              <p className="text-slate-300 pt-1 border-t border-slate-800/80 leading-relaxed">
                Overwrites the live database file (<code className="text-amber-200">central-database.sqlite</code>).
                All connected workstation terminals and mobile devices will be updated immediately via real-time WebSocket broadcast.
              </p>
            </div>

            {/* Super Admin PIN Confirmation */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-emerald-400" /> Super Admin Security PIN
              </label>
              <input
                type="password"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                placeholder="Enter Super Admin PIN"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            {/* Acknowledgment Checkbox */}
            <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input 
                type="checkbox"
                checked={isConfirmChecked}
                onChange={(e) => setIsConfirmChecked(e.target.checked)}
                className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer"
              />
              <span>I confirm that I want to overwrite the current live database with this snapshot.</span>
            </label>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => {
                  setBackupToRestore(null);
                  setIsConfirmChecked(false);
                }}
                disabled={isRestoring}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteRestore}
                disabled={!isConfirmChecked || isRestoring}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-lg shadow-amber-600/20"
              >
                {isRestoring ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {isRestoring ? 'Restoring Database...' : 'CONFIRM & OVERWRITE LIVE DATABASE'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
