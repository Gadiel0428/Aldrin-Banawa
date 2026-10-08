/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Barcode, 
  QrCode, 
  Search, 
  X, 
  ExternalLink, 
  Layers, 
  Package, 
  Truck, 
  ArrowLeftRight, 
  RotateCcw, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Boxes, 
  Copy, 
  Check, 
  Calendar, 
  MapPin, 
  User, 
  Tag, 
  ChevronRight,
  Sparkles,
  Building,
  RefreshCw,
  FolderOpen
} from 'lucide-react';
import { 
  MaterialStockItem, 
  ReceivingRecord, 
  IssuanceRecord, 
  DeliveryRecord, 
  ReturnRecord, 
  RecyclingRecord, 
  MasterRegistryItem 
} from '../types';

export interface QuickRecordLookupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenScanner: () => void;
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  stocks: MaterialStockItem[];
  receiving: ReceivingRecord[];
  issuances: IssuanceRecord[];
  deliveries: DeliveryRecord[];
  returns: ReturnRecord[];
  recycling: RecyclingRecord[];
  registries: MasterRegistryItem[];
  onNavigateToModule: (moduleView: string, filterQuery?: string) => void;
}

export type LookupCategory = 'ALL' | 'STOCKS' | 'RECEIVING' | 'ISSUANCE' | 'DELIVERY' | 'RETURNS' | 'REGISTRY';

