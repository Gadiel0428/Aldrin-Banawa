/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Plus, 
  Search, 
  FileSignature, 
  Settings, 
  Truck, 
  AlertTriangle, 
  CheckCircle, 
  Sparkles, 
  ClipboardCheck, 
  ShieldAlert, 
  Edit,
  Printer,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Check,
  Factory,
  ShieldCheck
} from 'lucide-react';
import { DeliveryRecord, ForkliftChecklist, MaterialStockItem, MasterRegistryItem } from '../types';
import PrintablePickingListModal, { DocViewMode } from './PrintablePickingListModal';
import { ExportMenu } from './ExportMenu';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';
import { motion, AnimatePresence } from 'motion/react';
import { generateAuthoritativeId } from '../lib/idGenerator';
import { showPrintToast } from '../utils/printDocument';
import {
  MISSING_UNIT_LABEL,
  formatNumberForUnit,
  getAllSelectUomOptions,
  normalizeUnitCode,
  resolveMasterDataUnit,
} from '../../shared/units';
import { validateDeliveryRecord } from '../../shared/validation';
import { getManilaTodayString } from '../lib/businessDate';
import { useI18n } from '../i18n';

interface DeliveryModuleProps {
  deliveries: DeliveryRecord[];
  forkliftChecks: ForkliftChecklist[];
  onAddDelivery: (record: DeliveryRecord) => void;
  onAddForkliftCheck: (check: ForkliftChecklist) => void;
  onUpdateDeliveryStatus: (id: string, status: DeliveryRecord['status'], extDoc?: { drNumber?: string, salesInvoice?: string, wayBill?: string }) => void;
  onEditDelivery?: (item: DeliveryRecord) => void;
  onDeleteDelivery?: (id: string) => void;
  isSuperAdmin?: boolean;
  canEdit?: boolean;
  stocks?: MaterialStockItem[];
  registries?: MasterRegistryItem[];
  currentUser?: string;
}

