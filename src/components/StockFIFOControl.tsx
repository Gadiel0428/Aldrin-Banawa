/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Filter, 
  AlertTriangle, 
  Layers, 
  Info, 
  AlertOctagon,
  BookmarkCheck,
  Plus,
  Users,
  Edit,
  Download,
  X,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Boxes,
  MapPin,
  Activity,
  CheckCircle2,
  FileText,
  Loader2,
  Printer
} from 'lucide-react';
import { MaterialStockItem, MaterialType, getCustomerForPart, ReceivingRecord, IssuanceRecord, ReturnRecord, MasterRegistryItem, FifoColorsMap, FifoMonthColor } from '../types';
import { FIFO_COLORS_BY_MONTH, DEFAULT_FIFO_COLORS_BY_MONTH, FIFO_COLOR_PRESETS, resolveFifoColor, getFifoColorForDate, normalizeFifoColor } from '../data';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';
import { LotLabelModal } from './LotLabelModal';
import { ExportMenu } from './ExportMenu';
import { StockMovementView } from './StockMovement';
import { generateAuthoritativeId } from '../lib/idGenerator';
import { showPrintToast } from '../utils/printDocument';
import {
  MISSING_UNIT_LABEL,
  findMasterPresetUnit,
  getAllSelectUomOptions,
  groupQuantitiesByUnit,
  normalizeUnitCode,
  resolveMasterDataUnit,
} from '../../shared/units';
import { computeStockAlerts } from '../utils/stockAlerts';
import { useI18n } from '../i18n';

interface StockFIFOControlProps {
  stocks: MaterialStockItem[];
  onAddStock: (item: MaterialStockItem) => void;
  onUpdateStockQty: (id: string, newQty: number) => void;
  onUpdateStockStatus: (id: string, status: MaterialStockItem['status']) => void;
  onEditStock?: (item: MaterialStockItem) => void;
  onDeleteStock?: (id: string) => void;
  isSuperAdmin?: boolean;
  canEdit?: boolean;
  receiving?: ReceivingRecord[];
  issuances?: IssuanceRecord[];
  returns?: ReturnRecord[];
  registries?: MasterRegistryItem[];
  fifoColorsByMonth?: FifoColorsMap;
  onUpdateFifoColors?: (newColors: FifoColorsMap | { month: number; color: FifoMonthColor }) => Promise<void> | void;
  currentUser?: { id: string; name: string; username: string };
  onStockUpdated?: () => void;
  initialTab?: 'bins' | 'movements';
}

