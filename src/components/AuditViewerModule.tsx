import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileClock,
  Download,
  RefreshCw,
  Search,
  Calendar,
  User,
  Layers,
  ShieldAlert,
  RotateCcw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { getApiBaseUrl, getAuthHeaders } from '../config/serverConfig';
import { useI18n } from '../i18n';
import type { AuditTrailEntry } from '../types';

export type { AuditTrailEntry };

interface AuditViewerModuleProps {
  isSuperAdmin: boolean;
  currentUser?: string;
  currentEmployeeId?: string;
}

const RECORD_TYPE_LABELS: Record<string, string> = {
  stocks: 'Stock & FIFO',
  receiving: 'Material Receiving',
  returns: 'Material Returns',
  recycling: 'Packaging Recycling',
  issuances: 'Material Issuance',
  deliveries: 'Outbound & Gate Pass',
  envLogs: 'Space Utilization',
  forkliftChecks: 'Forklift Checklists',
  registries: 'Master Registry',
  registeredUsers: 'JPMP Accounts',
  stockMovements: 'Stock Movements',
  authorizedDevices: 'Authorized Devices',
  operationalRoles: 'Operational Roles',
  receivingCategories: 'Receiving Categories',
  fifoColorsByMonth: 'FIFO Color Calendar',
  system: 'System / Backups'
};

function formatRecordTypeLabel(recordType: string): string {
  return RECORD_TYPE_LABELS[recordType] || recordType;
}