export default function DeliveryModule({
  deliveries,
  forkliftChecks,
  onAddDelivery,
  onAddForkliftCheck,
  onUpdateDeliveryStatus,
  onEditDelivery,
  onDeleteDelivery,
  isSuperAdmin = false,
  canEdit = false,
  stocks = [],
  registries = [],
  currentUser = ''
}: DeliveryModuleProps) {
  const { t, localizeValidation } = useI18n();
  const effectiveCanEdit = canEdit || isSuperAdmin;
  const [searchQuery, setSearchQuery] = useState('');
  const [editingDelivery, setEditingDelivery] = useState<DeliveryRecord | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'shipments' | 'forklift'>('shipments');
  const [selectedPickingDocDelivery, setSelectedPickingDocDelivery] = useState<DeliveryRecord | null>(null);
  const [printInitialView, setPrintInitialView] = useState<DocViewMode>('OFFICIAL_DOC');
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null);
  const [expandedForkliftId, setExpandedForkliftId] = useState<string | null>(null);
  
  // Forms states
  const [showPickForm, setShowPickForm] = useState(false);
  const [pickingListNumber, setPickingListNumber] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [modelName, setModelName] = useState('');
  const [partCode, setPartCode] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [quantityInput, setQuantityInput] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [pickFieldErrors, setPickFieldErrors] = useState<Record<string, string>>({});
  const [gatePassFieldErrors, setGatePassFieldErrors] = useState<Record<string, string>>({});
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({});
  const [editDeliveryQtyInput, setEditDeliveryQtyInput] = useState('');

  const clearPickErr = (field: string) => {
    setPickFieldErrors(prev => {
      if (!prev[field]) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const clearGateErr = (field: string) => {
    setGatePassFieldErrors(prev => {
      if (!prev[field]) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const clearEditDelErr = (field: string) => {
    setEditFieldErrors(prev => {
      if (!prev[field]) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  };

  // Forklift form states
  const [showForkliftForm, setShowForkliftForm] = useState(false);
  const [operator, setOperator] = useState(currentUser || '');
  const [forkliftId, setForkliftId] = useState('FL-TOYOTA-02');
  const [brakesOk, setBrakesOk] = useState(true);
  const [lightsOk, setLightsOk] = useState(true);
  const [hydraulicOk, setHydraulicOk] = useState(true);
  const [steeringOk, setSteeringOk] = useState(true);
  const [tiresOk, setTiresOk] = useState(true);
  const [batteryFluidOk, setBatteryFluidOk] = useState(true);
  const [remarks, setRemarks] = useState('');

  // Gate Pass validation states
  const [showGatePassModal, setShowGatePassModal] = useState<string | null>(null);
  const [drNumber, setDrNumber] = useState('');
  const [salesInvoice, setSalesInvoice] = useState('');
  const [wayBill, setWayBill] = useState('');

  const todayStr = getManilaTodayString();

  const isForkliftPrechecked = forkliftChecks.some(check => check.date === todayStr);

  const handlePickPartCodeChange = (val: string) => {
    const upper = val.toUpperCase();
    setPartCode(upper);
    clearPickErr('partCode');
    const resolved = resolveMasterDataUnit({ partCode: upper, modelName }, registries, stocks);
    if (resolved.unit) {
      setUnit(resolved.unit);
      clearPickErr('unit');
    }
  };

  const handlePickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedUnit = normalizeUnitCode(unit) || resolveMasterDataUnit({ partCode, modelName }, registries, stocks).unit || '';
    const rawQty = quantityInput.trim() === '' ? NaN : Number(quantityInput.trim());
    const numericQty = Number.isNaN(rawQty) ? 0 : rawQty;

    const newDelivery: DeliveryRecord = {
      id: generateAuthoritativeId('DEL'),
      date: todayStr,
      pickingListNumber: pickingListNumber.trim(),
      poNumber: poNumber.trim(),
      modelName: modelName.trim(),
      partCode: partCode.trim().toUpperCase(),
      quantity: numericQty,
      unit: resolvedUnit,
      unitMissing: !resolvedUnit,
      packagingConditionOk: true,
      fifoVerified: true,
      forkliftChecklistSigned: isForkliftPrechecked,
      gatePassNumber: `MGP-2026-${generateAuthoritativeId('GP')}`,
      status: 'PREPARING',
      preparedBy: currentUser || 'Aldrin Clerk'
    };

    const validation = validateDeliveryRecord(
      {
        ...newDelivery,
        quantity: quantityInput.trim() === '' ? '' : rawQty,
      } as any,
      deliveries,
      { requireOperationalFields: true }
    );

    if (!validation.valid) {
      setPickFieldErrors(validation.fieldErrors);
      showPrintToast(localizeValidation(validation.message || '') || t('delivery.fixValidation'), 'warning');
      return;
    }

    setPickFieldErrors({});
    onAddDelivery(newDelivery);

    // Reset
    setPickingListNumber('');
    setPoNumber('');
    setModelName('');
    setPartCode('');
    setQuantity(0);
    setQuantityInput('');
    setUnit('PCS');
    setShowPickForm(false);
  };

  const handleForkliftCheckSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!operator) {
      showPrintToast(t('delivery.operatorRequired'), 'warning');
      return;
    }

    const newCheck: ForkliftChecklist = {
      id: generateAuthoritativeId('FLK'),
      date: todayStr,
      operator,
      forkliftId,
      brakesOk,
      lightsOk,
      hydraulicOk,
      steeringOk,
      tiresOk,
      batteryFluidOk,
      remarks
    };

    onAddForkliftCheck(newCheck);
    setShowForkliftForm(false);
    setOperator('');
    setRemarks('');
  };

  const handleGatePassReleaseSubmit = (id: string) => {
    const targetDelivery = deliveries.find(d => d.id === id);
    const cleanDr = drNumber.trim();
    const cleanSi = salesInvoice.trim();
    const cleanWb = wayBill.trim();

    const candidate: Partial<DeliveryRecord> = {
      ...(targetDelivery || {}),
      id,
      status: 'RELEASED',
      drNumber: cleanDr,
      salesInvoice: cleanSi,
      wayBill: cleanWb,
    };

    const validation = validateDeliveryRecord(candidate as any, deliveries, {
      requireReleaseDocs: true,
    });

    if (!validation.valid) {
      setGatePassFieldErrors(validation.fieldErrors);
      showPrintToast(localizeValidation(validation.message || '') || t('delivery.fixReleaseValidation'), 'warning');
      return;
    }

    setGatePassFieldErrors({});
    onUpdateDeliveryStatus(id, 'RELEASED', {
      drNumber: cleanDr,
      salesInvoice: cleanSi,
      wayBill: cleanWb,
    });
    setShowGatePassModal(null);
    setDrNumber('');
    setSalesInvoice('');
    setWayBill('');
  };

  const q = (searchQuery || '').trim().toLowerCase();
  const filteredDeliveries = deliveries.filter(d => 
    (d.pickingListNumber || '').toLowerCase().includes(q) ||
    (d.poNumber || '').toLowerCase().includes(q) ||
    (d.modelName || '').toLowerCase().includes(q) ||
    (d.partCode || '').toLowerCase().includes(q)
  );

  return (
    <div className="space-y-6" id="delivery-module">
      {/* Official Header Banner matching Dashboard Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-5 rounded-2xl shadow-md border border-slate-800 flex flex-col md:flex-row md:justify-between md:items-center gap-4 text-white">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold font-mono px-2 py-0.5 rounded border border-indigo-500/30">
              {t('delivery.bannerBadge')}
            </span>
            <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block" /> {t('delivery.readyBadge')}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">{t('delivery.title')}</h2>
          <p className="text-xs text-slate-300 mt-1">
            {t('delivery.subtitle')}
          </p>
        </div>

        {/* Tab selector */}
        <div className="flex bg-slate-950/60 p-1.5 rounded-xl border border-slate-700/60 self-start md:self-auto shrink-0">
          <button 
            onClick={() => setActiveSubTab('shipments')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'shipments' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <Truck className="h-4 w-4" /> {t('delivery.tabDispatch')}
          </button>
          <button 
            onClick={() => setActiveSubTab('forklift')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'forklift' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <Settings className="h-4 w-4" /> {t('delivery.tabForklift')}
          </button>
        </div>
      </div>

      {activeSubTab === 'shipments' ? (
        <div className="space-y-6">
          {/* Forklift status checker warning */}
          {!isForkliftPrechecked ? (
            <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl flex gap-3 items-start" id="forklift-warning-banner">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-bold text-xs">{t('delivery.forkliftWarningTitle')}</h4>
                <p className="text-xs text-slate-600">
                  {t('delivery.forkliftWarningDesc')}
                </p>
                <button 
                  onClick={() => setActiveSubTab('forklift')}
                  className="text-xs font-bold text-amber-800 underline block mt-2"
                >
                  {t('delivery.forkliftWarningBtn')}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-900 rounded-xl flex gap-3 items-start" id="forklift-passed-banner">
              <ClipboardCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-bold text-xs text-emerald-800">{t('delivery.forkliftPassedTitle')}</h4>
                <p className="text-xs text-slate-600">
                  {t('delivery.forkliftPassedDesc')}
                </p>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col gap-3">
            {/* Action Buttons Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full">
              <div className="flex flex-wrap items-center gap-2">
                <ExportMenu
                  id="btn-delivery-export-menu"
                  variant="indigo"
                  menuAlign="left"
                  items={[
                    {
                      id: 'btn-print-active-dr',
                      label: t('delivery.printDrBtn'),
                      title: t('delivery.printDrTooltip'),
                      icon: <Printer className="h-3.5 w-3.5 text-indigo-600" />,
                      onClick: () => {
                        const target = filteredDeliveries[0] || deliveries[0];
                        if (target) {
                          setPrintInitialView('OFFICIAL_DOC');
                          setSelectedPickingDocDelivery(target);
                        } else {
                          showPrintToast(t('delivery.noDeliveriesToPrint'), 'warning');
                        }
                      },
                    },
                    {
                      id: 'btn-print-delivery-log',
                      label: t('delivery.printSummaryBtn'),
                      title: t('delivery.printSummaryTooltip'),
                      icon: <Printer className="h-3.5 w-3.5 text-slate-600" />,
                      onClick: () => {
                        if (filteredDeliveries.length > 0 || deliveries.length > 0) {
                          setPrintInitialView('SUMMARY_LOG');
                          setSelectedPickingDocDelivery(filteredDeliveries[0] || deliveries[0]);
                        } else {
                          showPrintToast(t('delivery.noSummaryToPrint'), 'warning');
                        }
                      },
                    },
                  ]}
                />
              </div>

              <div className="flex items-center sm:ml-auto shrink-0">
                {effectiveCanEdit ? (
                  <button 
                    onClick={() => setShowPickForm(!showPickForm)}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
                    id="btn-create-pick"
                  >
                    <Plus className="h-4 w-4" /> {t('delivery.createDeliveryBtn')}
                  </button>
                ) : (
                  <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 rounded-lg font-bold uppercase shrink-0 whitespace-nowrap">
                    {t('delivery.viewOnlyBadge')}
                  </span>
                )}
              </div>
            </div>

            {/* Search Bar at Bottom */}
            <div className="relative w-full">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search className="h-4 w-4" />
              </span>
              <input 
                type="text" 
                placeholder={t('delivery.searchPlaceholder')} 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none bg-slate-50/50"
              />
            </div>
          </div>

          {showPickForm && (
            <form 
              noValidate
              onSubmit={handlePickSubmit}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4"
              id="picking-form"
            >
              <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                <h3 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-slate-500" /> {t('delivery.newDeliveryTitle')}
                </h3>
                <button type="button" onClick={() => { setPickFieldErrors({}); setShowPickForm(false); }} className="text-[10px] text-slate-400">{t('common.cancel')}</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('delivery.pickingListLabel')}</label>
                  <input 
                    type="text" required placeholder={t('delivery.pickDplPlaceholder')} value={pickingListNumber}
                    onChange={e => {
                      setPickingListNumber(e.target.value);
                      clearPickErr('pickingListNumber');
                    }}
                    className={`w-full px-3 py-1.5 border rounded text-xs font-mono ${
                      pickFieldErrors.pickingListNumber
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  />
                  {pickFieldErrors.pickingListNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(pickFieldErrors.pickingListNumber)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('delivery.poNumberLabel')}</label>
                  <input 
                    type="text" required placeholder={t('delivery.pickPoPlaceholder')} value={poNumber}
                    onChange={e => {
                      setPoNumber(e.target.value);
                      clearPickErr('poNumber');
                    }}
                    className={`w-full px-3 py-1.5 border rounded text-xs font-mono ${
                      pickFieldErrors.poNumber
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  />
                  {pickFieldErrors.poNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(pickFieldErrors.poNumber)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('delivery.modelNameLabel')}</label>
                  <input 
                    type="text" required placeholder={t('delivery.pickModelPlaceholder')} value={modelName}
                    onChange={e => {
                      setModelName(e.target.value);
                      clearPickErr('modelName');
                    }}
                    className={`w-full px-3 py-1.5 border rounded text-xs ${
                      pickFieldErrors.modelName
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  />
                  {pickFieldErrors.modelName && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(pickFieldErrors.modelName)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('delivery.partCodeLabel')}</label>
                  <input 
                    type="text" required placeholder={t('delivery.pickPartPlaceholder')} value={partCode}
                    onChange={e => handlePickPartCodeChange(e.target.value)}
                    className={`w-full px-3 py-1.5 border rounded text-xs font-mono ${
                      pickFieldErrors.partCode
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  />
                  {pickFieldErrors.partCode && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(pickFieldErrors.partCode)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('delivery.quantityLabel')}</label>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    required 
                    placeholder={t('delivery.pickQtyPlaceholder')}
                    value={quantityInput}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.-]/g, '');
                      setQuantityInput(raw);
                      const num = Number(raw);
                      setQuantity(raw.trim() === '' || Number.isNaN(num) ? 0 : num);
                      clearPickErr('quantity');
                    }}
                    className={`w-full px-3 py-1.5 border rounded text-xs font-mono ${
                      pickFieldErrors.quantity
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  />
                  {pickFieldErrors.quantity && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(pickFieldErrors.quantity)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('delivery.unitLabel')}</label>
                  <select
                    value={unit}
                    onChange={e => {
                      setUnit(normalizeUnitCode(e.target.value));
                      clearPickErr('unit');
                    }}
                    className={`w-full px-3 py-1.5 border rounded text-xs font-mono font-bold bg-white ${
                      pickFieldErrors.unit
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  >
                    {getAllSelectUomOptions(unit).map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  {pickFieldErrors.unit && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(pickFieldErrors.unit)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-1.5 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => { setPickFieldErrors({}); setShowPickForm(false); }} className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded text-xs">{t('receiving.discardBtn')}</button>
                <button type="submit" className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-semibold">{t('delivery.generatePickingBtn')}</button>
              </div>
            </form>
          )}

          {/* Deliveries list table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="shipment-grid-panel">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{t('delivery.shipmentLogTitle')}</span>
              <span className="text-xs font-mono text-slate-500 font-semibold">{t('delivery.entriesCount', { count: filteredDeliveries.length })}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-500 font-medium border-b border-slate-200">
                    <th className="p-4 font-semibold">{t('delivery.colGatePass')}</th>
                    <th className="p-4 font-semibold">{t('delivery.colDateCreated')}</th>
                    <th className="p-4 font-semibold">{t('delivery.colDplRef')}</th>
                    <th className="p-4 font-semibold">{t('delivery.colClientPo')}</th>
                    <th className="p-4 font-semibold">{t('delivery.colModelCode')}</th>
                    <th className="p-4 font-semibold text-right">{t('delivery.colQuantity')}</th>
                    <th className="p-4 font-semibold">{t('delivery.colSopChecks')}</th>
                    <th className="p-4 font-semibold">{t('delivery.colReleaseDocs')}</th>
                    <th className="p-4 font-semibold">{t('delivery.colReleaseStatus')}</th>
                    <th className="p-4 font-semibold">{t('delivery.colAction')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDeliveries.map(d => {
                    const isExpanded = expandedDeliveryId === d.id;
                    const matchedStock = stocks.find(s => 
                      (s.partCode || '').trim().toLowerCase() === (d.partCode || '').trim().toLowerCase()
                    );
                    const registryItem = registries.find(r => 
                      (r.code || '').trim().toLowerCase() === (d.partCode || '').trim().toLowerCase()
                    );
                    const deliveryUnitRes = resolveMasterDataUnit(
                      { unit: d.unit, partCode: d.partCode, modelName: d.modelName },
                      registries,
                      stocks
                    );
                    const matchedStockUnitRes = matchedStock
                      ? resolveMasterDataUnit(matchedStock, registries)
                      : null;

                    return (
                      <React.Fragment key={d.id}>
                        <tr 
                          onClick={(e) => {
                            const target = e.target as HTMLElement;
                            if (target.closest('button, select, input, a, [data-no-expand="true"]')) return;
                            setExpandedDeliveryId(prev => prev === d.id ? null : d.id);
                          }}
                          className={`cursor-pointer transition-all duration-150 ${
                            isExpanded 
                              ? 'bg-indigo-50/70 border-l-4 border-l-indigo-600 shadow-2xs' 
                              : 'hover:bg-indigo-50/30 hover:border-l-4 hover:border-l-indigo-300'
                          }`}
                          title={t('delivery.rowExpandTooltip')}
                        >
                          <td className="p-4 font-mono font-bold text-slate-800">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedDeliveryId(prev => prev === d.id ? null : d.id);
                                }}
                                className={`p-1 rounded-md transition-colors ${
                                  isExpanded ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                                }`}
                                title={isExpanded ? t('delivery.collapseRowTitle') : t('delivery.expandRowTitle')}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <span>{d.gatePassNumber}</span>
                            </div>
                          </td>
                          <td className="p-4 text-slate-600 font-mono">{d.date}</td>
                          <td className="p-4" data-no-expand="true">
                            <button
                              type="button"
                              onClick={() => {
                                setPrintInitialView('PICKING_LIST');
                                setSelectedPickingDocDelivery(d);
                              }}
                              className="font-mono font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer"
                              title={t('delivery.dplPrintTooltip')}
                            >
                              <Printer className="h-3 w-3 text-indigo-500 shrink-0" />
                              <span>{d.pickingListNumber}</span>
                            </button>
                          </td>
                          <td className="p-4 font-mono text-slate-600">{d.poNumber}</td>
                          <td className="p-4">
                            <div className="font-mono font-bold text-slate-800">{d.partCode}</div>
                            <div className="text-slate-500 text-[11px] truncate max-w-[150px]">{d.modelName}</div>
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-slate-950">
                            <span>{formatNumberForUnit(d.quantity)}</span>{' '}
                            {deliveryUnitRes.isMissing ? (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 text-[9px] font-bold">
                                {MISSING_UNIT_LABEL}
                              </span>
                            ) : (
                              <span className="text-[11px] font-bold text-slate-600">{deliveryUnitRes.unit}</span>
                            )}
                          </td>
                          <td className="p-4 space-y-1">
                            <div className="flex items-center gap-1 text-[10px] font-medium text-slate-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {t('delivery.sopPackagingOk')}
                            </div>
                            <div className="flex items-center gap-1 text-[10px] font-medium text-slate-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {t('delivery.sopFifoConfirmed')}
                            </div>
                            <div className="flex items-center gap-1 text-[10px] font-medium text-slate-700">
                              <span className={`h-1.5 w-1.5 rounded-full ${d.forkliftChecklistSigned ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
                              {t('delivery.sopForkliftPrechecked')}
                            </div>
                          </td>
                          <td className="p-4 text-[10px] text-slate-600 space-y-0.5">
                            {d.drNumber ? (
                              <div className="font-mono font-semibold text-slate-800">DR: {d.drNumber}</div>
                            ) : (
                              <div className="text-slate-400 italic">{t('delivery.noDrYet')}</div>
                            )}
                            {d.salesInvoice ? (
                              <div className="font-mono text-slate-500">SI: {d.salesInvoice}</div>
                            ) : (
                              <div className="text-slate-400 italic">{t('delivery.noSalesInvoice')}</div>
                            )}
                            {d.wayBill ? (
                              <div className="font-mono text-slate-400 font-medium">Waybill: {d.wayBill}</div>
                            ) : (
                              <div className="text-slate-400 italic">{t('delivery.noWaybillAssigned')}</div>
                            )}
                          </td>
                          <td className="p-4">
                            {d.status === 'PREPARING' ? (
                              <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2 py-1 rounded font-bold text-[9px]">
                                {t('delivery.statusPreparing')}
                              </span>
                            ) : d.status === 'LOADED' ? (
                              <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded font-bold text-[9px] animate-pulse">
                                {t('delivery.statusLoaded')}
                              </span>
                            ) : (
                              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded font-bold text-[9px]">
                                {t('delivery.statusReleased')}
                              </span>
                            )}
                          </td>
                          <td className="p-4" data-no-expand="true">
                            <select
                              defaultValue=""
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'PRINT_DR') {
                                  setPrintInitialView('OFFICIAL_DOC');
                                  setSelectedPickingDocDelivery(d);
                                } else if (val === 'PRINT_DPL') {
                                  setPrintInitialView('PICKING_LIST');
                                  setSelectedPickingDocDelivery(d);
                                } else if (val === 'LOAD') {
                                  if (!effectiveCanEdit) return;
                                  if (!isForkliftPrechecked) {
                                    showPrintToast(t('delivery.cannotLoadPalletsErr'), 'error');
                                    e.target.value = '';
                                    return;
                                  }
                                  onUpdateDeliveryStatus(d.id, 'LOADED');
                                } else if (val === 'GATE_PASS') {
                                  if (!effectiveCanEdit) return;
                                  setGatePassFieldErrors({});
                                  setDrNumber('');
                                  setSalesInvoice('');
                                  setWayBill('');
                                  setShowGatePassModal(d.id);
                                } else if (val === 'EDIT') {
                                  if (!effectiveCanEdit) return;
                                  setEditFieldErrors({});
                                  setEditDeliveryQtyInput(String(d.quantity ?? ''));
                                  setEditingDelivery({ ...d });
                                } else if (val === 'DELETE') {
                                  if (!isSuperAdmin) return;
                                  setConfirmAction({
                                    title: t('delivery.deleteDeliveryTitle'),
                                    message: t('delivery.deleteDeliveryMsg', { id: d.gatePassNumber, modelName: d.modelName }),
                                    confirmLabel: t('delivery.confirmYesDeleteShipment'),
                                    confirmVariant: 'danger',
                                    onConfirm: () => onDeleteDelivery?.(d.id)
                                  });
                                }
                                e.target.value = '';
                              }}
                              className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                              id={`action-select-del-${d.id}`}
                            >
                              <option value="" disabled>{t('delivery.actionsPlaceholder')}</option>
                              <option value="PRINT_DR">📄 {t('delivery.actionPrintDr')}</option>
                              <option value="PRINT_DPL">📋 {t('delivery.printPickingAction')}</option>
                              {effectiveCanEdit && (
                                <>
                                  {d.status === 'PREPARING' && (
                                    <option value="LOAD">📦 {t('delivery.loadPalletsAction')}</option>
                                  )}
                                  {d.status === 'LOADED' && (
                                    <option value="GATE_PASS">📄 {t('delivery.gateReleaseAction')}</option>
                                  )}
                                  <option value="EDIT">📝 {t('delivery.editShipmentAction')}</option>
                                </>
                              )}
                              {isSuperAdmin && (
                                <option value="DELETE">🗑️ {t('delivery.deleteShipmentAction')}</option>
                              )}
                            </select>
                          </td>
                        </tr>

                        {/* Expandable Card View for Delivery Shipment Record */}
                        <AnimatePresence>
                          {isExpanded && (
                            <tr>
                              <td colSpan={10} className="p-0 bg-slate-50/80 border-b-2 border-indigo-200">
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="p-5 space-y-4">
                                    {/* Header Summary Ribbon */}
                                    <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                                      <div className="flex items-center gap-3">
                                        <div className="p-2.5 bg-blue-50 rounded-lg text-blue-600">
                                          <Truck className="h-5 w-5" />
                                        </div>
                                        <div>
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-slate-900">
                                              {t('delivery.cardGatePassColon')} <span className="font-mono text-indigo-600">{d.gatePassNumber}</span>
                                            </span>
                                            <span className="text-xs text-slate-400 font-mono">({d.id})</span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                              d.status === 'RELEASED' 
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                                : d.status === 'LOADED' 
                                                ? 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'
                                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                                            }`}>
                                              {d.status === 'RELEASED' ? t('delivery.statusReleased') : d.status === 'LOADED' ? t('delivery.statusLoaded') : t('delivery.cardPreparingStaging')}
                                            </span>
                                          </div>
                                          <p className="text-xs text-slate-500 mt-0.5">
                                            {t('delivery.cardModelColon')} <strong className="text-slate-800">{d.modelName}</strong> &bull; {t('delivery.cardPartCodeColon')} <strong className="font-mono text-slate-800">{d.partCode}</strong> &bull; {t('delivery.cardPoColon')} <strong className="font-mono text-slate-700">{d.poNumber}</strong>
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="bg-slate-100 text-slate-700 font-mono font-semibold px-2.5 py-1 rounded-lg border border-slate-200">
                                          {t('delivery.cardDateColon')} {d.date}
                                        </span>
                                        <span className={`font-bold px-2.5 py-1 rounded-lg border font-mono ${
                                          deliveryUnitRes.isMissing
                                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                                            : 'bg-blue-50 text-blue-800 border-blue-200'
                                        }`}>
                                          {t('delivery.cardQtyColon')} {formatNumberForUnit(d.quantity)} {deliveryUnitRes.isMissing ? MISSING_UNIT_LABEL : deliveryUnitRes.unit}
                                        </span>
                                        {matchedStock && matchedStockUnitRes && (
                                          <span className="bg-emerald-50 text-emerald-800 font-bold px-2.5 py-1 rounded-lg border border-emerald-200 font-mono">
                                            {t('delivery.cardWhStockColon')} {formatNumberForUnit(matchedStock.quantity)} {matchedStockUnitRes.isMissing ? MISSING_UNIT_LABEL : matchedStockUnitRes.unit}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* 3-Column Detailed Metadata Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                      {/* Col 1: Shipment & Order Specs */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <Factory className="h-4 w-4 text-indigo-500" />
                                          <span>{t('delivery.cardShipmentSpecsTitle')}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('delivery.cardClientPo')}</span>
                                            <span className="font-mono font-bold text-slate-800">{d.poNumber}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('delivery.cardDpl')}</span>
                                            <span className="font-mono font-semibold text-indigo-700">{d.pickingListNumber}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('delivery.cardPartCode')}</span>
                                            <span className="font-mono font-bold text-slate-800">{d.partCode}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('delivery.cardProductModel')}</span>
                                            <span className="font-semibold text-slate-800">{d.modelName}</span>
                                          </div>
                                          <div className="col-span-2 pt-1 border-t border-slate-100 flex justify-between items-center text-slate-500 text-[11px]">
                                            <span>{t('delivery.cardCategoryGroup')}</span>
                                            <span className="font-semibold text-slate-700">{registryItem?.category || t('delivery.cardFgOutbound')}</span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Col 2: Official Release Documents */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <FileSignature className="h-4 w-4 text-emerald-600" />
                                          <span>{t('delivery.cardOfficialDocsTitle')}</span>
                                        </div>
                                        <div className="space-y-2 text-xs">
                                          <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-150">
                                            <div>
                                              <span className="text-slate-400 text-[10px] block">{t('delivery.cardDrLabel')}</span>
                                              <span className="font-mono font-bold text-slate-800 text-[11px]">{d.drNumber || t('delivery.cardPendingIssuance')}</span>
                                            </div>
                                            <div>
                                              <span className="text-slate-400 text-[10px] block">{t('delivery.cardSiLabel')}</span>
                                              <span className="font-mono font-bold text-slate-800 text-[11px]">{d.salesInvoice || t('delivery.cardPendingBilling')}</span>
                                            </div>
                                            <div className="col-span-2 pt-1 border-t border-slate-200">
                                              <span className="text-slate-400 text-[10px] block">{t('delivery.cardWaybillLabel')}</span>
                                              <span className="font-mono font-semibold text-slate-700 text-[11px]">{d.wayBill || t('delivery.cardPendingCarrier')}</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Col 3: Safety & SOP Verification Checks + Quick Action */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <ShieldCheck className="h-4 w-4 text-purple-500" />
                                          <span>{t('delivery.cardSopAuditTitle')}</span>
                                        </div>

                                        <div className="space-y-2 text-xs">
                                          <div className="space-y-1 bg-slate-50 p-2 rounded-lg border border-slate-150 text-[11px]">
                                            <div className="flex items-center justify-between">
                                              <span className="text-slate-600">{t('delivery.cardPkgIntegrity')}</span>
                                              <span className="text-emerald-700 font-bold flex items-center gap-1">
                                                <Check className="h-3 w-3" /> {t('delivery.cardVerifiedOk')}
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span className="text-slate-600">{t('delivery.cardFifoBatchIntegrity')}</span>
                                              <span className="text-emerald-700 font-bold flex items-center gap-1">
                                                <Check className="h-3 w-3" /> {t('delivery.cardVerifiedOk')}
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span className="text-slate-600">{t('delivery.cardDailyForkliftInsp')}</span>
                                              <span className={`font-bold flex items-center gap-1 ${d.forkliftChecklistSigned ? 'text-emerald-700' : 'text-amber-600'}`}>
                                                {d.forkliftChecklistSigned ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                                {d.forkliftChecklistSigned ? t('delivery.cardCompleted') : t('delivery.cardPendingCheck')}
                                              </span>
                                            </div>
                                          </div>

                                          <div className="flex gap-2 pt-1" data-no-expand="true">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setPrintInitialView('OFFICIAL_DOC');
                                                setSelectedPickingDocDelivery(d);
                                              }}
                                              className="flex-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-blue-200 flex items-center justify-center gap-1 shadow-2xs"
                                            >
                                              <Printer className="h-3 w-3" /> {t('delivery.cardBtnDrGatePass')}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setPrintInitialView('PICKING_LIST');
                                                setSelectedPickingDocDelivery(d);
                                              }}
                                              className="flex-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-slate-200 flex items-center justify-center gap-1 shadow-2xs"
                                            >
                                              <ClipboardList className="h-3 w-3" /> {t('delivery.cardBtnPickList')}
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </motion.div>
                              </td>
                            </tr>
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Forklift Checks subtab */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <h3 className="font-bold text-sm text-slate-800">{t('delivery.forkliftSectionTitle')}</h3>
              <p className="text-xs text-slate-500 mt-1">
                {t('delivery.forkliftSectionSubtitle')}
              </p>
            </div>

            {effectiveCanEdit ? (
              <button 
                onClick={() => setShowForkliftForm(!showForkliftForm)}
                className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                id="btn-log-forklift"
              >
                <Plus className="h-4 w-4" /> {t('delivery.createDailyPrecheckBtn')}
              </button>
            ) : (
              <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded font-bold uppercase">
                {t('delivery.viewOnlyBadge')}
              </span>
            )}
          </div>

          {showForkliftForm && (
            <form 
              onSubmit={handleForkliftCheckSubmit}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4"
              id="forklift-form"
            >
              <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                <h4 className="font-bold text-xs text-slate-800">{t('delivery.forkliftFormTitle')}</h4>
                <button type="button" onClick={() => setShowForkliftForm(false)} className="text-[10px] text-slate-400">{t('common.cancel')}</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('delivery.operatorNameLabel')}</label>
                  <input 
                    type="text" required placeholder={t('delivery.operatorPlaceholder')} value={operator}
                    onChange={e => setOperator(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('delivery.forkliftIdLabel')}</label>
                  <select 
                    value={forkliftId}
                    onChange={e => setForkliftId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs"
                  >
                    <option value="FL-TOYOTA-02">{t('delivery.forkliftFleetOpt1')}</option>
                    <option value="FL-KOMATSU-01">{t('delivery.forkliftFleetOpt2')}</option>
                    <option value="FL-NISSAN-05">{t('delivery.forkliftFleetOpt3')}</option>
                  </select>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-3">
                <h5 className="text-[11px] font-bold text-slate-700">{t('delivery.forkliftChecksSubtitle')}</h5>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={brakesOk} onChange={e => setBrakesOk(e.target.checked)} className="h-4 w-4" />
                    {t('delivery.checkBrakes')}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={lightsOk} onChange={e => setLightsOk(e.target.checked)} className="h-4 w-4" />
                    {t('delivery.checkLights')}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={hydraulicOk} onChange={e => setHydraulicOk(e.target.checked)} className="h-4 w-4" />
                    {t('delivery.checkHydraulic')}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={steeringOk} onChange={e => setSteeringOk(e.target.checked)} className="h-4 w-4" />
                    {t('delivery.checkSteering')}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={tiresOk} onChange={e => setTiresOk(e.target.checked)} className="h-4 w-4" />
                    {t('delivery.checkTires')}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={batteryFluidOk} onChange={e => setBatteryFluidOk(e.target.checked)} className="h-4 w-4" />
                    {t('delivery.checkBatteryFluid')}
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('delivery.inspectionRemarksLabel')}</label>
                <input 
                  type="text" placeholder={t('delivery.remarksPlaceholder')} value={remarks}
                  onChange={e => setRemarks(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div className="flex justify-end gap-1 border-t border-slate-100 pt-3">
                <button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold px-3 py-1.5 rounded">
                  {t('delivery.submitForkliftBtn')}
                </button>
              </div>
            </form>
          )}

          {/* Forklift checks logs list */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="forklift-grid-panel">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{t('delivery.forkliftHistoryTitle')}</span>
            </div>

            <div className="divide-y divide-slate-100 text-xs">
              {forkliftChecks.map(check => {
                const isExpanded = expandedForkliftId === check.id;
                const checkPassed = check.brakesOk && check.lightsOk && check.hydraulicOk && check.steeringOk && check.tiresOk && check.batteryFluidOk;
                return (
                  <div key={check.id} className="transition-colors">
                    <div 
                      onClick={() => setExpandedForkliftId(prev => prev === check.id ? null : check.id)}
                      className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer transition-all ${
                        isExpanded ? 'bg-indigo-50/60 border-l-4 border-l-indigo-600' : 'hover:bg-slate-50/70 hover:border-l-4 hover:border-l-indigo-300'
                      }`}
                      title={t('delivery.forkliftRowTooltip')}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedForkliftId(prev => prev === check.id ? null : check.id);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-slate-700"
                          >
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                          <span className="font-mono font-bold text-slate-800">{check.forkliftId}</span>
                          <span className="text-slate-400 font-mono text-[11px]">&bull; {t('delivery.forkliftDatePrefix')} {check.date}</span>
                        </div>
                        <div className="text-slate-600 font-medium flex items-center gap-1 pl-6">
                          {t('delivery.forkliftSignedOpPrefix')} <span className="font-semibold text-slate-800">{check.operator}</span>
                        </div>
                        {check.remarks && (
                          <div className="text-[11px] text-slate-400 italic pl-6">{t('delivery.forkliftRemarksPrefix')} {check.remarks}</div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-3">
                        {checkPassed ? (
                          <span className="bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-1 rounded flex items-center gap-1 border border-emerald-100">
                            <CheckCircle className="h-4 w-4" /> {t('delivery.passedAll')}
                          </span>
                        ) : (
                          <span className="bg-rose-50 text-rose-700 font-semibold px-2.5 py-1 rounded flex items-center gap-1 border border-rose-100">
                            <ShieldAlert className="h-4 w-4" /> {t('delivery.failedCheck')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expandable 6-Point Checklist Breakdown */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="bg-slate-50 border-t border-slate-100 p-4 overflow-hidden"
                        >
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-[11px]">
                            <div className={`p-2.5 rounded-lg border ${check.brakesOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">{t('delivery.cardBrakes')}:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.brakesOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.brakesOk ? t('delivery.passLabel') : t('delivery.failLabel')}
                              </span>
                            </div>
                            <div className={`p-2.5 rounded-lg border ${check.lightsOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">{t('delivery.cardLights')}:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.lightsOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.lightsOk ? t('delivery.passLabel') : t('delivery.failLabel')}
                              </span>
                            </div>
                            <div className={`p-2.5 rounded-lg border ${check.hydraulicOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">{t('delivery.cardHydraulic')}:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.hydraulicOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.hydraulicOk ? t('delivery.passLabel') : t('delivery.failLabel')}
                              </span>
                            </div>
                            <div className={`p-2.5 rounded-lg border ${check.steeringOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">{t('delivery.cardSteering')}:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.steeringOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.steeringOk ? t('delivery.passLabel') : t('delivery.failLabel')}
                              </span>
                            </div>
                            <div className={`p-2.5 rounded-lg border ${check.tiresOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">{t('delivery.cardTires')}:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.tiresOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.tiresOk ? t('delivery.passLabel') : t('delivery.failLabel')}
                              </span>
                            </div>
                            <div className={`p-2.5 rounded-lg border ${check.batteryFluidOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">{t('delivery.cardBattery')}:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.batteryFluidOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.batteryFluidOk ? t('delivery.passLabel') : t('delivery.failLabel')}
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Gate Pass Release Modal Dialog */}
      {typeof document !== 'undefined' && showGatePassModal && createPortal(
        <AnimatePresence>
          <motion.div
            key="gate-pass-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-[100] overflow-y-auto"
          >
            <motion.div
              key="gate-pass-modal-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full space-y-4 my-auto"
            >
              <div>
                <h4 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                  <FileSignature className="h-4 w-4 text-slate-600" /> {t('delivery.releaseModalTitle')}
                </h4>
                <p className="text-[11px] text-slate-500 mt-1">{t('delivery.releaseModalSubtitle')}</p>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">{t('delivery.drNumberLabel')}</label>
                  <input 
                    type="text" required placeholder="DR-00001" value={drNumber}
                    onChange={e => {
                      setDrNumber(e.target.value);
                      clearGateErr('drNumber');
                    }}
                    className={`w-full border px-3 py-1.5 rounded font-mono focus:outline-none ${
                      gatePassFieldErrors.drNumber
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  />
                  {gatePassFieldErrors.drNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(gatePassFieldErrors.drNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">{t('delivery.salesInvoiceLabel')}</label>
                  <input 
                    type="text" required placeholder="SI-00001" value={salesInvoice}
                    onChange={e => {
                      setSalesInvoice(e.target.value);
                      clearGateErr('salesInvoice');
                    }}
                    className={`w-full border px-3 py-1.5 rounded font-mono focus:outline-none ${
                      gatePassFieldErrors.salesInvoice
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  />
                  {gatePassFieldErrors.salesInvoice && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(gatePassFieldErrors.salesInvoice)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">{t('delivery.wayBillLabel')}</label>
                  <input 
                    type="text" required placeholder="WB-LBC-00001" value={wayBill}
                    onChange={e => {
                      setWayBill(e.target.value);
                      clearGateErr('wayBill');
                    }}
                    className={`w-full border px-3 py-1.5 rounded font-mono focus:outline-none ${
                      gatePassFieldErrors.wayBill
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  />
                  {gatePassFieldErrors.wayBill && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(gatePassFieldErrors.wayBill)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-2 border-t border-slate-100">
                <button 
                  onClick={() => {
                    setGatePassFieldErrors({});
                    setShowGatePassModal(null);
                  }}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded hover:bg-slate-50 cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                <button 
                  onClick={() => handleGatePassReleaseSubmit(showGatePassModal)}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 cursor-pointer"
                >
                  {t('delivery.confirmReleaseBtn')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Edit Delivery Modal (Super Admin) */}
      {typeof document !== 'undefined' && editingDelivery && createPortal(
        <AnimatePresence>
          <motion.div
            key="editing-delivery-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-[100] overflow-y-auto"
          >
            <motion.div
              key="editing-delivery-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full space-y-4 max-h-[calc(100vh-2rem)] my-auto overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Edit className="h-4 w-4 text-indigo-600" /> {t('delivery.editDeliveryTitle', { id: editingDelivery.gatePassNumber })}
                  </h4>
                  <p className="text-[11px] text-slate-500">{t('delivery.editSubtitle')}</p>
                </div>
                <button 
                  onClick={() => setEditingDelivery(null)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editGatePassLabel')}</label>
                  <input 
                    type="text" 
                    value={editingDelivery.gatePassNumber}
                    onChange={e => setEditingDelivery({ ...editingDelivery, gatePassNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editDateLabel')}</label>
                  <input 
                    type="date" 
                    value={editingDelivery.date}
                    onChange={e => setEditingDelivery({ ...editingDelivery, date: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editDplRefLabel')}</label>
                  <input 
                    type="text" 
                    value={editingDelivery.pickingListNumber}
                    onChange={e => {
                      setEditingDelivery({ ...editingDelivery, pickingListNumber: e.target.value });
                      clearEditDelErr('pickingListNumber');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editFieldErrors.pickingListNumber
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editFieldErrors.pickingListNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editFieldErrors.pickingListNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editPoLabel')}</label>
                  <input 
                    type="text" 
                    placeholder="PO-2026-0001"
                    value={editingDelivery.poNumber}
                    onChange={e => {
                      setEditingDelivery({ ...editingDelivery, poNumber: e.target.value });
                      clearEditDelErr('poNumber');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editFieldErrors.poNumber
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editFieldErrors.poNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editFieldErrors.poNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editPartCodeLabel')}</label>
                  <input 
                    type="text" 
                    value={editingDelivery.partCode}
                    onChange={e => {
                      setEditingDelivery({ ...editingDelivery, partCode: e.target.value.toUpperCase() });
                      clearEditDelErr('partCode');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editFieldErrors.partCode
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editFieldErrors.partCode && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editFieldErrors.partCode)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editModelNameLabel')}</label>
                  <input 
                    type="text" 
                    value={editingDelivery.modelName}
                    onChange={e => {
                      setEditingDelivery({ ...editingDelivery, modelName: e.target.value });
                      clearEditDelErr('modelName');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 ${
                      editFieldErrors.modelName
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editFieldErrors.modelName && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editFieldErrors.modelName)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editQtyLabel')}</label>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    value={editDeliveryQtyInput}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.-]/g, '');
                      setEditDeliveryQtyInput(raw);
                      const num = Number(raw);
                      setEditingDelivery({ ...editingDelivery, quantity: raw.trim() === '' || Number.isNaN(num) ? 0 : num });
                      clearEditDelErr('quantity');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editFieldErrors.quantity
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editFieldErrors.quantity && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editFieldErrors.quantity)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editUomLabel')}</label>
                  <select
                    value={normalizeUnitCode(editingDelivery.unit)}
                    onChange={e => {
                      const norm = normalizeUnitCode(e.target.value);
                      setEditingDelivery({ ...editingDelivery, unit: norm, unitMissing: !norm });
                      clearEditDelErr('unit');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono font-bold bg-white ${
                      editFieldErrors.unit
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  >
                    <option value="">{t('delivery.editSelectUomOpt')}</option>
                    {getAllSelectUomOptions(editingDelivery.unit).map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  {editFieldErrors.unit && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editFieldErrors.unit)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editStatusLabel')}</label>
                  <select 
                    value={editingDelivery.status}
                    onChange={e => {
                      setEditingDelivery({ ...editingDelivery, status: e.target.value as any });
                      clearEditDelErr('drNumber');
                      clearEditDelErr('salesInvoice');
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-bold"
                  >
                    <option value="PREPARING">{t('delivery.editStatusPreparingOpt')}</option>
                    <option value="LOADED">{t('delivery.editStatusLoadedOpt')}</option>
                    <option value="RELEASED">{t('delivery.editStatusReleasedOpt')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editDrLabel')}</label>
                  <input 
                    type="text" 
                    placeholder="DR-00001"
                    value={editingDelivery.drNumber || ''}
                    onChange={e => {
                      setEditingDelivery({ ...editingDelivery, drNumber: e.target.value });
                      clearEditDelErr('drNumber');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editFieldErrors.drNumber
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editFieldErrors.drNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editFieldErrors.drNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editSiLabel')}</label>
                  <input 
                    type="text" 
                    placeholder="SI-00001"
                    value={editingDelivery.salesInvoice || ''}
                    onChange={e => {
                      setEditingDelivery({ ...editingDelivery, salesInvoice: e.target.value });
                      clearEditDelErr('salesInvoice');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editFieldErrors.salesInvoice
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editFieldErrors.salesInvoice && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editFieldErrors.salesInvoice)}
                    </p>
                  )}
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('delivery.editWaybillLabel')}</label>
                  <input 
                    type="text" 
                    value={editingDelivery.wayBill || ''}
                    onChange={e => {
                      setEditingDelivery({ ...editingDelivery, wayBill: e.target.value });
                      clearEditDelErr('wayBill');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editFieldErrors.wayBill
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editFieldErrors.wayBill && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editFieldErrors.wayBill)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  onClick={() => {
                    setEditFieldErrors({});
                    setEditingDelivery(null);
                  }}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
                >
                  {t('common.cancel')}
                </button>
                <button 
                  onClick={() => {
                    const resolved = resolveMasterDataUnit(editingDelivery, registries, stocks);
                    const rawQty = editDeliveryQtyInput.trim() === '' ? NaN : Number(editDeliveryQtyInput.trim());
                    const candidate: DeliveryRecord = {
                      ...editingDelivery,
                      quantity: Number.isNaN(rawQty) ? 0 : rawQty,
                      unit: resolved.unit,
                      unitMissing: !resolved.unit,
                      poNumber: editingDelivery.poNumber?.trim() || '',
                      drNumber: editingDelivery.drNumber?.trim() || undefined,
                      salesInvoice: editingDelivery.salesInvoice?.trim() || undefined,
                      wayBill: editingDelivery.wayBill?.trim() || undefined,
                    };
                    const validation = validateDeliveryRecord(
                      {
                        ...candidate,
                        quantity: editDeliveryQtyInput.trim() === '' ? '' : rawQty,
                      } as any,
                      deliveries,
                      {
                        requireOperationalFields: true,
                        requireReleaseDocs: editingDelivery.status === 'RELEASED',
                      }
                    );
                    if (!validation.valid) {
                      setEditFieldErrors(validation.fieldErrors);
                      showPrintToast(localizeValidation(validation.message || '') || t('delivery.fixValidation'), 'warning');
                      return;
                    }
                    setEditFieldErrors({});
                    onEditDelivery?.(candidate);
                    setEditingDelivery(null);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold"
                >
                  {t('delivery.saveDeliveryChangesBtn')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Printable Picking List & Documentation Modal */}
      {selectedPickingDocDelivery && (
        <PrintablePickingListModal
          delivery={selectedPickingDocDelivery}
          deliveriesList={filteredDeliveries}
          stocks={stocks}
          registries={registries}
          initialView={printInitialView}
          onClose={() => setSelectedPickingDocDelivery(null)}
        />
      )}

      {/* Confirmation Modal with YES / NO options */}
      <ConfirmModal config={confirmAction} onClose={() => setConfirmAction(null)} />
    </div>
  );
}
