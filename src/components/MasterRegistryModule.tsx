/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Tag, 
  Users, 
  Truck, 
  Barcode,
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  RefreshCw,
  FolderPlus,
  SlidersHorizontal,
  Info,
  AlertTriangle,
  AlertOctagon,
  X,
  Warehouse,
  Boxes,
  Factory,
  FileText
} from 'lucide-react';
import { MasterRegistryItem, RegistryType, PresetSourceType } from '../types';
import { ConfirmActionConfig } from './ConfirmModal';
import { motion, AnimatePresence } from 'motion/react';

export const DEFAULT_MASTER_REGISTRIES: MasterRegistryItem[] = [];

interface MasterRegistryModuleProps {
  registries: MasterRegistryItem[];
  onRegisterItem: (item: MasterRegistryItem) => void;
  onUpdateItem: (item: MasterRegistryItem) => void;
  onDeleteItem: (id: string) => void;
  onResetDefaults?: () => void;
  isSuperAdmin?: boolean;
  defaultType?: RegistryType | 'ALL';
}

export default function MasterRegistryModule({
  registries,
  onRegisterItem,
  onUpdateItem,
  onDeleteItem,
  onResetDefaults,
  isSuperAdmin = true,
  defaultType = 'ALL'
}: MasterRegistryModuleProps) {
  const [selectedType, setSelectedType] = useState<RegistryType | 'ALL'>(defaultType);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setSelectedType(defaultType);
  }, [defaultType]);
  
  // Modal State
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterRegistryItem | null>(null);

  // Yes / No Confirmation Modal State
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);

  // Form state
  const [formType, setFormType] = useState<RegistryType>('SUPPLIER');
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStatus, setFormStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  // Preset specific fields (referring to Log New Material Arrival)
  const [formPresetSource, setFormPresetSource] = useState<PresetSourceType>('INTERNAL');

  const [formCategory, setFormCategory] = useState('');
  const [formVendorSupplier, setFormVendorSupplier] = useState('');
  const [formUnit, setFormUnit] = useState('PCS');
  const [formLocation, setFormLocation] = useState('');

  // Open modal for new registration
  const handleOpenNew = (type?: RegistryType) => {
    setEditingItem(null);
    let targetType = type || (selectedType !== 'ALL' && selectedType !== 'CATEGORY' && selectedType !== 'BARCODE_PRESET' ? selectedType : 'SUPPLIER');
    if (targetType === 'CATEGORY' || targetType === 'BARCODE_PRESET') targetType = 'SUPPLIER';
    setFormType(targetType);
    setFormCode('');
    setFormName('');
    setFormDesc('');
    setFormStatus('ACTIVE');
    setFormPresetSource('INTERNAL');
    setFormCategory('');
    setFormVendorSupplier('');
    setFormUnit('PCS');
    setFormLocation('');
    setShowRegisterModal(true);
  };

  // Open modal for editing
  const handleOpenEdit = (item: MasterRegistryItem) => {
    setEditingItem(item);
    setFormType(item.type);
    setFormCode(item.code || '');
    setFormName(item.name);
    setFormDesc(item.description || '');
    setFormStatus(item.status);
    setFormPresetSource(item.presetSource || 'INTERNAL');
    setFormCategory(item.category || '');
    setFormVendorSupplier(item.vendorSupplier || '');
    setFormUnit(item.unit || 'PCS');
    setFormLocation(item.location || '');
    setShowRegisterModal(true);
  };

  // Submit registration
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert('Please provide a name for this registration entry.');
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];

    if (editingItem) {
      const updated: MasterRegistryItem = {
        ...editingItem,
        type: formType,
        code: formCode.trim() ? formCode.trim().toUpperCase() : undefined,
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        status: formStatus,
        presetSource: formType === 'BARCODE_PRESET' ? formPresetSource : undefined,
        category: formType === 'BARCODE_PRESET' ? (formCategory.trim() || undefined) : undefined,
        vendorSupplier: formType === 'BARCODE_PRESET' ? (formVendorSupplier.trim() || undefined) : undefined,
        unit: formType === 'BARCODE_PRESET' ? formUnit : undefined,
        location: formType === 'BARCODE_PRESET' ? (formLocation.trim() || undefined) : undefined
      };
      onUpdateItem(updated);
    } else {
      const typePrefix = formType === 'BARCODE_PRESET' ? 'BCP' : formType.slice(0,3);
      const newItem: MasterRegistryItem = {
        id: `REG-${typePrefix}-${Date.now().toString().slice(-4)}`,
        type: formType,
        code: formCode.trim() ? formCode.trim().toUpperCase() : `REG-${Date.now().toString().slice(-3)}`,
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        status: formStatus,
        dateRegistered: todayStr,
        presetSource: formType === 'BARCODE_PRESET' ? formPresetSource : undefined,
        category: formType === 'BARCODE_PRESET' ? (formCategory.trim() || undefined) : undefined,
        vendorSupplier: formType === 'BARCODE_PRESET' ? (formVendorSupplier.trim() || undefined) : undefined,
        unit: formType === 'BARCODE_PRESET' ? formUnit : undefined,
        location: formType === 'BARCODE_PRESET' ? (formLocation.trim() || undefined) : undefined
      };
      onRegisterItem(newItem);
    }

    setShowRegisterModal(false);
  };

  // Filtered registries
  const filtered = registries.filter(item => {
    const query = (searchQuery || '').trim().toLowerCase();
    const matchesType = selectedType === 'ALL' || item.type === selectedType;
    const matchesSearch = 
      (item.name || '').toLowerCase().includes(query) ||
      (item.code && item.code.toLowerCase().includes(query)) ||
      (item.description && item.description.toLowerCase().includes(query));
    return matchesType && matchesSearch;
  });

  const getBadgeColor = (type: RegistryType) => {
    switch (type) {
      case 'LOCATION': return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'CATEGORY': return 'bg-indigo-100 text-indigo-800 border-indigo-300';
      case 'CUSTOMER': return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'SUPPLIER': return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'BARCODE_PRESET': return 'bg-cyan-100 text-cyan-800 border-cyan-300';
    }
  };

  const getTypeIcon = (type: RegistryType) => {
    switch (type) {
      case 'LOCATION': return <Building2 className="h-4 w-4" />;
      case 'CATEGORY': return <Tag className="h-4 w-4" />;
      case 'CUSTOMER': return <Users className="h-4 w-4" />;
      case 'SUPPLIER': return <Truck className="h-4 w-4" />;
      case 'BARCODE_PRESET': return <Barcode className="h-4 w-4" />;
    }
  };

  const countByType = {
    LOCATION: registries.filter(r => r.type === 'LOCATION').length,
    CATEGORY: registries.filter(r => r.type === 'CATEGORY').length,
    CUSTOMER: registries.filter(r => r.type === 'CUSTOMER').length,
    SUPPLIER: registries.filter(r => r.type === 'SUPPLIER').length,
    BARCODE_PRESET: registries.filter(r => r.type === 'BARCODE_PRESET').length,
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-xl shadow-lg border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-600 rounded-lg text-white">
              <FolderPlus className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight">Master Data Register</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Register and manage master lists for Customers and Suppliers across the WMS.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onResetDefaults && (
            <button
              type="button"
              onClick={() => {
                setConfirmAction({
                  title: 'Clear All Master Registries',
                  message: 'Are you sure you want to clear all customers, suppliers, and locations to zero?',
                  confirmLabel: 'YES, RESET ALL TO ZERO',
                  confirmVariant: 'danger',
                  onConfirm: () => onResetDefaults()
                });
              }}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-rose-300 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title="Clear all master registry entries"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Clear All to 0
            </button>
          )}

          <button
            onClick={() => handleOpenNew()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition cursor-pointer"
          >
            <Plus className="h-4 w-4" /> Register New Option
          </button>
        </div>
      </div>

      {/* Location Registration Relocation Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 flex items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2.5">
          <Warehouse className="h-5 w-5 text-amber-600 shrink-0" />
          <div>
            <strong className="font-bold block">Storage Location Registration Moved to Space Utilization</strong>
            <span className="text-amber-800 text-[11px]">Storage locations, rack rows, and bins are now registered directly inside the Space Utilization module for integrated capacity management.</span>
          </div>
        </div>
      </div>

      {/* Quick Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div 
          onClick={() => setSelectedType(selectedType === 'CUSTOMER' ? 'ALL' : 'CUSTOMER')}
          className={`p-3 rounded-xl border transition cursor-pointer ${
            selectedType === 'CUSTOMER' 
              ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-400/20 shadow-sm' 
              : 'bg-white border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/30'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg shrink-0">
                <Users className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-700 block truncate">Customer</span>
                <span className="text-[10px] text-slate-500 block truncate">Accounts</span>
              </div>
            </div>
            <span className="text-base font-mono font-bold text-slate-800 shrink-0">{countByType.CUSTOMER}</span>
          </div>
        </div>

        <div 
          onClick={() => setSelectedType(selectedType === 'SUPPLIER' ? 'ALL' : 'SUPPLIER')}
          className={`p-3 rounded-xl border transition cursor-pointer ${
            selectedType === 'SUPPLIER' 
              ? 'bg-purple-50 border-purple-400 ring-2 ring-purple-400/20 shadow-sm' 
              : 'bg-white border-slate-200 hover:border-purple-300 hover:bg-purple-50/30'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1.5 bg-purple-100 text-purple-700 rounded-lg shrink-0">
                <Truck className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-700 block truncate">Supplier / Vendor</span>
                <span className="text-[10px] text-slate-500 block truncate">Vendors</span>
              </div>
            </div>
            <span className="text-base font-mono font-bold text-slate-800 shrink-0">{countByType.SUPPLIER}</span>
          </div>
        </div>

        <div 
          onClick={() => setSelectedType(selectedType === 'LOCATION' ? 'ALL' : 'LOCATION')}
          className={`p-3 rounded-xl border transition cursor-pointer ${
            selectedType === 'LOCATION' 
              ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/20 shadow-sm' 
              : 'bg-white border-slate-200 hover:border-amber-300 hover:bg-amber-50/30'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1.5 bg-amber-100 text-amber-700 rounded-lg shrink-0">
                <Building2 className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-700 block truncate">Location</span>
                <span className="text-[10px] text-slate-500 block truncate">Zones & Bins</span>
              </div>
            </div>
            <span className="text-base font-mono font-bold text-slate-800 shrink-0">{countByType.LOCATION}</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input 
            type="text"
            placeholder="Search registered items..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <label htmlFor="filter-registry-type-select" className="text-xs font-bold text-slate-500 flex items-center gap-1.5 shrink-0">
            <SlidersHorizontal className="h-3.5 w-3.5 text-indigo-600" /> Filter:
          </label>
          <select
            id="filter-registry-type-select"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as 'ALL' | RegistryType)}
            className="w-full md:w-60 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none cursor-pointer shadow-sm transition"
          >
            <option value="ALL">ALL REGISTERED ({registries.length})</option>
            <option value="CUSTOMER">CUSTOMERS ({countByType.CUSTOMER})</option>
            <option value="SUPPLIER">SUPPLIERS ({countByType.SUPPLIER})</option>
            <option value="LOCATION">LOCATIONS ({countByType.LOCATION})</option>
          </select>
        </div>
      </div>

      {/* Main Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900 text-slate-300 font-mono text-[11px] uppercase tracking-wider border-b border-slate-800">
                <th className="p-3">Type</th>
                <th className="p-3">Code</th>
                <th className="p-3">Name / Title</th>
                <th className="p-3">Description</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3">Date Registered</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400 text-xs">
                    No registered items found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition">
                    <td className="p-3">
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${getBadgeColor(item.type)}`}>
                          {getTypeIcon(item.type)}
                          {item.type}
                        </span>
                        {item.type === 'BARCODE_PRESET' && item.presetSource && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold border ${
                            item.presetSource === 'WIP/BOM/FG(Internal)' || item.presetSource === 'INTERNAL'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                          }`}>
                            {item.presetSource === 'WIP/BOM/FG(Internal)' || item.presetSource === 'INTERNAL' ? <Building2 className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
                            {item.presetSource === 'WIP/BOM/FG(Internal)' || item.presetSource === 'INTERNAL' ? 'INTERNAL' : 'EXTERNAL'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-700">
                      {item.code || '-'}
                    </td>
                    <td className="p-3 font-semibold text-slate-900">
                      <div>{item.name}</div>
                      {item.type === 'BARCODE_PRESET' && (item.category || item.vendorSupplier) && (
                        <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                          {item.vendorSupplier && <span className="font-medium text-slate-700">{item.vendorSupplier}</span>}
                          {item.vendorSupplier && item.category && <span className="mx-1">•</span>}
                          {item.category && <span>{item.category}</span>}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-slate-500 max-w-xs" title={item.description}>
                      <div className="truncate font-medium text-slate-700">{item.description || '-'}</div>
                      {item.type === 'BARCODE_PRESET' && (item.unit || item.location) && (
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          {item.unit && <span>UOM: <strong className="text-slate-600">{item.unit}</strong></span>}
                          {item.unit && item.location && <span className="mx-1.5">|</span>}
                          {item.location && <span>Loc: <strong className="text-slate-600">{item.location}</strong></span>}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {item.status === 'ACTIVE' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 className="h-3 w-3" /> ACTIVE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          <XCircle className="h-3 w-3" /> INACTIVE
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-slate-500">
                      {item.dateRegistered}
                    </td>
                    <td className="p-3 text-right">
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'EDIT') handleOpenEdit(item);
                          else if (val === 'DELETE') {
                            setConfirmAction({
                              title: 'Delete Master Registry Item',
                              message: `Are you sure you want to delete registered item "${item.name}" (${item.code || item.id})?`,
                              confirmLabel: 'YES, DELETE',
                              onConfirm: () => onDeleteItem(item.id)
                            });
                          }
                          e.target.value = '';
                        }}
                        className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                        id={`action-select-reg-${item.id}`}
                      >
                        <option value="" disabled>Actions...</option>
                        <option value="EDIT">📝 Edit Registration</option>
                        <option value="DELETE">🗑️ Delete Option</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Registration Modal */}
      <AnimatePresence>
        {showRegisterModal && (
          <motion.div
            key="register-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              key="register-modal-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className={`bg-white rounded-xl shadow-xl border border-slate-200 w-full ${formType === 'BARCODE_PRESET' ? 'max-w-lg' : 'max-w-md'} overflow-hidden`}
            >
              <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plus className="h-4 w-4 text-indigo-400" />
                  <h3 className="font-bold text-sm">
                    {editingItem ? 'Edit Master Registration' : 'Register New Option'}
                  </h3>
                </div>
                <button 
                  onClick={() => setShowRegisterModal(false)}
                  className="text-slate-400 hover:text-white text-lg leading-none"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Registration Target *</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['CUSTOMER', 'SUPPLIER', 'LOCATION'] as RegistryType[]).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setFormType(t)}
                        className={`px-2.5 py-2 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                          formType === t 
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' 
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {getTypeIcon(t)}
                        {t === 'CUSTOMER' ? 'Customer' : t === 'SUPPLIER' ? 'Supplier' : 'Location'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {formType === 'CUSTOMER'
                      ? 'Customer Code'
                      : formType === 'SUPPLIER'
                      ? 'Supplier Code'
                      : formType === 'LOCATION'
                      ? 'Location Code'
                      : 'Code / Short Identifier'}
                  </label>
                  <input 
                    type="text"
                    placeholder={
                      formType === 'CUSTOMER' ? 'e.g. CUST-NIS'
                      : formType === 'SUPPLIER' ? 'e.g. SUP-APX'
                      : 'e.g. LOC-ZA'
                    }
                    value={formCode}
                    onChange={e => setFormCode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {formType === 'CUSTOMER' ? 'Customer Name *'
                      : formType === 'SUPPLIER' ? 'Supplier / Vendor Name *'
                      : formType === 'LOCATION' ? 'Location / Zone Name *'
                      : 'Name / Title *'}
                  </label>
                  <input 
                    type="text"
                    required
                    placeholder={
                      formType === 'CUSTOMER' ? 'e.g. NISSAN Motors'
                      : formType === 'SUPPLIER' ? 'e.g. Apex Chemical Corp'
                      : 'e.g. Zone A - Raw Materials'
                    }
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {formType === 'CUSTOMER' ? 'Customer Notes / Address'
                      : formType === 'SUPPLIER' ? 'Supplier Description / Notes'
                      : 'Description / Notes'}
                  </label>
                  <textarea 
                    rows={2}
                    placeholder={
                      formType === 'CUSTOMER' ? 'e.g. Automotive molded plastic assemblies & packaging'
                      : formType === 'SUPPLIER' ? 'e.g. Primary resin & chemical compound supplier'
                      : 'Optional details, contacts, or specs...'
                    }
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                  <select 
                    value={formStatus}
                    onChange={e => setFormStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="ACTIVE">ACTIVE (Visible in selection lists)</option>
                    <option value="INACTIVE">INACTIVE (Hidden from selection lists)</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowRegisterModal(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition shadow-sm"
                  >
                    {editingItem ? 'Save Changes' : 'Register Item'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Yes / No Action Confirmation Modal */}
      <AnimatePresence>
        {confirmAction && (
          <motion.div
            key="confirm-action-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              key="confirm-action-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
            >
              <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                  <h3 className="font-bold text-sm">{confirmAction.title}</h3>
                </div>
                <button 
                  onClick={() => setConfirmAction(null)} 
                  className="text-slate-400 hover:text-white transition"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <p className="text-xs text-slate-600 font-medium leading-relaxed">
                  {confirmAction.message}
                </p>

                <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-center gap-2 text-amber-800 text-[11px] font-semibold">
                  <AlertOctagon className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>Please select YES to confirm or NO to cancel this action.</span>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setConfirmAction(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <XCircle className="h-4 w-4 text-slate-500" />
                    NO
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      confirmAction.onConfirm();
                      setConfirmAction(null);
                    }}
                    className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <CheckCircle2 className="h-4 w-4 text-white" />
                    {confirmAction.confirmLabel || 'YES'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
