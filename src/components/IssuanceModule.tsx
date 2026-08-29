/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  FileSpreadsheet, 
  ShieldAlert, 
  ShieldCheck, 
  CheckCircle2, 
  HelpCircle, 
  User, 
  CornerDownRight,
  Edit,
  Trash2,
  ScanLine,
  Barcode,
  Printer,
  ChevronDown,
  ChevronRight,
  PackageCheck,
  ClipboardList,
  Layers,
  Calendar,
  Building2,
  Factory,
  Tag,
  Check
} from 'lucide-react';
import { MaterialStockItem, IssuanceRecord, MasterRegistryItem } from '../types';
import BarcodeScannerModal from './BarcodeScannerModal';
import PrintablePickingListModal, { DocViewMode } from './PrintablePickingListModal';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';
import { motion, AnimatePresence } from 'motion/react';

interface IssuanceModuleProps {
  stocks: MaterialStockItem[];
  issuances: IssuanceRecord[];
  onAddIssuance: (record: IssuanceRecord) => void;
  onDeductStock: (partCode: string, lotNumber: string, quantity: number) => boolean;
  onEditIssuance?: (record: IssuanceRecord) => void;
  onDeleteIssuance?: (id: string) => void;
  isSuperAdmin?: boolean;
  registries?: MasterRegistryItem[];
  currentUser?: string;
}