export default function QuickRecordLookupModal({
  isOpen,
  onClose,
  onOpenScanner,
  searchTerm,
  onSearchTermChange,
  stocks,
  receiving,
  issuances,
  deliveries,
  returns,
  recycling,
  registries,
  onNavigateToModule
}: QuickRecordLookupModalProps) {
  const [activeCategory, setActiveCategory] = useState<LookupCategory>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Extract clean keywords if barcode contains JSON (e.g. login pass or serialized object)
  const parsedSearchKeywords = useMemo(() => {
    const raw = searchTerm.trim();
    if (!raw) return [];

    // Attempt JSON parse
    if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
      try {
        const obj = JSON.parse(raw);
        const extracted: string[] = [];
        if (typeof obj === 'object' && obj !== null) {
          ['lotNumber', 'partCode', 'code', 'rrNumber', 'poNumber', 'drNumber', 'requisitionNumber', 'username', 'employeeId', 'id', 'name', 'itemDescription'].forEach(key => {
            if (obj[key] && typeof obj[key] === 'string') {
              extracted.push(obj[key].trim().toLowerCase());
            }
          });
          if (extracted.length > 0) return extracted;
        }
      } catch (e) {
        // Fallback to plain string
      }
    }

    return [raw.toLowerCase()];
  }, [searchTerm]);

  const matchesKeyword = (fieldValue: string | undefined | null): boolean => {
    if (!fieldValue) return false;
    const lower = fieldValue.toLowerCase();
    return parsedSearchKeywords.some(keyword => lower.includes(keyword) || keyword.includes(lower));
  };

  // 1. Stock matches
  const matchedStocks = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return stocks.filter(item => 
      matchesKeyword(item.lotNumber) ||
      matchesKeyword(item.partCode) ||
      matchesKeyword(item.description) ||
      matchesKeyword(item.location) ||
      matchesKeyword(item.color) ||
      matchesKeyword(item.modelName) ||
      matchesKeyword(item.customer) ||
      matchesKeyword(item.id)
    );
  }, [stocks, searchTerm, parsedSearchKeywords]);

  // 2. Receiving matches
  const matchedReceiving = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return receiving.filter(item => 
      matchesKeyword(item.rrNumber) ||
      matchesKeyword(item.poNumber) ||
      matchesKeyword(item.drNumber) ||
      matchesKeyword(item.lotNumber) ||
      matchesKeyword(item.partCode) ||
      matchesKeyword(item.itemDescription) ||
      matchesKeyword(item.supplierOrDept) ||
      matchesKeyword(item.vendorSupplier) ||
      matchesKeyword(item.siNumber) ||
      matchesKeyword(item.wayBill) ||
      matchesKeyword(item.transferFormNumber)
    );
  }, [receiving, searchTerm, parsedSearchKeywords]);

  // 3. Issuance matches
  const matchedIssuances = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return issuances.filter(item => 
      matchesKeyword(item.requisitionNumber) ||
      matchesKeyword(item.lotNumber) ||
      matchesKeyword(item.partCode) ||
      matchesKeyword(item.description) ||
      matchesKeyword(item.department) ||
      matchesKeyword(item.issuedBy) ||
      matchesKeyword(item.receivedBy)
    );
  }, [issuances, searchTerm, parsedSearchKeywords]);

  // 4. Delivery matches
  const matchedDeliveries = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return deliveries.filter(item => 
      matchesKeyword(item.drNumber) ||
      matchesKeyword(item.pickingListNumber) ||
      matchesKeyword(item.gatePassNumber) ||
      matchesKeyword(item.poNumber) ||
      matchesKeyword(item.partCode) ||
      matchesKeyword(item.modelName) ||
      matchesKeyword(item.salesInvoice) ||
      matchesKeyword(item.wayBill) ||
      matchesKeyword(item.preparedBy)
    );
  }, [deliveries, searchTerm, parsedSearchKeywords]);

  // 5. Return matches
  const matchedReturns = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return returns.filter(item => 
      matchesKeyword(item.returnSlipFormNumber) ||
      matchesKeyword(item.partCode) ||
      matchesKeyword(item.lotNumber) ||
      matchesKeyword(item.materialDescription) ||
      matchesKeyword(item.department) ||
      matchesKeyword(item.reason)
    );
  }, [returns, searchTerm, parsedSearchKeywords]);

  // 6. Registry matches
  const matchedRegistries = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return registries.filter(item => 
      matchesKeyword(item.code) ||
      matchesKeyword(item.name) ||
      matchesKeyword(item.description) ||
      matchesKeyword(item.category) ||
      matchesKeyword(item.vendorSupplier) ||
      matchesKeyword(item.location)
    );
  }, [registries, searchTerm, parsedSearchKeywords]);

  const totalMatchesCount = 
    matchedStocks.length + 
    matchedReceiving.length + 
    matchedIssuances.length + 
    matchedDeliveries.length + 
    matchedReturns.length + 
    matchedRegistries.length;

  const handleCopy = (text: string, id: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error('Clipboard copy failed', e);
    }
  };

  const handleNavigate = (moduleView: string, query?: string) => {
    onClose();
    onNavigateToModule(moduleView, query || searchTerm);
  };

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="quick-record-lookup-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            key="quick-record-lookup-content"
            initial={{ opacity: 0, scale: 0.95, y: 16, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.95, y: 16, filter: 'blur(8px)' }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="frosted-glass-modal border border-white/20 rounded-3xl w-full max-w-4xl shadow-2xl text-slate-100 overflow-hidden flex flex-col max-h-[calc(100vh-2.5rem)] my-auto backdrop-blur-3xl bg-slate-900/90"
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 bg-slate-950/50 backdrop-blur-md">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-2xl border border-indigo-400/30 shrink-0 backdrop-blur-md">
                  <Barcode className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-base text-white tracking-tight">
                      Quick Record Lookup
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {totalMatchesCount} {totalMatchesCount === 1 ? 'match' : 'matches'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">
                    Barcode, QR & Material Identification across all WMS operations
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onOpenScanner}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition cursor-pointer"
                  title="Scan another Barcode or QR code"
                >
                  <Barcode className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Scan Again</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer"
                  title="Close modal"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Interactive Search Bar & Quick Trigger */}
            <div className="px-5 py-3 border-b border-slate-800 bg-slate-950/40 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => onSearchTermChange(e.target.value)}
                  placeholder="Filter or type lot number, part code, PO#, requisition#, DR#..."
                  className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                  autoFocus
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => onSearchTermChange('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {searchTerm && (
                <div className="flex items-center gap-2 text-xs font-mono text-slate-400 px-1 shrink-0">
                  <span className="text-[11px] text-slate-500">Query:</span>
                  <span className="font-bold text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/60 truncate max-w-[200px]">
                    {searchTerm}
                  </span>
                </div>
              )}
            </div>

            {/* Category Filter Pills */}
            <div className="px-5 py-2.5 border-b border-slate-800/80 bg-slate-950/20 overflow-x-auto flex items-center gap-1.5 scrollbar-thin">
              <button
                type="button"
                onClick={() => setActiveCategory('ALL')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeCategory === 'ALL'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <span>All Results</span>
                <span className="text-[10px] opacity-75 font-mono">({totalMatchesCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveCategory('STOCKS')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeCategory === 'STOCKS'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Layers className="h-3 w-3" />
                <span>Stock FIFO</span>
                <span className="text-[10px] opacity-75 font-mono">({matchedStocks.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveCategory('RECEIVING')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeCategory === 'RECEIVING'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Package className="h-3 w-3" />
                <span>Receiving</span>
                <span className="text-[10px] opacity-75 font-mono">({matchedReceiving.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveCategory('ISSUANCE')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeCategory === 'ISSUANCE'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <ArrowLeftRight className="h-3 w-3" />
                <span>Issuances</span>
                <span className="text-[10px] opacity-75 font-mono">({matchedIssuances.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveCategory('DELIVERY')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeCategory === 'DELIVERY'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Truck className="h-3 w-3" />
                <span>Deliveries</span>
                <span className="text-[10px] opacity-75 font-mono">({matchedDeliveries.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveCategory('RETURNS')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeCategory === 'RETURNS'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <RotateCcw className="h-3 w-3" />
                <span>Returns</span>
                <span className="text-[10px] opacity-75 font-mono">({matchedReturns.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveCategory('REGISTRY')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeCategory === 'REGISTRY'
                    ? 'bg-cyan-600 text-white shadow-xs'
                    : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <FolderOpen className="h-3 w-3" />
                <span>Master Registry</span>
                <span className="text-[10px] opacity-75 font-mono">({matchedRegistries.length})</span>
              </button>
            </div>

            {/* Results Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {totalMatchesCount === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <div className="inline-flex p-4 bg-slate-800/60 rounded-full text-slate-500 border border-slate-700/60">
                    <Search className="h-8 w-8" />
                  </div>
                  <h4 className="font-bold text-sm text-slate-200">
                    {searchTerm.trim() ? `No Records Found for "${searchTerm}"` : 'Ready to Scan or Search'}
                  </h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    {searchTerm.trim()
                      ? 'No inventory stock, receiving vouchers, issuances, delivery orders, returns, or master registry items match this code.'
                      : 'Scan a lot tag, roll barcode, requisition QR code, or type a search string above.'}
                  </p>
                  <div className="pt-2 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={onOpenScanner}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-2"
                    >
                      <Barcode className="h-4 w-4" />
                      Open Scanner Modal
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* SECTION 1: Stock Inventory */}
                  {(activeCategory === 'ALL' || activeCategory === 'STOCKS') && matchedStocks.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5" />
                          Warehouse Stock Inventory ({matchedStocks.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleNavigate('stock', matchedStocks[0]?.partCode || searchTerm)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 cursor-pointer"
                        >
                          View in Stock FIFO <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {matchedStocks.map((item) => (
                          <div
                            key={`stock-${item.id}`}
                            className="bg-slate-950/60 border border-emerald-500/30 hover:border-emerald-500/60 rounded-2xl p-3.5 space-y-2.5 transition backdrop-blur-md shadow-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  {item.type || 'RAW'}
                                </span>
                                <h4 className="font-bold text-sm text-white truncate mt-1">
                                  {item.partCode}
                                </h4>
                                <p className="text-xs text-slate-300 truncate">{item.description}</p>
                              </div>

                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase font-mono ${
                                item.status === 'APPROVED' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800' :
                                item.status === 'QUARANTINE' ? 'bg-amber-950/80 text-amber-400 border border-amber-800' :
                                'bg-rose-950/80 text-rose-400 border border-rose-800'
                              }`}>
                                {item.status}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs bg-slate-900/80 rounded-xl p-2.5 border border-slate-800">
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">LOT NUMBER</span>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="font-mono font-bold text-slate-200 truncate">{item.lotNumber}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(item.lotNumber, `lot-${item.id}`)}
                                    title="Copy lot number"
                                    className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
                                  >
                                    {copiedId === `lot-${item.id}` ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                                  </button>
                                </div>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">QUANTITY</span>
                                <span className="font-bold text-emerald-400 text-sm">
                                  {item.quantity.toLocaleString()} <span className="text-xs text-slate-400 font-normal">{item.unit}</span>
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">LOCATION</span>
                                <span className="text-slate-300 flex items-center gap-1 truncate">
                                  <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                                  {item.location || 'Unassigned'}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">FIFO COLOR TAG</span>
                                <span className="text-slate-300 flex items-center gap-1">
                                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.fifoColor?.toLowerCase() || '#10b981' }} />
                                  {item.fifoColor || 'N/A'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                              <span>Received: {item.receivedDate || 'N/A'}</span>
                              <button
                                type="button"
                                onClick={() => handleNavigate('stock', item.lotNumber || item.partCode)}
                                className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 cursor-pointer"
                              >
                                View in FIFO Module <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SECTION 2: Receiving Records */}
                  {(activeCategory === 'ALL' || activeCategory === 'RECEIVING') && matchedReceiving.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5" />
                          Receiving Arrivals ({matchedReceiving.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleNavigate('receiving', matchedReceiving[0]?.rrNumber || searchTerm)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 cursor-pointer"
                        >
                          View in Receiving <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {matchedReceiving.map((item) => (
                          <div
                            key={`rec-${item.id}`}
                            className="bg-slate-950/60 border border-blue-500/30 hover:border-blue-500/60 rounded-2xl p-3.5 space-y-2.5 transition backdrop-blur-md shadow-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                  {item.rrNumber || 'RR VOUCHER'}
                                </span>
                                <h4 className="font-bold text-sm text-white truncate mt-1">
                                  {item.partCode}
                                </h4>
                                <p className="text-xs text-slate-300 truncate">{item.itemDescription}</p>
                              </div>

                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase font-mono ${
                                item.iqcStatus === 'APPROVED_IQC' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800' :
                                item.iqcStatus === 'PENDING_IQC' ? 'bg-amber-950/80 text-amber-400 border border-amber-800' :
                                'bg-rose-950/80 text-rose-400 border border-rose-800'
                              }`}>
                                {item.iqcStatus || 'PENDING'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs bg-slate-900/80 rounded-xl p-2.5 border border-slate-800">
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">LOT / BATCH</span>
                                <span className="font-mono font-bold text-slate-200 truncate block">{item.lotNumber}</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">QTY RECEIVED</span>
                                <span className="font-bold text-blue-400 text-sm">
                                  {item.quantity.toLocaleString()} <span className="text-xs text-slate-400 font-normal">{item.unit}</span>
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">PO / DR NUMBER</span>
                                <span className="text-slate-300 truncate block">
                                  {item.poNumber || item.drNumber || 'N/A'}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">SUPPLIER</span>
                                <span className="text-slate-300 truncate block">
                                  {item.supplierOrDept || item.vendorSupplier || 'N/A'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                              <span>Date: {item.date || 'N/A'}</span>
                              <button
                                type="button"
                                onClick={() => handleNavigate('receiving', item.rrNumber || item.lotNumber)}
                                className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 cursor-pointer"
                              >
                                View in Receiving <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SECTION 3: Issuance Records */}
                  {(activeCategory === 'ALL' || activeCategory === 'ISSUANCE') && matchedIssuances.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                          Requisitions & Issuances ({matchedIssuances.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleNavigate('issuance', matchedIssuances[0]?.requisitionNumber || searchTerm)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 cursor-pointer"
                        >
                          View in Issuance <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {matchedIssuances.map((item) => (
                          <div
                            key={`iss-${item.id}`}
                            className="bg-slate-950/60 border border-indigo-500/30 hover:border-indigo-500/60 rounded-2xl p-3.5 space-y-2.5 transition backdrop-blur-md shadow-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                  {item.requisitionNumber || 'REQUISITION'}
                                </span>
                                <h4 className="font-bold text-sm text-white truncate mt-1">
                                  {item.partCode}
                                </h4>
                                <p className="text-xs text-slate-300 truncate">{item.description}</p>
                              </div>

                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase font-mono bg-indigo-950/80 text-indigo-300 border border-indigo-800">
                                {item.department || 'ISSUED'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs bg-slate-900/80 rounded-xl p-2.5 border border-slate-800">
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">LOT NUMBER</span>
                                <span className="font-mono font-bold text-slate-200 truncate block">{item.lotNumber}</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">QTY ISSUED</span>
                                <span className="font-bold text-indigo-400 text-sm">
                                  {item.quantityIssued?.toLocaleString()}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">ISSUED BY</span>
                                <span className="text-slate-300 truncate block">{item.issuedBy || 'N/A'}</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">RECEIVED BY</span>
                                <span className="text-slate-300 truncate block">{item.receivedBy || 'N/A'}</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                              <span>Date: {item.date || 'N/A'}</span>
                              <button
                                type="button"
                                onClick={() => handleNavigate('issuance', item.requisitionNumber || item.lotNumber)}
                                className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 cursor-pointer"
                              >
                                View in Issuance <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SECTION 4: Delivery Records */}
                  {(activeCategory === 'ALL' || activeCategory === 'DELIVERY') && matchedDeliveries.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                          <Truck className="h-3.5 w-3.5" />
                          Delivery & Dispatch Records ({matchedDeliveries.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleNavigate('delivery', matchedDeliveries[0]?.drNumber || searchTerm)}
                          className="text-xs text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1 cursor-pointer"
                        >
                          View in Delivery <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {matchedDeliveries.map((item) => (
                          <div
                            key={`del-${item.id}`}
                            className="bg-slate-950/60 border border-purple-500/30 hover:border-purple-500/60 rounded-2xl p-3.5 space-y-2.5 transition backdrop-blur-md shadow-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                  {item.drNumber || item.gatePassNumber || 'DISPATCH'}
                                </span>
                                <h4 className="font-bold text-sm text-white truncate mt-1">
                                  {item.partCode}
                                </h4>
                                <p className="text-xs text-slate-300 truncate">{item.modelName}</p>
                              </div>

                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase font-mono ${
                                item.status === 'RELEASED' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800' :
                                item.status === 'LOADED' ? 'bg-indigo-950/80 text-indigo-400 border border-indigo-800' :
                                'bg-amber-950/80 text-amber-400 border border-amber-800'
                              }`}>
                                {item.status || 'PENDING'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs bg-slate-900/80 rounded-xl p-2.5 border border-slate-800">
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">PO / PICK LIST</span>
                                <span className="font-mono font-bold text-slate-200 truncate block">
                                  {item.poNumber || item.pickingListNumber || 'N/A'}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">QTY DISPATCHED</span>
                                <span className="font-bold text-purple-400 text-sm">
                                  {item.quantity?.toLocaleString()}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">GATE PASS</span>
                                <span className="text-slate-300 truncate block">{item.gatePassNumber || 'N/A'}</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">PREPARED BY</span>
                                <span className="text-slate-300 truncate block">{item.preparedBy || 'N/A'}</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                              <span>Date: {item.date || 'N/A'}</span>
                              <button
                                type="button"
                                onClick={() => handleNavigate('delivery', item.drNumber || item.poNumber)}
                                className="text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1 cursor-pointer"
                              >
                                View in Delivery <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SECTION 5: Return Records */}
                  {(activeCategory === 'ALL' || activeCategory === 'RETURNS') && matchedReturns.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                          <RotateCcw className="h-3.5 w-3.5" />
                          Material Return Slips ({matchedReturns.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleNavigate('receiving', matchedReturns[0]?.returnSlipFormNumber || searchTerm)}
                          className="text-xs text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1 cursor-pointer"
                        >
                          View in Returns <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {matchedReturns.map((item) => (
                          <div
                            key={`ret-${item.id}`}
                            className="bg-slate-950/60 border border-amber-500/30 hover:border-amber-500/60 rounded-2xl p-3.5 space-y-2.5 transition backdrop-blur-md shadow-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  {item.returnSlipFormNumber || 'RETURN SLIP'}
                                </span>
                                <h4 className="font-bold text-sm text-white truncate mt-1">
                                  {item.partCode}
                                </h4>
                                <p className="text-xs text-slate-300 truncate">{item.materialDescription}</p>
                              </div>

                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase font-mono bg-amber-950/80 text-amber-400 border border-amber-800">
                                {item.condition || 'RETURNED'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs bg-slate-900/80 rounded-xl p-2.5 border border-slate-800">
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">LOT NUMBER</span>
                                <span className="font-mono font-bold text-slate-200 truncate block">{item.lotNumber}</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">QTY RETURNED</span>
                                <span className="font-bold text-amber-400 text-sm">
                                  {item.quantity?.toLocaleString()} <span className="text-xs text-slate-400 font-normal">{item.unit}</span>
                                </span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-[10px] text-slate-400 font-mono block">REASON / DEPT</span>
                                <span className="text-slate-300 truncate block">
                                  {item.reason} ({item.department})
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SECTION 6: Master Registry */}
                  {(activeCategory === 'ALL' || activeCategory === 'REGISTRY') && matchedRegistries.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                          <FolderOpen className="h-3.5 w-3.5" />
                          Master Registry Presets ({matchedRegistries.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleNavigate('master-registry', matchedRegistries[0]?.code || searchTerm)}
                          className="text-xs text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 cursor-pointer"
                        >
                          View Registry <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {matchedRegistries.map((item) => (
                          <div
                            key={`reg-${item.id}`}
                            className="bg-slate-950/60 border border-cyan-500/30 hover:border-cyan-500/60 rounded-2xl p-3.5 space-y-2.5 transition backdrop-blur-md shadow-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                  {item.type || 'PRESET'}
                                </span>
                                <h4 className="font-bold text-sm text-white truncate mt-1">
                                  {item.code}
                                </h4>
                                <p className="text-xs text-slate-300 truncate">{item.name}</p>
                              </div>

                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase font-mono bg-cyan-950/80 text-cyan-400 border border-cyan-800">
                                {item.status || 'ACTIVE'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs bg-slate-900/80 rounded-xl p-2.5 border border-slate-800">
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">CATEGORY</span>
                                <span className="text-slate-200 truncate block">{item.category || 'N/A'}</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-mono block">SUPPLIER</span>
                                <span className="text-slate-200 truncate block">{item.vendorSupplier || 'N/A'}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/50 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
              <span className="text-[11px] font-mono text-slate-500 text-center sm:text-left">
                Use handheld scanner, camera, or QR codes to query across all warehouse tables.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenScanner}
                  className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 rounded-xl font-medium transition cursor-pointer flex items-center gap-1.5"
                >
                  <Barcode className="h-3.5 w-3.5" />
                  Scan Again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
}
