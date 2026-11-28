/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Search, 
  Plus, 
  Barcode, 
  RefreshCw
} from 'lucide-react';
import { Product } from '../types/product';
import { fetchProducts, upsertProduct } from '../database/products';
import { subscribeToProducts } from '../database/realtime';
import { getAllSelectUomOptions, MISSING_UNIT_LABEL, normalizeUnitCode } from '../../shared/units';
import { useI18n } from '../i18n';

export interface ProductListProps {
  categories?: string[];
}

export const ProductList: React.FC<ProductListProps> = ({ categories = [] }) => {
  const { t } = useI18n();
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
  const [category, setCategory] = useState(categories[0] || '');
  const [minStock, setMinStock] = useState(10);

  useEffect(() => {
    if (!category && categories.length > 0) {
      setCategory(categories[0]);
    }
  }, [categories, category]);

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
    const cleanUnit = normalizeUnitCode(unit);
    if (!sku || !name || !cleanUnit) return;

    setSaving(true);
    try {
      await upsertProduct({
        sku,
        name,
        barcode: barcode || undefined,
        unit: cleanUnit,
        category,
        cost: 0,
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
            placeholder={t('products.searchPlaceholder')}
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
            {t('products.addMasterSku')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((prod) => {
          const resolvedUnit = normalizeUnitCode(prod.unit);
          return (
          <div
            key={prod.id || prod.sku}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between hover:border-indigo-300 dark:hover:border-indigo-800 transition-all"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="font-bold text-sm text-slate-900 dark:text-slate-100">{prod.name}</div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  {prod.category || t('common.na')}
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
                <span className="text-slate-400 text-[10px] uppercase">{t('products.labelUnit')}</span>
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  {resolvedUnit || (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 border border-rose-500/30 text-[10px] font-mono">
                      {MISSING_UNIT_LABEL}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase">{t('products.minSafetyStock')}</span>
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  {prod.min_stock} {resolvedUnit || MISSING_UNIT_LABEL}
                </div>
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {/* Add SKU Modal */}
      {typeof document !== 'undefined' && isModalOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 my-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('products.modalTitle')}</h3>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">{t('products.labelSku')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('products.skuPlaceholder')}
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">{t('products.labelMaterialName')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('products.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">{t('products.labelBarcode')}</label>
                  <input
                    type="text"
                    placeholder={t('products.barcodePlaceholder')}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">{t('products.labelUnit')}</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="">{t('products.selectUnitOption')}</option>
                    {getAllSelectUomOptions(unit).map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">{t('products.labelCategory')}</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="">{t('masterRegistry.selectUnifiedCategoryOpt')}</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">{t('products.minSafetyStock')}</label>
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
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer"
                >
                  {t('products.cancelBtn')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                >
                  {saving ? t('products.savingBtn') : t('products.saveBtn')}
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