export default function IssuanceModule({
  stocks,
  issuances,
  onAddIssuance,
  onDeductStock,
  onEditIssuance,
  onDeleteIssuance,
  isSuperAdmin = false,
  registries = [],
  currentUser = ''
}: IssuanceModuleProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [editingIssuance, setEditingIssuance] = useState<IssuanceRecord | null>(null);
  const [selectedPickingDocIssuance, setSelectedPickingDocIssuance] = useState<IssuanceRecord | null>(null);
  const [printInitialView, setPrintInitialView] = useState<DocViewMode>('OFFICIAL_DOC');
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);
  const [expandedIssuanceId, setExpandedIssuanceId] = useState<string | null>(null);

  const ISSUANCE_DRAFT_KEY = 'juwei_wms_draft_issuance';

  const loadIssuanceDraft = () => {
    try {
      const raw = localStorage.getItem(ISSUANCE_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return null;
  };

  const initialIssuanceDraft = loadIssuanceDraft();

  // Form states
  const [showForm, setShowForm] = useState<boolean>(() => {
    if (initialIssuanceDraft?.showForm !== undefined) return Boolean(initialIssuanceDraft.showForm);
    return Boolean(
      initialIssuanceDraft?.requisitionNumber || 
      initialIssuanceDraft?.selectedPartCode || 
      (initialIssuanceDraft?.quantityRequested && initialIssuanceDraft.quantityRequested > 0)
    );
  });
  const [requisitionNumber, setRequisitionNumber] = useState(initialIssuanceDraft?.requisitionNumber || '');
  const [department, setDepartment] = useState(initialIssuanceDraft?.department || 'Injection Molding Dept');
  const [selectedPartCode, setSelectedPartCode] = useState(initialIssuanceDraft?.selectedPartCode || '');
  const [selectedLotNumber, setSelectedLotNumber] = useState(initialIssuanceDraft?.selectedLotNumber || '');
  const [quantityRequested, setQuantityRequested] = useState<number>(initialIssuanceDraft?.quantityRequested || 0);
  const [quantityIssued, setQuantityIssued] = useState<number>(initialIssuanceDraft?.quantityIssued || 0);
  const [issuedBy, setIssuedBy] = useState(initialIssuanceDraft?.issuedBy || (currentUser || 'Warehouse Staff'));
  const [receivedBy, setReceivedBy] = useState(initialIssuanceDraft?.receivedBy || '');

  // Auto-save issuance draft to localStorage
  useEffect(() => {
    const hasContent = Boolean(
      requisitionNumber ||
      selectedPartCode ||
      selectedLotNumber ||
      quantityRequested > 0 ||
      quantityIssued > 0 ||
      receivedBy
    );

    if (hasContent || showForm) {
      const draft = {
        showForm,
        requisitionNumber,
        department,
        selectedPartCode,
        selectedLotNumber,
        quantityRequested,
        quantityIssued,
        issuedBy,
        receivedBy,
        savedAt: Date.now()
      };
      try {
        localStorage.setItem(ISSUANCE_DRAFT_KEY, JSON.stringify(draft));
      } catch (e) {}
    }
  }, [
    showForm, requisitionNumber, department, selectedPartCode,
    selectedLotNumber, quantityRequested, quantityIssued, issuedBy, receivedBy
  ]);

  const clearIssuanceDraft = () => {
    try {
      localStorage.removeItem(ISSUANCE_DRAFT_KEY);
    } catch (e) {}
  };

  const handleDiscardIssuance = () => {
    clearIssuanceDraft();
    setRequisitionNumber('');
    setSelectedPartCode('');
    setSelectedLotNumber('');
    setQuantityRequested(0);
    setQuantityIssued(0);
    setReceivedBy('');
    setShowForm(false);
  };

  // Derived states for stocks and FIFO checks
  const approvedStocks = stocks.filter(item => item.status === 'APPROVED' && item.quantity > 0);
  const uniquePartCodes = Array.from(new Set(approvedStocks.map(item => item.partCode)));

  const [availableLots, setAvailableLots] = useState<MaterialStockItem[]>([]);
  const [fifoAlert, setFifoAlert] = useState<string | null>(null);

  // Handle scanned barcode / QR code result
  const handleScanResult = (scannedCode: string) => {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    // Search stocks for matching part code or lot number
    const matchedPart = stocks.find(s => (s.partCode || '').toLowerCase() === cleanCode.toLowerCase());
    const matchedLot = stocks.find(s => (s.lotNumber || '').toLowerCase() === cleanCode.toLowerCase());
    const matchedUniqueCode = uniquePartCodes.find(c => (c || '').toLowerCase() === cleanCode.toLowerCase());

    if (matchedPart) {
      setSelectedPartCode(matchedPart.partCode);
      setShowForm(true);
    } else if (matchedLot) {
      setSelectedPartCode(matchedLot.partCode);
      setSelectedLotNumber(matchedLot.lotNumber);
      setShowForm(true);
    } else if (matchedUniqueCode) {
      setSelectedPartCode(matchedUniqueCode);
      setShowForm(true);
    } else {
      setSelectedPartCode(cleanCode.toUpperCase());
      setShowForm(true);
    }
  };

  // Update available lots when part code changes
  useEffect(() => {
    if (selectedPartCode) {
      const lots = approvedStocks.filter(item => item.partCode === selectedPartCode);
      setAvailableLots(lots);
      if (lots.length > 0) {
        if (!selectedLotNumber || !lots.some(l => l.lotNumber === selectedLotNumber)) {
          setSelectedLotNumber(lots[0].lotNumber);
        }
      } else {
        setSelectedLotNumber('');
      }
    } else {
      setAvailableLots([]);
      setSelectedLotNumber('');
    }
  }, [selectedPartCode, stocks]);

  // FIFO validation checks: scan all approved lots of the part code to see if an older lot is ignored
  useEffect(() => {
    if (selectedPartCode && selectedLotNumber && availableLots.length > 1) {
      // Find the currently selected lot's received date
      const selectedLotItem = availableLots.find(item => item.lotNumber === selectedLotNumber);
      if (selectedLotItem) {
        const selectedDate = new Date(selectedLotItem.receivedDate).getTime();

        // Check if there is any other lot with an earlier received date
        const olderLots = availableLots.filter(item => {
          const itemDate = new Date(item.receivedDate).getTime();
          return item.lotNumber !== selectedLotNumber && itemDate < selectedDate && item.quantity > 0;
        });

        if (olderLots.length > 0) {
          const oldestLot = olderLots.sort((a, b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime())[0];
          setFifoAlert(
            `Warning: Lot "${oldestLot.lotNumber}" (received on ${oldestLot.receivedDate}) is older than your selected Lot "${selectedLotNumber}". FIFO mandates issuing older stock first!`
          );
        } else {
          setFifoAlert(null);
        }
      }
    } else {
      setFifoAlert(null);
    }
  }, [selectedLotNumber, selectedPartCode, availableLots]);

  // Auto-fill quantity issued when requested changes
  const handleQtyRequestChange = (val: number) => {
    setQuantityRequested(val);
    setQuantityIssued(val); // Default matching
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requisitionNumber || !selectedPartCode || !selectedLotNumber || quantityIssued <= 0 || !receivedBy) {
      alert('Please complete all required fields.');
      return;
    }

    // Attempt to deduct the inventory
    const success = onDeductStock(selectedPartCode, selectedLotNumber, quantityIssued);
    if (!success) {
      alert('Error: Not enough stock quantity available in the selected lot to fulfill this issuance.');
      return;
    }

    // Retrieve full item details
    const selectedItem = approvedStocks.find(item => item.partCode === selectedPartCode && item.lotNumber === selectedLotNumber);
    const itemDesc = selectedItem ? selectedItem.description : 'Unknown Item';

    const newIssuance: IssuanceRecord = {
      id: `ISS-${Date.now().toString().slice(-4)}`,
      date: new Date().toISOString().split('T')[0],
      requisitionNumber,
      department,
      partCode: selectedPartCode,
      description: itemDesc,
      quantityRequested,
      quantityIssued,
      lotNumber: selectedLotNumber,
      fifoVerified: fifoAlert === null,
      issuedBy,
      receivedBy
    };

    onAddIssuance(newIssuance);
    clearIssuanceDraft();

    // Reset
    setRequisitionNumber('');
    setSelectedPartCode('');
    setSelectedLotNumber('');
    setQuantityRequested(0);
    setQuantityIssued(0);
    setReceivedBy('');
    setShowForm(false);
  };

  const q = (searchQuery || '').trim().toLowerCase();
  const filteredIssuances = issuances.filter(iss => 
    (iss.requisitionNumber || '').toLowerCase().includes(q) ||
    (iss.partCode || '').toLowerCase().includes(q) ||
    (iss.description || '').toLowerCase().includes(q) ||
    (iss.department || '').toLowerCase().includes(q)
  );

  return (
    <div className="space-y-6" id="issuance-module">
      {/* Official Header Banner matching Dashboard Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-5 rounded-2xl shadow-md border border-slate-800 flex flex-col md:flex-row md:justify-between md:items-center gap-4 text-white">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold font-mono px-2 py-0.5 rounded border border-indigo-500/30">
              PRODUCTION ISSUANCE DISPATCH
            </span>
            <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block" /> AUTHORIZED
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Material Issuance to Production</h2>
          <p className="text-xs text-slate-300 mt-1">
            Issue approved materials and finished sub-parts to lines, perform FIFO sequence checks, and record receiver signatures.
          </p>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col gap-3">
        {/* Action Buttons Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full">
          <div className="flex flex-wrap items-center gap-2 overflow-x-auto">
            <button 
              type="button"
              onClick={() => setShowScannerModal(true)}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 px-3.5 rounded-lg flex items-center justify-center gap-2 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
              id="btn-scan-issuance-barcode"
            >
              <ScanLine className="h-4 w-4" /> Scan
            </button>

            <button 
              type="button"
              onClick={() => {
                const target = filteredIssuances[0] || issuances[0];
                if (target) {
                  setPrintInitialView('OFFICIAL_DOC');
                  setSelectedPickingDocIssuance(target);
                } else {
                  alert('No material issuance records available to print.');
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-3.5 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
              id="btn-print-active-mrs"
              title="Preview & Print Official Material Requisition Slip (MRS)"
            >
              <Printer className="h-4 w-4" /> Print Requisition Slip (MRS)
            </button>

            <button 
              type="button"
              onClick={() => {
                if (filteredIssuances.length > 0 || issuances.length > 0) {
                  setPrintInitialView('SUMMARY_LOG');
                  setSelectedPickingDocIssuance(filteredIssuances[0] || issuances[0]);
                } else {
                  alert('No material issuance records available to print log summary.');
                }
              }}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 px-3.5 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
              id="btn-print-issuance-log"
              title="Print Summary Log Report of all Filtered Issuance Records"
            >
              <Printer className="h-4 w-4 text-slate-300" /> Print Summary Log
            </button>
          </div>

          <div className="flex items-center sm:ml-auto shrink-0">
            {isSuperAdmin ? (
              <button 
                onClick={() => setShowForm(!showForm)}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
                id="btn-new-requisition"
              >
                <Plus className="h-4 w-4" /> Process Material Requisition
              </button>
            ) : (
              <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 rounded-lg font-bold uppercase shrink-0 whitespace-nowrap">
                🔒 View-Only Mode
              </span>
            )}
          </div>
        </div>

        {/* Search Bar at Bottom */}
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            <Search className="h-4 w-4" />
          </span>
          <input 
            type="text" 
            placeholder="Search issuances by Requisition #, Part #, Item Name, Department..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none bg-slate-50/50"
          />
        </div>
      </div>

      {/* Issuance form */}
      {showForm && (
        <form 
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6"
          id="issuance-form"
        >
          <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <FileSpreadsheet className="h-4 w-4 text-slate-500" /> New Material Requisition Fulfill Form (MRS)
              </h3>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Auto-saved draft
              </span>
            </div>
            <button 
              type="button" 
              onClick={handleDiscardIssuance} 
              className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Requisition Slip Number *</label>
              <input 
                type="text"
                required
                placeholder="e.g. REQ-2026-009"
                value={requisitionNumber}
                onChange={e => setRequisitionNumber(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Requesting Department *</label>
              <select 
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="Injection Molding Dept">Injection Molding Dept</option>
                <option value="Printing & Assembly Dept">Printing & Assembly Dept</option>
                <option value="Production Control Line A">Production Control Line A</option>
                <option value="PMC Dept">PMC Dept (Logistics)</option>
                <option value="Packaging Section B">Packaging Section B</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Part Code to Issue *</label>
              <select 
                value={selectedPartCode}
                onChange={e => setSelectedPartCode(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="">-- Choose Approved Part Code --</option>
                {uniquePartCodes.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
          </div>

          {selectedPartCode && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-4">
              <h4 className="text-xs font-bold text-slate-700">FIFO Bin & Lot Allocation Check</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Select Lot Number *</label>
                  <select 
                    value={selectedLotNumber}
                    onChange={e => setSelectedLotNumber(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white focus:outline-none"
                  >
                    {availableLots.map(lot => (
                      <option key={lot.id} value={lot.lotNumber}>
                        {lot.lotNumber} ({lot.quantity.toLocaleString()} {lot.unit.toUpperCase()} available)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Quantity Requested *</label>
                  <input 
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required
                    placeholder="Qty requested"
                    value={quantityRequested || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const sanitized = e.target.value.replace(/\D/g, '');
                      const val = sanitized ? parseInt(sanitized, 10) : 0;
                      handleQtyRequestChange(val);
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Quantity to Issue (FIFO match) *</label>
                  <input 
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required
                    placeholder="Qty issued"
                    value={quantityIssued || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const sanitized = e.target.value.replace(/\D/g, '');
                      setQuantityIssued(sanitized ? parseInt(sanitized, 10) : 0);
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white font-mono focus:outline-none"
                  />
                </div>
              </div>

              {/* FIFO Alerts & Verification Results */}
              {fifoAlert ? (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
                  <span>{fifoAlert}</span>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg text-xs flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span><strong>SOP Verification Success:</strong> Selected lot is compliant with the FIFO sequence rules for this part code.</span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Issued By (Warehouse personnel) *</label>
              <input 
                type="text"
                required
                value={issuedBy}
                onChange={e => setIssuedBy(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Received By (Production Representative Signature) *</label>
              <input 
                type="text"
                required
                placeholder="Print Full Name"
                value={receivedBy}
                onChange={e => setReceivedBy(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-1.5 pt-2">
            <button 
              type="button" 
              onClick={handleDiscardIssuance} 
              className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Discard
            </button>
            <button 
              type="submit" 
              className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              Verify, Issue and Update Balance
            </button>
          </div>
        </form>
      )}

      {/* Issuances Logs Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="issuance-grid-panel">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Fulfill and Issuance Log History</span>
          <span className="text-xs font-mono text-slate-500 font-semibold">{filteredIssuances.length} issuances logged</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-500 font-medium border-b border-slate-200">
                <th className="p-4 font-semibold">Issuance ID</th>
                <th className="p-4 font-semibold">Date Issued</th>
                <th className="p-4 font-semibold">Requisition #</th>
                <th className="p-4 font-semibold">Department</th>
                <th className="p-4 font-semibold">Material Code & Description</th>
                <th className="p-4 font-semibold text-right">Quantity Issued</th>
                <th className="p-4 font-semibold">Lot Issued</th>
                <th className="p-4 font-semibold">FIFO Audit</th>
                <th className="p-4 font-semibold">Authorized Signatures</th>
                <th className="p-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredIssuances.map(iss => {
                const isExpanded = expandedIssuanceId === iss.id;
                const matchedStock = stocks.find(s => 
                  (s.partCode || '').trim().toLowerCase() === (iss.partCode || '').trim().toLowerCase() && 
                  (!iss.lotNumber || (s.lotNumber || '').trim().toLowerCase() === (iss.lotNumber || '').trim().toLowerCase())
                );
                const registryItem = registries.find(r => 
                  (r.code || '').trim().toLowerCase() === (iss.partCode || '').trim().toLowerCase()
                );

                return (
                  <React.Fragment key={iss.id}>
                    <tr 
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button, select, input, a, [data-no-expand="true"]')) return;
                        setExpandedIssuanceId(prev => prev === iss.id ? null : iss.id);
                      }}
                      className={`cursor-pointer transition-all duration-150 ${
                        isExpanded 
                          ? 'bg-indigo-50/70 border-l-4 border-l-indigo-600 shadow-2xs' 
                          : 'hover:bg-indigo-50/30 hover:border-l-4 hover:border-l-indigo-300'
                      }`}
                      title="Click row to expand issuance details & FIFO metadata"
                    >
                      <td className="p-4 font-mono font-semibold text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedIssuanceId(prev => prev === iss.id ? null : iss.id);
                            }}
                            className={`p-1 rounded-md transition-colors ${
                              isExpanded ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                            title={isExpanded ? 'Collapse row' : 'Expand row details'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <span>{iss.id}</span>
                        </div>
                      </td>
                      <td className="p-4 text-slate-600 font-mono">{iss.date}</td>
                      <td className="p-4" data-no-expand="true">
                        <button
                          type="button"
                          onClick={() => {
                            setPrintInitialView('OFFICIAL_DOC');
                            setSelectedPickingDocIssuance(iss);
                          }}
                          className="font-mono font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer"
                          title="Click to view & print official Material Requisition Slip (MRS)"
                        >
                          <Printer className="h-3 w-3 text-indigo-500 shrink-0" />
                          <span>{iss.requisitionNumber}</span>
                        </button>
                      </td>
                      <td className="p-4 font-medium text-slate-700">{iss.department}</td>
                      <td className="p-4">
                        <div className="font-mono font-semibold text-slate-800">{iss.partCode}</div>
                        <div className="text-slate-500 text-[11px] truncate max-w-[200px]">{iss.description}</div>
                      </td>
                      <td className="p-4 text-right font-mono font-bold text-slate-850">
                        {iss.quantityIssued.toLocaleString()}
                      </td>
                      <td className="p-4 font-mono text-slate-700">{iss.lotNumber}</td>
                      <td className="p-4">
                        {iss.fifoVerified ? (
                          <span className="text-emerald-600 font-semibold flex items-center gap-1">
                            <ShieldCheck className="h-4 w-4" /> Passed FIFO
                          </span>
                        ) : (
                          <span className="text-amber-600 font-semibold flex items-center gap-1" title="Issued out of chronological order">
                            <ShieldAlert className="h-4 w-4" /> Override Warning
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-slate-600 space-y-0.5">
                        <div className="flex items-center gap-1"><User className="h-3 w-3 text-slate-400" /> <span className="text-[10px]">Staff:</span> {iss.issuedBy}</div>
                        <div className="flex items-center gap-1"><CornerDownRight className="h-3 w-3 text-slate-400" /> <span className="text-[10px]">Recv:</span> {iss.receivedBy}</div>
                      </td>
                      <td className="p-4" data-no-expand="true">
                        {isSuperAdmin ? (
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === 'PRINT_MRS') {
                                setPrintInitialView('OFFICIAL_DOC');
                                setSelectedPickingDocIssuance(iss);
                              } else if (val === 'PRINT_PL') {
                                setPrintInitialView('PICKING_LIST');
                                setSelectedPickingDocIssuance(iss);
                              } else if (val === 'EDIT') setEditingIssuance({ ...iss });
                              else if (val === 'DELETE') {
                                setConfirmAction({
                                  title: 'Delete Issuance Record',
                                  message: `Are you sure you want to delete issuance record ${iss.id} (${iss.requisitionNumber})?`,
                                  confirmLabel: 'YES, DELETE RECORD',
                                  confirmVariant: 'danger',
                                  onConfirm: () => onDeleteIssuance?.(iss.id)
                                });
                              }
                              e.target.value = '';
                            }}
                            className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                            id={`action-select-iss-${iss.id}`}
                          >
                            <option value="" disabled>Actions...</option>
                            <option value="PRINT_MRS">📄 Print Requisition Slip (MRS)</option>
                            <option value="PRINT_PL">📋 Print Picking List</option>
                            <option value="EDIT">📝 Edit Record</option>
                            <option value="DELETE">🗑️ Delete Record</option>
                          </select>
                        ) : (
                          <span className="text-slate-400 italic text-[10px]">Super Admin Only</span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable Card View for Issuance Record */}
                    <AnimatePresence>
                      {isExpanded && (
                        <tr>
                          <td colSpan={10} className="p-0 bg-slate-50/80 border-b-2 border-indigo-200">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="p-5 space-y-4">
                                {/* Header Summary Ribbon */}
                                <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                                  <div className="flex items-center gap-3">
                                    <div className="p-2.5 bg-indigo-50 rounded-lg text-indigo-600">
                                      <PackageCheck className="h-5 w-5" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-slate-900">
                                          Requisition: <span className="font-mono text-indigo-600">{iss.requisitionNumber}</span>
                                        </span>
                                        <span className="font-mono text-xs text-slate-400">({iss.id})</span>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                          iss.fifoVerified 
                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                                        }`}>
                                          {iss.fifoVerified ? 'FIFO COMPLIANT' : 'OVERRIDE AUDIT REQUIRED'}
                                        </span>
                                      </div>
                                      <p className="text-xs text-slate-500 mt-0.5">
                                        Target: <strong className="text-slate-700">{iss.department}</strong> &bull; Part: <strong className="font-mono text-slate-700">{iss.partCode}</strong> - {iss.description}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="bg-slate-100 text-slate-700 font-mono font-semibold px-2.5 py-1 rounded-lg border border-slate-200">
                                      Date: {iss.date}
                                    </span>
                                    <span className="bg-indigo-50 text-indigo-800 font-bold px-2.5 py-1 rounded-lg border border-indigo-200 font-mono">
                                      Issued: {iss.quantityIssued.toLocaleString()} PCS
                                    </span>
                                    {matchedStock && (
                                      <span className="bg-emerald-50 text-emerald-800 font-bold px-2.5 py-1 rounded-lg border border-emerald-200 font-mono">
                                        Current Stock: {matchedStock.quantity.toLocaleString()} {matchedStock.unit}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* 3-Column Detailed Metadata Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  {/* Col 1: Material & Warehouse Details */}
                                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                      <Tag className="h-4 w-4 text-indigo-500" />
                                      <span>Material & Warehouse Location</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                      <div>
                                        <span className="text-slate-400 text-[11px] block">Part Code:</span>
                                        <span className="font-mono font-bold text-slate-800">{iss.partCode}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400 text-[11px] block">Category:</span>
                                        <span className="font-semibold text-indigo-700">{registryItem?.category || 'Production Material'}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400 text-[11px] block">Batch / Lot #:</span>
                                        <span className="font-mono font-bold text-slate-800">{iss.lotNumber}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400 text-[11px] block">Bin Location:</span>
                                        <span className="font-mono font-semibold text-slate-800">{matchedStock?.location || 'Standard Bay / Shelf'}</span>
                                      </div>
                                      <div className="col-span-2 pt-1 border-t border-slate-100 flex justify-between items-center text-slate-500 text-[11px]">
                                        <span>Unit of Measure:</span>
                                        <span className="font-mono font-bold text-slate-700">{matchedStock?.unit || registryItem?.unit || 'PCS'}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Col 2: FIFO Compliance & SOP Verification */}
                                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                      <span>FIFO & SOP Compliance</span>
                                    </div>
                                    <div className="space-y-2 text-xs">
                                      <div>
                                        <span className="text-slate-400 text-[11px] block">FIFO Status:</span>
                                        <div className="mt-0.5">
                                          {iss.fifoVerified ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                              <Check className="h-3 w-3" /> Strict First-In First-Out Verified
                                            </span>
                                          ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">
                                              <ShieldAlert className="h-3 w-3" /> Manual Out-of-Sequence Override
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="bg-slate-50 p-2 rounded-lg border border-slate-150 text-[11px] text-slate-600 space-y-1">
                                        <div className="flex justify-between">
                                          <span>Stock Allocation:</span>
                                          <strong className="text-slate-800">Deducted from Inventory</strong>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>Requisition Purpose:</span>
                                          <strong className="text-slate-800">{iss.department} Operations</strong>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Col 3: Signatures & Quick Print Actions */}
                                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                      <FileSpreadsheet className="h-4 w-4 text-purple-500" />
                                      <span>Signatures & Official Documents</span>
                                    </div>

                                    <div className="space-y-2 text-xs">
                                      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded-lg border border-slate-150">
                                        <div>
                                          <span className="text-slate-400 text-[10px] block">Issued By (Warehouse):</span>
                                          <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                                            <User className="h-3 w-3 text-slate-400" /> {iss.issuedBy}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-slate-400 text-[10px] block">Received By (Production):</span>
                                          <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                                            <CornerDownRight className="h-3 w-3 text-slate-400" /> {iss.receivedBy}
                                          </span>
                                        </div>
                                      </div>

                                      <div className="flex gap-2 pt-1" data-no-expand="true">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setPrintInitialView('OFFICIAL_DOC');
                                            setSelectedPickingDocIssuance(iss);
                                          }}
                                          className="flex-1 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-indigo-200 flex items-center justify-center gap-1 shadow-2xs"
                                        >
                                          <Printer className="h-3 w-3" /> Requisition Slip
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setPrintInitialView('PICKING_LIST');
                                            setSelectedPickingDocIssuance(iss);
                                          }}
                                          className="flex-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-slate-200 flex items-center justify-center gap-1 shadow-2xs"
                                        >
                                          <ClipboardList className="h-3 w-3" /> Picking List
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Issuance Modal (Super Admin) */}
      <AnimatePresence>
        {editingIssuance && (
          <motion.div
            key="editing-issuance-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <motion.div
              key="editing-issuance-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-lg w-full space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Edit className="h-4 w-4 text-indigo-600" /> Edit Registered Issuance ({editingIssuance.id})
                  </h4>
                  <p className="text-[11px] text-slate-500">Super Admin Record Overwrite</p>
                </div>
                <button 
                  onClick={() => setEditingIssuance(null)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Requisition Number</label>
                  <input 
                    type="text" 
                    value={editingIssuance.requisitionNumber}
                    onChange={e => setEditingIssuance({ ...editingIssuance, requisitionNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Date Issued</label>
                  <input 
                    type="date" 
                    value={editingIssuance.date}
                    onChange={e => setEditingIssuance({ ...editingIssuance, date: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Department</label>
                  <input 
                    type="text" 
                    value={editingIssuance.department}
                    onChange={e => setEditingIssuance({ ...editingIssuance, department: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Part Code</label>
                  <input 
                    type="text" 
                    value={editingIssuance.partCode}
                    onChange={e => setEditingIssuance({ ...editingIssuance, partCode: e.target.value.toUpperCase() })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Description</label>
                  <input 
                    type="text" 
                    value={editingIssuance.description}
                    onChange={e => setEditingIssuance({ ...editingIssuance, description: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Quantity Requested</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editingIssuance.quantityRequested || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const sanitized = e.target.value.replace(/\D/g, '');
                      setEditingIssuance({ ...editingIssuance, quantityRequested: sanitized ? parseInt(sanitized, 10) : 0 });
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Quantity Issued</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editingIssuance.quantityIssued || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const sanitized = e.target.value.replace(/\D/g, '');
                      setEditingIssuance({ ...editingIssuance, quantityIssued: sanitized ? parseInt(sanitized, 10) : 0 });
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Lot Number</label>
                  <input 
                    type="text" 
                    value={editingIssuance.lotNumber}
                    onChange={e => setEditingIssuance({ ...editingIssuance, lotNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Issued By</label>
                  <input 
                    type="text" 
                    value={editingIssuance.issuedBy}
                    onChange={e => setEditingIssuance({ ...editingIssuance, issuedBy: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Received By</label>
                  <input 
                    type="text" 
                    value={editingIssuance.receivedBy}
                    onChange={e => setEditingIssuance({ ...editingIssuance, receivedBy: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  onClick={() => setEditingIssuance(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    onEditIssuance?.(editingIssuance);
                    setEditingIssuance(null);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold"
                >
                  Save Issuance Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Barcode / QR Code Scanner Modal */}
      <BarcodeScannerModal 
        isOpen={showScannerModal}
        onClose={() => setShowScannerModal(false)}
        onScanResult={handleScanResult}
        title="Issuance Material Barcode Scanner"
        subtitle="Use handheld barcode scanner or enter barcode manually"
      />

      {/* Printable Requisition & Picking List Modal */}
      {selectedPickingDocIssuance && (
        <PrintablePickingListModal
          issuance={selectedPickingDocIssuance}
          issuancesList={filteredIssuances}
          stocks={stocks}
          registries={registries}
          initialView={printInitialView}
          onClose={() => setSelectedPickingDocIssuance(null)}
        />
      )}

      {/* Confirmation Modal with YES / NO options */}
      <ConfirmModal config={confirmAction} onClose={() => setConfirmAction(null)} />
    </div>
  );
}