function getActionBadgeClasses(action: string): string {
  const upper = (action || '').toUpperCase();
  if (upper === 'CREATE' || upper === 'DEVICE_AUTHORIZED') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (upper === 'DELETE' || upper === 'PURGE' || upper === 'DEVICE_REVOKED' || upper === 'GLOBAL_RESET') {
    return 'bg-rose-50 text-rose-700 border-rose-200';
  }
  if (upper === 'STOCK_MOVEMENT' || upper === 'DEVICE_PENDING' || upper === 'COMPROMISED_PIN_RESOLVED') {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  if (upper.startsWith('PIN_') || upper === 'DATABASE_RESTORED' || upper === 'BACKUP_CREATED') {
    return 'bg-purple-50 text-purple-700 border-purple-200';
  }
  return 'bg-indigo-50 text-indigo-700 border-indigo-200';
}

function formatTimestamp(ts: string): string {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const str = String(value).replace(/"/g, '""');
  return `"${str}"`;
}

export default function AuditViewerModule({
  isSuperAdmin,
  currentUser = 'ALDRIN BANAWA',
  currentEmployeeId = 'JPMP-002'
}: AuditViewerModuleProps) {
  const { t } = useI18n();
  const [logs, setLogs] = useState<AuditTrailEntry[]>([]);
  const [availableUsers, setAvailableUsers] = useState<string[]>([]);
  const [availableRecordTypes, setAvailableRecordTypes] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Filters: Date range, User, Record Type, Search
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [userFilter, setUserFilter] = useState<string>('ALL');
  const [recordTypeFilter, setRecordTypeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const getDeviceIdHeader = (): string => {
    try {
      return typeof localStorage !== 'undefined' ? (localStorage.getItem('juwei_wms_device_id') || '') : '';
    } catch {
      return '';
    }
  };

  const fetchAuditLogs = useCallback(async () => {
    if (!isSuperAdmin) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const baseUrl = getApiBaseUrl();
      const deviceId = getDeviceIdHeader();
      const params = new URLSearchParams();
      params.set('limit', '5000');
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (userFilter && userFilter !== 'ALL') params.set('user', userFilter);
      if (recordTypeFilter && recordTypeFilter !== 'ALL') params.set('recordType', recordTypeFilter);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());

      const res = await fetch(`${baseUrl}/api/admin/audit-logs?${params.toString()}`, {
        cache: 'no-store',
        headers: getAuthHeaders({
          Accept: 'application/json',
          ...(deviceId ? { 'x-device-id': deviceId } : {})
        })
      });

      const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
      if (res.status === 403 && data?.error === 'DEVICE_REVOKED' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('juwei_device_revoked', { detail: { deviceId } }));
      }
      if (!res.ok || !data.success) {
        setErrorMsg(data.error || `Failed to load audit logs (HTTP ${res.status})`);
        return;
      }

      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTotalCount(Number(data.total) || 0);
      setAvailableUsers(Array.isArray(data.availableUsers) ? data.availableUsers : []);
      setAvailableRecordTypes(Array.isArray(data.availableRecordTypes) ? data.availableRecordTypes : []);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to connect to central audit log service');
    } finally {
      setIsLoading(false);
    }
  }, [isSuperAdmin, dateFrom, dateTo, userFilter, recordTypeFilter, searchQuery]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  // Immediate local filtering to keep UI snappy across filter changes
  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter(entry => {
      const entryDate = String(entry.timestamp || '').slice(0, 10);
      if (dateFrom && entryDate && entryDate < dateFrom) return false;
      if (dateTo && entryDate && entryDate > dateTo) return false;
      if (userFilter !== 'ALL') {
        const target = userFilter.toLowerCase();
        if (
          !String(entry.actor || '').toLowerCase().includes(target) &&
          !String(entry.actorId || '').toLowerCase().includes(target)
        ) {
          return false;
        }
      }
      if (recordTypeFilter !== 'ALL' && entry.recordType !== recordTypeFilter) {
        return false;
      }
      if (q) {
        const hay = [
          entry.actor,
          entry.actorId,
          entry.action,
          entry.recordType,
          formatRecordTypeLabel(entry.recordType),
          entry.recordId,
          entry.summary,
          entry.details || '',
          entry.deviceId || ''
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, dateFrom, dateTo, userFilter, recordTypeFilter, searchQuery]);

  const hasActiveFilters = Boolean(
    dateFrom || dateTo || userFilter !== 'ALL' || recordTypeFilter !== 'ALL' || searchQuery.trim()
  );

  const handleResetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setUserFilter('ALL');
    setRecordTypeFilter('ALL');
    setSearchQuery('');
  };

  const handleExportCsv = () => {
    if (filteredLogs.length === 0) return;

    const headers = [
      'Audit ID',
      'Timestamp (ISO)',
      'Local Date/Time',
      'Who (User)',
      'User / Employee ID',
      'Action',
      'Record Type',
      'Record Type Label',
      'Record ID',
      'What Changed (Summary)',
      'Details',
      'Device ID'
    ];

    const rows = filteredLogs.map(entry =>
      [
        escapeCsvCell(entry.id),
        escapeCsvCell(entry.timestamp),
        escapeCsvCell(formatTimestamp(entry.timestamp)),
        escapeCsvCell(entry.actor),
        escapeCsvCell(entry.actorId),
        escapeCsvCell(entry.action),
        escapeCsvCell(entry.recordType),
        escapeCsvCell(formatRecordTypeLabel(entry.recordType)),
        escapeCsvCell(entry.recordId),
        escapeCsvCell(entry.summary),
        escapeCsvCell(entry.details || ''),
        escapeCsvCell(entry.deviceId || '')
      ].join(',')
    );

    const metadataComments = [
      `# JUWEI PLASTIC MOULDING PHILIPPINES INC. - SUPER ADMIN AUDIT TRAIL EXPORT`,
      `# Exported By: ${currentUser} (${currentEmployeeId})`,
      `# Exported At: ${new Date().toISOString()}`,
      `# Filters: DateFrom=${dateFrom || 'ALL'} | DateTo=${dateTo || 'ALL'} | User=${userFilter} | RecordType=${recordTypeFilter} | Search=${searchQuery || 'NONE'}`,
      `# Rows Exported: ${filteredLogs.length}`,
      ''
    ].join('\n');

    const csvContent = '\uFEFF' + metadataComments + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `Juwei_Audit_Trail_${dateStamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setExportSuccess(`Exported ${filteredLogs.length} audit entry(ies) to CSV.`);
    setTimeout(() => setExportSuccess(null), 4000);
  };

  if (!isSuperAdmin) {
    return (
      <div className="bg-white border border-rose-200 rounded-2xl p-8 text-center max-w-lg mx-auto mt-8 shadow-sm">
        <ShieldAlert className="h-10 w-10 text-rose-600 mx-auto mb-3" />
        <h2 className="text-base font-bold text-slate-900">{t('audit.accessDeniedTitle')}</h2>
        <p className="text-xs text-slate-600 mt-1">
          {t('audit.accessDeniedSubtitle')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" id="super-admin-audit-viewer">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-2xl p-4 sm:p-5 text-white border border-slate-800 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 shrink-0">
            <FileClock className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold tracking-tight">
                {t('audit.headerTitle')}
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-[10px] font-mono font-bold text-indigo-200 uppercase">
                {t('audit.entriesBadge', { count: filteredLogs.length, total: totalCount })}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              {t('audit.headerSubtitle')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={fetchAuditLogs}
            disabled={isLoading}
            id="btn-audit-refresh"
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-100 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? t('audit.refreshingBtn') : t('audit.refreshBtn')}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredLogs.length === 0}
            id="btn-audit-export-csv"
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white border border-emerald-400/30 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            title="Export the currently filtered audit view to CSV"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('audit.exportCsvBtn')}</span>
          </button>
        </div>
      </div>

      {/* Feedback banners */}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {exportSuccess && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{exportSuccess}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div>
            <label htmlFor="audit-filter-date-from" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" /> {t('audit.filterDateFrom')}
            </label>
            <input
              id="audit-filter-date-from"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="audit-filter-date-to" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" /> {t('audit.filterDateTo')}
            </label>
            <input
              id="audit-filter-date-to"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="audit-filter-user" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
              <User className="h-3 w-3" /> {t('audit.filterUser')}
            </label>
            <select
              id="audit-filter-user"
              value={userFilter}
              onChange={e => setUserFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
            >
              <option value="ALL">{t('audit.filterAllUsers')}</option>
              {availableUsers.map(u => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="audit-filter-record-type" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
              <Layers className="h-3 w-3" /> {t('audit.filterRecordType')}
            </label>
            <select
              id="audit-filter-record-type"
              value={recordTypeFilter}
              onChange={e => setRecordTypeFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
            >
              <option value="ALL">{t('audit.filterAllRecordTypes')}</option>
              {availableRecordTypes.map(rt => (
                <option key={rt} value={rt}>
                  {formatRecordTypeLabel(rt)} ({rt})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="audit-filter-search" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
              <Search className="h-3 w-3" /> {t('audit.filterSearch')}
            </label>
            <div className="relative">
              <input
                id="audit-filter-search"
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('audit.searchPlaceholder')}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
            <span className="text-slate-500 font-medium">
              {t('audit.matchingEntries', { count: filteredLogs.length })}
            </span>
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" /> {t('audit.clearFiltersBtn')}
            </button>
          </div>
        )}
      </div>

      {/* Audit Entries Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs" id="audit-logs-table">
            <thead>
              <tr className="bg-slate-900 text-slate-200 border-b border-slate-800 text-[10px] uppercase tracking-wider font-bold">
                <th className="py-3 px-4 whitespace-nowrap">{t('audit.colWhen')}</th>
                <th className="py-3 px-4 whitespace-nowrap">{t('audit.colWho')}</th>
                <th className="py-3 px-4 whitespace-nowrap">{t('audit.colAction')}</th>
                <th className="py-3 px-4 whitespace-nowrap">{t('audit.filterRecordType')}</th>
                <th className="py-3 px-4">{t('audit.colWhatChanged')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map(entry => (
                <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors align-top">
                  <td className="py-2.5 px-4 whitespace-nowrap font-mono text-[11px] text-slate-600 tabular-nums" title={entry.timestamp}>
                    <div>{formatTimestamp(entry.timestamp)}</div>
                    <div className="text-[10px] text-slate-400">{entry.timestamp.slice(0, 10)}</div>
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    <div className="font-bold text-slate-900">{entry.actor}</div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {entry.actorId}
                      {entry.deviceId ? ` · ${entry.deviceId}` : ''}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold ${getActionBadgeClasses(
                        entry.action
                      )}`}
                    >
                      {entry.action}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    <div className="font-semibold text-slate-800">{formatRecordTypeLabel(entry.recordType)}</div>
                    <div className="text-[10px] font-mono text-slate-400">{entry.recordType}</div>
                  </td>
                  <td className="py-2.5 px-4 min-w-[280px]">
                    <div className="font-medium text-slate-900">{entry.summary}</div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3">
                      <span>ID: {entry.recordId}</span>
                      {entry.details && <span className="text-slate-600">{entry.details}</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 px-4 text-center text-slate-500">
                    {t('audit.noEntriesMatch')}
                  </td>
                </tr>
              )}
              {isLoading && filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 px-4 text-center text-slate-500">
                    {t('audit.loading')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
