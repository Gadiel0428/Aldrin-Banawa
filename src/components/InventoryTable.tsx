/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Search, 
  AlertTriangle, 
  CheckCircle, 
  ArrowUpDown, 
  RefreshCw,
  Building,
  Layers,
  MapPin
} from 'lucide-react';
import { InventoryItem, Warehouse } from '../types/inventory';
import { fetchInventory, fetchWarehouses } from '../database/inventory';
import { subscribeToInventory } from '../database/realtime';

interface InventoryTableProps {
  onSelectProduct?: (productId: string) => void;
}

export const InventoryTable: React.FC<InventoryTableProps> = ({ onSelectProduct }) => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [invData, whData] = await Promise.all([
        fetchInventory(selectedWarehouse === 'ALL' ? undefined : selectedWarehouse),
        fetchWarehouses(),
      ]);
      setItems(invData);
      setWarehouses(whData);
    } catch (e) {
      console.error('Failed to load inventory table:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    const unsubscribe = subscribeToInventory(
      selectedWarehouse === 'ALL' ? undefined : selectedWarehouse,
      () => {
        loadData();
      }
    );

    return unsubscribe;
  }, [selectedWarehouse]);

  const filteredItems = items.filter((item) => {
    const term = search.toLowerCase();
    const matchesSearch =
      !term ||
      item.product?.name?.toLowerCase().includes(term) ||
      item.product?.sku?.toLowerCase().includes(term) ||
      item.location?.toLowerCase().includes(term) ||
      item.lot_number?.toLowerCase().includes(term);

    return matchesSearch;
  });

  return (
    <div className="space-y-4">
      {/* Top filter bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by SKU, product name, lot number or bin location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        <div className="flex items-center gap-2">
          <Building className="w-4 h-4 text-slate-400" />
          <select
            value={selectedWarehouse}
            onChange={(e) => setSelectedWarehouse(e.target.value)}
            className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
          >
            <option value="ALL">All Warehouses / Bays</option>
            {warehouses.map((wh) => (
              <option key={wh.id} value={wh.id}>
                {wh.name}
              </option>
            ))}
          </select>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            title="Refresh Inventory"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Item & SKU</th>
                <th className="py-3 px-4">Warehouse</th>
                <th className="py-3 px-4">Location / Lot</th>
                <th className="py-3 px-4 text-right">Available Qty</th>
                <th className="py-3 px-4 text-center">Stock Status</th>
                <th className="py-3 px-4 text-right">Last Movement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    {loading ? 'Fetching current stock balances...' : 'No inventory records found.'}
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const qty = Number(item.quantity) || 0;
                  const min = Number(item.product?.min_stock) || 0;
                  const isLow = qty <= min && qty > 0;
                  const isOut = qty <= 0;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => onSelectProduct && onSelectProduct(item.product_id)}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {item.product?.name || 'Item'}
                        </div>
                        <div className="text-slate-400 font-mono text-[11px]">
                          {item.product?.sku || item.product_id}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {item.warehouse?.name || 'Main Warehouse'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          <span>{item.location || 'Default Bin'}</span>
                        </div>
                        {item.lot_number && (
                          <div className="text-[10px] text-slate-400 font-mono">Lot: {item.lot_number}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-sm">
                        <span className={isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900 dark:text-slate-100'}>
                          {qty.toLocaleString()} {item.product?.unit || 'PCS'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isOut ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">
                            <AlertTriangle className="w-3 h-3" /> Out of Stock
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            <AlertTriangle className="w-3 h-3" /> Low Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                            <CheckCircle className="w-3 h-3" /> Optimal
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-400 text-[11px]">
                        {new Date(item.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
