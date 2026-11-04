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
  Activity, 
  ClipboardCheck, 
  ShieldAlert, 
  UserPlus,
  Edit,
  Trash2,
  Printer,
  ChevronDown,
  ChevronRight,
  PackageCheck,
  ClipboardList,
  Check,
  Layers,
  Building2,
  Factory,
  Tag,
  ShieldCheck
} from 'lucide-react';
import { DeliveryRecord, ForkliftChecklist, MaterialStockItem, MasterRegistryItem } from '../types';
import PrintablePickingListModal, { DocViewMode } from './PrintablePickingListModal';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';
import { motion, AnimatePresence } from 'motion/react';
import { generateAuthoritativeId } from '../lib/idGenerator';
import { formatDrNumber, formatSiNumber, formatWaybillNumber } from '../data';

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

  const todayStr = new Date().toISOString().split('T')[0];

  const isForkliftPrechecked = forkliftChecks.some(check => check.date === todayStr);

  const handlePickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickingListNumber || !poNumber || !modelName || !partCode || quantity <= 0) {
      alert('Please fill out all fields correctly.');
      return;
    }

    const newDelivery: DeliveryRecord = {
      id: generateAuthoritativeId('DEL'),
      date: todayStr,
      pickingListNumber,
      poNumber,
      modelName,
      partCode,
      quantity,
      packagingConditionOk: true,
      fifoVerified: true,
      forkliftChecklistSigned: isForkliftPrechecked,
      gatePassNumber: `MGP-2026-${generateAuthoritativeId('GP')}`,
      status: 'PREPARING',
      preparedBy: 'Aldrin Clerk'
    };

    onAddDelivery(newDelivery);

    // Reset
    setPickingListNumber('');
    setPoNumber('');
    setModelName('');
    setPartCode('');
    setQuantity(0);
    setShowPickForm(false);
  };

  const handleForkliftCheckSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!operator) {
      alert('Operator name is required.');
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
    if (!drNumber || !salesInvoice || !wayBill) {
      alert('Please key in all release references (DR #, Sales Invoice #, and Waybill #) as required by standard gate protocols.');
      return;
    }

    onUpdateDeliveryStatus(id, 'RELEASED', { drNumber, salesInvoice, wayBill });
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
              OUTBOUND DISPATCH & LOGISTICS
            </span>
            <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block" /> READY
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Delivery & Gate Pass Operations</h2>
          <p className="text-xs text-slate-300 mt-1">
            Build Picking Lists, execute forklift pre-inspections, verify packaging, and authorize Gate Passes.
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
            <Truck className="h-4 w-4" /> Outbound Shipments
          </button>
          <button 
            onClick={() => setActiveSubTab('forklift')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'forklift' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <Settings className="h-4 w-4" /> Forklift Pre-Inspection
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
                <h4 className="font-bold text-xs">Safe Loading Pre-requisite Pending</h4>
                <p className="text-xs text-slate-600">
                  <strong>The forklift pre-inspection checklist is pending for today!</strong> Operators must complete this safety check before loading palletized finished goods to trucks.
                </p>
                <button 
                  onClick={() => setActiveSubTab('forklift')}
                  className="text-xs font-bold text-amber-800 underline block mt-2"
                >
                  Log Forklift Pre-Inspection Check Now
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-900 rounded-xl flex gap-3 items-start" id="forklift-passed-banner">
              <ClipboardCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-bold text-xs text-emerald-800">Forklift Operations Approved</h4>
                <p className="text-xs text-slate-600">
                  Forklift inspection checklist is complete. Safe loading and transfer operations are fully authorized.
                </p>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col gap-3">
            {/* Action Buttons Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full">
              <div className="flex flex-wrap items-center gap-2 overflow-x-auto">
                <button 
                  type="button"
                  onClick={() => {
                    const target = filteredDeliveries[0] || deliveries[0];
                    if (target) {
                      setPrintInitialView('OFFICIAL_DOC');
                      setSelectedPickingDocDelivery(target);
                    } else {
                      alert('No delivery records available to print.');
                    }
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-3.5 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
                  id="btn-print-active-dr"
                  title="Preview & Print Official Delivery Receipt & Gate Pass Manifest"
                >
                  <Printer className="h-4 w-4" /> Print Delivery Receipt & Gate Pass
                </button>

                <button 
                  type="button"
                  onClick={() => {
                    if (filteredDeliveries.length > 0 || deliveries.length > 0) {
                      setPrintInitialView('SUMMARY_LOG');
                      setSelectedPickingDocDelivery(filteredDeliveries[0] || deliveries[0]);
                    } else {
                      alert('No delivery records available to print log summary.');
                    }
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 px-3.5 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
                  id="btn-print-delivery-log"
                  title="Print Summary Log Report of all Filtered Delivery Records"
                >
                  <Printer className="h-4 w-4 text-slate-300" /> Print Summary Log
                </button>
              </div>

              <div className="flex items-center sm:ml-auto shrink-0">
                {effectiveCanEdit ? (
                  <button 
                    onClick={() => setShowPickForm(!showPickForm)}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
                    id="btn-create-pick"
                  >
                    <Plus className="h-4 w-4" /> Create Picking List (DPL)
                  </button>
                ) : (
                  <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 rounded-lg font-bold uppercase shrink-0 whitespace-nowrap">
                    🔒 View-Only Mode
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
                placeholder="Search shipping records..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none bg-slate-50/50"
              />
            </div>
          </div>

          {showPickForm && (
            <form 
              onSubmit={handlePickSubmit}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4"
              id="picking-form"
            >
              <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                <h3 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-slate-500" /> New Delivery Picking List (DPL) Entry
                </h3>
                <button type="button" onClick={() => setShowPickForm(false)} className="text-[10px] text-slate-400">Cancel</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Picking List (DPL) # *</label>
                  <input 
                    type="text" required placeholder="e.g. DPL-2026-906" value={pickingListNumber}
                    onChange={e => setPickingListNumber(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Customer PO Number *</label>
                  <input 
                    type="text" required placeholder="e.g. CUST-PO-45523" value={poNumber}
                    onChange={e => setPoNumber(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Finished Model / Description *</label>
                  <input 
                    type="text" required placeholder="e.g. Smart Router Pro" value={modelName}
                    onChange={e => setModelName(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Part Code *</label>
                  <input 
                    type="text" required placeholder="e.g. FG-SN-999" value={partCode}
                    onChange={e => setPartCode(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Dispatch Quantity *</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required 
                    placeholder="Dispatch qty"
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
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-1.5 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowPickForm(false)} className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded text-xs">Discard</button>
                <button type="submit" className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-semibold">Generate Picking List</button>
              </div>
            </form>
          )}

          {/* Deliveries list table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="shipment-grid-panel">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Outbound Shipments & Gate Pass Log</span>
              <span className="text-xs font-mono text-slate-500 font-semibold">{filteredDeliveries.length} entries</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-500 font-medium border-b border-slate-200">
                    <th className="p-4 font-semibold">Gate Pass #</th>
                    <th className="p-4 font-semibold">Date Created</th>
                    <th className="p-4 font-semibold">DPL Ref</th>
                    <th className="p-4 font-semibold">Client PO</th>
                    <th className="p-4 font-semibold">Model Name & Code</th>
                    <th className="p-4 font-semibold text-right">Quantity</th>
                    <th className="p-4 font-semibold">SOP Verification Checks</th>
                    <th className="p-4 font-semibold">Official Release Documents</th>
                    <th className="p-4 font-semibold">Release Status</th>
                    <th className="p-4 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDeliveries.map(d => {
                    const isExpanded = expandedDeliveryId === d.id;
                    const isFullyLoaded = d.status === 'LOADED' || d.status === 'RELEASED';
                    const matchedStock = stocks.find(s => 
                      (s.partCode || '').trim().toLowerCase() === (d.partCode || '').trim().toLowerCase()
                    );
                    const registryItem = registries.find(r => 
                      (r.code || '').trim().toLowerCase() === (d.partCode || '').trim().toLowerCase()
                    );

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
                          title="Click row to expand outbound shipment metadata & compliance checks"
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
                                title={isExpanded ? 'Collapse row' : 'Expand row details'}
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
                              title="Click to view & print official Picking List (DPL)"
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
                            {d.quantity.toLocaleString()} units
                          </td>
                          <td className="p-4 space-y-1">
                            <div className="flex items-center gap-1 text-[10px] font-medium text-slate-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Packaging Condition OK
                            </div>
                            <div className="flex items-center gap-1 text-[10px] font-medium text-slate-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              FIFO Batch Confirmed
                            </div>
                            <div className="flex items-center gap-1 text-[10px] font-medium text-slate-700">
                              <span className={`h-1.5 w-1.5 rounded-full ${d.forkliftChecklistSigned ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
                              Forklift Pre-checked
                            </div>
                          </td>
                          <td className="p-4 text-[10px] text-slate-600 space-y-0.5">
                            {d.drNumber ? (
                              <div className="font-mono font-semibold text-slate-800">DR: {d.drNumber}</div>
                            ) : (
                              <div className="text-slate-400 italic">No DR yet</div>
                            )}
                            {d.salesInvoice ? (
                              <div className="font-mono text-slate-500">SI: {d.salesInvoice}</div>
                            ) : (
                              <div className="text-slate-400 italic">No Sales Invoice</div>
                            )}
                            {d.wayBill ? (
                              <div className="font-mono text-slate-400 font-medium">Waybill: {d.wayBill}</div>
                            ) : (
                              <div className="text-slate-400 italic">No Waybill assigned</div>
                            )}
                          </td>
                          <td className="p-4">
                            {d.status === 'PREPARING' ? (
                              <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2 py-1 rounded font-bold text-[9px]">
                                PREPARING
                              </span>
                            ) : d.status === 'LOADED' ? (
                              <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded font-bold text-[9px] animate-pulse">
                                LOADED (AWAITING GATE)
                              </span>
                            ) : (
                              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded font-bold text-[9px]">
                                DISPATCHED & RELEASED
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
                                    alert('Cannot load pallets! Standard operating procedure requires completing the Daily Forklift Checklist first.');
                                    e.target.value = '';
                                    return;
                                  }
                                  onUpdateDeliveryStatus(d.id, 'LOADED');
                                } else if (val === 'GATE_PASS') {
                                  if (!effectiveCanEdit) return;
                                  setShowGatePassModal(d.id);
                                } else if (val === 'EDIT') {
                                  if (!effectiveCanEdit) return;
                                  setEditingDelivery({ ...d });
                                } else if (val === 'DELETE') {
                                  if (!isSuperAdmin) return;
                                  setConfirmAction({
                                    title: 'Delete Delivery Shipment',
                                    message: `Are you sure you want to delete delivery shipment ${d.gatePassNumber} (${d.modelName})?`,
                                    confirmLabel: 'YES, DELETE SHIPMENT',
                                    confirmVariant: 'danger',
                                    onConfirm: () => onDeleteDelivery?.(d.id)
                                  });
                                }
                                e.target.value = '';
                              }}
                              className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                              id={`action-select-del-${d.id}`}
                            >
                              <option value="" disabled>Actions...</option>
                              <option value="PRINT_DR">📄 Print Delivery Receipt & Gate Pass</option>
                              <option value="PRINT_DPL">📋 Print Picking List (DPL)</option>
                              {effectiveCanEdit && (
                                <>
                                  {d.status === 'PREPARING' && (
                                    <option value="LOAD">📦 Load Pallets</option>
                                  )}
                                  {d.status === 'LOADED' && (
                                    <option value="GATE_PASS">📄 Gate Release Pass</option>
                                  )}
                                  <option value="EDIT">📝 Edit Shipment</option>
                                </>
                              )}
                              {isSuperAdmin && (
                                <option value="DELETE">🗑️ Delete Shipment</option>
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
                                              Gate Pass: <span className="font-mono text-indigo-600">{d.gatePassNumber}</span>
                                            </span>
                                            <span className="text-xs text-slate-400 font-mono">({d.id})</span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                              d.status === 'RELEASED' 
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                                : d.status === 'LOADED' 
                                                ? 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'
                                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                                            }`}>
                                              {d.status === 'RELEASED' ? 'DISPATCHED & RELEASED' : d.status === 'LOADED' ? 'LOADED (AWAITING GATE PASS)' : 'PREPARING / STAGING'}
                                            </span>
                                          </div>
                                          <p className="text-xs text-slate-500 mt-0.5">
                                            Model: <strong className="text-slate-800">{d.modelName}</strong> &bull; Part Code: <strong className="font-mono text-slate-800">{d.partCode}</strong> &bull; PO: <strong className="font-mono text-slate-700">{d.poNumber}</strong>
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="bg-slate-100 text-slate-700 font-mono font-semibold px-2.5 py-1 rounded-lg border border-slate-200">
                                          Date: {d.date}
                                        </span>
                                        <span className="bg-blue-50 text-blue-800 font-bold px-2.5 py-1 rounded-lg border border-blue-200 font-mono">
                                          Quantity: {d.quantity.toLocaleString()} UNITS
                                        </span>
                                        {matchedStock && (
                                          <span className="bg-emerald-50 text-emerald-800 font-bold px-2.5 py-1 rounded-lg border border-emerald-200 font-mono">
                                            Warehouse Stock: {matchedStock.quantity.toLocaleString()} {matchedStock.unit}
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
                                          <span>Shipment & Order Specifications</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Client PO #:</span>
                                            <span className="font-mono font-bold text-slate-800">{d.poNumber}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Picking List (DPL):</span>
                                            <span className="font-mono font-semibold text-indigo-700">{d.pickingListNumber}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Part Code:</span>
                                            <span className="font-mono font-bold text-slate-800">{d.partCode}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Product Model:</span>
                                            <span className="font-semibold text-slate-800">{d.modelName}</span>
                                          </div>
                                          <div className="col-span-2 pt-1 border-t border-slate-100 flex justify-between items-center text-slate-500 text-[11px]">
                                            <span>Category / Group:</span>
                                            <span className="font-semibold text-slate-700">{registryItem?.category || 'Finished Goods Outbound'}</span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Col 2: Official Release Documents */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <FileSignature className="h-4 w-4 text-emerald-600" />
                                          <span>Official Regulatory Documents</span>
                                        </div>
                                        <div className="space-y-2 text-xs">
                                          <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-150">
                                            <div>
                                              <span className="text-slate-400 text-[10px] block">Delivery Receipt (DR):</span>
                                              <span className="font-mono font-bold text-slate-800 text-[11px]">{d.drNumber || 'Pending Issuance'}</span>
                                            </div>
                                            <div>
                                              <span className="text-slate-400 text-[10px] block">Sales Invoice (SI):</span>
                                              <span className="font-mono font-bold text-slate-800 text-[11px]">{d.salesInvoice || 'Pending Billing'}</span>
                                            </div>
                                            <div className="col-span-2 pt-1 border-t border-slate-200">
                                              <span className="text-slate-400 text-[10px] block">Transportation Waybill:</span>
                                              <span className="font-mono font-semibold text-slate-700 text-[11px]">{d.wayBill || 'Pending Carrier Assignment'}</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Col 3: Safety & SOP Verification Checks + Quick Action */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <ShieldCheck className="h-4 w-4 text-purple-500" />
                                          <span>SOP Quality & Forklift Audit</span>
                                        </div>

                                        <div className="space-y-2 text-xs">
                                          <div className="space-y-1 bg-slate-50 p-2 rounded-lg border border-slate-150 text-[11px]">
                                            <div className="flex items-center justify-between">
                                              <span className="text-slate-600">Packaging Integrity:</span>
                                              <span className="text-emerald-700 font-bold flex items-center gap-1">
                                                <Check className="h-3 w-3" /> VERIFIED OK
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span className="text-slate-600">FIFO Batch Integrity:</span>
                                              <span className="text-emerald-700 font-bold flex items-center gap-1">
                                                <Check className="h-3 w-3" /> VERIFIED OK
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span className="text-slate-600">Daily Forklift Inspection:</span>
                                              <span className={`font-bold flex items-center gap-1 ${d.forkliftChecklistSigned ? 'text-emerald-700' : 'text-amber-600'}`}>
                                                {d.forkliftChecklistSigned ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                                {d.forkliftChecklistSigned ? 'COMPLETED' : 'PENDING CHECK'}
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
                                              <Printer className="h-3 w-3" /> DR / Gate Pass
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setPrintInitialView('PICKING_LIST');
                                                setSelectedPickingDocDelivery(d);
                                              }}
                                              className="flex-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-slate-200 flex items-center justify-center gap-1 shadow-2xs"
                                            >
                                              <ClipboardList className="h-3 w-3" /> Picking List
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
              <h3 className="font-bold text-sm text-slate-800">Forklift Pre-Operation Checklists</h3>
              <p className="text-xs text-slate-500 mt-1">
                Conduct daily forklift checks using the Forklift Daily Monitoring Checklist prior to operations to prevent safety hazards.
              </p>
            </div>

            {effectiveCanEdit ? (
              <button 
                onClick={() => setShowForkliftForm(!showForkliftForm)}
                className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                id="btn-log-forklift"
              >
                <Plus className="h-4 w-4" /> Create Daily Pre-Check
              </button>
            ) : (
              <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded font-bold uppercase">
                🔒 View-Only Mode
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
                <h4 className="font-bold text-xs text-slate-800">Operator Pre-Inspection Logging Form</h4>
                <button type="button" onClick={() => setShowForkliftForm(false)} className="text-[10px] text-slate-400">Cancel</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Operator Name *</label>
                  <input 
                    type="text" required placeholder="e.g. Juan Forklift Op" value={operator}
                    onChange={e => setOperator(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Forklift Fleet ID *</label>
                  <select 
                    value={forkliftId}
                    onChange={e => setForkliftId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs"
                  >
                    <option value="FL-TOYOTA-02">FL-TOYOTA-02 (Heavy Pallet Lift)</option>
                    <option value="FL-KOMATSU-01">FL-KOMATSU-01 (Light Pallet Lift)</option>
                    <option value="FL-NISSAN-05">FL-NISSAN-05 (WIP Reach Truck)</option>
                  </select>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-3">
                <h5 className="text-[11px] font-bold text-slate-700">Pre-Operational Safety Inspection Checks</h5>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={brakesOk} onChange={e => setBrakesOk(e.target.checked)} className="h-4 w-4" />
                    Foot & Parking Brakes Operational
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={lightsOk} onChange={e => setLightsOk(e.target.checked)} className="h-4 w-4" />
                    Headlights & Backup Alarms Ok
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={hydraulicOk} onChange={e => setHydraulicOk(e.target.checked)} className="h-4 w-4" />
                    Hydraulic Mast Lift/Tilt Ok
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={steeringOk} onChange={e => setSteeringOk(e.target.checked)} className="h-4 w-4" />
                    Power Steering Smooth
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={tiresOk} onChange={e => setTiresOk(e.target.checked)} className="h-4 w-4" />
                    Tires Pressure/Condition Ok
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={batteryFluidOk} onChange={e => setBatteryFluidOk(e.target.checked)} className="h-4 w-4" />
                    Battery Terminals / Fluid Ok
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Inspection Remarks</label>
                <input 
                  type="text" placeholder="e.g. Fluids top up complete. All green." value={remarks}
                  onChange={e => setRemarks(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div className="flex justify-end gap-1 border-t border-slate-100 pt-3">
                <button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold px-3 py-1.5 rounded">
                  Authorize & Sign Safety Checklist
                </button>
              </div>
            </form>
          )}

          {/* Forklift checks logs list */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="forklift-grid-panel">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Daily Safety Inspection History Logs</span>
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
                      title="Click to view 6-point mechanical safety checklist"
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
                          <span className="text-slate-400 font-mono text-[11px]">&bull; Date: {check.date}</span>
                        </div>
                        <div className="text-slate-600 font-medium flex items-center gap-1 pl-6">
                          Signed Operator: <span className="font-semibold text-slate-800">{check.operator}</span>
                        </div>
                        {check.remarks && (
                          <div className="text-[11px] text-slate-400 italic pl-6">Remarks: {check.remarks}</div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-3">
                        {checkPassed ? (
                          <span className="bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-1 rounded flex items-center gap-1 border border-emerald-100">
                            <CheckCircle className="h-4 w-4" /> SAFE TO OPERATE
                          </span>
                        ) : (
                          <span className="bg-rose-50 text-rose-700 font-semibold px-2.5 py-1 rounded flex items-center gap-1 border border-rose-100">
                            <ShieldAlert className="h-4 w-4" /> HAZARD ACTIVE (HOLD)
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
                              <span className="text-[10px] text-slate-500 block">Brakes & Parking:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.brakesOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.brakesOk ? 'PASS' : 'FAIL'}
                              </span>
                            </div>
                            <div className={`p-2.5 rounded-lg border ${check.lightsOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">Lights & Horn:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.lightsOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.lightsOk ? 'PASS' : 'FAIL'}
                              </span>
                            </div>
                            <div className={`p-2.5 rounded-lg border ${check.hydraulicOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">Hydraulic Forks:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.hydraulicOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.hydraulicOk ? 'PASS' : 'FAIL'}
                              </span>
                            </div>
                            <div className={`p-2.5 rounded-lg border ${check.steeringOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">Steering & Turn:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.steeringOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.steeringOk ? 'PASS' : 'FAIL'}
                              </span>
                            </div>
                            <div className={`p-2.5 rounded-lg border ${check.tiresOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">Tires & Wheels:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.tiresOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.tiresOk ? 'PASS' : 'FAIL'}
                              </span>
                            </div>
                            <div className={`p-2.5 rounded-lg border ${check.batteryFluidOk ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                              <span className="text-[10px] text-slate-500 block">Battery & Fluids:</span>
                              <span className="font-bold flex items-center gap-1 mt-0.5">
                                {check.batteryFluidOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {check.batteryFluidOk ? 'PASS' : 'FAIL'}
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
                  <FileSignature className="h-4 w-4 text-slate-600" /> Prepare Material Gate Pass Release
                </h4>
                <p className="text-[11px] text-slate-500 mt-1">Linking required outbound documents is required prior to physical release.</p>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Official Delivery Receipt (DR) # *</label>
                  <input 
                    type="text" required placeholder="DR-XXXXX" value={drNumber}
                    onChange={e => setDrNumber(formatDrNumber(e.target.value))}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Official Sales Invoice (SI) # *</label>
                  <input 
                    type="text" required placeholder="SI-XXXX" value={salesInvoice}
                    onChange={e => setSalesInvoice(formatSiNumber(e.target.value))}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Transportation Way Bill # *</label>
                  <input 
                    type="text" required placeholder="WB-LBC-XXXXX" value={wayBill}
                    onChange={e => setWayBill(formatWaybillNumber(e.target.value))}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-2 border-t border-slate-100">
                <button 
                  onClick={() => setShowGatePassModal(null)}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleGatePassReleaseSubmit(showGatePassModal)}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 cursor-pointer"
                >
                  Sign & Authorize Release
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
                    <Edit className="h-4 w-4 text-indigo-600" /> Edit Registered Delivery ({editingDelivery.gatePassNumber})
                  </h4>
                  <p className="text-[11px] text-slate-500">Super Admin Record Overwrite</p>
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
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Gate Pass #</label>
                  <input 
                    type="text" 
                    value={editingDelivery.gatePassNumber}
                    onChange={e => setEditingDelivery({ ...editingDelivery, gatePassNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Date</label>
                  <input 
                    type="date" 
                    value={editingDelivery.date}
                    onChange={e => setEditingDelivery({ ...editingDelivery, date: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">DPL / Picking List Ref</label>
                  <input 
                    type="text" 
                    value={editingDelivery.pickingListNumber}
                    onChange={e => setEditingDelivery({ ...editingDelivery, pickingListNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">PO Number</label>
                  <input 
                    type="text" 
                    value={editingDelivery.poNumber}
                    onChange={e => setEditingDelivery({ ...editingDelivery, poNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Part Code</label>
                  <input 
                    type="text" 
                    value={editingDelivery.partCode}
                    onChange={e => setEditingDelivery({ ...editingDelivery, partCode: e.target.value.toUpperCase() })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Model Name</label>
                  <input 
                    type="text" 
                    value={editingDelivery.modelName}
                    onChange={e => setEditingDelivery({ ...editingDelivery, modelName: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Quantity</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editingDelivery.quantity || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const sanitized = e.target.value.replace(/\D/g, '');
                      setEditingDelivery({ ...editingDelivery, quantity: sanitized ? parseInt(sanitized, 10) : 0 });
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Status</label>
                  <select 
                    value={editingDelivery.status}
                    onChange={e => setEditingDelivery({ ...editingDelivery, status: e.target.value as any })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-bold"
                  >
                    <option value="PREPARING">PREPARING</option>
                    <option value="LOADED">LOADED</option>
                    <option value="RELEASED">RELEASED</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">DR Number</label>
                  <input 
                    type="text" 
                    value={editingDelivery.drNumber || ''}
                    onChange={e => setEditingDelivery({ ...editingDelivery, drNumber: formatDrNumber(e.target.value) })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Sales Invoice</label>
                  <input 
                    type="text" 
                    value={editingDelivery.salesInvoice || ''}
                    onChange={e => setEditingDelivery({ ...editingDelivery, salesInvoice: formatSiNumber(e.target.value) })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Waybill Number</label>
                  <input 
                    type="text" 
                    value={editingDelivery.wayBill || ''}
                    onChange={e => setEditingDelivery({ ...editingDelivery, wayBill: formatWaybillNumber(e.target.value) })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  onClick={() => setEditingDelivery(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    onEditDelivery?.(editingDelivery);
                    setEditingDelivery(null);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold"
                >
                  Save Delivery Changes
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
