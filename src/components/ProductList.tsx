/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Search, 
  Plus, 
  Barcode, 
  Tag, 
  DollarSign, 
  Boxes,
  RefreshCw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { Product } from '../types/product';
import { fetchProducts, upsertProduct } from '../database/products';
import { subscribeToProducts } from '../database/realtime';

export const ProductList: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form State
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [category, setCategory] = useState('RAW');
  const [cost, setCost] = useState(0);
  const [minStock, setMinStock] = useState(10);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const data = await fetchProducts();
      setProducts(data);
    } catch (e) {
      console.error('Failed to load products:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
    const unsub = subscribeToProducts(() => loadProducts());
    return unsub;
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sku || !name) return;

    setSaving(true);
    try {
      await upsertProduct({
        sku,
        name,
        barcode: barcode || undefined,
        unit,
        category,
        cost: Number(cost),
        min_stock: Number(minStock),
        is_active: true,
      });
      setIsModalOpen(false);
      setSku('');
      setName('');
      setBarcode('');
      loadProducts();
    } catch (err) {
      console.error('Failed to save product:', err);
    } finally {
      setSaving(false);
    }
  };

  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode && p.barcode.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by SKU, part name, or barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadProducts}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Master SKU
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((prod) => (
          <div
            key={prod.id || prod.sku}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between hover:border-indigo-300 dark:hover:border-indigo-800 transition-all"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="font-bold text-sm text-slate-900 dark:text-slate-100">{prod.name}</div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  {prod.category || 'RAW'}
                </span>
              </div>
              <div className="font-mono text-xs text-indigo-600 dark:text-indigo-400 font-semibold mt-1">
                SKU: {prod.sku}
              </div>
              {prod.barcode && (
                <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono mt-1">
                  <Barcode className="w-3.5 h-3.5" /> {prod.barcode}
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-400 text-[10px] uppercase">Unit</span>
                <div className="font-semibold text-slate-700 dark:text-slate-300">{prod.unit}</div>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase">Min Safety Stock</span>
                <div className="font-semibold text-slate-700 dark:text-slate-300">{prod.min_stock} {prod.unit}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add SKU Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-5">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-4">Register Master Product SKU</h3>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Part SKU / Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. RAW-RESIN-001"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Material Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Polypropylene Granules"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Barcode</label>
                  <input
                    type="text"
                    placeholder="Barcode string"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Unit</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="PCS">PCS</option>
                    <option value="KG">KG</option>
                    <option value="SET">SET</option>
                    <option value="BOX">BOX</option>
                    <option value="UNITS">UNITS</option>
                    <option value="LITERS">LITERS</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="RAW">RAW</option>
                    <option value="PACKAGING">PACKAGING</option>
                    <option value="CONSUMABLE">CONSUMABLE</option>
                    <option value="WIP">WIP</option>
                    <option value="FG">FG</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Min Safety Stock</label>
                  <input
                    type="number"
                    value={minStock}
                    onChange={(e) => setMinStock(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {saving ? 'Saving...' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
