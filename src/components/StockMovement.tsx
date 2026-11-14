/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  Repeat, 
  Search, 
  Filter, 
  Plus, 
  Laptop, 
  Layers, 
  Clock, 
  User, 
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { fetchStockMovements } from '../database/movements';
import { subscribeToStockMovements } from '../database/realtime';
import { syncManager } from '../sync/syncManager';
import { StockMovement, StockMovementType } from '../types/movement';
import { MaterialStockItem } from '../types';
import { generateAuthoritativeId } from '../lib/idGenerator';

interface StockMovementProps {
  stocks: MaterialStockItem[];
  currentUser?: { id: string; name: string; username: string };
  onStockUpdated?: () => void;
}

export const StockMovementView: React.FC<StockMovementProps> = ({
  stocks,
  currentUser,
  onStockUpdated,
}) => {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form State for Manual Atomic Adjustment
  const [selectedStockId, setSelectedStockId] = useState('');
  const [movementType, setMovementType] = useState<StockMovementType>('ADJUSTMENT_IN');
  const [quantity, setQuantity] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [refNumber, setRefNumber] = useState('');

  const loadMovements = async () => {
    setLoading(true);
    try {
      const data = await fetchStockMovements(100);
      setMovements(data);
    } catch (e) {
      console.error('Failed to load movements:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMovements();

    // Subscribe to incoming movements via Realtime
    const unsubscribe = subscribeToStockMovements((newMovement) => {
      setMovements((prev) => [newMovement, ...prev.filter((m) => m.id !== newMovement.id)]);
      if (onStockUpdated) onStockUpdated();
    });

    return unsubscribe;
  }, []);

  const handleCreateMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStockId || quantity <= 0) {
      setErrorMsg('Please select a material and enter a valid quantity.');
      return;
    }

    const targetStock = stocks.find((s) => s.id === selectedStockId);
    if (!targetStock) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await syncManager.executeMovement({
        productId: targetStock.id,
        warehouseId: 'wh-main',
        type: movementType,
        quantity: Number(quantity),
        referenceNumber: refNumber || generateAuthoritativeId('ADJ'),
        notes: notes || `Manual ${movementType} recorded by ${currentUser?.name || 'Operator'}`,
        userId: currentUser?.id,
        userName: currentUser?.name || currentUser?.username || 'Operator',
        lotNumber: targetStock.lotNumber,
        location: targetStock.location,
      });

      if (result.success) {
        setIsModalOpen(false);
        setSelectedStockId('');
        setQuantity(1);
        setNotes('');
        setRefNumber('');
        loadMovements();
        if (onStockUpdated) onStockUpdated();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to execute stock movement.');
    } finally {
      setSubmitting(false);
    }
  };

  const getMovementBadge = (type: string) => {
    switch (type) {
      case 'PURCHASE':
      case 'ADJUSTMENT_IN':
      case 'SALE_RETURN':
      case 'TRANSFER_IN':
        return {
          bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400',
          icon: <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" />,
          label: type.replace('_', ' '),
        };
      case 'SALE':
      case 'ADJUSTMENT_OUT':
      case 'PURCHASE_RETURN':
      case 'TRANSFER_OUT':
        return {
          bg: 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400',
          icon: <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" />,
          label: type.replace('_', ' '),
        };
      case 'RECYCLING':
        return {
          bg: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400',
          icon: <Repeat className="w-3.5 h-3.5 text-amber-500" />,
          label: 'RECYCLING',
        };
      default:
        return {
          bg: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
          icon: <Layers className="w-3.5 h-3.5" />,
          label: type,
        };
    }
  };

  const filteredMovements = movements.filter((m) => {
    const matchesSearch =
      !search ||
      m.product_name?.toLowerCase().includes(search.toLowerCase()) ||
      m.product_sku?.toLowerCase().includes(search.toLowerCase()) ||
      m.reference_number?.toLowerCase().includes(search.toLowerCase()) ||
      m.notes?.toLowerCase().includes(search.toLowerCase()) ||
      m.device_id?.toLowerCase().includes(search.toLowerCase());

    const matchesType = typeFilter === 'ALL' || m.type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Layers className="w-6 h-6 text-indigo-500" />
            Atomic Stock Movement Audit Ledger
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Immutable transaction history synchronized across all computers & devices. Never directly overwrites inventory quantities.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadMovements}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Record Movement
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search SKU, item name, reference PO, device ID, or notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="ALL">All Movement Types</option>
            <option value="PURCHASE">PURCHASE (Receiving)</option>
            <option value="SALE">SALE (Issuance)</option>
            <option value="ADJUSTMENT_IN">ADJUSTMENT IN (Surplus)</option>
            <option value="ADJUSTMENT_OUT">ADJUSTMENT OUT (Scrap / Deficit)</option>
            <option value="TRANSFER_IN">TRANSFER IN</option>
            <option value="TRANSFER_OUT">TRANSFER OUT</option>
            <option value="SALE_RETURN">SALE RETURN</option>
            <option value="RECYCLING">PACKAGING RECYCLING</option>
          </select>
        </div>
      </div>

      {/* Movements Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Item & Part Code</th>
                <th className="py-3 px-4 text-right">Delta Qty</th>
                <th className="py-3 px-4 text-right">Inventory Balance</th>
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Device & User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    {loading ? 'Loading atomic stock movements...' : 'No stock movements recorded yet.'}
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m) => {
                  const badge = getMovementBadge(m.type);
                  const isPositive = Number(m.quantity) > 0;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-mono">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {new Date(m.created_at).toLocaleString()}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-bold ${badge.bg}`}>
                          {badge.icon}
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {m.product_name || m.notes || 'Warehouse Material'}
                        </div>
                        <div className="text-slate-400 font-mono text-[11px]">
                          {m.product_sku || m.product_id}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-sm">
                        <span className={isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          {isPositive ? `+${m.quantity}` : m.quantity} {m.unit || 'PCS'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-300">
                        {m.previous_quantity !== undefined && m.new_quantity !== undefined ? (
                          <div className="text-[11px]">
                            <span className="text-slate-400">{m.previous_quantity}</span>
                            <span className="mx-1 text-slate-300 dark:text-slate-600">→</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100">{m.new_quantity}</span>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                          {m.reference_number || '—'}
                        </span>
                        {m.notes && <div className="text-[11px] text-slate-500 truncate max-w-xs">{m.notes}</div>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-medium">
                          <User className="w-3 h-3 text-slate-400" />
                          {m.user_name || 'Operator'}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                          <Laptop className="w-3 h-3" />
                          {m.device_id || 'UNKNOWN-DEV'}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Movement Modal */}
      {typeof document !== 'undefined' && isModalOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto max-h-[calc(100vh-2rem)] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-500" />
                <h3 className="font-bold text-base text-slate-900 dark:text-white">Record Atomic Stock Movement</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateMovement} className="p-5 space-y-4">
              {errorMsg && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 text-rose-600 border border-rose-500/20 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Target Material / SKU
                </label>
                <select
                  value={selectedStockId}
                  onChange={(e) => setSelectedStockId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                  required
                >
                  <option value="">-- Select Material --</option>
                  {stocks.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.partCode} - {s.description} (Stock: {s.quantity} {s.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Movement Type
                  </label>
                  <select
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as StockMovementType)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="ADJUSTMENT_IN">ADJUSTMENT IN (+)</option>
                    <option value="ADJUSTMENT_OUT">ADJUSTMENT OUT (-)</option>
                    <option value="PURCHASE">PURCHASE (+)</option>
                    <option value="SALE">SALE (-)</option>
                    <option value="TRANSFER_IN">TRANSFER IN (+)</option>
                    <option value="TRANSFER_OUT">TRANSFER OUT (-)</option>
                    <option value="SALE_RETURN">SALE RETURN (+)</option>
                    <option value="RECYCLING">RECYCLING (+/-)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    value={quantity}
                    onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Reference # (e.g. PO, Delivery Pass, Cycle Count ID)
                </label>
                <input
                  type="text"
                  placeholder="Optional reference identifier"
                  value={refNumber}
                  onChange={(e) => setRefNumber(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Audit Notes / Reason
                </label>
                <textarea
                  rows={2}
                  placeholder="State reason for stock adjustment or transfer..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Executing Atomic RPC...' : 'Commit Movement'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
