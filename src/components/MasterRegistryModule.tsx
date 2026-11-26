/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Building2, 
  Tag, 
  Users, 
  Truck, 
  Barcode,
  Plus, 
  Search, 
  CheckCircle2, 
  XCircle, 
  RefreshCw,
  FolderPlus,
  SlidersHorizontal,
  AlertTriangle,
  AlertOctagon,
  X,
  Warehouse
} from 'lucide-react';
import { MasterRegistryItem, RegistryType, PresetSourceType } from '../types';
import { ConfirmActionConfig } from './ConfirmModal';
import { motion, AnimatePresence } from 'motion/react';
import { generateAuthoritativeId } from '../lib/idGenerator';
import { DEFAULT_RECEIVING_CATEGORIES } from './ReceivingModule';
import { showPrintToast } from '../utils/printDocument';
import {
  MISSING_UNIT_LABEL,
  getAllSelectUomOptions,
  normalizeUnitCode,
} from '../../shared/units';
import { useI18n } from '../i18n';

export const STARTER_BARCODE_PRESETS: MasterRegistryItem[] = [
  {
    id: 'REG-BCP-RESIN-001',
    type: 'BARCODE_PRESET',
    code: 'SAMPLE-RESIN-001',
    name: 'PC/ABS CYCOLOY RESIN PELLETS',
    description: 'High-impact flame retardant engineering plastic resin pellets for injection molding',
    category: 'RESIN/RAW MATERIALS',
    unit: 'KG',
    vendorSupplier: 'SABIC INNOVATIVE PLASTICS',
    location: 'RAW-ZONE-A1',
    presetSource: 'EXTERNAL',
    status: 'ACTIVE',
    dateRegistered: '2026-10-02'
  },
  {
    id: 'REG-BCP-IND-001',
    type: 'BARCODE_PRESET',
    code: 'SAMPLE-IND-001',
    name: 'THERMAL CONDUCTIVE SILICONE GREASE',
    description: 'High-efficiency thermal interface compound for heatsink and PCB assembly',
    category: 'INDIRECT BOM',
    unit: 'TUBES',
    vendorSupplier: 'SHIN-ETSU CHEMICAL CO.',
    location: 'CHEM-SHELF-B2',
    presetSource: 'EXTERNAL',
    status: 'ACTIVE',
    dateRegistered: '2026-10-02'
  },
  {
    id: 'REG-BCP-DIR-001',
    type: 'BARCODE_PRESET',
    code: 'SAMPLE-DIR-001',
    name: 'M3X8MM STAINLESS STEEL MACHINE SCREW',
    description: 'Phillips pan-head SUS304 precision fastener for chassis sub-assembly',
    category: 'DIRECT BOM',
    unit: 'PCS',
    vendorSupplier: 'FASTENAL INDUSTRIAL SUPPLIES',
    location: 'FAST-BIN-C3',
    presetSource: 'EXTERNAL',
    status: 'ACTIVE',
    dateRegistered: '2026-10-02'
  },
  {
    id: 'REG-BCP-CON-001',
    type: 'BARCODE_PRESET',
    code: 'SAMPLE-CON-001',
    name: 'ESD ANTISTATIC CLEANROOM WIPES',
    description: '9x9 inch lint-free polyester microfiber wipes for optical and SMT cleaning',
    category: 'CONSUMABLES',
    unit: 'PACKS',
    vendorSupplier: 'CLEANROOM PRO DYNAMICS',
    location: 'CONS-RACK-D1',
    presetSource: 'EXTERNAL',
    status: 'ACTIVE',
    dateRegistered: '2026-10-02'
  },
  {
    id: 'REG-BCP-PKG-001',
    type: 'BARCODE_PRESET',
    code: 'SAMPLE-PKG-001',
    name: 'CORRUGATED SHIPPER CARTON 400X300X250',
    description: 'Double-wall heavy duty B/C flute export shipping carton with preprinted handling symbols',
    category: 'PACKAGING MATERIALS',
    unit: 'PCS',
    vendorSupplier: 'INTERNATIONAL PACKAGING CORP',
    location: 'PKG-MEZZ-E4',
    presetSource: 'EXTERNAL',
    status: 'ACTIVE',
    dateRegistered: '2026-10-02'
  },
  {
    id: 'REG-BCP-WIP-001',
    type: 'BARCODE_PRESET',
    code: 'SAMPLE-WIP-001',
    name: 'MOLDED FRONT HOUSING SUB-ASSEMBLY',
    description: 'Precision injection molded bezel frame awaiting ultrasonic brass insert staking',
    category: 'WIP (WORK IN PROGRESS)',
    unit: 'PCS',
    vendorSupplier: 'PLASTICS INJECTION LINE 2',
    location: 'WIP-STAGE-F1',
    presetSource: 'INTERNAL',
    status: 'ACTIVE',
    dateRegistered: '2026-10-02'
  },
  {
    id: 'REG-BCP-FG-001',
    type: 'BARCODE_PRESET',
    code: 'SAMPLE-FG-001',
    name: 'SMART IOT SENSOR NODE CONTROLLER',
    description: 'Fully assembled, calibrated and QC approved wireless industrial sensor unit',
    category: 'FG (FINISHED GOOD)',
    unit: 'PCS',
    vendorSupplier: 'FINAL ASSEMBLY DEPT 1',
    location: 'FG-AISLE-G2',
    presetSource: 'INTERNAL',
    status: 'ACTIVE',
    dateRegistered: '2026-10-02'
  },
  {
    id: 'REG-BCP-OFF-001',
    type: 'BARCODE_PRESET',
    code: 'SAMPLE-OFF-001',
    name: 'DIRECT THERMAL BARCODE LABELS 4X6',
    description: 'Standard perforated warehouse shipping label rolls for Zebra industrial printers',
    category: 'OFFICE SUPPLIES',
    unit: 'ROLLS',
    vendorSupplier: 'OFFICE SUPPLY DEPOT PH',
    location: 'ADMIN-CAB-H1',
    presetSource: 'EXTERNAL',
    status: 'ACTIVE',
    dateRegistered: '2026-10-02'
  }
];

