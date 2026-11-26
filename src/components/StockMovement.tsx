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
import { MISSING_UNIT_LABEL, normalizeUnitCode } from '../../shared/units';
import { useI18n } from '../i18n';

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
  const { t } = useI18n();
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
      setErrorMsg(t('movements.errSelectMaterialQty'));
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
      setErrorMsg(err.message || t('movements.errFailedMovement'));
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
            {t('movements.title')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('movements.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadMovements}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('movements.refreshBtn')}
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {t('movements.recordMovementBtn')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder={t('movements.searchPlaceholder')}
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
            <option value="ALL">{t('movements.allTypes')}</option>
            <option value="PURCHASE">{t('movements.typePurchase')}</option>
            <option value="SALE">{t('movements.typeSale')}</option>
            <option value="ADJUSTMENT_IN">{t('movements.typeAdjustmentIn')}</option>
            <option value="ADJUSTMENT_OUT">{t('movements.typeAdjustmentOut')}</option>
            <option value="TRANSFER_IN">{t('movements.typeTransferIn')}</option>
            <option value="TRANSFER_OUT">{t('movements.typeTransferOut')}</option>
            <option value="SALE_RETURN">{t('movements.typeSaleReturn')}</option>
            <option value="RECYCLING">{t('movements.typeRecycling')}</option>
          </select>
        </div>
      </div>

      {/* Movements Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">{t('movements.colTimestamp')}</th>
                <th className="py-3 px-4">{t('movements.colType')}</th>
                <th className="py-3 px-4">{t('movements.colPartCode')}</th>
                <th className="py-3 px-4 text-right">{t('movements.colDelta')}</th>
                <th className="py-3 px-4 text-right">{t('movements.colBalance')}</th>
                <th className="py-3 px-4">{t('movements.colReference')}</th>
                <th className="py-3 px-4">{t('movements.colUser')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    {loading ? t('movements.loading') : t('movements.empty')}
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m) => {
                  const badge = getMovementBadge(m.type);
                  const isPositive = Number(m.quantity) > 0;
                  const resolvedUnit = normalizeUnitCode(m.unit);
                  const unitDisplay = resolvedUnit || MISSING_UNIT_LABEL;
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
                          {isPositive ? `+${m.quantity}` : m.quantity} {resolvedUnit ? resolvedUnit : (
                            <span className="ml-1 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 border border-rose-500/30 text-[10px]">
                              {MISSING_UNIT_LABEL}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-300">
                        {m.previous_quantity !== undefined && m.new_quantity !== undefined ? (
                          <div className="text-[11px]">
                            <span className="text-slate-400">{m.previous_quantity} {unitDisplay}</span>
                            <span className="mx-1 text-slate-300 dark:text-slate-600">→</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100">{m.new_quantity} {unitDisplay}</span>
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
                <h3 className="font-bold text-base text-slate-900 dark:text-white">{t('movements.modalTitle')}</h3>
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
                  {t('movements.labelTargetMaterial')}
                </label>
                <select
                  value={selectedStockId}
                  onChange={(e) => setSelectedStockId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                  required
                >
                  <option value="">{t('movements.selectMaterialOption')}</option>
                  {stocks.map((s) => {
                    const u = normalizeUnitCode(s.unit) || MISSING_UNIT_LABEL;
                    return (
                      <option key={s.id} value={s.id}>
                        {s.partCode} - {s.description} (Stock: {s.quantity} {u})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t('movements.labelMovementType')}
                  </label>
                  <select
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as StockMovementType)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="ADJUSTMENT_IN">{t('movements.typeAdjustmentIn')}</option>
                    <option value="ADJUSTMENT_OUT">{t('movements.typeAdjustmentOut')}</option>
                    <option value="PURCHASE">{t('movements.typePurchase')}</option>
                    <option value="SALE">{t('movements.typeSale')}</option>
                    <option value="TRANSFER_IN">{t('movements.typeTransferIn')}</option>
                    <option value="TRANSFER_OUT">{t('movements.typeTransferOut')}</option>
                    <option value="SALE_RETURN">{t('movements.typeSaleReturn')}</option>
                    <option value="RECYCLING">{t('movements.typeRecycling')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t('movements.labelQuantity')}
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
                  {t('movements.labelReference')}
                </label>
                <input
                  type="text"
                  placeholder={t('movements.referencePlaceholder')}
                  value={refNumber}
                  onChange={(e) => setRefNumber(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t('movements.labelNotes')}
                </label>
                <textarea
                  rows={2}
                  placeholder={t('movements.notesPlaceholder')}
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
                  {t('movements.cancelBtn')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? t('movements.executingRpc') : t('movements.commitBtn')}
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
