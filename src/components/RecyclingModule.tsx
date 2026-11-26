/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  RefreshCcw, 
  Trash2, 
  CheckCircle, 
  AlertTriangle, 
  Sparkles, 
  BarChart3
} from 'lucide-react';
import { RecyclingRecord, MasterRegistryItem } from '../types';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';
import { generateAuthoritativeId } from '../lib/idGenerator';
import { showPrintToast } from '../utils/printDocument';
import { useI18n } from '../i18n';
import {
  MISSING_UNIT_LABEL,
  formatNumberForUnit,
  getAllSelectUomOptions,
  groupQuantitiesByUnit,
  normalizeUnitCode,
  resolveMasterDataUnit,
  type UnitTotalBucket,
} from '../../shared/units';

interface RecyclingModuleProps {
  recycling: RecyclingRecord[];
  onAddRecycling: (record: RecyclingRecord) => void;
  onDeleteRecycling: (id: string) => void;
  isSuperAdmin?: boolean;
  canEdit?: boolean;
  registries?: MasterRegistryItem[];
}

export default function RecyclingModule({
  recycling,
  onAddRecycling,
  onDeleteRecycling,
  isSuperAdmin = false,
  canEdit = false,
  registries = []
}: RecyclingModuleProps) {
  const { t } = useI18n();
  const effectiveCanEdit = canEdit || isSuperAdmin;
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);

  // Form states
  const [logSheetNumber, setLogSheetNumber] = useState('');
  const [itemType, setItemType] = useState<'Carton Box' | 'Pallet' | 'Partition'>('Carton Box');
  const [quantity, setQuantity] = useState(0);
  const [unit, setUnit] = useState<string>('PCS');
  const [condition, setCondition] = useState<'Reusable' | 'Non-Reusable' | 'Contaminated' | 'Damaged'>('Reusable');
  const [reuseCycleCount, setReuseCycleCount] = useState(1);
  const [disposition, setDisposition] = useState<'Re-used' | 'For Re-sorting' | 'Scrap Disposal'>('Re-used');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUnit = normalizeUnitCode(unit);
    if (!logSheetNumber || quantity <= 0 || !cleanUnit) {
      showPrintToast(t('recycling.fillAllFieldsWarning'), 'warning');
      return;
    }

    const newRecord: RecyclingRecord = {
      id: generateAuthoritativeId('RCY'),
      date: new Date().toISOString().split('T')[0],
      itemType,
      quantity,
      unit: cleanUnit,
      unitMissing: false,
      condition,
      reuseCycleCount,
      disposition,
      logSheetNumber
    };

    onAddRecycling(newRecord);

    // Reset
    setLogSheetNumber('');
    setQuantity(0);
    setUnit('PCS');
    setCondition('Reusable');
    setReuseCycleCount(1);
    setDisposition('Re-used');
    setShowForm(false);
  };

  const q = (searchQuery || '').trim().toLowerCase();
  const filteredLogs = recycling.filter(log => 
    (log.logSheetNumber || '').toLowerCase().includes(q) ||
    (log.itemType || '').toLowerCase().includes(q) ||
    (log.disposition || '').toLowerCase().includes(q)
  );

  const resolveLogUnit = (log: RecyclingRecord) =>
    resolveMasterDataUnit({ unit: log.unit, itemType: log.itemType }, registries);

  const reusableGrouped = groupQuantitiesByUnit(
    recycling.filter(r => r.disposition === 'Re-used'),
    r => r.quantity,
    r => resolveLogUnit(r).unit
  );
  const scrappedGrouped = groupQuantitiesByUnit(
    recycling.filter(r => r.disposition === 'Scrap Disposal'),
    r => r.quantity,
    r => resolveLogUnit(r).unit
  );
  const sortingGrouped = groupQuantitiesByUnit(
    recycling.filter(r => r.disposition === 'For Re-sorting'),
    r => r.quantity,
    r => resolveLogUnit(r).unit
  );

  const missingUnitLogsCount = recycling.filter(r => resolveLogUnit(r).isMissing).length;

  const renderUnitBuckets = (buckets: UnitTotalBucket[], defaultTextClass: string) => {
    if (buckets.length === 0) {
      return <div className={`text-xl font-mono font-bold ${defaultTextClass}`}>0</div>;
    }
    return (
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 mt-0.5">
        {buckets.map((bucket) => (
          <span
            key={bucket.key}
            className={`text-lg font-mono font-bold ${bucket.isMissing ? 'text-rose-600' : defaultTextClass}`}
          >
            {formatNumberForUnit(bucket.total)}{' '}
            <span className="text-[11px] font-bold uppercase">{bucket.displayUnit}</span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6" id="recycling-module">
      {/* Official Header Banner matching Dashboard Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-5 rounded-2xl shadow-md border border-slate-800 flex flex-col md:flex-row md:justify-between md:items-center gap-4 text-white">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold font-mono px-2 py-0.5 rounded border border-indigo-500/30">
              {t('recycling.bannerBadge')}
            </span>
            <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block" /> {t('recycling.recycleTag')}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">{t('recycling.moduleTitle')}</h2>
          <p className="text-xs text-slate-300 mt-1">
            {t('recycling.moduleSubtitle')}
          </p>
        </div>
      </div>

      {/* Overview stats panel (strictly grouped by unit) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4" id="recycling-stats-row">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center justify-between gap-2">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">{t('recycling.totalInUse')}</span>
            {renderUnitBuckets(reusableGrouped.buckets, 'text-slate-800')}
            <span className="text-[9px] text-slate-400">{t('recycling.activeCirculation')}</span>
          </div>
          <span className="p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0"><CheckCircle className="h-4 w-4" /></span>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center justify-between gap-2">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">{t('recycling.scrapCondemned')}</span>
            {renderUnitBuckets(scrappedGrouped.buckets, 'text-rose-600')}
            <span className="text-[9px] text-slate-400">{t('recycling.wasteDisposal')}</span>
          </div>
          <span className="p-2 bg-rose-50 text-rose-600 rounded-lg shrink-0"><Trash2 className="h-4 w-4" /></span>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center justify-between gap-2">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">{t('recycling.pendingResorting')}</span>
            {renderUnitBuckets(sortingGrouped.buckets, 'text-amber-600')}
            <span className="text-[9px] text-slate-400">{t('recycling.requiresWashing')}</span>
          </div>
          <span className="p-2 bg-amber-50 text-amber-600 rounded-lg shrink-0"><RefreshCcw className="h-4 w-4" /></span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl shadow-sm text-white flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">{t('recycling.maxRotationLimit')}</span>
            <div className="text-base font-bold text-white">{t('recycling.cyclesLimit')}</div>
            <span className="text-[9px] text-slate-300">{t('recycling.strictMandate')}</span>
          </div>
          <span className="p-2 bg-slate-800 text-slate-400 rounded-lg"><BarChart3 className="h-4 w-4" /></span>
        </div>
      </div>

      {missingUnitLogsCount > 0 && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>
            {t('recycling.missingUnitWarning', { count: missingUnitLogsCount })}
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="relative w-full sm:max-w-xs">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            <Search className="h-4 w-4" />
          </span>
          <input 
            type="text" 
            placeholder={t('recycling.searchPlaceholder')} 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
          />
        </div>

        {effectiveCanEdit ? (
          <button 
            onClick={() => setShowForm(!showForm)}
            className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
            id="btn-add-recycling-log"
          >
            <Plus className="h-4 w-4" /> {t('recycling.logActivityBtn')}
          </button>
        ) : (
          <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded font-bold uppercase">
            {t('recycling.viewOnlyBadge')}
          </span>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <form 
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4"
          id="recycling-form"
        >
          <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
            <h3 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-slate-500" /> {t('recycling.formTitle')}
            </h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-[10px] text-slate-400">{t('recycling.discardBtn')}</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('recycling.logSheetNumberLabel')}</label>
              <input 
                type="text"
                required
                placeholder={t('recycling.sheetRefPlaceholder')}
                value={logSheetNumber}
                onChange={e => setLogSheetNumber(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('recycling.packagingTypeLabel')}</label>
              <select 
                value={itemType}
                onChange={e => setItemType(e.target.value as any)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="Carton Box">{t('recycling.typeCartonBox')}</option>
                <option value="Pallet">{t('recycling.typePallet')}</option>
                <option value="Partition">{t('recycling.typePartition')}</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('recycling.quantityLabel')}</label>
              <div className="flex gap-2">
                <input 
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  placeholder="Qty"
                  value={quantity || ''}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  onChange={e => {
                    const sanitized = e.target.value.replace(/\D/g, '');
                    setQuantity(sanitized ? parseInt(sanitized, 10) : 0);
                  }}
                  className="flex-1 px-3 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <select
                  value={unit}
                  onChange={e => setUnit(e.target.value)}
                  className="w-24 px-2 py-1.5 border border-slate-200 rounded text-xs font-mono font-bold bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                  aria-label="Unit of Measure"
                >
                  {getAllSelectUomOptions(unit).map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('recycling.physicalConditionLabel')}</label>
              <select 
                value={condition}
                onChange={e => {
                  const val = e.target.value as any;
                  setCondition(val);
                  // Auto disposition helper
                  if (val === 'Damaged' || val === 'Contaminated' || val === 'Non-Reusable') {
                    setDisposition('Scrap Disposal');
                  } else {
                    setDisposition('Re-used');
                  }
                }}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs focus:outline-none"
              >
                <option value="Reusable">{t('recycling.condReusable')}</option>
                <option value="Non-Reusable">{t('recycling.condNonReusable')}</option>
                <option value="Contaminated">{t('recycling.condContaminated')}</option>
                <option value="Damaged">{t('recycling.condDamaged')}</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('recycling.cycleCountLabel')}</label>
              <input 
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                placeholder="1"
                value={reuseCycleCount || ''}
                onKeyDown={(e) => {
                  if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                    e.preventDefault();
                  }
                }}
                onChange={e => {
                  const sanitized = e.target.value.replace(/\D/g, '');
                  const val = sanitized ? parseInt(sanitized, 10) : 1;
                  setReuseCycleCount(val);
                  if (val >= 5) {
                    setDisposition('Scrap Disposal');
                  }
                }}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none"
              />
              <p className="text-[9px] text-slate-400 mt-0.5">SOP Limit: Maximum 5 cycles allowed.</p>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('recycling.finalDispositionLabel')}</label>
              <select 
                value={disposition}
                onChange={e => setDisposition(e.target.value as any)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs focus:outline-none"
              >
                <option value="Re-used">{t('recycling.dispReused')}</option>
                <option value="For Re-sorting">{t('recycling.dispResorting')}</option>
                <option value="Scrap Disposal">{t('recycling.dispScrap')}</option>
              </select>
            </div>
          </div>

          {(reuseCycleCount >= 5 || condition === 'Damaged' || condition === 'Contaminated') && (
            <div className="p-3 bg-rose-50 border border-rose-100 text-rose-800 rounded-lg text-xs flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              <strong>SOP Warning:</strong> This item has exceeded the allowable 5 cycles or is damaged/contaminated. Standard procedures mandate classification as <strong>Scrap Disposal</strong>.
            </div>
          )}

          <div className="flex justify-end gap-1.5 border-t border-slate-100 pt-3">
            <button 
              type="button" 
              onClick={() => setShowForm(false)} 
              className="px-3.5 py-1.5 border border-slate-200 text-slate-600 rounded text-xs font-semibold"
            >
              {t('recycling.discardBtn')}
            </button>
            <button 
              type="submit" 
              className="px-3.5 py-1.5 bg-slate-900 text-white rounded text-xs font-semibold"
            >
              {t('recycling.logToSortingSheetsBtn')}
            </button>
          </div>
        </form>
      )}

      {/* Recycling logs table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="recycling-grid-panel">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{t('recycling.tableTitle')}</span>
          <span className="text-xs font-mono text-slate-500 font-semibold">{t('recycling.logsInDb', { count: filteredLogs.length })}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-500 font-medium border-b border-slate-200">
                <th className="p-4 font-semibold">{t('recycling.colLogId')}</th>
                <th className="p-4 font-semibold">{t('recycling.colDateLogged')}</th>
                <th className="p-4 font-semibold">{t('recycling.colSheetRef')}</th>
                <th className="p-4 font-semibold">{t('recycling.colItemClassification')}</th>
                <th className="p-4 font-semibold text-right">{t('recycling.colQuantity')}</th>
                <th className="p-4 font-semibold">{t('recycling.colReportedCondition')}</th>
                <th className="p-4 font-semibold">{t('recycling.colCycleCount')}</th>
                <th className="p-4 font-semibold">{t('recycling.colDisposition')}</th>
                <th className="p-4 font-semibold">{t('recycling.colAction')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map(log => {
                const isLimitReached = log.reuseCycleCount >= 5;
                const isScrapped = log.disposition === 'Scrap Disposal';
                const unitRes = resolveLogUnit(log);
                return (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 font-mono font-semibold text-slate-600">{log.id}</td>
                    <td className="p-4 text-slate-600 font-mono">{log.date}</td>
                    <td className="p-4 font-mono font-bold text-slate-800">{log.logSheetNumber}</td>
                    <td className="p-4 font-semibold text-slate-700">{log.itemType}</td>
                    <td className="p-4 text-right font-mono font-bold text-slate-800">
                      <span>{formatNumberForUnit(log.quantity)}</span>{' '}
                      {unitRes.isMissing ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 text-[9px] font-bold">
                          {MISSING_UNIT_LABEL}
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-500">{unitRes.unit}</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.condition === 'Reusable' ? 'bg-emerald-50 text-emerald-700' :
                        log.condition === 'Damaged' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {log.condition}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-800">{log.reuseCycleCount} / 5</span>
                        <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className={`h-full ${isLimitReached ? 'bg-rose-500' : 'bg-indigo-600'}`} 
                            style={{ width: `${(log.reuseCycleCount / 5) * 100}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                        isScrapped ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                        log.disposition === 'For Re-sorting' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                        'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}>
                        {(log.disposition || 'RE-USED').toUpperCase()}
                      </span>
                    </td>
                    <td className="p-4">
                      {isSuperAdmin ? (
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'DELETE') {
                              setConfirmAction({
                                title: t('recycling.confirmDeleteTitle'),
                                message: t('recycling.confirmDeleteMsg', { id: log.id }),
                                confirmLabel: t('recycling.confirmYesDelete'),
                                confirmVariant: 'danger',
                                onConfirm: () => onDeleteRecycling(log.id)
                              });
                            }
                            e.target.value = '';
                          }}
                          className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                          id={`action-select-recyc-${log.id}`}
                        >
                          <option value="" disabled>{t('receiving.actionsPlaceholder')}</option>
                          <option value="DELETE">🗑️ {t('recycling.deleteAction')}</option>
                        </select>
                      ) : (
                        <span className="text-slate-300 font-bold">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal with YES / NO options */}
      <ConfirmModal config={confirmAction} onClose={() => setConfirmAction(null)} />
    </div>
  );
}
