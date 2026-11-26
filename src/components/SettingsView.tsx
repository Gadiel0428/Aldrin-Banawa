/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Settings, Database, Activity, RefreshCw, Globe, Laptop } from 'lucide-react';
import { LanguageSwitch, useI18n } from '../i18n';
import { getCentralServerUrl } from '../config/serverConfig';
import { getStationId } from '../hooks/useSync';
import { PrintCheckSection } from './PrintCheckSection';

export interface SettingsViewProps {
  currentUser: string;
  currentEmployeeId: string;
  currentRole: string;
  canEdit: boolean;
  isManualSyncing: boolean;
  onForceSync: () => void;
  onOpenCentralDatabase: () => void;
  onOpenDiagnostics: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentUser,
  currentEmployeeId,
  currentRole,
  canEdit,
  isManualSyncing,
  onForceSync,
  onOpenCentralDatabase,
  onOpenDiagnostics,
}) => {
  const { t } = useI18n();
  const stationId = getStationId();
  const centralUrl = getCentralServerUrl();

  return (
    <div id="settings-view" className="max-w-6xl mx-auto space-y-5">
      {/* Page Header */}
      <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">
              {t('settings.title')}
            </h1>
            <p className="text-xs text-slate-600 mt-0.5">{t('settings.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenCentralDatabase}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <Database className="h-3.5 w-3.5 text-indigo-600" />
            <span>{t('settings.openCentralDbBtn')}</span>
          </button>

          <button
            type="button"
            onClick={onOpenDiagnostics}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <Activity className="h-3.5 w-3.5 text-emerald-600" />
            <span>{t('settings.openDiagnosticsBtn')}</span>
          </button>

          <button
            type="button"
            onClick={onForceSync}
            disabled={isManualSyncing}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isManualSyncing ? 'animate-spin' : ''}`} />
            <span>{t('settings.syncNowBtn')}</span>
          </button>
        </div>
      </div>

      {/* Terminal & Language Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div className="flex items-center gap-3 min-w-0">
          <Globe className="h-4 w-4 text-slate-500 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('settings.endpointLabel')}
            </div>
            <div
              className="text-xs font-mono font-semibold text-slate-900 truncate"
              title={centralUrl}
            >
              {centralUrl}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 min-w-0">
          <Laptop className="h-4 w-4 text-slate-500 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('settings.stationLabel')}
            </div>
            <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums truncate">
              {stationId}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between md:justify-end gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {t('settings.languageLabel')}
          </span>
          <LanguageSwitch />
        </div>
      </div>

      {/* Print check Section */}
      <PrintCheckSection
        currentUser={currentUser}
        currentEmployeeId={currentEmployeeId}
        currentRole={currentRole}
        stationId={stationId}
        canEdit={canEdit}
      />
    </div>
  );
};

export default SettingsView;
