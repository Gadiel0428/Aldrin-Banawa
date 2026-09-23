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
import { RecyclingRecord } from '../types';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';
import { generateAuthoritativeId } from '../lib/idGenerator';

interface RecyclingModuleProps {
  recycling: RecyclingRecord[];
  onAddRecycling: (record: RecyclingRecord) => void;
  onDeleteRecycling: (id: string) => void;
  isSuperAdmin?: boolean;
  canEdit?: boolean;
}

export default function RecyclingModule({
  recycling,
  onAddRecycling,
  onDeleteRecycling,
  isSuperAdmin = false,
  canEdit = false
}: RecyclingModuleProps) {
  const effectiveCanEdit = canEdit || isSuperAdmin;
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);

  // Form states
  const [logSheetNumber, setLogSheetNumber] = useState('');
  const [itemType, setItemType] = useState<'Carton Box' | 'Pallet' | 'Partition'>('Carton Box');
  const [quantity, setQuantity] = useState(0);
  const [condition, setCondition] = useState<'Reusable' | 'Non-Reusable' | 'Contaminated' | 'Damaged'>('Reusable');
  const [reuseCycleCount, setReuseCycleCount] = useState(1);
  const [disposition, setDisposition] = useState<'Re-used' | 'For Re-sorting' | 'Scrap Disposal'>('Re-used');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!logSheetNumber || quantity <= 0) {
      alert('Please fill out all fields correctly.');
      return;
    }

    const newRecord: RecyclingRecord = {
      id: generateAuthoritativeId('RCY'),
      date: new Date().toISOString().split('T')[0],
      itemType,
      quantity,
      condition,
      reuseCycleCount,
      disposition,
      logSheetNumber
    };

    onAddRecycling(newRecord);

    // Reset
    setLogSheetNumber('');
    setQuantity(0);
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

  // Simple stats
  const totalReusable = recycling.filter(r => r.disposition === 'Re-used').reduce((sum, r) => sum + r.quantity, 0);
  const totalScrapped = recycling.filter(r => r.disposition === 'Scrap Disposal').reduce((sum, r) => sum + r.quantity, 0);
  const totalSorting = recycling.filter(r => r.disposition === 'For Re-sorting').reduce((sum, r) => sum + r.quantity, 0);

  return (
    <div className="space-y-6" id="recycling-module">
      {/* Official Header Banner matching Dashboard Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-5 rounded-2xl shadow-md border border-slate-800 flex flex-col md:flex-row md:justify-between md:items-center gap-4 text-white">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold font-mono px-2 py-0.5 rounded border border-indigo-500/30">
              SUSTAINABILITY & PACKAGING
            </span>
            <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block" /> RECYCLE
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Packaging Materials Recycling Management</h2>
          <p className="text-xs text-slate-300 mt-1">
            Monitor the condition, classification, reuse cycle count, and final disposition of reusable pallets and carton boxes.
          </p>
        </div>
      </div>

      {/* Overview stats panel */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4" id="recycling-stats-row">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Total In-Use / Reused</span>
            <div className="text-xl font-mono font-bold text-slate-800">{totalReusable} pcs</div>
            <span className="text-[9px] text-slate-400">Active internal circulation</span>
          </div>
          <span className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><CheckCircle className="h-4 w-4" /></span>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Scrap / Condemned</span>
            <div className="text-xl font-mono font-bold text-rose-600">{totalScrapped} pcs</div>
            <span className="text-[9px] text-slate-400">Sent for waste disposal</span>
          </div>
          <span className="p-2 bg-rose-50 text-rose-600 rounded-lg"><Trash2 className="h-4 w-4" /></span>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Pending Re-sorting</span>
            <div className="text-xl font-mono font-bold text-amber-600">{totalSorting} pcs</div>
            <span className="text-[9px] text-slate-400">Requires washing or grading</span>
          </div>
          <span className="p-2 bg-amber-50 text-amber-600 rounded-lg"><RefreshCcw className="h-4 w-4" /></span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl shadow-sm text-white flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Max Rotation Limit</span>
            <div className="text-base font-bold text-white">5 Cycles Limit</div>
            <span className="text-[9px] text-slate-300">Strict Mandate</span>
          </div>
          <span className="p-2 bg-slate-800 text-slate-400 rounded-lg"><BarChart3 className="h-4 w-4" /></span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="relative w-full sm:max-w-xs">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            <Search className="h-4 w-4" />
          </span>
          <input 
            type="text" 
            placeholder="Search recycling log sheet..." 
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
            <Plus className="h-4 w-4" /> Log Sorting Activity Sheet
          </button>
        ) : (
          <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded font-bold uppercase">
            🔒 View-Only Mode
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
              <Sparkles className="h-4 w-4 text-slate-500" /> Log sorting & reuse status
            </h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-[10px] text-slate-400">Cancel</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Sorting Sheet Number *</label>
              <input 
                type="text"
                required
                placeholder="e.g. RML-2026-105"
                value={logSheetNumber}
                onChange={e => setLogSheetNumber(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Item Type *</label>
              <select 
                value={itemType}
                onChange={e => setItemType(e.target.value as any)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="Carton Box">Carton Box</option>
                <option value="Pallet">Pallet</option>
                <option value="Partition">Partition</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Quantity of Pieces *</label>
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
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Physical Condition *</label>
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
                <option value="Reusable">Reusable / Compliant</option>
                <option value="Non-Reusable">One-Time Use (Non-Reusable)</option>
                <option value="Contaminated">Contaminated</option>
                <option value="Damaged">Damaged / Worn Out</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Reuse Cycle Count (Max 5) *</label>
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
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Final Disposition *</label>
              <select 
                value={disposition}
                onChange={e => setDisposition(e.target.value as any)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs focus:outline-none"
              >
                <option value="Re-used">Re-used in Production Floor</option>
                <option value="For Re-sorting">For Re-sorting / Washing</option>
                <option value="Scrap Disposal">Scrap Disposal (Condemned)</option>
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
              Discard
            </button>
            <button 
              type="submit" 
              className="px-3.5 py-1.5 bg-slate-900 text-white rounded text-xs font-semibold"
            >
              Log To Sorting Sheets
            </button>
          </div>
        </form>
      )}

      {/* Recycling logs table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="recycling-grid-panel">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Recyclable Materials Sorting Log Sheet</span>
          <span className="text-xs font-mono text-slate-500 font-semibold">{filteredLogs.length} logs in database</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-500 font-medium border-b border-slate-200">
                <th className="p-4 font-semibold">Log ID</th>
                <th className="p-4 font-semibold">Date Logged</th>
                <th className="p-4 font-semibold">Sheet Ref</th>
                <th className="p-4 font-semibold">Item Classification</th>
                <th className="p-4 font-semibold text-right">Quantity</th>
                <th className="p-4 font-semibold">Reported Condition</th>
                <th className="p-4 font-semibold">Cycle Count</th>
                <th className="p-4 font-semibold">SOP Dispo Status</th>
                <th className="p-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map(log => {
                const isLimitReached = log.reuseCycleCount >= 5;
                const isScrapped = log.disposition === 'Scrap Disposal';
                return (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 font-mono font-semibold text-slate-600">{log.id}</td>
                    <td className="p-4 text-slate-600 font-mono">{log.date}</td>
                    <td className="p-4 font-mono font-bold text-slate-800">{log.logSheetNumber}</td>
                    <td className="p-4 font-semibold text-slate-700">{log.itemType}</td>
                    <td className="p-4 text-right font-mono font-bold text-slate-800">{log.quantity} pcs</td>
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
                                title: 'Delete Recycling Log',
                                message: `Are you sure you want to delete recycling log ${log.id}?`,
                                confirmLabel: 'YES, DELETE LOG',
                                confirmVariant: 'danger',
                                onConfirm: () => onDeleteRecycling(log.id)
                              });
                            }
                            e.target.value = '';
                          }}
                          className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                          id={`action-select-recyc-${log.id}`}
                        >
                          <option value="" disabled>Actions...</option>
                          <option value="DELETE">🗑️ Delete Log</option>
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