export default function StockFIFOControl({
  stocks,
  onAddStock,
  onUpdateStockQty,
  onUpdateStockStatus,
  onEditStock,
  onDeleteStock,
  isSuperAdmin = false,
  canEdit = false,
  receiving = [],
  issuances = [],
  returns = [],
  registries = [],
  fifoColorsByMonth,
  onUpdateFifoColors,
  currentUser,
  onStockUpdated,
  initialTab = 'bins'
}: StockFIFOControlProps) {
  const { t, dateLocale } = useI18n();
  const effectiveCanEdit = canEdit || isSuperAdmin;
  const effectiveCalendar: FifoColorsMap = fifoColorsByMonth || FIFO_COLORS_BY_MONTH;
  const [activeTab, setActiveTab] = useState<'bins' | 'movements'>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Show Customer/Client fields only when the company has registered active customers
  const hasCustomers = useMemo(() => {
    return Array.isArray(registries) && registries.some(r => r.type === 'CUSTOMER' && r.status !== 'INACTIVE');
  }, [registries]);

  // Calendar Management Modal States
  const [showEditCalendarModal, setShowEditCalendarModal] = useState<boolean>(false);
  const [editingCalendarDraft, setEditingCalendarDraft] = useState<FifoColorsMap>(() => ({ ...effectiveCalendar }));
  const [calendarModalError, setCalendarModalError] = useState<string>('');
  const [calendarModalSuccess, setCalendarModalSuccess] = useState<string>('');
  const [isSavingCalendar, setIsSavingCalendar] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<MaterialType | 'ALL'>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<MaterialStockItem['status'] | 'ALL' | 'MISSING_UNIT'>('ALL');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('ALL');
  
  // Column Sorting States
  type StockSortField = 'id' | 'type' | 'partCode' | 'quantity' | 'receivedDate' | 'expirationDate' | 'fifoColor' | 'location' | 'status';
  type SortDirection = 'asc' | 'desc';
  const [sortField, setSortField] = useState<StockSortField>('partCode');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: StockSortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };
  
  // State for Item History Modal, Lot Label Modal & Inline Row Expansion
  const [historyStockItem, setHistoryStockItem] = useState<MaterialStockItem | null>(null);
  const [printLabelStockItem, setPrintLabelStockItem] = useState<MaterialStockItem | null>(null);
  const [expandedStockId, setExpandedStockId] = useState<string | null>(null);
  const [inlineHistoryFilter, setInlineHistoryFilter] = useState<'ALL' | 'RECEIVING' | 'ISSUANCE' | 'RETURN'>('ALL');

  // States for manual stock additions / adjustment modal
  const [showAdjustModal, setShowAdjustModal] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState(0);

  // State for Editing Registered Item Modal
  const [editingStockItem, setEditingStockItem] = useState<MaterialStockItem | null>(null);

  // State for Confirmation Modal
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);

  // States for adding stock manually (optional adjustment)
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPartCode, setNewPartCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newType, setNewType] = useState<MaterialType>('RAW');
  const [newLocation, setNewLocation] = useState('');
  const [newQty, setNewQty] = useState(0);
  const [newUnit, setNewUnit] = useState('KG');
  const [newLot, setNewLot] = useState('');
  const [newExpDate, setNewExpDate] = useState('');
  const [newResinRisk, setNewResinRisk] = useState(false);
  const [newCustomer, setNewCustomer] = useState('');

  const systemDateStr = new Date().toISOString().split('T')[0];

  // Auto-resolve UOM from Master Data preset when part code changes in Add Stock form
  const handleNewPartCodeChange = (val: string) => {
    setNewPartCode(val);
    const presetUnit = findMasterPresetUnit({ partCode: val, description: newDesc }, registries);
    if (presetUnit) {
      setNewUnit(presetUnit);
    }
  };

  // Submit manual stock addition
  const handleAddStockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPartCode || !newDesc || newQty <= 0 || !newLot || !newLocation) {
      showPrintToast(t('stocks.fillRequiredWarning'), 'warning');
      return;
    }

    const masterUnit = findMasterPresetUnit({ partCode: newPartCode, description: newDesc }, registries);
    const cleanUnit = normalizeUnitCode(newUnit) || masterUnit;
    if (!cleanUnit) {
      showPrintToast(t('stocks.selectValidUomWarning'), 'warning');
      return;
    }

    // Determine FIFO Month color tag from synced calendar
    const fifoColor = getFifoColorForDate(systemDateStr, effectiveCalendar);

    const newItem: MaterialStockItem = {
      id: generateAuthoritativeId('STK'),
      partCode: newPartCode,
      description: newDesc,
      type: newType,
      location: newLocation,
      quantity: newQty,
      unit: cleanUnit,
      unitMissing: false,
      lotNumber: newLot,
      receivedDate: systemDateStr,
      expirationDate: newExpDate || undefined,
      fifoColor,
      status: 'APPROVED',
      resinSackRisk: newResinRisk,
      shelfLifeDays: newExpDate ? Math.ceil((new Date(newExpDate).getTime() - new Date(systemDateStr).getTime()) / (1000 * 60 * 60 * 24)) : undefined,
      customer: newCustomer || getCustomerForPart(newPartCode, newDesc)
    };

    onAddStock(newItem);

    // Reset Form
    setNewPartCode('');
    setNewDesc('');
    setNewType('RAW');
    setNewLocation('');
    setNewQty(0);
    setNewUnit('KG');
    setNewLot('');
    setNewExpDate('');
    setNewResinRisk(false);
    setNewCustomer('');
    setShowAddForm(false);
  };

  const handleAdjustQtySubmit = (id: string) => {
    onUpdateStockQty(id, adjustQty);
    setShowAdjustModal(null);
  };

  // Group unique SKUs by customer
  const customersWithSkuCounts = Object.entries(
    stocks.reduce((acc, item) => {
      const customer = (item.customer || getCustomerForPart(item.partCode, item.description) || '').trim();
      if (customer) {
        if (!acc[customer]) {
          acc[customer] = new Set<string>();
        }
        acc[customer].add(item.partCode);
      }
      return acc;
    }, {} as Record<string, Set<string>>)
  ).map(([customer, partCodesSet]) => ({
    customer,
    skuCount: partCodesSet.size,
  })).sort((a, b) => b.skuCount - a.skuCount);

  // Registered customer list from master registries (only genuine registered customers, no hardcoded sample data)
  const registeredCustomers = useMemo(() => {
    if (!registries || !Array.isArray(registries)) return [];
    return registries
      .filter(r => r.type === 'CUSTOMER')
      .map(r => (r.name || '').trim())
      .filter((name, idx, arr) => Boolean(name) && arr.indexOf(name) === idx);
  }, [registries]);

  // Filter lists
  const filteredStocks = stocks.filter(item => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q || 
                          (item.partCode || '').toLowerCase().includes(q) ||
                          (item.description || '').toLowerCase().includes(q) ||
                          (item.lotNumber || '').toLowerCase().includes(q) ||
                          (item.location || '').toLowerCase().includes(q);
    const matchesType = selectedType === 'ALL' || item.type === selectedType;
    const unitInfo = resolveMasterDataUnit(item, registries, stocks);
    const matchesStatus =
      selectedStatus === 'ALL'
        ? true
        : selectedStatus === 'MISSING_UNIT'
        ? unitInfo.isMissing
        : item.status === selectedStatus;
    
    const itemCustomer = item.customer || getCustomerForPart(item.partCode, item.description);
    const matchesCustomer = !hasCustomers || selectedCustomer === 'ALL' || itemCustomer === selectedCustomer;
    
    return matchesSearch && matchesType && matchesStatus && matchesCustomer;
  });

  const stockAlertsSummary = useMemo(
    () => computeStockAlerts(stocks, undefined, registries),
    [stocks, registries]
  );

  const groupedViewTotals = useMemo(
    () =>
      groupQuantitiesByUnit(
        filteredStocks,
        (s) => s.quantity,
        (s) => resolveMasterDataUnit(s, registries, stocks).unit
      ),
    [filteredStocks, registries, stocks]
  );

  // Sorted stocks based on active column sort
  const sortedStocks = useMemo(() => {
    return [...filteredStocks].sort((a, b) => {
      let result = 0;
      switch (sortField) {
        case 'partCode': {
          result = (a.partCode || '').localeCompare(b.partCode || '', undefined, { numeric: true, sensitivity: 'base' });
          if (result === 0) {
            result = (a.description || '').localeCompare(b.description || '', undefined, { numeric: true, sensitivity: 'base' });
          }
          break;
        }
        case 'quantity': {
          result = (Number(a.quantity) || 0) - (Number(b.quantity) || 0);
          break;
        }
        case 'receivedDate': {
          const timeA = a.receivedDate ? new Date(a.receivedDate).getTime() : 0;
          const timeB = b.receivedDate ? new Date(b.receivedDate).getTime() : 0;
          result = timeA - timeB;
          break;
        }
        case 'expirationDate': {
          const timeA = a.expirationDate ? new Date(a.expirationDate).getTime() : 9999999999999;
          const timeB = b.expirationDate ? new Date(b.expirationDate).getTime() : 9999999999999;
          result = timeA - timeB;
          break;
        }
        case 'id': {
          result = (a.id || '').localeCompare(b.id || '', undefined, { numeric: true, sensitivity: 'base' });
          break;
        }
        case 'type': {
          result = (a.type || '').localeCompare(b.type || '');
          break;
        }
        case 'fifoColor': {
          result = (a.fifoColor || '').localeCompare(b.fifoColor || '');
          break;
        }
        case 'location': {
          result = (a.location || '').localeCompare(b.location || '', undefined, { numeric: true, sensitivity: 'base' });
          break;
        }
        case 'status': {
          result = (a.status || '').localeCompare(b.status || '');
          break;
        }
        default:
          result = 0;
      }
      return sortDirection === 'asc' ? result : -result;
    });
  }, [filteredStocks, sortField, sortDirection]);

  // Generate printable CSV summary of current stock levels
  const handleDownloadCSV = () => {
    if (sortedStocks.length === 0) {
      showPrintToast(t('stocks.noExportWarning'), 'warning');
      return;
    }

    const headers = [
      'Stock ID',
      'Part Code',
      'Description',
      'Material Type',
      ...(hasCustomers ? ['Customer'] : []),
      'Location / Bin',
      'Available Quantity',
      'Unit',
      'Lot Number',
      'FIFO Tag Color',
      'Received Date',
      'Expiration Date',
      'SOP Status',
      'Resin Sack Hazard Risk'
    ];

    const rows = sortedStocks.map(item => {
      const unitInfo = resolveMasterDataUnit(item, registries, stocks);
      return [
      `"${(item.id || '').replace(/"/g, '""')}"`,
      `"${(item.partCode || '').replace(/"/g, '""')}"`,
      `"${(item.description || '').replace(/"/g, '""')}"`,
      `"${(item.type || '').replace(/"/g, '""')}"`,
      ...(hasCustomers ? [`"${(item.customer || getCustomerForPart(item.partCode, item.description) || '').replace(/"/g, '""')}"`] : []),
      `"${(item.location || '').replace(/"/g, '""')}"`,
      item.quantity,
      `"${(unitInfo.unit || MISSING_UNIT_LABEL).replace(/"/g, '""')}"`,
      `"${(item.lotNumber || '').replace(/"/g, '""')}"`,
      `"${(item.fifoColor || '').replace(/"/g, '""')}"`,
      `"${(item.receivedDate || '').replace(/"/g, '""')}"`,
      `"${(item.expirationDate || 'N/A').replace(/"/g, '""')}"`,
      `"${(item.status || '').replace(/"/g, '""')}"`,
      item.resinSackRisk ? 'YES (Risk)' : 'NO'
    ];
    });

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const nowStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `Stock_Levels_Summary_${nowStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6" id="stock-fifo-control">
      {/* Official Header Banner matching Dashboard Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-5 rounded-2xl shadow-md border border-slate-800 flex flex-col md:flex-row md:justify-between md:items-center gap-4 text-white">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold font-mono px-2 py-0.5 rounded border border-indigo-500/30">
              {t('stocks.bannerBadge')}
            </span>
            <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block" /> {t('stocks.verifiedBadge')}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">{t('stocks.moduleTitle')}</h2>
          <p className="text-xs text-slate-300 mt-1">
            {t('stocks.moduleSubtitle')}
          </p>
        </div>

        {/* Module Tabs: Stock & FIFO Bins | Movements */}
        <div className="flex bg-slate-950/60 p-1.5 rounded-xl border border-slate-700/60 self-start md:self-auto shrink-0">
          <button
            type="button"
            id="btn-stock-tab-bins"
            onClick={() => setActiveTab('bins')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'bins' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <Boxes className="h-4 w-4" /> {t('stocks.tabBins')}
          </button>
          <button
            type="button"
            id="btn-stock-tab-movements"
            onClick={() => setActiveTab('movements')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'movements' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <History className="h-4 w-4" /> {t('stocks.tabMovements')}
          </button>
        </div>
      </div>

      {activeTab === 'movements' ? (
        <StockMovementView
          stocks={stocks}
          currentUser={currentUser}
          onStockUpdated={onStockUpdated}
        />
      ) : (
      <>

      {/* FIFO Color Coding Legend Section */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4" id="fifo-legend-panel">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-slate-500" /> {t('stocks.fifoLegendTitle')}
            </h3>
            <span className="bg-indigo-50 text-indigo-700 text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-indigo-200">
              {t('stocks.monthsCountBadge')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">{t('stocks.visualControlGuideline')}</span>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => {
                  setEditingCalendarDraft({ ...effectiveCalendar });
                  setCalendarModalError('');
                  setCalendarModalSuccess('');
                  setShowEditCalendarModal(true);
                }}
                className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs hover:border-indigo-300"
                title={t('stocks.editCalendarTooltip')}
                id="btn-edit-fifo-calendar"
              >
                <Edit className="h-3 w-3 text-indigo-600" />
                <span>{t('stocks.fifoCalendarBtn')}</span>
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          SOP dictates identifying and labeling incoming materials with the designated color tag prior to storage. Materials with missing tags must be immediately labeled.
        </p>
        
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {Object.entries(effectiveCalendar).map(([monthNum, meta]) => {
            const date = new Date(2026, Number(monthNum) - 1, 1);
            const monthLabel = date.toLocaleString(dateLocale, { month: 'long' });
            const isCurrentMonth = (new Date().getMonth() + 1) === Number(monthNum);
            return (
              <div 
                key={monthNum} 
                onClick={() => {
                  if (isSuperAdmin) {
                    setEditingCalendarDraft({ ...effectiveCalendar });
                    setCalendarModalError('');
                    setCalendarModalSuccess('');
                    setShowEditCalendarModal(true);
                  }
                }}
                className={`p-2.5 rounded-lg border flex flex-col items-center justify-center text-center space-y-1.5 transition-all relative group ${
                  isCurrentMonth 
                    ? 'border-indigo-300 bg-indigo-50/60 shadow-xs ring-1 ring-indigo-200' 
                    : 'border-slate-150 bg-slate-50 hover:bg-slate-100/70'
                } ${isSuperAdmin ? 'cursor-pointer hover:border-indigo-300 hover:shadow-xs' : ''}`}
                title={isSuperAdmin ? t('stocks.monthEditTooltip', { month: monthLabel }) : `${t('stocks.monthViewTooltip', { month: monthLabel })}: ${meta.name}`}
              >
                {isCurrentMonth && (
                  <span className="absolute -top-2 right-1.5 bg-indigo-600 text-white text-[8px] font-bold px-1.5 py-0.2 rounded-full uppercase tracking-wider shadow-2xs">
                    {t('stocks.currentBadge')}
                  </span>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono">{monthLabel}</span>
                  {isSuperAdmin && (
                    <Edit className="h-2.5 w-2.5 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                  )}
                </div>
                <span 
                  className={`h-4 w-4 rounded-full shadow-2xs border border-black/10 ${meta.colorClass}`} 
                  style={meta.hex ? { backgroundColor: meta.hex } : undefined}
                />
                <span className="text-[10px] font-bold text-slate-700">{meta.name}</span>
                {isSuperAdmin && (
                  <span className="text-[9px] text-indigo-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                    {t('common.edit')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Spillage Control reminder on Broken Resin Sacks */}
      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 flex gap-3 items-start" id="sop-spillage-tip">
        <AlertOctagon className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="font-bold text-xs">Contamination Control Alert</h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            <strong>Broken resin sacks must strictly avoid being mixed in general storage!</strong> This prevents resin granule spillage, dust hazard, contamination, and incorrect compounding on production lines. Isolate immediately in the Quarantine Area.
          </p>
        </div>
      </div>

      {/* Grid Controls */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        {/* Real-time Text Search Input */}
        <div className="relative flex-1 max-w-md">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 pointer-events-none">
              <Search className="h-4 w-4" />
            </span>
            <input 
              id="stock-search-input"
              type="text" 
              placeholder={t('stocks.searchPlaceholder')} 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 focus:outline-none transition-all bg-white shadow-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                title={t('stocks.clearSearchTitle')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {searchQuery.trim() && (
            <div className="mt-1 text-[11px] text-slate-500 font-medium flex items-center gap-1">
              <span>{t('stocks.showingMatches', { count: filteredStocks.length, query: searchQuery.trim() })}</span>
            </div>
          )}
        </div>

        {/* Filters and Add */}
        <div className="flex flex-wrap gap-2">
          {/* Filter Type */}
          <div className="flex items-center border border-slate-200 rounded-lg bg-white px-2.5 py-1 text-xs">
            <Filter className="h-3 w-3 text-slate-400 mr-1.5" />
            <select 
              value={selectedType}
              onChange={e => setSelectedType(e.target.value as any)}
              className="bg-transparent focus:outline-none font-semibold text-slate-700 cursor-pointer"
            >
              <option value="ALL">{t('stocks.filterAllTypes')}</option>
              <option value="RAW">{t('stocks.typeRawOpt')}</option>
              <option value="PACKAGING">{t('stocks.typePackagingOpt')}</option>
              <option value="CONSUMABLE">{t('stocks.typeConsumableOpt')}</option>
              <option value="WIP">{t('stocks.typeWipOpt')}</option>
              <option value="FG">{t('stocks.typeFgOpt')}</option>
              <option value="SUB_PART">{t('stocks.typeSubPartOpt')}</option>
            </select>
          </div>

          {/* Filter Status */}
          <div className="flex items-center border border-slate-200 rounded-lg bg-white px-2.5 py-1 text-xs">
            <BookmarkCheck className="h-3 w-3 text-slate-400 mr-1.5" />
            <select 
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value as any)}
              className="bg-transparent focus:outline-none font-semibold text-slate-700 cursor-pointer"
            >
              <option value="ALL">{t('stocks.filterAllStatuses')}</option>
              <option value="APPROVED">{t('stocks.statusApproved')}</option>
              <option value="QUARANTINE">{t('stocks.statusQuarantine')}</option>
              <option value="HOLD">{t('stocks.statusHold')}</option>
              <option value="MISSING_UNIT">{t('stocks.statusMissingUnit')}</option>
            </select>
          </div>

          {/* Filter Customer with Registered SKU Count */}
          {hasCustomers && (
            <div className="flex items-center border border-slate-200 rounded-lg bg-white px-2.5 py-1 text-xs" id="customer-filter-container">
              <Users className="h-3 w-3 text-slate-400 mr-1.5" />
              <select 
                value={selectedCustomer}
                onChange={e => setSelectedCustomer(e.target.value)}
                className="bg-transparent focus:outline-none font-semibold text-slate-700 cursor-pointer max-w-[160px] truncate"
                title={t('stocks.filterAllCustomers')}
              >
                <option value="ALL">{t('stocks.filterAllCustomers')}</option>
                {customersWithSkuCounts.map(item => (
                  <option key={item.customer} value={item.customer}>
                    {item.customer} ({item.skuCount} SKU)
                  </option>
                ))}
              </select>
            </div>
          )}

          <ExportMenu
            id="btn-stock-export-menu"
            variant="emerald"
            items={[
              {
                id: 'btn-stock-export-csv',
                label: t('stocks.exportCsvBtn'),
                title: t('stocks.exportCsvTitle'),
                icon: <Download className="h-3.5 w-3.5 text-emerald-600" />,
                onClick: handleDownloadCSV,
              },
            ]}
          />

          {effectiveCanEdit && (
            <button 
              onClick={() => setShowAddForm(!showAddForm)}
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-1.5 px-3.5 rounded-lg flex items-center gap-1 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" /> {t('stocks.addStockBtn')}
            </button>
          )}
        </div>
      </div>

      {/* Manual Add Stock Form */}
      {showAddForm && (
        <form 
          onSubmit={handleAddStockSubmit}
          className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4"
          id="manual-stock-form"
        >
          <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
            <h4 className="font-bold text-xs text-slate-800">{t('stocks.addModalTitle')}</h4>
            <button type="button" onClick={() => setShowAddForm(false)} className="text-[10px] text-slate-400">{t('common.cancel')}</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('stocks.editPartCodeLabel')}</label>
              <input 
                type="text" required placeholder={t('stocks.manualPartPlaceholder')} value={newPartCode}
                onChange={e => handleNewPartCodeChange(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('stocks.manualDescLabel')}</label>
              <input 
                type="text" required placeholder={t('stocks.manualDescPlaceholder')} value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('stocks.manualTypeLabel')}</label>
              <select 
                value={newType} onChange={e => setNewType(e.target.value as any)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs"
              >
                <option value="RAW">{t('stocks.manualTypeRaw')}</option>
                <option value="PACKAGING">{t('stocks.manualTypePkg')}</option>
                <option value="CONSUMABLE">{t('stocks.manualTypeCon')}</option>
                <option value="WIP">{t('stocks.manualTypeWip')}</option>
                <option value="FG">{t('stocks.manualTypeFg')}</option>
                <option value="SUB_PART">{t('stocks.manualTypeSub')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('stocks.editLotLabel')}</label>
              <input 
                type="text" required placeholder={t('stocks.manualLotPlaceholder')} value={newLot}
                onChange={e => setNewLot(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('stocks.manualQtyLabel')}</label>
              <input 
                type="text" 
                inputMode="numeric"
                pattern="[0-9]*"
                required 
                placeholder={t('stocks.manualQtyPlaceholder')} 
                value={newQty || ''}
                onKeyDown={(e) => {
                  if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                    e.preventDefault();
                  }
                }}
                onChange={e => {
                  const sanitized = e.target.value.replace(/\D/g, '');
                  setNewQty(sanitized ? parseInt(sanitized, 10) : 0);
                }}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('stocks.manualUomLabel')}</label>
              <select 
                value={newUnit} 
                onChange={e => setNewUnit(e.target.value)}
                required
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-semibold"
              >
                <option value="">{t('stocks.manualSelectUomOpt')}</option>
                {getAllSelectUomOptions(newUnit).map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('stocks.manualLocationLabel')}</label>
              <input 
                type="text" required placeholder={t('stocks.manualLocationPlaceholder')} value={newLocation}
                onChange={e => setNewLocation(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('stocks.manualExpiryLabel')}</label>
              <input 
                type="date" value={newExpDate}
                onChange={e => setNewExpDate(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs"
              />
            </div>
            {hasCustomers && (
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">{t('stocks.manualCustomerLabel')}</label>
                <select 
                  value={newCustomer} onChange={e => setNewCustomer(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs"
                >
                  <option value="">{t('stocks.manualSelectCustomerOpt')}</option>
                  {registeredCustomers.map(cust => (
                    <option key={cust} value={cust}>{cust}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input 
              type="checkbox" id="chk-resin-risk" checked={newResinRisk}
              onChange={e => setNewResinRisk(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900"
            />
            <label htmlFor="chk-resin-risk" className="text-xs font-semibold text-slate-700 cursor-pointer">
              {t('stocks.manualResinRiskLabel')}
            </label>
          </div>

          <div className="flex justify-end gap-1">
            <button type="submit" className="bg-slate-900 text-white text-[11px] font-bold px-3 py-1.5 rounded">
              {t('stocks.registerStockBtn')}
            </button>
          </div>
        </form>
      )}

      {/* Missing-Unit Alert & Unit-Grouped Totals Bar */}
      {(stockAlertsSummary.missingUnitCount > 0 || groupedViewTotals.buckets.length > 0) && (
        <div className="space-y-2.5">
          {stockAlertsSummary.missingUnitCount > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-900">
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-4 w-4 text-rose-600 shrink-0" />
                <span>
                  {t('stocks.missingUnitBanner', { count: stockAlertsSummary.missingUnitCount })} <span className="font-mono font-bold">{t('common.missingUnit')}</span>.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStatus(selectedStatus === 'MISSING_UNIT' ? 'ALL' : 'MISSING_UNIT')}
                className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[11px] transition cursor-pointer"
              >
                {selectedStatus === 'MISSING_UNIT' ? t('stocks.showAllStatusesBtn') : t('stocks.filterMissingUnitBtn')}
              </button>
            </div>
          )}

          {groupedViewTotals.buckets.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {t('stocks.totalOnHandByUnit', { count: filteredStocks.length })}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {groupedViewTotals.buckets.map((bucket) => (
                  <span
                    key={bucket.key}
                    className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold border ${
                      bucket.isMissing
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-slate-50 text-slate-800 border-slate-200'
                    }`}
                  >
                    {bucket.total.toLocaleString()} {bucket.isMissing ? t('common.missingUnit') : bucket.displayUnit}
                    <span className="ml-1 text-[10px] font-normal text-slate-500">({bucket.count})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stock Grid List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="stock-grid-panel">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{t('stocks.activeGridTitle')}</span>
            <span className="bg-slate-200/80 text-slate-700 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full">
              {t('stocks.recordsInView', { count: filteredStocks.length })}
            </span>
            <span className="text-[11px] text-slate-500 font-medium hidden md:inline">
              &bull; {t('stocks.sortedByText')} <strong className="text-indigo-700 font-semibold">{sortField}</strong> ({sortDirection === 'asc' ? t('stocks.ascText') : t('stocks.descText')})
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-600 font-medium border-b border-slate-200 divide-x divide-slate-200/50">
                <th 
                  onClick={() => handleSort('id')}
                  className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                    sortField === 'id' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                  }`}
                  title={t('stocks.sortByIdTitle')}
                >
                  <div className="flex items-center gap-1">
                    <span>{t('stocks.colStockId')}</span>
                    <span className="text-slate-400 group-hover:text-slate-700">
                      {sortField === 'id' ? (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                    </span>
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('type')}
                  className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                    sortField === 'type' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                  }`}
                  title={t('stocks.sortByTypeTitle')}
                >
                  <div className="flex items-center gap-1">
                    <span>{t('stocks.colClassification')}</span>
                    <span className="text-slate-400 group-hover:text-slate-700">
                      {sortField === 'type' ? (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                    </span>
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('partCode')}
                  className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                    sortField === 'partCode' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                  }`}
                  title={t('stocks.sortByPartTitle')}
                >
                  <div className="flex items-center gap-1">
                    <span>{t('stocks.colPartCodeDesc')}</span>
                    <span className="text-slate-400 group-hover:text-slate-700">
                      {sortField === 'partCode' ? (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                    </span>
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('quantity')}
                  className={`p-3 font-semibold select-none cursor-pointer transition-colors group text-right ${
                    sortField === 'quantity' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                  }`}
                  title={t('stocks.sortByQtyTitle')}
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>{t('stocks.colQuantity')}</span>
                    <span className="text-slate-400 group-hover:text-slate-700">
                      {sortField === 'quantity' ? (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                    </span>
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('receivedDate')}
                  className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                    sortField === 'receivedDate' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                  }`}
                  title={t('stocks.sortByRecvTitle')}
                >
                  <div className="flex items-center gap-1">
                    <span>{t('stocks.colLotNumber')}</span>
                    <span className="text-slate-400 group-hover:text-slate-700">
                      {sortField === 'receivedDate' ? (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                    </span>
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('expirationDate')}
                  className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                    sortField === 'expirationDate' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                  }`}
                  title={t('stocks.sortByExpTitle')}
                >
                  <div className="flex items-center gap-1">
                    <span>{t('stocks.colExpiry')}</span>
                    <span className="text-slate-400 group-hover:text-slate-700">
                      {sortField === 'expirationDate' ? (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                    </span>
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('fifoColor')}
                  className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                    sortField === 'fifoColor' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                  }`}
                  title={t('stocks.sortByFifoTitle')}
                >
                  <div className="flex items-center gap-1">
                    <span>{t('stocks.colFifoTag')}</span>
                    <span className="text-slate-400 group-hover:text-slate-700">
                      {sortField === 'fifoColor' ? (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                    </span>
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('location')}
                  className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                    sortField === 'location' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                  }`}
                  title={t('stocks.sortByLocTitle')}
                >
                  <div className="flex items-center gap-1">
                    <span>{t('stocks.colLocation')}</span>
                    <span className="text-slate-400 group-hover:text-slate-700">
                      {sortField === 'location' ? (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                    </span>
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('status')}
                  className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                    sortField === 'status' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                  }`}
                  title={t('stocks.sortByStatusTitle')}
                >
                  <div className="flex items-center gap-1">
                    <span>{t('stocks.colStatus')}</span>
                    <span className="text-slate-400 group-hover:text-slate-700">
                      {sortField === 'status' ? (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                    </span>
                  </div>
                </th>
                <th className="p-3 font-semibold text-slate-600">{t('stocks.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedStocks.map(item => {
                // Calculate expiry
                let isNearExpiry = false;
                let daysLeft = null;
                if (item.expirationDate) {
                  const diff = new Date(item.expirationDate).getTime() - new Date(systemDateStr).getTime();
                  daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
                  isNearExpiry = daysLeft <= 30;
                }

                const isExpanded = expandedStockId === item.id;

                // Match transaction histories for this specific part code & lot
                const pCode = (item.partCode || '').trim().toLowerCase();
                const lNum = (item.lotNumber || '').trim().toLowerCase();

                const matchedReceivings = receiving.filter(r => {
                  const matchCode = (r.partCode || '').trim().toLowerCase() === pCode;
                  const matchLot = !lNum || !r.lotNumber || (r.lotNumber || '').trim().toLowerCase() === lNum;
                  return matchCode && matchLot;
                });

                const matchedIssuances = issuances.filter(i => {
                  const matchCode = (i.partCode || '').trim().toLowerCase() === pCode;
                  const matchLot = !lNum || !i.lotNumber || (i.lotNumber || '').trim().toLowerCase() === lNum;
                  return matchCode && matchLot;
                });

                const matchedReturns = returns.filter(ret => {
                  const matchCode = (ret.partCode || '').trim().toLowerCase() === pCode;
                  const matchLot = !lNum || !ret.lotNumber || (ret.lotNumber || '').trim().toLowerCase() === lNum;
                  return matchCode && matchLot;
                });

                const itemUnitInfo = resolveMasterDataUnit(item, registries, stocks);

                const historyEvents = [
                  ...matchedReceivings.map(r => {
                    const rUnit = resolveMasterDataUnit(r, registries, stocks);
                    return {
                      id: r.id,
                      type: 'RECEIVING' as const,
                      date: r.receivedDate || r.date,
                      refNumber: r.rrNumber || r.poNumber || r.id,
                      qty: r.quantity,
                      unit: rUnit.unit || itemUnitInfo.unit,
                      party: r.supplierOrDept || r.vendorSupplier || 'External Supplier',
                      status: r.iqcStatus === 'APPROVED_IQC' ? 'IQC APPROVED' : r.iqcStatus === 'REJECTED_IQC' ? 'IQC REJECTED' : (r.iqcStatus || 'RECEIVED'),
                      details: `Lot: ${r.lotNumber || item.lotNumber} • Loc: ${r.location || item.location}`
                    };
                  }),
                  ...matchedIssuances.map(i => {
                    const iUnit = resolveMasterDataUnit(i, registries, stocks);
                    return {
                      id: i.id,
                      type: 'ISSUANCE' as const,
                      date: i.date,
                      refNumber: i.requisitionNumber || i.id,
                      qty: i.quantityIssued,
                      unit: iUnit.unit || itemUnitInfo.unit,
                      party: i.department || 'Production Line',
                      status: i.fifoVerified ? 'FIFO COMPLIANT' : 'FIFO OVERRIDE',
                      details: `Staff: ${i.issuedBy || 'Operator'} → Recv: ${i.receivedBy || 'Dept'}`
                    };
                  }),
                  ...matchedReturns.map(ret => {
                    const retUnit = resolveMasterDataUnit(ret, registries, stocks);
                    return {
                      id: ret.id,
                      type: 'RETURN' as const,
                      date: ret.date,
                      refNumber: ret.returnSlipFormNumber || ret.id,
                      qty: ret.quantity,
                      unit: retUnit.unit || itemUnitInfo.unit,
                      party: ret.department || 'Department Return',
                      status: ret.status,
                      details: `Cond: ${ret.condition} • Reason: ${ret.reason || 'Excess Return'}`
                    };
                  })
                ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                const filteredEvents = historyEvents.filter(ev => {
                  if (inlineHistoryFilter === 'ALL') return true;
                  return ev.type === inlineHistoryFilter;
                });

                const totalReceivedQty = matchedReceivings.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
                const totalIssuedQty = matchedIssuances.reduce((sum, i) => sum + (Number(i.quantityIssued) || 0), 0);
                const totalReturnedQty = matchedReturns.reduce((sum, ret) => sum + (Number(ret.quantity) || 0), 0);

                return (
                  <React.Fragment key={item.id}>
                    <tr 
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button, select, input, a, [data-no-expand="true"]')) return;
                        setExpandedStockId(prev => prev === item.id ? null : item.id);
                      }}
                      className={`cursor-pointer transition-all duration-150 ${
                        isExpanded 
                          ? 'bg-indigo-50/70 border-l-4 border-l-indigo-600 shadow-2xs' 
                          : 'hover:bg-indigo-50/30 hover:border-l-4 hover:border-l-indigo-300'
                      }`}
                      title={t('stocks.rowExpandTooltip')}
                    >
                      <td className="p-4 font-mono font-semibold text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedStockId(prev => prev === item.id ? null : item.id);
                            }}
                            className={`p-1 rounded-md transition-colors ${
                              isExpanded 
                                ? 'bg-indigo-600 text-white shadow-2xs' 
                                : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-100/60'
                            }`}
                            title={isExpanded ? t('stocks.collapseCardTitle') : t('stocks.expandCardTitle')}
                          >
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                          <span>{item.id}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded font-mono text-[9px] font-bold bg-slate-150 text-slate-800 uppercase">
                          {item.type}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="font-mono font-bold text-slate-800 flex items-center flex-wrap gap-1.5">
                          <span>{item.partCode}</span>
                          {item.resinSackRisk && (
                            <span className="bg-orange-100 text-orange-800 text-[8px] font-bold px-1 rounded-sm shrink-0" title={t('stocks.sackRiskTitle')}>
                              {t('stocks.sackRiskBadge')}
                            </span>
                          )}
                          {hasCustomers && (item.customer || getCustomerForPart(item.partCode, item.description)) && (
                            <span className="bg-indigo-50 text-indigo-700 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border border-indigo-100 shrink-0 font-sans">
                              {item.customer || getCustomerForPart(item.partCode, item.description)}
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500 text-[11px] truncate max-w-[180px]">{item.description}</div>
                        {item.bom && item.bom.length > 0 && (
                          <div className="mt-2 bg-slate-50 border border-slate-200 p-2 rounded-lg max-w-[200px]">
                            <span className="text-[9px] font-bold text-indigo-700 uppercase block mb-1">{t('stocks.bomComponentsTitle')} ({item.bom.length})</span>
                            <div className="space-y-1 max-h-[80px] overflow-y-auto pr-1">
                              {item.bom.map((b: any, idx: number) => {
                                const bUnit = normalizeUnitCode(b.unit) || t('common.missingUnit');
                                return (
                                  <div key={idx} className="flex justify-between items-center text-[9px] font-mono text-slate-600 leading-tight">
                                    <span className="truncate max-w-[110px]" title={`${b.partCode}: ${b.description}`}>{b.partCode}</span>
                                    <span className="font-bold text-slate-800">{b.quantityRequired} {bUnit}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-right font-mono font-bold text-slate-900">
                        <div>
                          {item.quantity.toLocaleString()}{' '}
                          {itemUnitInfo.isMissing ? (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 text-[9px] font-bold">
                              {t('common.missingUnit')}
                            </span>
                          ) : (
                            itemUnitInfo.unit
                          )}
                        </div>
                        {typeof item.reorderMin === 'number' && item.reorderMin > 0 && item.quantity <= item.reorderMin && (
                          <span className="inline-block bg-rose-100 text-rose-800 text-[9px] font-bold px-1.5 py-0.5 rounded border border-rose-200 mt-1 font-sans">
                            ⚠️ {t('stocks.lowStockBadge', { min: item.reorderMin, unit: itemUnitInfo.unit || t('common.missingUnit') })}
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="font-mono font-semibold">{item.lotNumber}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{t('stocks.recDatePrefix')} {item.receivedDate}</div>
                      </td>
                      <td className="p-4">
                        {item.expirationDate ? (
                          <div className="space-y-0.5">
                            <div className={`font-semibold ${isNearExpiry ? 'text-rose-600 animate-pulse font-bold' : 'text-slate-700'}`}>
                              {item.expirationDate}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {daysLeft !== null && daysLeft <= 0 ? t('stocks.shelfLifeExpired') : t('stocks.daysRemaining', { days: daysLeft ?? 0 })}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">{t('stocks.noExpiry')}</span>
                        )}
                      </td>
                      <td className="p-4">
                        {(() => {
                          const displayColor = normalizeFifoColor(item.fifoColor, item.receivedDate, effectiveCalendar);
                          const meta = resolveFifoColor(displayColor, undefined, undefined, effectiveCalendar);
                          return (
                            <span className="flex items-center gap-1.5 font-bold text-slate-700 font-mono">
                              <span 
                                className={`h-3 w-3 rounded-full border border-black/10 shrink-0 ${meta.colorClass}`}
                                style={meta.hex ? { backgroundColor: meta.hex } : undefined} 
                              />
                              {displayColor}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="p-4 font-medium text-slate-700">{item.location}</td>
                      <td className="p-4">
                        {item.status === 'APPROVED' ? (
                          <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded font-bold text-[9px] border border-emerald-100">
                            {t('stocks.statusApproved')}
                          </span>
                        ) : item.status === 'QUARANTINE' ? (
                          <span className="bg-rose-50 text-rose-700 px-2 py-1 rounded font-bold text-[9px] border border-rose-100">
                            {t('stocks.statusQuarantine')}
                          </span>
                        ) : (
                          <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded font-bold text-[9px] border border-amber-100">
                            {t('stocks.statusHold')}
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                          <div className="flex items-center gap-1.5" data-no-expand="true">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedStockId(prev => prev === item.id ? null : item.id);
                              }}
                              className={`flex items-center gap-1 text-[11px] font-semibold py-1 px-2.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                                isExpanded 
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs' 
                                  : 'bg-slate-100 hover:bg-indigo-50 text-slate-800 border-slate-300'
                              }`}
                              title={t('stocks.rowExpandTooltip')}
                            >
                              <History className="h-3.5 w-3.5 shrink-0" />
                              <span>{isExpanded ? t('stocks.hideCardBtn') : t('stocks.detailsBtn')}</span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPrintLabelStockItem(item);
                              }}
                              className="flex items-center gap-1 text-[11px] font-semibold py-1 px-2.5 rounded-lg border bg-white hover:bg-indigo-50 text-slate-800 border-slate-300 hover:border-indigo-300 transition-colors cursor-pointer shrink-0"
                              title={t('stocks.printLabelTooltip')}
                              id={`btn-print-label-${item.id}`}
                            >
                              <Printer className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                              <span>{t('stocks.printLabelBtn')}</span>
                            </button>

                            {(effectiveCanEdit || isSuperAdmin) ? (
                              <select
                                defaultValue=""
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const val = e.target.value;
                                  if (val === 'PRINT_LABEL') {
                                    setPrintLabelStockItem(item);
                                  } else if (val === 'HISTORY') {
                                    setHistoryStockItem(item);
                                  } else if (val === 'ADJUST') {
                                    if (!effectiveCanEdit) return;
                                    setShowAdjustModal(item.id);
                                    setAdjustQty(item.quantity);
                                  } else if (val === 'EDIT') {
                                    if (!effectiveCanEdit) return;
                                    setEditingStockItem({ ...item });
                                  } else if (val === 'RELEASE') {
                                    if (!effectiveCanEdit) return;
                                    setConfirmAction({
                                      title: t('stocks.releaseStockTitle'),
                                      message: t('stocks.releaseStockMsg', { partCode: item.partCode, lotNumber: item.lotNumber }),
                                      confirmLabel: t('stocks.approveBtn'),
                                      confirmVariant: 'primary',
                                      onConfirm: () => onUpdateStockStatus(item.id, 'APPROVED')
                                    });
                                  } else if (val === 'QUARANTINE') {
                                    if (!effectiveCanEdit) return;
                                    setConfirmAction({
                                      title: t('stocks.quarantineStockTitle'),
                                      message: t('stocks.quarantineStockMsg', { partCode: item.partCode, lotNumber: item.lotNumber }),
                                      confirmLabel: t('stocks.quarantineBtn'),
                                      confirmVariant: 'warning',
                                      onConfirm: () => onUpdateStockStatus(item.id, 'QUARANTINE')
                                    });
                                  } else if (val === 'DELETE') {
                                    if (!isSuperAdmin) return;
                                    setConfirmAction({
                                      title: t('stocks.deleteStockTitle'),
                                      message: t('stocks.deleteStockMsg', { partCode: item.partCode, lotNumber: item.lotNumber }),
                                      confirmLabel: t('stocks.deleteItemAction'),
                                      confirmVariant: 'danger',
                                      onConfirm: () => onDeleteStock?.(item.id)
                                    });
                                  }
                                  e.target.value = '';
                                }}
                                className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                                id={`action-select-stock-${item.id}`}
                              >
                                <option value="" disabled>{t('common.actions')}...</option>
                                <option value="PRINT_LABEL">🏷️ {t('stocks.printLabelBtn')}</option>
                                <option value="HISTORY">📜 {t('stocks.viewHistoryBtn')}</option>
                                {effectiveCanEdit && (
                                  <>
                                    <option value="ADJUST">✏️ {t('stocks.adjustQtyBtn')}</option>
                                    <option value="EDIT">📝 {t('stocks.editDetailsAction')}</option>
                                    {item.status !== 'APPROVED' ? (
                                      <option value="RELEASE">✅ {t('stocks.approveBtn')}</option>
                                    ) : (
                                      <option value="QUARANTINE">⚠️ {t('stocks.quarantineBtn')}</option>
                                    )}
                                  </>
                                )}
                                {isSuperAdmin && (
                                  <option value="DELETE">🗑️ {t('stocks.deleteItemAction')}</option>
                                )}
                              </select>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHistoryStockItem(item);
                                }}
                                className="text-[10px] text-indigo-600 hover:underline font-semibold"
                              >
                                {t('stocks.viewHistoryBtn')}
                              </button>
                            )}
                          </div>
                      </td>
                    </tr>

                    {/* Inline Expandable Card Row */}
                    {isExpanded && (
                      <tr className="bg-slate-50/90 border-b-2 border-indigo-100">
                        <td colSpan={10} className="p-0">
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.22, ease: 'easeOut' }}
                            className="p-5 border-l-4 border-l-indigo-600 bg-linear-to-b from-indigo-50/40 via-white to-slate-50/50 space-y-4"
                          >
                            {/* Card Header Dossier */}
                            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-xs">
                                  <Boxes className="h-5 w-5" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-bold text-slate-900 font-mono tracking-tight">{item.partCode}</h4>
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                                      {t('stocks.lotPrefix')} #{item.lotNumber}
                                    </span>
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700 uppercase">
                                      {item.type}
                                    </span>
                                    {hasCustomers && (item.customer || getCustomerForPart(item.partCode, item.description)) && (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        {item.customer || getCustomerForPart(item.partCode, item.description)}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-600 mt-0.5">{item.description}</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => setPrintLabelStockItem(item)}
                                  className="px-3 py-1.5 bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                                >
                                  <Printer className="h-3.5 w-3.5 text-indigo-600" />
                                  <span>{t('stocks.printLabelBtn')}</span>
                                </button>
                                {effectiveCanEdit && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowAdjustModal(item.id);
                                        setAdjustQty(item.quantity);
                                      }}
                                      className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                                    >
                                      <Edit className="h-3.5 w-3.5 text-indigo-600" />
                                      <span>{t('stocks.adjustBalanceBtn')}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingStockItem({ ...item })}
                                      className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                                    >
                                      <FileText className="h-3.5 w-3.5 text-slate-600" />
                                      <span>{t('stocks.editSpecsBtn')}</span>
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setHistoryStockItem(item)}
                                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                                >
                                  <History className="h-3.5 w-3.5 text-indigo-600" />
                                  <span>{t('stocks.fullModalBtn')}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setExpandedStockId(null)}
                                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                  title={t('stocks.collapseCardTitle')}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            </div>

                            {/* 4-Panel Metadata & Summary Metric Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                              {/* Stat 1: Current Balance & Reorder Status */}
                              <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs space-y-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{t('stocks.cardBalanceTitle')}</span>
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-xl font-mono font-bold text-slate-900">{item.quantity.toLocaleString()}</span>
                                  {itemUnitInfo.isMissing ? (
                                    <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-mono font-bold">
                                      {t('common.missingUnit')}
                                    </span>
                                  ) : (
                                    <span className="text-xs font-mono font-semibold text-slate-500">{itemUnitInfo.unit}</span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-500 flex items-center gap-1 pt-1 border-t border-slate-100">
                                  {typeof item.reorderMin === 'number' && item.reorderMin > 0 ? (
                                    item.quantity <= item.reorderMin ? (
                                      <span className="text-rose-600 font-bold flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3" /> {t('stocks.belowSafetyMin', { min: item.reorderMin, unit: itemUnitInfo.unit || t('common.missingUnit') })}
                                      </span>
                                    ) : (
                                      <span className="text-emerald-600 font-medium flex items-center gap-1">
                                        <CheckCircle2 className="h-3 w-3" /> {t('stocks.safeLevel', { min: item.reorderMin, unit: itemUnitInfo.unit || t('common.missingUnit') })}
                                      </span>
                                    )
                                  ) : (
                                    <span className="text-slate-400 italic">{t('stocks.noReorderLimit')}</span>
                                  )}
                                </div>
                              </div>

                              {/* Stat 2: Storage Location & FIFO Color Code */}
                              <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs space-y-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{t('stocks.cardStorageFifoTitle')}</span>
                                <div className="flex items-center gap-2">
                                  <MapPin className="h-4 w-4 text-indigo-600 shrink-0" />
                                  <span className="text-sm font-bold text-slate-800">{item.location || t('stocks.whMainFallback')}</span>
                                </div>
                                {(() => {
                                  const displayColor = normalizeFifoColor(item.fifoColor, item.receivedDate, effectiveCalendar);
                                  const meta = resolveFifoColor(displayColor, undefined, undefined, effectiveCalendar);
                                  return (
                                    <div className="flex items-center gap-2 pt-1 border-t border-slate-100 text-xs font-mono">
                                      <span 
                                        className={`h-3 w-3 rounded-full border border-black/10 shrink-0 ${meta.colorClass}`}
                                        style={meta.hex ? { backgroundColor: meta.hex } : undefined} 
                                      />
                                      <span className="font-bold text-slate-700">{displayColor} {t('stocks.fifoTagSuffix')}</span>
                                      <span className="text-[10px] text-slate-400">({item.receivedDate ? new Date(item.receivedDate.includes('T') ? item.receivedDate : `${item.receivedDate}T00:00:00`).toLocaleString(dateLocale, { month: 'short' }) : t('stocks.monthTagFallback')})</span>
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Stat 3: FEFO Shelf Life & Expiry */}
                              <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs space-y-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{t('stocks.cardFefoQualityTitle')}</span>
                                <div className="text-sm font-semibold font-mono text-slate-800">
                                  {item.expirationDate ? item.expirationDate : t('stocks.nonPerishable')}
                                </div>
                                <div className="text-[11px] pt-1 border-t border-slate-100 flex items-center justify-between">
                                  <span className={`font-semibold ${daysLeft !== null && daysLeft <= 0 ? 'text-rose-600' : daysLeft !== null && daysLeft <= 30 ? 'text-amber-600' : 'text-slate-500'}`}>
                                    {daysLeft !== null ? (daysLeft <= 0 ? `⚠️ ${t('stocks.shelfLifeExpired')}` : t('stocks.daysLeft', { days: daysLeft })) : t('stocks.permanentShelf')}
                                  </span>
                                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                    item.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : item.status === 'QUARANTINE' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                                  }`}>
                                    {item.status === 'APPROVED' ? t('stocks.statusApproved') : item.status === 'QUARANTINE' ? t('stocks.statusQuarantine') : t('stocks.statusHold')}
                                  </span>
                                </div>
                              </div>

                              {/* Stat 4: Total Movement Inflow & Outflow */}
                              <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs space-y-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{t('stocks.cardFlowTitle')}</span>
                                <div className="grid grid-cols-3 gap-1 text-center font-mono">
                                  <div className="bg-emerald-50/70 p-1 rounded border border-emerald-100">
                                    <div className="text-[9px] text-emerald-700 font-semibold">{t('stocks.flowInRecv')}</div>
                                    <div className="text-xs font-bold text-emerald-800">+{totalReceivedQty} {itemUnitInfo.unit || t('common.missingUnit')}</div>
                                  </div>
                                  <div className="bg-blue-50/70 p-1 rounded border border-blue-100">
                                    <div className="text-[9px] text-blue-700 font-semibold">{t('stocks.flowOutIssue')}</div>
                                    <div className="text-xs font-bold text-blue-800">-{totalIssuedQty} {itemUnitInfo.unit || t('common.missingUnit')}</div>
                                  </div>
                                  <div className="bg-amber-50/70 p-1 rounded border border-amber-100">
                                    <div className="text-[9px] text-amber-700 font-semibold">{t('stocks.flowRet')}</div>
                                    <div className="text-xs font-bold text-amber-800">+{totalReturnedQty} {itemUnitInfo.unit || t('common.missingUnit')}</div>
                                  </div>
                                </div>
                                <div className="text-[10px] text-slate-400 text-right pt-0.5">{t('stocks.logTransactionsCount', { count: historyEvents.length })}</div>
                              </div>
                            </div>

                            {/* BOM Hierarchy Section (if BOM components exist) */}
                            {item.bom && item.bom.length > 0 && (
                              <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                    <Layers className="h-3.5 w-3.5 text-indigo-600" />
                                    {t('stocks.bomSubcomponentsTitle')} ({item.bom.length})
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-400">{t('stocks.requiredPerUnit', { qty: 1, unit: itemUnitInfo.unit || t('common.unit') })}</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                  {item.bom.map((b: any, idx: number) => {
                                    const bUnit = normalizeUnitCode(b.unit) || t('common.missingUnit');
                                    return (
                                      <div key={idx} className="p-2 bg-slate-50/80 border border-slate-200 rounded-lg text-xs flex justify-between items-center">
                                        <div>
                                          <div className="font-mono font-bold text-slate-800">{b.partCode}</div>
                                          <div className="text-[10px] text-slate-500 truncate max-w-[140px]">{b.description}</div>
                                        </div>
                                        <div className="text-right font-mono font-bold text-indigo-700 shrink-0 ml-2">
                                          {b.quantityRequired} {bUnit}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Embedded Transaction History Table */}
                            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
                              <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Activity className="h-4 w-4 text-indigo-600" />
                                  <span className="text-xs font-bold text-slate-800">{t('stocks.txTimelineTitle')}</span>
                                  <span className="text-[10px] font-mono font-semibold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                                    {t('stocks.recordsCount', { count: filteredEvents.length })}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  {/* Filter tabs */}
                                  <div className="flex bg-slate-200/70 p-0.5 rounded-lg text-[10px] font-semibold text-slate-600">
                                    {(['ALL', 'RECEIVING', 'ISSUANCE', 'RETURN'] as const).map(tab => (
                                      <button
                                        key={tab}
                                        type="button"
                                        onClick={() => setInlineHistoryFilter(tab)}
                                        className={`px-2 py-1 rounded-md transition-colors ${
                                          inlineHistoryFilter === tab 
                                            ? 'bg-white text-indigo-700 shadow-2xs font-bold' 
                                            : 'hover:text-slate-900'
                                        }`}
                                      >
                                        {tab === 'ALL'
                                          ? t('stocks.tabAll', { count: historyEvents.length })
                                          : tab === 'RECEIVING'
                                          ? t('stocks.tabArrivals', { count: matchedReceivings.length })
                                          : tab === 'ISSUANCE'
                                          ? t('stocks.tabIssuances', { count: matchedIssuances.length })
                                          : t('stocks.tabReturns', { count: matchedReturns.length })}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              {filteredEvents.length === 0 ? (
                                <div className="p-6 text-center text-xs text-slate-400 italic">
                                  {t('stocks.noTxMatchFilter')}
                                </div>
                              ) : (
                                <div className="max-h-[220px] overflow-y-auto">
                                  <table className="w-full text-left border-collapse text-[11px]">
                                    <thead className="bg-slate-50/80 text-slate-500 font-semibold sticky top-0 border-b border-slate-200">
                                      <tr>
                                        <th className="p-2.5">{t('stocks.txColDate')}</th>
                                        <th className="p-2.5">{t('stocks.txColType')}</th>
                                        <th className="p-2.5">{t('stocks.txColRef')}</th>
                                        <th className="p-2.5 text-right">{t('stocks.txColQty')}</th>
                                        <th className="p-2.5">{t('stocks.txColParty')}</th>
                                        <th className="p-2.5">{t('stocks.txColVerification')}</th>
                                        <th className="p-2.5">{t('stocks.txColDetails')}</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 font-sans">
                                      {filteredEvents.map((ev, evIdx) => (
                                        <tr key={evIdx} className="hover:bg-slate-50/60 transition-colors">
                                          <td className="p-2.5 font-mono text-slate-600 whitespace-nowrap">{ev.date}</td>
                                          <td className="p-2.5">
                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase inline-flex items-center gap-1 ${
                                              ev.type === 'RECEIVING' 
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                                : ev.type === 'ISSUANCE' 
                                                ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                                            }`}>
                                              {ev.type === 'RECEIVING' && <ArrowDownLeft className="h-2.5 w-2.5" />}
                                              {ev.type === 'ISSUANCE' && <ArrowUpRight className="h-2.5 w-2.5" />}
                                              {ev.type === 'RETURN' && <RotateCcw className="h-2.5 w-2.5" />}
                                              {ev.type === 'RECEIVING' ? t('stocks.histTypeReceiving') : ev.type === 'ISSUANCE' ? t('stocks.histTypeIssuance') : t('stocks.histTypeReturn')}
                                            </span>
                                          </td>
                                          <td className="p-2.5 font-mono font-semibold text-slate-800">{ev.refNumber}</td>
                                          <td className={`p-2.5 text-right font-mono font-bold ${
                                            ev.type === 'RECEIVING' ? 'text-emerald-700' : ev.type === 'ISSUANCE' ? 'text-blue-700' : 'text-amber-700'
                                          }`}>
                                            {ev.type === 'RECEIVING' || ev.type === 'RETURN' ? '+' : '-'}{ev.qty.toLocaleString()} {ev.unit || t('common.missingUnit')}
                                          </td>
                                          <td className="p-2.5 text-slate-700 font-medium">{ev.party}</td>
                                          <td className="p-2.5">
                                            <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                              {ev.status}
                                            </span>
                                          </td>
                                          <td className="p-2.5 text-[10px] text-slate-500 font-mono">{ev.details}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Quantity Adjustment Popover Dialog */}
      {/* Quick Adjustment Modal */}
      {typeof document !== 'undefined' && showAdjustModal && createPortal(
        <AnimatePresence>
          <motion.div
            key="adjust-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-[100] overflow-y-auto"
          >
            <motion.div
              key="adjust-modal-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full space-y-4 my-auto"
            >
              <h4 className="font-bold text-sm text-slate-800">{t('stocks.adjustModalTitle')}</h4>
              <p className="text-xs text-slate-500">{t('stocks.adjustModalSubtitle')}</p>
              
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-400">{t('stocks.targetItemIdLabel')} {showAdjustModal}</label>
                <input 
                  type="text" 
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={adjustQty || ''}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  onChange={e => {
                    const sanitized = e.target.value.replace(/\D/g, '');
                    setAdjustQty(sanitized ? parseInt(sanitized, 10) : 0);
                  }}
                  className="w-full border border-slate-200 px-3 py-2 rounded text-xs font-mono focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold">
                <button 
                  onClick={() => setShowAdjustModal(null)}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded hover:bg-slate-50 cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                <button 
                  onClick={() => handleAdjustQtySubmit(showAdjustModal)}
                  className="px-3 py-1.5 bg-slate-950 text-white rounded hover:bg-slate-900 cursor-pointer"
                >
                  {t('stocks.saveAdjustmentBtn')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Edit Registered Stock Item Modal (Super Admin) */}
      {typeof document !== 'undefined' && editingStockItem && createPortal(
        <AnimatePresence>
          <motion.div
            key="edit-stock-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-[100] overflow-y-auto"
          >
            <motion.div
              key="edit-stock-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full space-y-4 max-h-[calc(100vh-2rem)] my-auto overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Edit className="h-4 w-4 text-indigo-600" /> {t('stocks.editModalTitle')} ({editingStockItem.id})
                  </h4>
                  <p className="text-[11px] text-slate-500">{t('stocks.editModalSubtitle')}</p>
                </div>
                <button 
                  onClick={() => setEditingStockItem(null)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editPartCodeLabel')}</label>
                  <input 
                    type="text" 
                    value={editingStockItem.partCode}
                    onChange={e => setEditingStockItem({ ...editingStockItem, partCode: e.target.value.toUpperCase() })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editTypeLabel')}</label>
                  <select 
                    value={editingStockItem.type}
                    onChange={e => setEditingStockItem({ ...editingStockItem, type: e.target.value as MaterialType })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="RAW">{t('stocks.editTypeRaw')}</option>
                    <option value="PACKAGING">{t('stocks.editTypePkg')}</option>
                    <option value="CONSUMABLE">{t('stocks.editTypeCon')}</option>
                    <option value="WIP">{t('stocks.editTypeWip')}</option>
                    <option value="FG">{t('stocks.editTypeFg')}</option>
                    <option value="SUB_PART">{t('stocks.editTypeSub')}</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editDescLabel')}</label>
                  <input 
                    type="text" 
                    value={editingStockItem.description}
                    onChange={e => setEditingStockItem({ ...editingStockItem, description: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editQtyLabel')}</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editingStockItem.quantity || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const sanitized = e.target.value.replace(/\D/g, '');
                      setEditingStockItem({ ...editingStockItem, quantity: sanitized ? parseInt(sanitized, 10) : 0 });
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editUomLabel')}</label>
                  <select 
                    value={normalizeUnitCode(editingStockItem.unit)}
                    onChange={e => {
                      const clean = normalizeUnitCode(e.target.value);
                      setEditingStockItem({ ...editingStockItem, unit: clean, unitMissing: !clean });
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono font-semibold"
                  >
                    <option value="">{t('stocks.manualSelectUomOpt')}</option>
                    {getAllSelectUomOptions(editingStockItem.unit).map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editLotLabel')}</label>
                  <input 
                    type="text" 
                    value={editingStockItem.lotNumber}
                    onChange={e => setEditingStockItem({ ...editingStockItem, lotNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editLocationLabel')}</label>
                  <input 
                    type="text" 
                    value={editingStockItem.location}
                    onChange={e => setEditingStockItem({ ...editingStockItem, location: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editFifoColorLabel')}</label>
                  <select 
                    value={editingStockItem.fifoColor}
                    onChange={e => setEditingStockItem({ ...editingStockItem, fifoColor: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-semibold"
                  >
                    {Array.from(new Set(Object.values(effectiveCalendar).map(c => c.name))).map(colorName => (
                      <option key={colorName} value={colorName}>{colorName}</option>
                    ))}
                    {editingStockItem.fifoColor && !Object.values(effectiveCalendar).some(c => c.name === editingStockItem.fifoColor) && (
                      <option value={editingStockItem.fifoColor}>{editingStockItem.fifoColor} {t('stocks.editHistoricalSuffix')}</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editQcStatusLabel')}</label>
                  <select 
                    value={editingStockItem.status}
                    onChange={e => setEditingStockItem({ ...editingStockItem, status: e.target.value as any })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-bold"
                  >
                    <option value="APPROVED">{t('stocks.editQcApprovedOpt')}</option>
                    <option value="QUARANTINE">{t('stocks.editQcQuarantineOpt')}</option>
                    <option value="HOLD">{t('stocks.editQcHoldOpt')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editExpiryLabel')}</label>
                  <input 
                    type="date" 
                    value={editingStockItem.expirationDate || ''}
                    onChange={e => setEditingStockItem({ ...editingStockItem, expirationDate: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {hasCustomers && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('stocks.editCustomerLabel')}</label>
                    <input 
                      type="text" 
                      value={editingStockItem.customer || ''}
                      onChange={e => setEditingStockItem({ ...editingStockItem, customer: e.target.value })}
                      placeholder={t('stocks.editCustomerPlaceholder')}
                      className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  onClick={() => setEditingStockItem(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                <button 
                  onClick={() => {
                    const resolved = resolveMasterDataUnit(editingStockItem, registries, stocks);
                    if (!resolved.unit) {
                      showPrintToast(t('stocks.editMissingUomWarn'), 'warning');
                      return;
                    }
                    onEditStock?.({
                      ...editingStockItem,
                      unit: resolved.unit,
                      unitMissing: false,
                    });
                    setEditingStockItem(null);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold cursor-pointer"
                >
                  {t('stocks.saveItemChangesBtn')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Item Transaction History Modal */}
      <AnimatePresence>
        {historyStockItem && (() => {
          const pCode = (historyStockItem.partCode || '').trim().toLowerCase();
          const lNum = (historyStockItem.lotNumber || '').trim().toLowerCase();

          // Matching Receivings
          const matchedReceivings = receiving.filter(r => {
            const matchCode = (r.partCode || '').trim().toLowerCase() === pCode;
            const matchLot = !lNum || !r.lotNumber || (r.lotNumber || '').trim().toLowerCase() === lNum;
            return matchCode && matchLot;
          });

          // Matching Issuances
          const matchedIssuances = issuances.filter(i => {
            const matchCode = (i.partCode || '').trim().toLowerCase() === pCode;
            const matchLot = !lNum || !i.lotNumber || (i.lotNumber || '').trim().toLowerCase() === lNum;
            return matchCode && matchLot;
          });

          // Matching Returns
          const matchedReturns = returns.filter(ret => {
            const matchCode = (ret.partCode || '').trim().toLowerCase() === pCode;
            const matchLot = !lNum || !ret.lotNumber || (ret.lotNumber || '').trim().toLowerCase() === lNum;
            return matchCode && matchLot;
          });

          const totalReceivedQty = matchedReceivings.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
          const totalIssuedQty = matchedIssuances.reduce((sum, i) => sum + (Number(i.quantityIssued) || 0), 0);
          const totalReturnedQty = matchedReturns.reduce((sum, ret) => sum + (Number(ret.quantity) || 0), 0);

          const historyStockUnitInfo = resolveMasterDataUnit(historyStockItem, registries, stocks);
          const historyStockUnitLabel = historyStockUnitInfo.unit || t('common.missingUnit');

          // Combine into unified history timeline
          const historyEvents: Array<{
            id: string;
            type: 'RECEIVING' | 'ISSUANCE' | 'RETURN';
            date: string;
            refNumber: string;
            qty: number;
            unit: string;
            party: string;
            status: string;
            details: string;
          }> = [
            ...matchedReceivings.map(r => ({
              id: r.id,
              type: 'RECEIVING' as const,
              date: r.receivedDate || r.date,
              refNumber: r.rrNumber || r.poNumber || r.id,
              qty: r.quantity,
              unit: resolveMasterDataUnit(r, registries, stocks).unit || historyStockUnitLabel,
              party: r.supplierOrDept || r.vendorSupplier || 'External Supplier',
              status: r.iqcStatus === 'APPROVED_IQC' ? 'IQC APPROVED' : r.iqcStatus === 'REJECTED_IQC' ? 'IQC REJECTED' : r.iqcStatus,
              details: `Lot: ${r.lotNumber} • Location: ${r.location || 'Warehouse'}`
            })),
            ...matchedIssuances.map(i => ({
              id: i.id,
              type: 'ISSUANCE' as const,
              date: i.date,
              refNumber: i.requisitionNumber || i.id,
              qty: i.quantityIssued,
              unit: resolveMasterDataUnit(i, registries, stocks).unit || historyStockUnitLabel,
              party: i.department || 'Production Line',
              status: i.fifoVerified ? 'FIFO VERIFIED' : 'ISSUED',
              details: `Issued By: ${i.issuedBy || 'Operator'} → Received By: ${i.receivedBy || 'Dept'}`
            })),
            ...matchedReturns.map(ret => ({
              id: ret.id,
              type: 'RETURN' as const,
              date: ret.date,
              refNumber: ret.returnSlipFormNumber || ret.id,
              qty: ret.quantity,
              unit: resolveMasterDataUnit(ret, registries, stocks).unit || historyStockUnitLabel,
              party: ret.department || 'Department Return',
              status: ret.status,
              details: `Condition: ${ret.condition} • Reason: ${ret.reason}`
            }))
          ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          const downloadHistoryCSV = () => {
            const csvHeaders = ['Transaction Type', 'Date', 'Reference #', 'Quantity', 'Unit', 'Source / Department', 'Status', 'Lot Number', 'Details'];
            const csvRows = historyEvents.map(e => [
              `"${e.type}"`,
              `"${e.date}"`,
              `"${e.refNumber.replace(/"/g, '""')}"`,
              e.qty,
              `"${e.unit}"`,
              `"${e.party.replace(/"/g, '""')}"`,
              `"${e.status.replace(/"/g, '""')}"`,
              `"${historyStockItem.lotNumber}"`,
              `"${e.details.replace(/"/g, '""')}"`
            ]);

            const csvData = [
              `"JUWEI WMS - ITEM TRANSACTION HISTORY"`,
              `"Part Code","${historyStockItem.partCode}"`,
              `"Description","${historyStockItem.description}"`,
              `"Lot Number","${historyStockItem.lotNumber}"`,
              `"Current Quantity","${historyStockItem.quantity} ${historyStockUnitLabel}"`,
              [],
              csvHeaders.join(','),
              ...csvRows.map(r => r.join(','))
            ].join('\n');

            const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Transaction_History_${historyStockItem.partCode}_${historyStockItem.lotNumber}_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          };

          return typeof document !== 'undefined' ? createPortal(
            <motion.div
              key="history-stock-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
            >
              <motion.div
                key="history-stock-content"
                initial={{ opacity: 0, scale: 0.94, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 16 }}
                transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
                className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[calc(100vh-2rem)] flex flex-col"
              >
                
                {/* Header */}
                <div className="bg-blue-950 text-white p-5 flex items-start justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-800 text-blue-200 rounded-xl border border-blue-700">
                      <History className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold font-mono">{historyStockItem.partCode}</h3>
                        <span className="bg-blue-800 text-blue-100 px-2 py-0.5 rounded text-[10px] font-bold font-mono">
                          {t('stocks.histLotPrefix')} {historyStockItem.lotNumber}
                        </span>
                      </div>
                      <p className="text-xs text-blue-200 mt-0.5 truncate max-w-lg">
                        {historyStockItem.description}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setHistoryStockItem(null)}
                    className="text-blue-300 hover:text-white p-1 rounded-lg hover:bg-blue-900 transition cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto space-y-5 flex-1">
                  
                  {/* Stats row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 font-mono uppercase block">{t('stocks.histCurrentOnHand')}</span>
                      <span className="text-xl font-bold text-indigo-950">{historyStockItem.quantity} {historyStockUnitLabel}</span>
                      <span className="text-[10px] text-slate-500 block">{t('stocks.histBinLocPrefix')} {historyStockItem.location}</span>
                    </div>
                    <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl">
                      <span className="text-[10px] font-bold text-emerald-600 font-mono uppercase block">{t('stocks.histTotalReceived')}</span>
                      <span className="text-xl font-bold">{totalReceivedQty} {historyStockUnitLabel}</span>
                      <span className="text-[10px] text-emerald-700 block">{t('stocks.histReceivingLogsCount', { count: matchedReceivings.length })}</span>
                    </div>
                    <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-xl">
                      <span className="text-[10px] font-bold text-blue-600 font-mono uppercase block">{t('stocks.histTotalIssued')}</span>
                      <span className="text-xl font-bold">{totalIssuedQty} {historyStockUnitLabel}</span>
                      <span className="text-[10px] text-blue-700 block">{t('stocks.histIssuanceLogsCount', { count: matchedIssuances.length })}</span>
                    </div>
                    <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl">
                      <span className="text-[10px] font-bold text-amber-600 font-mono uppercase block">{t('stocks.histTotalReturned')}</span>
                      <span className="text-xl font-bold">{totalReturnedQty} {historyStockUnitLabel}</span>
                      <span className="text-[10px] text-amber-700 block">{t('stocks.histReturnLogsCount', { count: matchedReturns.length })}</span>
                    </div>
                  </div>

                  {/* Timeline table */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                        {t('stocks.auditTimelineTitle', { count: historyEvents.length })}
                      </h4>
                      <span className="text-[11px] text-slate-500">{t('stocks.histSortedNewest')}</span>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white text-xs">
                      <div className="max-h-72 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px] sticky top-0 bg-slate-50">
                            <tr>
                              <th className="p-2.5">{t('stocks.histColType')}</th>
                              <th className="p-2.5">{t('stocks.histColDate')}</th>
                              <th className="p-2.5">{t('stocks.histColRef')}</th>
                              <th className="p-2.5 text-right">{t('stocks.histColQtyTransacted')}</th>
                              <th className="p-2.5">{t('stocks.histColSource')}</th>
                              <th className="p-2.5">{t('stocks.histColStatus')}</th>
                              <th className="p-2.5">{t('stocks.histColDetails')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                            {historyEvents.length === 0 ? (
                              <tr>
                                <td colSpan={7} className="p-8 text-center text-slate-400 italic">
                                  {t('stocks.histEmpty')}
                                </td>
                              </tr>
                            ) : (
                              historyEvents.map(evt => (
                                <tr key={evt.id} className="hover:bg-slate-50">
                                  <td className="p-2.5">
                                    {evt.type === 'RECEIVING' && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                        <ArrowDownLeft className="h-3 w-3" /> {t('stocks.histTypeReceiving')}
                                      </span>
                                    )}
                                    {evt.type === 'ISSUANCE' && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                        <ArrowUpRight className="h-3 w-3" /> {t('stocks.histTypeIssuance')}
                                      </span>
                                    )}
                                    {evt.type === 'RETURN' && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                        <RotateCcw className="h-3 w-3" /> {t('stocks.histTypeReturn')}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-2.5 font-mono text-[11px] text-slate-800 font-semibold">{evt.date}</td>
                                  <td className="p-2.5 font-mono text-indigo-900 font-bold">{evt.refNumber}</td>
                                  <td className="p-2.5 text-right font-bold text-slate-900">
                                    {evt.type === 'ISSUANCE' ? `-${evt.qty}` : `+${evt.qty}`} {evt.unit}
                                  </td>
                                  <td className="p-2.5">{evt.party}</td>
                                  <td className="p-2.5">
                                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 font-mono text-[10px] rounded font-semibold border border-slate-200">
                                      {evt.status}
                                    </span>
                                  </td>
                                  <td className="p-2.5 text-[11px] text-slate-500">{evt.details}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Footer */}
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
                  <div className="text-xs text-slate-500 font-medium">
                    {t('stocks.histFooterNote')}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setHistoryStockItem(null)}
                      className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      {t('common.close')}
                    </button>
                    <ExportMenu
                      id="btn-stock-history-export-menu"
                      variant="slate"
                      items={[
                        {
                          id: 'btn-stock-history-export-csv',
                          label: t('stocks.exportHistoryCsvBtn'),
                          icon: <Download className="h-3.5 w-3.5 text-indigo-600" />,
                          onClick: downloadHistoryCSV,
                        },
                      ]}
                    />
                  </div>
                </div>

              </motion.div>
            </motion.div>,
            document.body
          ) : null;
        })()}
      </AnimatePresence>
      </>
      )}

      {/* Reusable Confirmation Modal with YES / NO options */}
      <ConfirmModal config={confirmAction} onClose={() => setConfirmAction(null)} />

      {/* Lot Label Print Modal (Code 128 Barcode + FIFO Tag + 50x30mm Thermal / A4 Options) */}
      <LotLabelModal
        stock={printLabelStockItem}
        onClose={() => setPrintLabelStockItem(null)}
        registries={registries}
        stocks={stocks}
        fifoColorsByMonth={effectiveCalendar}
      />

      {/* Super Admin Edit FIFO Color Coding Calendar Modal */}
      {typeof document !== 'undefined' && showEditCalendarModal && isSuperAdmin && createPortal(
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-[999998]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold tracking-tight">{t('stocks.fifoModalTitle')}</h3>
                    <span className="bg-indigo-500/30 text-indigo-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border border-indigo-400/30">
                      {t('stocks.monthsCountBadge')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    {t('stocks.fifoModalSubtitle')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowEditCalendarModal(false);
                  setCalendarModalError('');
                  setCalendarModalSuccess('');
                }}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-white/10 transition cursor-pointer"
                title={t('common.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Informational SOP Alert */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
                <Info className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong>Standard Operating Procedure Note:</strong> Updating monthly color tags takes effect immediately for <em>newly received materials and stock records</em>. Past records stay permanently locked to the color tag assigned at their original receiving time.
                </div>
              </div>

              {/* Status / Error Alerts */}
              {calendarModalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2 animate-fadeIn font-semibold">
                  <AlertOctagon className="h-4 w-4 shrink-0 text-rose-500" />
                  <span>{calendarModalError}</span>
                </div>
              )}
              {calendarModalSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex items-center gap-2 animate-fadeIn font-semibold">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{calendarModalSuccess}</span>
                </div>
              )}

              {/* 12 Months Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((monthNum) => {
                  const date = new Date(2026, monthNum - 1, 1);
                  const monthName = date.toLocaleString(dateLocale, { month: 'long' });
                  const currentMonthNum = new Date().getMonth() + 1;
                  const isCurrent = monthNum === currentMonthNum;
                  const monthColor = editingCalendarDraft[monthNum] || DEFAULT_FIFO_COLORS_BY_MONTH[monthNum];

                  return (
                    <div 
                      key={monthNum}
                      className={`p-3 rounded-xl border transition-all ${
                        isCurrent 
                          ? 'border-indigo-300 bg-indigo-50/40 ring-1 ring-indigo-200' 
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-slate-500">
                            #{String(monthNum).padStart(2, '0')}
                          </span>
                          <span className="text-xs font-bold text-slate-800">
                            {monthName}
                          </span>
                          {isCurrent && (
                            <span className="bg-indigo-600 text-white text-[8px] font-bold px-1.5 py-0.2 rounded-full uppercase tracking-wider">
                              {t('stocks.currentMonthBadge')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span 
                            className={`h-4 w-4 rounded-full border border-black/15 shadow-2xs ${monthColor.colorClass}`}
                            style={monthColor.hex ? { backgroundColor: monthColor.hex } : undefined}
                          />
                          <span className="text-xs font-bold text-slate-700">
                            {monthColor.name}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          {t('stocks.calMonthColorLabel')}
                        </label>
                        <select
                          value={monthColor.name}
                          onChange={(e) => {
                            const selectedName = e.target.value;
                            const resolved = resolveFifoColor(selectedName);
                            setEditingCalendarDraft(prev => ({
                              ...prev,
                              [monthNum]: resolved
                            }));
                          }}
                          className="w-full text-xs font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none transition"
                        >
                          {FIFO_COLOR_PRESETS.map((preset) => (
                            <option key={preset.name} value={preset.name}>
                              {preset.name}
                            </option>
                          ))}
                          {!FIFO_COLOR_PRESETS.some(p => p.name === monthColor.name) && (
                            <option value={monthColor.name}>
                              {monthColor.name} {t('stocks.calCustomSuffix')}
                            </option>
                          )}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setEditingCalendarDraft({ ...DEFAULT_FIFO_COLORS_BY_MONTH });
                  setCalendarModalSuccess(t('stocks.calResetSuccess'));
                  setCalendarModalError('');
                }}
                disabled={isSavingCalendar}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title={t('stocks.calResetTooltip')}
              >
                <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
                <span>{t('stocks.resetSopDefaultsBtn')}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditCalendarModal(false);
                    setCalendarModalError('');
                    setCalendarModalSuccess('');
                  }}
                  disabled={isSavingCalendar}
                  className="px-4 py-1.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!onUpdateFifoColors) return;
                    setIsSavingCalendar(true);
                    setCalendarModalError('');
                    try {
                      await onUpdateFifoColors(editingCalendarDraft);
                      setCalendarModalSuccess(t('stocks.calSyncSuccess'));
                      setTimeout(() => {
                        setShowEditCalendarModal(false);
                        setCalendarModalSuccess('');
                      }, 1200);
                    } catch (err: any) {
                      setCalendarModalError(err?.message || t('stocks.calSyncFailed'));
                    } finally {
                      setIsSavingCalendar(false);
                    }
                  }}
                  disabled={isSavingCalendar}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
                  id="btn-save-fifo-calendar"
                >
                  {isSavingCalendar ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>{t('stocks.savingCalendarBtn')}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{t('stocks.saveCalendarBtn')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
