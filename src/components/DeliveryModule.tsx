/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
  Printer
} from 'lucide-react';
import { DeliveryRecord, ForkliftChecklist, MaterialStockItem, MasterRegistryItem } from '../types';
import PrintablePickingListModal, { DocViewMode } from './PrintablePickingListModal';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';

interface DeliveryModuleProps {
  deliveries: DeliveryRecord[];
  forkliftChecks: ForkliftChecklist[];
  onAddDelivery: (record: DeliveryRecord) => void;
  onAddForkliftCheck: (check: ForkliftChecklist) => void;
  onUpdateDeliveryStatus: (id: string, status: DeliveryRecord['status'], extDoc?: { drNumber?: string, salesInvoice?: string, wayBill?: string }) => void;
  onEditDelivery?: (item: DeliveryRecord) => void;
  onDeleteDelivery?: (id: string) => void;
  isSuperAdmin?: boolean;
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
  stocks = [],
  registries = [],
  currentUser = ''
}: DeliveryModuleProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingDelivery, setEditingDelivery] = useState<DeliveryRecord | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'shipments' | 'forklift'>('shipments');
  const [selectedPickingDocDelivery, setSelectedPickingDocDelivery] = useState<DeliveryRecord | null>(null);
  const [printInitialView, setPrintInitialView] = useState<DocViewMode>('OFFICIAL_DOC');
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);
  
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
      id: `DEL-${Date.now().toString().slice(-4)}`,
      date: todayStr,
      pickingListNumber,
      poNumber,
      modelName,
      partCode,
      quantity,
      packagingConditionOk: true,
      fifoVerified: true,
      forkliftChecklistSigned: isForkliftPrechecked,
      gatePassNumber: `MGP-2026-${Date.now().toString().slice(-4)}`,
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
      id: `FLK-${Date.now().toString().slice(-3)}`,
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
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Delivery & Gate Pass Operations</h2>
          <p className="text-xs text-slate-500 mt-1">
            Build Picking Lists, execute forklift pre-inspections, verify packaging, and authorize Gate Passes.
          </p>
        </div>

        {/* Tab selector */}
        <div className="flex bg-slate-100 p-1 rounded-lg self-start">
          <button 
            onClick={() => setActiveSubTab('shipments')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
              activeSubTab === 'shipments' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Truck className="h-3.5 w-3.5" /> Outbound Shipments
          </button>
          <button 
            onClick={() => setActiveSubTab('forklift')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
              activeSubTab === 'forklift' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Settings className="h-3.5 w-3.5" /> Forklift Pre-Inspection
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
                {isSuperAdmin ? (
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
                    const isFullyLoaded = d.status === 'LOADED' || d.status === 'RELEASED';
                    return (
                      <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 font-mono font-bold text-slate-800">{d.gatePassNumber}</td>
                        <td className="p-4 text-slate-600 font-mono">{d.date}</td>
                        <td className="p-4">
                          <button
                            type="button"
                            onClick={() => setSelectedPickingDocDelivery(d)}
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
                            <div className="font-mono font-semibold">DR: {d.drNumber}</div>
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
                        <td className="p-4">
                          {isSuperAdmin ? (
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
                                  if (!isForkliftPrechecked) {
                                    alert('Cannot load pallets! Standard operating procedure requires completing the Daily Forklift Checklist first.');
                                    e.target.value = '';
                                    return;
                                  }
                                  onUpdateDeliveryStatus(d.id, 'LOADED');
                                } else if (val === 'GATE_PASS') {
                                  setShowGatePassModal(d.id);
                                } else if (val === 'EDIT') {
                                  setEditingDelivery({ ...d });
                                } else if (val === 'DELETE') {
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
                              {d.status === 'PREPARING' && (
                                <option value="LOAD">📦 Load Pallets</option>
                              )}
                              {d.status === 'LOADED' && (
                                <option value="GATE_PASS">📄 Gate Release Pass</option>
                              )}
                              <option value="EDIT">📝 Edit Shipment</option>
                              <option value="DELETE">🗑️ Delete Shipment</option>
                            </select>
                          ) : (
                            <span className="text-slate-400 italic text-[10px] font-semibold">Super Admin Action Pending</span>
                          )}
                        </td>
                      </tr>
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

            {isSuperAdmin ? (
              <button 
                onClick={() => setShowForkliftForm(!showForkliftForm)}
                className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5"
                id="btn-log-forklift"
              >
                <Plus className="h-4 w-4" /> Create Daily Pre-Check
              </button>
            ) : (
              <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded font-bold uppercase">
                🔒 View-Only Mode (Inspection restricted to Super Admin)
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
                const checkPassed = check.brakesOk && check.lightsOk && check.hydraulicOk && check.steeringOk && check.tiresOk && check.batteryFluidOk;
                return (
                  <div key={check.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-800">{check.forkliftId}</span>
                        <span className="text-slate-400 font-mono">Date: {check.date}</span>
                      </div>
                      <div className="text-slate-600 font-medium flex items-center gap-1">
                        Signed Operator: <span className="font-semibold text-slate-800">{check.operator}</span>
                      </div>
                      {check.remarks && (
                        <div className="text-[11px] text-slate-400 italic">Remarks: {check.remarks}</div>
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
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Gate Pass Release Modal Dialog */}
      {showGatePassModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 max-w-sm w-full space-y-4">
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
                  onChange={e => setDrNumber(e.target.value)}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Official Sales Invoice (SI) # *</label>
                <input 
                  type="text" required placeholder="SI-XXXX" value={salesInvoice}
                  onChange={e => setSalesInvoice(e.target.value)}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Transportation Way Bill # *</label>
                <input 
                  type="text" required placeholder="WB-LBC-XXXXX" value={wayBill}
                  onChange={e => setWayBill(e.target.value)}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs font-semibold pt-2 border-t border-slate-100">
              <button 
                onClick={() => setShowGatePassModal(null)}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded hover:bg-slate-50"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleGatePassReleaseSubmit(showGatePassModal)}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700"
              >
                Sign & Authorize Release
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Delivery Modal (Super Admin) */}
      {editingDelivery && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-lg w-full space-y-4 max-h-[90vh] overflow-y-auto">
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
                  onChange={e => setEditingDelivery({ ...editingDelivery, drNumber: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Sales Invoice</label>
                <input 
                  type="text" 
                  value={editingDelivery.salesInvoice || ''}
                  onChange={e => setEditingDelivery({ ...editingDelivery, salesInvoice: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Waybill Number</label>
                <input 
                  type="text" 
                  value={editingDelivery.wayBill || ''}
                  onChange={e => setEditingDelivery({ ...editingDelivery, wayBill: e.target.value })}
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
          </div>
        </div>
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