export const DEFAULT_MASTER_REGISTRIES: MasterRegistryItem[] = [...STARTER_BARCODE_PRESETS];

interface MasterRegistryModuleProps {
  registries: MasterRegistryItem[];
  onRegisterItem: (item: MasterRegistryItem) => void;
  onUpdateItem: (item: MasterRegistryItem) => void;
  onDeleteItem: (id: string) => void;
  onResetDefaults?: () => void;
  isSuperAdmin?: boolean;
  canEdit?: boolean;
  defaultType?: RegistryType | 'ALL';
  categories?: string[];
}

export default function MasterRegistryModule({
  registries,
  onRegisterItem,
  onUpdateItem,
  onDeleteItem,
  onResetDefaults,
  isSuperAdmin = false,
  canEdit: _canEdit = false,
  defaultType = 'ALL',
  categories
}: MasterRegistryModuleProps) {
  const { t } = useI18n();
  const [selectedType, setSelectedType] = useState<RegistryType | 'ALL'>(defaultType);
  const [searchQuery, setSearchQuery] = useState('');

  const unifiedCategories = React.useMemo(() => {
    const list = new Set<string>();
    if (categories && Array.isArray(categories)) {
      categories.forEach(c => { if (c) list.add(c.trim().toUpperCase()); });
    }
    registries.filter(r => r.type === 'CATEGORY').forEach(r => {
      if (r.name) list.add(r.name.trim().toUpperCase());
      else if (r.code) list.add(r.code.trim().toUpperCase());
    });
    DEFAULT_RECEIVING_CATEGORIES.forEach(c => list.add(c));
    return Array.from(list);
  }, [categories, registries]);

  useEffect(() => {
    setSelectedType(defaultType);
  }, [defaultType]);
  
  // Modal State
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterRegistryItem | null>(null);

  // Yes / No Confirmation Modal State
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);

  // Form state
  const [formType, setFormType] = useState<RegistryType>('BARCODE_PRESET');
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStatus, setFormStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  // Preset specific fields (referring to Log New Material Arrival)
  const [formPresetSource, setFormPresetSource] = useState<PresetSourceType>('EXTERNAL');

  const [formCategory, setFormCategory] = useState('');
  const [formVendorSupplier, setFormVendorSupplier] = useState('');
  const [formUnit, setFormUnit] = useState('PCS');
  const [formLocation, setFormLocation] = useState('');

  // Open modal for new registration
  const handleOpenNew = (type?: RegistryType) => {
    setEditingItem(null);
    let targetType = type || (selectedType !== 'ALL' && selectedType !== 'CATEGORY' ? selectedType : 'BARCODE_PRESET');
    if (targetType === 'CATEGORY') targetType = 'BARCODE_PRESET';
    setFormType(targetType);
    setFormCode('');
    setFormName('');
    setFormDesc('');
    setFormStatus('ACTIVE');
    setFormPresetSource('EXTERNAL');
    setFormCategory(unifiedCategories[0] || 'RESIN/RAW MATERIALS');
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
    setFormPresetSource(item.presetSource || 'EXTERNAL');
    setFormCategory(item.category || unifiedCategories[0] || 'RESIN/RAW MATERIALS');
    setFormVendorSupplier(item.vendorSupplier || '');
    setFormUnit(item.type === 'BARCODE_PRESET' ? normalizeUnitCode(item.unit) : normalizeUnitCode(item.unit) || 'PCS');
    setFormLocation(item.location || '');
    setShowRegisterModal(true);
  };

  // Submit registration
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      showPrintToast(t('masterRegistry.nameRequired'), 'warning');
      return;
    }
    if (formType === 'BARCODE_PRESET' && !formCode.trim()) {
      showPrintToast(t('masterRegistry.codeRequired'), 'warning');
      return;
    }
    if (formType === 'BARCODE_PRESET' && !formCategory.trim()) {
      showPrintToast(t('masterRegistry.categoryRequired'), 'warning');
      return;
    }
    const normalizedFormUnit = formType === 'BARCODE_PRESET' ? normalizeUnitCode(formUnit) : '';
    if (formType === 'BARCODE_PRESET' && !normalizedFormUnit) {
      showPrintToast(t('masterRegistry.unitRequired'), 'warning');
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
        unit: formType === 'BARCODE_PRESET' ? normalizedFormUnit : undefined,
        location: formType === 'BARCODE_PRESET' ? (formLocation.trim() || undefined) : undefined
      };
      onUpdateItem(updated);
    } else {
      const typePrefix = formType === 'BARCODE_PRESET' ? 'BCP' : formType.slice(0,3);
      const newItem: MasterRegistryItem = {
        id: generateAuthoritativeId(`REG-${typePrefix}`),
        type: formType,
        code: formCode.trim() ? formCode.trim().toUpperCase() : generateAuthoritativeId(`REG-${typePrefix}`),
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        status: formStatus,
        dateRegistered: todayStr,
        presetSource: formType === 'BARCODE_PRESET' ? formPresetSource : undefined,
        category: formType === 'BARCODE_PRESET' ? (formCategory.trim() || undefined) : undefined,
        vendorSupplier: formType === 'BARCODE_PRESET' ? (formVendorSupplier.trim() || undefined) : undefined,
        unit: formType === 'BARCODE_PRESET' ? normalizedFormUnit : undefined,
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
            <h1 className="text-xl font-bold tracking-tight">{t('masterRegistry.headerTitle')}</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {t('masterRegistry.headerSubtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isSuperAdmin ? (
            <>
              {onResetDefaults && (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmAction({
                      title: t('masterRegistry.resetConfirmTitle'),
                      message: t('masterRegistry.resetConfirmMsg'),
                      confirmLabel: t('masterRegistry.resetConfirmBtnLabel'),
                      confirmVariant: 'primary',
                      onConfirm: () => onResetDefaults()
                    });
                  }}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  title={t('masterRegistry.resetStarterTooltip')}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> {t('masterRegistry.resetStarterBtn')}
                </button>
              )}

              <button
                onClick={() => handleOpenNew('BARCODE_PRESET')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition cursor-pointer"
              >
                <Plus className="h-4 w-4" /> {t('masterRegistry.registerNewBtn')}
              </button>
            </>
          ) : (
            <span className="text-[10px] font-mono text-indigo-400 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg font-bold uppercase">
              {t('masterRegistry.viewOnlyBadge')}
            </span>
          )}
        </div>
      </div>

      {/* Location Registration Relocation Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 flex items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2.5">
          <Warehouse className="h-5 w-5 text-amber-600 shrink-0" />
          <div>
            <strong className="font-bold block">{t('masterRegistry.relocationTitle')}</strong>
            <span className="text-amber-800 text-[11px]">{t('masterRegistry.relocationDesc')}</span>
          </div>
        </div>
      </div>

      {/* Quick Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* 1. Barcode Presets */}
        <div 
          onClick={() => setSelectedType(selectedType === 'BARCODE_PRESET' ? 'ALL' : 'BARCODE_PRESET')}
          className={`p-3 rounded-xl border transition cursor-pointer ${
            selectedType === 'BARCODE_PRESET' 
              ? 'bg-cyan-50 border-cyan-400 ring-2 ring-cyan-400/20 shadow-sm' 
              : 'bg-white border-slate-200 hover:border-cyan-300 hover:bg-cyan-50/30'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1.5 bg-cyan-100 text-cyan-700 rounded-lg shrink-0">
                <Barcode className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-700 block truncate">{t('masterRegistry.cardPresetTitle')}</span>
                <span className="text-[10px] text-slate-500 block truncate">{t('masterRegistry.cardPresetSub')}</span>
              </div>
            </div>
            <span className="text-base font-mono font-bold text-slate-800 shrink-0">{countByType.BARCODE_PRESET}</span>
          </div>
        </div>

        {/* 2. Customer */}
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
                <span className="text-xs font-bold text-slate-700 block truncate">{t('masterRegistry.cardCustomerTitle')}</span>
                <span className="text-[10px] text-slate-500 block truncate">{t('masterRegistry.cardCustomerSub')}</span>
              </div>
            </div>
            <span className="text-base font-mono font-bold text-slate-800 shrink-0">{countByType.CUSTOMER}</span>
          </div>
        </div>

        {/* 3. Supplier / Vendor */}
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
                <span className="text-xs font-bold text-slate-700 block truncate">{t('masterRegistry.cardSupplierTitle')}</span>
                <span className="text-[10px] text-slate-500 block truncate">{t('masterRegistry.cardSupplierSub')}</span>
              </div>
            </div>
            <span className="text-base font-mono font-bold text-slate-800 shrink-0">{countByType.SUPPLIER}</span>
          </div>
        </div>

        {/* 4. Location */}
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
                <span className="text-xs font-bold text-slate-700 block truncate">{t('masterRegistry.cardLocationTitle')}</span>
                <span className="text-[10px] text-slate-500 block truncate">{t('masterRegistry.cardLocationSub')}</span>
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
            placeholder={t('masterRegistry.searchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <label htmlFor="filter-registry-type-select" className="text-xs font-bold text-slate-500 flex items-center gap-1.5 shrink-0">
            <SlidersHorizontal className="h-3.5 w-3.5 text-indigo-600" /> {t('masterRegistry.filterLabel')}
          </label>
          <select
            id="filter-registry-type-select"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as 'ALL' | RegistryType)}
            className="w-full md:w-64 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none cursor-pointer shadow-sm transition"
          >
            <option value="ALL">{t('masterRegistry.filterAll', { count: registries.length })}</option>
            <option value="BARCODE_PRESET">{t('masterRegistry.filterPresets', { count: countByType.BARCODE_PRESET })}</option>
            <option value="CUSTOMER">{t('masterRegistry.filterCustomers', { count: countByType.CUSTOMER })}</option>
            <option value="SUPPLIER">{t('masterRegistry.filterSuppliers', { count: countByType.SUPPLIER })}</option>
            <option value="LOCATION">{t('masterRegistry.filterLocations', { count: countByType.LOCATION })}</option>
          </select>
        </div>
      </div>

      {/* Main Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900 text-slate-300 font-mono text-[11px] uppercase tracking-wider border-b border-slate-800">
                <th className="p-3">{t('masterRegistry.colType')}</th>
                <th className="p-3">{t('masterRegistry.colCode')}</th>
                <th className="p-3">{t('masterRegistry.colName')}</th>
                <th className="p-3">{t('masterRegistry.colDescription')}</th>
                <th className="p-3 text-center">{t('masterRegistry.colStatus')}</th>
                <th className="p-3">{t('masterRegistry.colDateRegistered')}</th>
                <th className="p-3 text-right">{t('masterRegistry.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400 text-xs">
                    {t('masterRegistry.emptyFiltered')}
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
                        {item.type === 'BARCODE_PRESET' && (
                          <div className="flex flex-col gap-1 mt-0.5">
                            {item.category && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs" title={`Unified Category: ${item.category}`}>
                                <Tag className="h-3 w-3 text-indigo-500 shrink-0" />
                                {item.category}
                              </span>
                            )}
                            {item.presetSource && (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold border ${
                                item.presetSource === 'WIP/BOM/FG(Internal)' || item.presetSource === 'INTERNAL'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                              }`}>
                                {item.presetSource === 'WIP/BOM/FG(Internal)' || item.presetSource === 'INTERNAL' ? <Building2 className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
                                {item.presetSource === 'WIP/BOM/FG(Internal)' || item.presetSource === 'INTERNAL' ? t('masterRegistry.sourceInternal') : t('masterRegistry.sourceExternal')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-700">
                      {item.code || '-'}
                    </td>
                    <td className="p-3 font-semibold text-slate-900">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{item.name}</span>
                        {item.type === 'BARCODE_PRESET' && item.category && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-800 border border-indigo-300 shadow-2xs">
                            <Tag className="h-3 w-3 text-indigo-600" />
                            {item.category}
                          </span>
                        )}
                      </div>
                      {item.type === 'BARCODE_PRESET' && (item.vendorSupplier || item.location) && (
                        <div className="text-[10px] font-normal text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                          {item.vendorSupplier && (
                            <span className="font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                              {t('masterRegistry.vendorPrefix')} {item.vendorSupplier}
                            </span>
                          )}
                          {item.location && (
                            <span className="font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                              {t('masterRegistry.locPrefix')} {item.location}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-slate-500 max-w-xs" title={item.description}>
                      <div className="truncate font-medium text-slate-700">{item.description || '-'}</div>
                      {item.type === 'BARCODE_PRESET' && (
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                          {normalizeUnitCode(item.unit) ? (
                            <span>{t('masterRegistry.uomPrefix')} <strong className="text-slate-600">{normalizeUnitCode(item.unit)}</strong></span>
                          ) : (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 text-[9px] font-bold">
                              {MISSING_UNIT_LABEL}
                            </span>
                          )}
                          {item.location && <span>| {t('masterRegistry.locPrefix')} <strong className="text-slate-600">{item.location}</strong></span>}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {item.status === 'ACTIVE' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 className="h-3 w-3" /> {t('masterRegistry.statusActive')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          <XCircle className="h-3 w-3" /> {t('masterRegistry.statusInactive')}
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-slate-500">
                      {item.dateRegistered}
                    </td>
                    <td className="p-3 text-right">
                      {isSuperAdmin ? (
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'EDIT') handleOpenEdit(item);
                            else if (val === 'DELETE') {
                              setConfirmAction({
                                title: t('masterRegistry.deleteConfirmTitle'),
                                message: t('masterRegistry.confirmDeleteItemMsg', { name: item.name, code: item.code || item.id }),
                                confirmLabel: t('masterRegistry.deleteConfirmBtnLabel'),
                                onConfirm: () => onDeleteItem(item.id)
                              });
                            }
                            e.target.value = '';
                          }}
                          className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                          id={`action-select-reg-${item.id}`}
                        >
                          <option value="" disabled>{t('masterRegistry.actionsPlaceholder')}</option>
                          <option value="EDIT">📝 {t('masterRegistry.actionEdit')}</option>
                          <option value="DELETE">🗑️ {t('masterRegistry.actionDelete')}</option>
                        </select>
                      ) : (
                        <span className="text-slate-400 italic text-[10px] font-semibold">{t('masterRegistry.superAdminOnly')}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Registration Modal */}
      {typeof document !== 'undefined' && showRegisterModal && createPortal(
        <AnimatePresence>
          <motion.div
            key="register-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          >
            <motion.div
              key="register-modal-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className={`bg-white rounded-2xl shadow-2xl border border-slate-200 w-full ${formType === 'BARCODE_PRESET' ? 'max-w-lg' : 'max-w-md'} overflow-hidden my-auto max-h-[calc(100vh-2rem)] flex flex-col`}
            >
              <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Plus className="h-4 w-4 text-indigo-400" />
                  <h3 className="font-bold text-sm">
                    {editingItem ? t('masterRegistry.modalEditTitle') : t('masterRegistry.modalCreateTitle')}
                  </h3>
                </div>
                <button 
                  onClick={() => setShowRegisterModal(false)}
                  className="text-slate-400 hover:text-white text-lg leading-none cursor-pointer"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t('masterRegistry.regTargetLabel')}</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(['BARCODE_PRESET', 'CUSTOMER', 'SUPPLIER', 'LOCATION'] as RegistryType[]).map(regType => (
                      <button
                        key={regType}
                        type="button"
                        onClick={() => setFormType(regType)}
                        className={`px-2 py-2 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                          formType === regType 
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' 
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {getTypeIcon(regType)}
                        {regType === 'BARCODE_PRESET' ? t('masterRegistry.cardPresetTitle') : regType === 'CUSTOMER' ? t('masterRegistry.cardCustomerTitle') : regType === 'SUPPLIER' ? t('masterRegistry.cardSupplierTitle') : t('masterRegistry.cardLocationTitle')}
                      </button>
                    ))}
                  </div>
                </div>

                {formType === 'BARCODE_PRESET' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">{t('masterRegistry.sourceStreamLabel')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setFormPresetSource('EXTERNAL')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                          formPresetSource === 'EXTERNAL'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <Truck className="h-3.5 w-3.5" />
                        {t('masterRegistry.streamExternal')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormPresetSource('INTERNAL')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                          formPresetSource === 'INTERNAL'
                            ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        {t('masterRegistry.streamInternal')}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {formType === 'BARCODE_PRESET'
                      ? t('masterRegistry.codeLabelPreset')
                      : formType === 'CUSTOMER'
                      ? t('masterRegistry.codeLabelCustomer')
                      : formType === 'SUPPLIER'
                      ? t('masterRegistry.codeLabelSupplier')
                      : t('masterRegistry.codeLabelLocation')}
                  </label>
                  <input 
                    type="text"
                    required={formType === 'BARCODE_PRESET'}
                    placeholder={
                      formType === 'BARCODE_PRESET' ? t('masterRegistry.codePlaceholderPreset')
                      : formType === 'CUSTOMER' ? t('masterRegistry.codePlaceholderCustomer')
                      : formType === 'SUPPLIER' ? t('masterRegistry.codePlaceholderSupplier')
                      : t('masterRegistry.codePlaceholderLocation')
                    }
                    value={formCode}
                    onChange={e => setFormCode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {formType === 'BARCODE_PRESET' ? t('masterRegistry.nameLabelPreset')
                      : formType === 'CUSTOMER' ? t('masterRegistry.nameLabelCustomer')
                      : formType === 'SUPPLIER' ? t('masterRegistry.nameLabelSupplier')
                      : t('masterRegistry.nameLabelLocation')}
                  </label>
                  <input 
                    type="text"
                    required
                    placeholder={
                      formType === 'BARCODE_PRESET' ? t('masterRegistry.namePlaceholderPreset')
                      : formType === 'CUSTOMER' ? t('masterRegistry.namePlaceholderCustomer')
                      : formType === 'SUPPLIER' ? t('masterRegistry.namePlaceholderSupplier')
                      : t('masterRegistry.namePlaceholderLocation')
                    }
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {formType === 'BARCODE_PRESET' ? t('masterRegistry.descLabelPreset')
                      : formType === 'CUSTOMER' ? t('masterRegistry.descLabelCustomer')
                      : formType === 'SUPPLIER' ? t('masterRegistry.descLabelSupplier')
                      : t('masterRegistry.descLabelGeneric')}
                  </label>
                  <textarea 
                    rows={2}
                    placeholder={
                      formType === 'BARCODE_PRESET' ? t('masterRegistry.descPlaceholderPreset')
                      : formType === 'CUSTOMER' ? t('masterRegistry.descPlaceholderCustomer')
                      : formType === 'SUPPLIER' ? t('masterRegistry.descPlaceholderSupplier')
                      : t('masterRegistry.descPlaceholderGeneric')
                    }
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                {formType === 'BARCODE_PRESET' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {t('masterRegistry.categoryLabel')} * <span className="text-[10px] text-slate-400 font-normal">({t('masterRegistry.categoryUnifiedHint')})</span>
                    </label>
                    <select
                      required
                      value={formCategory}
                      onChange={e => setFormCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer"
                    >
                      <option value="" disabled>{t('masterRegistry.selectUnifiedCategoryOpt')}</option>
                      {unifiedCategories.map(cat => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {formType === 'BARCODE_PRESET' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{t('masterRegistry.uomReqLabel')}</label>
                      <select
                        required
                        value={formUnit}
                        onChange={e => setFormUnit(normalizeUnitCode(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer bg-white"
                      >
                        <option value="" disabled>{t('masterRegistry.selectUomOpt')}</option>
                        {getAllSelectUomOptions(formUnit).map(uom => (
                          <option key={uom} value={uom}>{uom}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{t('masterRegistry.vendorOptLabel')}</label>
                      <input 
                        type="text"
                        list="preset-suppliers-list"
                        placeholder={t('masterRegistry.vendorOptPlaceholder')}
                        value={formVendorSupplier}
                        onChange={e => setFormVendorSupplier(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                      <datalist id="preset-suppliers-list">
                        {registries.filter(r => r.type === 'SUPPLIER').map(s => (
                          <option key={s.id} value={s.name} />
                        ))}
                      </datalist>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{t('masterRegistry.defaultLocLabel')}</label>
                      <input 
                        type="text"
                        placeholder={t('masterRegistry.defaultLocPlaceholder')}
                        value={formLocation}
                        onChange={e => setFormLocation(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono uppercase focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t('masterRegistry.statusLabel')}</label>
                  <select 
                    value={formStatus}
                    onChange={e => setFormStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="ACTIVE">{t('masterRegistry.statusActiveOpt')}</option>
                    <option value="INACTIVE">{t('masterRegistry.statusInactiveOpt')}</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowRegisterModal(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
                  >
                    {t('common.cancel')}
                  </button>

                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition shadow-sm"
                  >
                    {editingItem ? t('common.saveChanges') : t('masterRegistry.registerItemBtn')}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Yes / No Action Confirmation Modal */}
      {typeof document !== 'undefined' && confirmAction && createPortal(
        <AnimatePresence>
          <motion.div
            key="confirm-action-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[120] flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          >
            <motion.div
              key="confirm-action-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden my-auto"
            >
              <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                  <h3 className="font-bold text-sm">{confirmAction.title}</h3>
                </div>
                <button 
                  onClick={() => setConfirmAction(null)} 
                  className="text-slate-400 hover:text-white transition cursor-pointer"
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
                  <span>{t('receiving.selectYesNoHint')}</span>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setConfirmAction(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <XCircle className="h-4 w-4 text-slate-500" />
                    {t('receiving.noLabel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      confirmAction.onConfirm();
                      setConfirmAction(null);
                    }}
                    className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4 text-white" />
                    {confirmAction.confirmLabel || t('receiving.yesLabel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
