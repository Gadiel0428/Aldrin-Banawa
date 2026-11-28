/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Plus, 
  Search, 
  FileSpreadsheet, 
  ShieldAlert, 
  ShieldCheck, 
  CheckCircle2, 
  User, 
  CornerDownRight,
  Edit,
  ScanLine,
  Printer,
  ChevronDown,
  ChevronRight,
  PackageCheck,
  ClipboardList,
  Tag,
  Check
} from 'lucide-react';
import { MaterialStockItem, IssuanceRecord, MasterRegistryItem } from '../types';
import BarcodeScannerModal, { ScannedItemPreview } from './BarcodeScannerModal';
import PrintablePickingListModal, { DocViewMode } from './PrintablePickingListModal';
import { ExportMenu } from './ExportMenu';
import { showPrintToast } from '../utils/printDocument';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';
import { motion, AnimatePresence } from 'motion/react';
import { generateAuthoritativeId } from '../lib/idGenerator';
import { verifyCentralCredentials } from '../lib/centralApi';
import {
  MISSING_UNIT_LABEL,
  formatNumberForUnit,
  getAllSelectUomOptions,
  normalizeUnitCode,
  resolveMasterDataUnit,
} from '../../shared/units';
import { validateIssuanceRecord } from '../../shared/validation';
import { getFifoEligibleLots, checkFifoSelectionCompliance } from '../../shared/fifoAllocation';
import { getManilaTodayString } from '../lib/businessDate';
import { useI18n } from '../i18n';

interface IssuanceModuleProps {
  stocks: MaterialStockItem[];
  issuances: IssuanceRecord[];
  onAddIssuance: (record: IssuanceRecord) => void;
  onDeductStock: (partCode: string, lotNumber: string, quantity: number) => boolean;
  onEditIssuance?: (record: IssuanceRecord) => void;
  onDeleteIssuance?: (id: string) => void;
  isSuperAdmin?: boolean;
  canEdit?: boolean;
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
  canEdit = false,
  registries = [],
  currentUser = ''
}: IssuanceModuleProps) {
  const { t, localizeValidation } = useI18n();
  const effectiveCanEdit = canEdit || isSuperAdmin;
  const [searchQuery, setSearchQuery] = useState('');
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [confirmedScanInfo, setConfirmedScanInfo] = useState<ScannedItemPreview | null>(null);
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
  const [quantityRequestedInput, setQuantityRequestedInput] = useState<string>(
    initialIssuanceDraft?.quantityRequested !== undefined && initialIssuanceDraft?.quantityRequested !== 0
      ? String(initialIssuanceDraft.quantityRequested)
      : ''
  );
  const [quantityIssued, setQuantityIssued] = useState<number>(initialIssuanceDraft?.quantityIssued || 0);
  const [quantityIssuedInput, setQuantityIssuedInput] = useState<string>(
    initialIssuanceDraft?.quantityIssued !== undefined && initialIssuanceDraft?.quantityIssued !== 0
      ? String(initialIssuanceDraft.quantityIssued)
      : ''
  );
  const [issuedBy, setIssuedBy] = useState(initialIssuanceDraft?.issuedBy || (currentUser || 'Warehouse Staff'));
  const [receivedBy, setReceivedBy] = useState(initialIssuanceDraft?.receivedBy || '');
  const [issuanceFieldErrors, setIssuanceFieldErrors] = useState<Record<string, string>>({});
  const [editIssuanceFieldErrors, setEditIssuanceFieldErrors] = useState<Record<string, string>>({});
  const [editQtyRequestedInput, setEditQtyRequestedInput] = useState<string>('');
  const [editQtyIssuedInput, setEditQtyIssuedInput] = useState<string>('');

  const clearIssErr = (field: string) => {
    setIssuanceFieldErrors(prev => {
      if (!prev[field]) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const clearEditIssErr = (field: string) => {
    setEditIssuanceFieldErrors(prev => {
      if (!prev[field]) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  };

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
    setQuantityRequestedInput('');
    setQuantityIssued(0);
    setQuantityIssuedInput('');
    setReceivedBy('');
    setConfirmedScanInfo(null);
    setIssuanceFieldErrors({});
    setShowForm(false);
  };

  // Derived states for stocks and FIFO checks
  const approvedStocks = stocks.filter(item => item.status === 'APPROVED' && item.quantity > 0);
  const uniquePartCodes = Array.from(new Set(approvedStocks.map(item => item.partCode)));

  const [availableLots, setAvailableLots] = useState<MaterialStockItem[]>([]);
  const [fifoAlert, setFifoAlert] = useState<string | null>(null);
  const [newerLotReason, setNewerLotReason] = useState<string>('');
  const [superAdminApproved, setSuperAdminApproved] = useState<boolean>(isSuperAdmin);
  const [adminEmpId, setAdminEmpId] = useState<string>('JPMP-002');
  const [adminPin, setAdminPin] = useState<string>('');
  const [adminVerifyMsg, setAdminVerifyMsg] = useState<string | null>(null);

  const FIXED_FIFO_REASONS = [
    'Lot Damaged',
    'Customer Request',
    'Lot Segregated',
    'Production Urgency',
    'Quality Hold on Older Lot'
  ];

  const resolveIssuanceScanDetails = (scannedCode: string): ScannedItemPreview => {
    const cleanCode = scannedCode.trim();
    const lower = cleanCode.toLowerCase();

    const matchedStock =
      approvedStocks.find(s => (s.lotNumber || '').trim().toLowerCase() === lower) ||
      approvedStocks.find(s => (s.partCode || '').trim().toLowerCase() === lower) ||
      stocks.find(s => (s.lotNumber || '').trim().toLowerCase() === lower) ||
      stocks.find(s => (s.partCode || '').trim().toLowerCase() === lower);

    const matchedRegistry = registries.find(
      r => (r.code || '').trim().toLowerCase() === lower ||
           (r.name || '').trim().toLowerCase() === lower ||
           (r.id || '').trim().toLowerCase() === lower
    );

    if (matchedStock) {
      const stockUnit = resolveMasterDataUnit(matchedStock, registries);
      return {
        code: cleanCode,
        itemName: matchedStock.description || matchedStock.partCode,
        lot: matchedStock.lotNumber || t('common.na'),
        location: matchedStock.location || t('common.na'),
        partCode: matchedStock.partCode,
        quantityLabel: `${formatNumberForUnit(matchedStock.quantity)} ${stockUnit.unit || MISSING_UNIT_LABEL}`,
        matchedSource: 'STOCK'
      };
    }

    if (matchedRegistry) {
      return {
        code: cleanCode,
        itemName: matchedRegistry.name || matchedRegistry.description || matchedRegistry.code,
        lot: t('common.na'),
        location: matchedRegistry.location || t('common.na'),
        partCode: matchedRegistry.code,
        category: matchedRegistry.category,
        matchedSource: 'REGISTRY'
      };
    }

    return {
      code: cleanCode,
      itemName: `${cleanCode}`,
      lot: t('common.na'),
      location: t('common.na'),
      partCode: cleanCode.toUpperCase(),
      matchedSource: 'UNMATCHED'
    };
  };

  // Handle scanned barcode / QR code result (called after operator taps Confirm)
  const handleScanResult = (scannedCode: string) => {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    setConfirmedScanInfo(resolveIssuanceScanDetails(cleanCode));

    // Search approved stocks first, then all stocks for matching part code or lot number
    const matchedLot =
      approvedStocks.find(s => (s.lotNumber || '').toLowerCase() === cleanCode.toLowerCase()) ||
      stocks.find(s => (s.lotNumber || '').toLowerCase() === cleanCode.toLowerCase());
    const matchedPart =
      approvedStocks.find(s => (s.partCode || '').toLowerCase() === cleanCode.toLowerCase()) ||
      stocks.find(s => (s.partCode || '').toLowerCase() === cleanCode.toLowerCase());
    const matchedUniqueCode = uniquePartCodes.find(c => (c || '').toLowerCase() === cleanCode.toLowerCase());

    if (matchedLot) {
      setSelectedPartCode(matchedLot.partCode);
      setSelectedLotNumber(matchedLot.lotNumber);
      setShowForm(true);
    } else if (matchedPart) {
      setSelectedPartCode(matchedPart.partCode);
      setShowForm(true);
    } else if (matchedUniqueCode) {
      setSelectedPartCode(matchedUniqueCode);
      setShowForm(true);
    } else {
      setSelectedPartCode(cleanCode.toUpperCase());
      setShowForm(true);
    }
  };

  // Update available lots when part code changes, sorted by receivedDate ascending (oldest first)
  useEffect(() => {
    if (selectedPartCode) {
      const lots = getFifoEligibleLots(stocks, selectedPartCode);

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

  const fifoCompliance = checkFifoSelectionCompliance(availableLots, selectedLotNumber);
  const oldestLot = fifoCompliance.oldestLot;
  const isNewerLotSelected = fifoCompliance.isNewerLotSelected;

  useEffect(() => {
    if (!isNewerLotSelected) {
      setNewerLotReason('');
      setSuperAdminApproved(isSuperAdmin);
      setAdminPin('');
      setAdminVerifyMsg(null);
    } else if (isSuperAdmin) {
      setSuperAdminApproved(true);
    }
  }, [isNewerLotSelected, isSuperAdmin]);

  // FIFO validation checks: scan all approved lots of the part code to see if an older lot is ignored
  useEffect(() => {
    if (selectedPartCode && selectedLotNumber && fifoCompliance.olderAvailableLots.length > 0) {
      const oldestLotItem = fifoCompliance.olderAvailableLots[0];
      setFifoAlert(
        t('issuance.fifoAlertTemplate', {
          lot: `${oldestLotItem.lotNumber} (${oldestLotItem.receivedDate})`,
          location: oldestLotItem.location || t('common.na')
        })
      );
    } else {
      setFifoAlert(null);
    }
  }, [selectedLotNumber, selectedPartCode, availableLots, t]);

  // Auto-fill quantity issued when requested changes
  const handleQtyRequestChange = (rawVal: string) => {
    const cleaned = rawVal.replace(/[^0-9.-]/g, '');
    setQuantityRequestedInput(cleaned);
    setQuantityIssuedInput(cleaned);
    const num = Number(cleaned);
    const parsed = cleaned.trim() === '' || Number.isNaN(num) ? 0 : num;
    setQuantityRequested(parsed);
    setQuantityIssued(parsed); // Default matching
    clearIssErr('quantityRequested');
    clearIssErr('quantityIssued');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const selectedItem = approvedStocks.find(
      item => item.partCode === selectedPartCode && item.lotNumber === selectedLotNumber
    );
    const itemDesc = selectedItem ? selectedItem.description : 'Unknown Item';
    const resolvedUnit = resolveMasterDataUnit(
      { unit: selectedItem?.unit, partCode: selectedPartCode, description: itemDesc, lotNumber: selectedLotNumber },
      registries,
      stocks
    );

    const rawReq = quantityRequestedInput.trim() === '' ? NaN : Number(quantityRequestedInput.trim());
    const rawIss = quantityIssuedInput.trim() === '' ? NaN : Number(quantityIssuedInput.trim());
    const numericReq = Number.isNaN(rawReq) ? 0 : rawReq;
    const numericIss = Number.isNaN(rawIss) ? 0 : rawIss;

    const newIssuance: IssuanceRecord = {
      id: generateAuthoritativeId('ISS'),
      date: getManilaTodayString(),
      requisitionNumber: requisitionNumber.trim(),
      department,
      partCode: selectedPartCode,
      description: itemDesc,
      quantityRequested: numericReq,
      quantityIssued: numericIss,
      unit: resolvedUnit.unit,
      unitMissing: resolvedUnit.isMissing,
      lotNumber: selectedLotNumber,
      fifoVerified: !isNewerLotSelected,
      issuedBy: issuedBy.trim(),
      receivedBy: receivedBy.trim(),
      ...(isNewerLotSelected ? {
        overrideReason: newerLotReason,
        superAdminApproved: true,
        superAdminApprover: isSuperAdmin ? currentUser : (adminEmpId || 'JPMP-002')
      } : {})
    };

    const validation = validateIssuanceRecord(
      {
        ...newIssuance,
        quantityRequested: quantityRequestedInput.trim() === '' ? '' : rawReq,
        quantityIssued: quantityIssuedInput.trim() === '' ? '' : rawIss,
      } as any,
      {
        requireOperationalFields: true,
        availableLotQty: selectedItem ? selectedItem.quantity : undefined,
        isNewerLotSelected,
        superAdminApproved,
      }
    );

    const extraErrors: Record<string, string> = { ...validation.fieldErrors };
    if (!issuedBy.trim()) {
      extraErrors.issuedBy = t('issuance.issuedByRequiredErr');
    }

    if (Object.keys(extraErrors).length > 0) {
      setIssuanceFieldErrors(extraErrors);
      const firstErr = Object.values(extraErrors)[0] || t('delivery.fixValidation');
      showPrintToast(localizeValidation(firstErr), 'warning');
      return;
    }

    // Attempt to deduct the inventory
    const success = onDeductStock(selectedPartCode, selectedLotNumber, numericIss);
    if (!success) {
      setIssuanceFieldErrors({
        quantityIssued: t('issuance.insufficientStockError')
      });
      showPrintToast(t('issuance.insufficientStockError'), 'error');
      return;
    }

    setIssuanceFieldErrors({});
    onAddIssuance(newIssuance);
    clearIssuanceDraft();

    // Reset
    setRequisitionNumber('');
    setSelectedPartCode('');
    setSelectedLotNumber('');
    setQuantityRequested(0);
    setQuantityRequestedInput('');
    setQuantityIssued(0);
    setQuantityIssuedInput('');
    setReceivedBy('');
    setNewerLotReason('');
    setSuperAdminApproved(isSuperAdmin);
    setAdminPin('');
    setAdminVerifyMsg(null);
    setConfirmedScanInfo(null);
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
              {t('issuance.bannerBadge')}
            </span>
            <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block" /> {t('issuance.authorizedBadge')}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">{t('issuance.title')}</h2>
          <p className="text-xs text-slate-300 mt-1">
            {t('issuance.subtitle')}
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
              <ScanLine className="h-4 w-4" /> {t('issuance.scanBtn')}
            </button>

            <ExportMenu
              id="btn-issuance-export-menu"
              variant="indigo"
              menuAlign="left"
              items={[
                {
                  id: 'btn-print-active-mrs',
                  label: t('issuance.printPickingBtn'),
                  title: t('issuance.printMrsTooltip'),
                  icon: <Printer className="h-3.5 w-3.5 text-indigo-600" />,
                  onClick: () => {
                    const target = filteredIssuances[0] || issuances[0];
                    if (target) {
                      setPrintInitialView('OFFICIAL_DOC');
                      setSelectedPickingDocIssuance(target);
                    } else {
                      showPrintToast(t('issuance.noRecordsToPrint'), 'warning');
                    }
                  },
                },
                {
                  id: 'btn-print-issuance-log',
                  label: t('issuance.printSummaryBtn'),
                  title: t('issuance.printSummaryTooltip'),
                  icon: <Printer className="h-3.5 w-3.5 text-slate-600" />,
                  onClick: () => {
                    if (filteredIssuances.length > 0 || issuances.length > 0) {
                      setPrintInitialView('SUMMARY_LOG');
                      setSelectedPickingDocIssuance(filteredIssuances[0] || issuances[0]);
                    } else {
                      showPrintToast(t('issuance.noSummaryToPrint'), 'warning');
                    }
                  },
                },
              ]}
            />
          </div>

          <div className="flex items-center sm:ml-auto shrink-0">
            {effectiveCanEdit ? (
              <button 
                onClick={() => setShowForm(!showForm)}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
                id="btn-new-requisition"
              >
                <Plus className="h-4 w-4" /> {t('issuance.processReqBtn')}
              </button>
            ) : (
              <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 rounded-lg font-bold uppercase shrink-0 whitespace-nowrap">
                {t('issuance.viewOnlyBadge')}
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
            placeholder={t('issuance.searchPlaceholder')} 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none bg-slate-50/50"
          />
        </div>
      </div>

      {/* Issuance form */}
      {showForm && (
        <form 
          noValidate
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6"
          id="issuance-form"
        >
          <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <FileSpreadsheet className="h-4 w-4 text-slate-500" /> {t('issuance.formTitle')}
              </h3>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" /> {t('receiving.autoSavedDraft')}
              </span>
            </div>
            <button 
              type="button" 
              onClick={handleDiscardIssuance} 
              className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              {t('common.cancel')}
            </button>
          </div>

          {confirmedScanInfo && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1.5 font-bold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  {t('receiving.scanConfirmed')}
                </span>
                <span><strong>{t('issuance.scanItemLabel')}</strong> {confirmedScanInfo.itemName}</span>
                <span className="font-mono"><strong>{t('issuance.scanLotLabel')}</strong> {confirmedScanInfo.lot}</span>
                <span><strong>{t('issuance.scanLocLabel')}</strong> {confirmedScanInfo.location}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">{t('issuance.requisitionLabel')}</label>
              <input 
                type="text"
                required
                placeholder={t('issuance.requisitionPlaceholder')}
                value={requisitionNumber}
                onChange={e => {
                  setRequisitionNumber(e.target.value);
                  clearIssErr('requisitionNumber');
                }}
                className={`w-full px-3 py-2 border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 ${
                  issuanceFieldErrors.requisitionNumber
                    ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                    : 'border-slate-200 focus:ring-slate-400'
                }`}
              />
              {issuanceFieldErrors.requisitionNumber && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                  {localizeValidation(issuanceFieldErrors.requisitionNumber)}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">{t('issuance.departmentLabel')}</label>
              <select 
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="Injection Molding Dept">{t('issuance.deptInjection')}</option>
                <option value="Printing & Assembly Dept">{t('issuance.deptPrinting')}</option>
                <option value="Production Control Line A">{t('issuance.deptProdLineA')}</option>
                <option value="PMC Dept">{t('issuance.deptPmc')}</option>
                <option value="Packaging Section B">{t('issuance.deptPackagingB')}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">{t('issuance.partCodeLabel')}</label>
              <select 
                value={selectedPartCode}
                onChange={e => {
                  setSelectedPartCode(e.target.value);
                  clearIssErr('partCode');
                  clearIssErr('lotNumber');
                }}
                required
                className={`w-full px-3 py-2 border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 ${
                  issuanceFieldErrors.partCode
                    ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                    : 'border-slate-200 focus:ring-slate-400'
                }`}
              >
                <option value="">{t('issuance.selectPartPlaceholder')}</option>
                {uniquePartCodes.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
              {issuanceFieldErrors.partCode && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                  {localizeValidation(issuanceFieldErrors.partCode)}
                </p>
              )}
            </div>
          </div>

          {selectedPartCode && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-4">
              <h4 className="text-xs font-bold text-slate-700">{t('issuance.lotCheckHeader')}</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">{t('issuance.lotLabel')}</label>
                  <select 
                    value={selectedLotNumber}
                    onChange={e => {
                      setSelectedLotNumber(e.target.value);
                      clearIssErr('lotNumber');
                    }}
                    required
                    className={`w-full px-3 py-2 border rounded-lg text-xs font-mono bg-white focus:outline-none ${
                      issuanceFieldErrors.lotNumber
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  >
                    {availableLots.map(lot => {
                      const lotUnit = resolveMasterDataUnit(lot, registries).unit || MISSING_UNIT_LABEL;
                      return (
                        <option key={lot.id} value={lot.lotNumber}>
                          {lot.lotNumber} ({formatNumberForUnit(lot.quantity)} {lotUnit} {t('issuance.availableQtyLabel')})
                        </option>
                      );
                    })}
                  </select>
                  {issuanceFieldErrors.lotNumber && (
                    <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(issuanceFieldErrors.lotNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">{t('issuance.qtyRequestedLabel')}</label>
                  <input 
                    type="text"
                    inputMode="decimal"
                    required
                    placeholder={t('issuance.qtyReqPlaceholder')}
                    value={quantityRequestedInput}
                    onChange={e => handleQtyRequestChange(e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg text-xs bg-white font-mono focus:outline-none ${
                      issuanceFieldErrors.quantityRequested
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  />
                  {issuanceFieldErrors.quantityRequested && (
                    <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(issuanceFieldErrors.quantityRequested)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">{t('issuance.qtyIssuedLabel')}</label>
                  <input 
                    type="text"
                    inputMode="decimal"
                    required
                    placeholder={t('issuance.qtyIssuedPlaceholder')}
                    value={quantityIssuedInput}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.-]/g, '');
                      setQuantityIssuedInput(raw);
                      const num = Number(raw);
                      setQuantityIssued(raw.trim() === '' || Number.isNaN(num) ? 0 : num);
                      clearIssErr('quantityIssued');
                    }}
                    className={`w-full px-3 py-2 border rounded-lg text-xs bg-white font-mono focus:outline-none ${
                      issuanceFieldErrors.quantityIssued
                        ? 'border-rose-500 ring-1 ring-rose-500'
                        : 'border-slate-200'
                    }`}
                  />
                  {issuanceFieldErrors.quantityIssued && (
                    <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(issuanceFieldErrors.quantityIssued)}
                    </p>
                  )}
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
                  <span><strong>{t('issuance.sopComplianceSuccessTitle')}:</strong> {t('issuance.sopComplianceSuccessDesc')}</span>
                </div>
              )}

              {isNewerLotSelected && (
                <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-3 mt-3">
                  <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                    <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>{t('issuance.newerLotWarningTitle', { lot: oldestLot?.lotNumber || '' })}</span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">{t('issuance.overrideReasonLabel')}</label>
                    <select
                      value={newerLotReason}
                      onChange={e => {
                        setNewerLotReason(e.target.value);
                        clearIssErr('overrideReason');
                      }}
                      required
                      className={`w-full px-3 py-2 border bg-white rounded-lg text-xs font-medium focus:outline-none ${
                        issuanceFieldErrors.overrideReason
                          ? 'border-rose-500 ring-1 ring-rose-500'
                          : 'border-amber-300'
                      }`}
                    >
                      <option value="">{t('issuance.selectOverrideReason')}</option>
                      {FIXED_FIFO_REASONS.map(r => (
                        <option key={r} value={r}>
                          {r === 'Lot Damaged' ? t('issuance.reasonDamaged')
                            : r === 'Customer Request' ? t('issuance.reasonCustomerRequest')
                            : r === 'Lot Segregated' ? t('issuance.reasonSegregated')
                            : r === 'Production Urgency' ? t('issuance.reasonProductionUrgency')
                            : r === 'Quality Hold on Older Lot' ? t('issuance.reasonQualityHold')
                            : r}
                        </option>
                      ))}
                    </select>
                    {issuanceFieldErrors.overrideReason && (
                      <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                        {localizeValidation(issuanceFieldErrors.overrideReason)}
                      </p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-amber-200">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">{t('issuance.superAdminApproverLabel')}</label>
                    {isSuperAdmin ? (
                      <label className="flex items-center gap-2 text-xs font-semibold text-emerald-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={superAdminApproved}
                          onChange={e => {
                            setSuperAdminApproved(e.target.checked);
                            clearIssErr('superAdminApproved');
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                        />
                        <span>{t('issuance.approveOverrideCheckbox', { user: currentUser || t('issuance.superAdminFallback') })}</span>
                      </label>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder={t('issuance.superAdminIdPlaceholder')}
                            value={adminEmpId}
                            onChange={e => setAdminEmpId(e.target.value)}
                            className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                          />
                          <input
                            type="password"
                            placeholder={t('issuance.superAdminPinLabel')}
                            value={adminPin}
                            onChange={e => setAdminPin(e.target.value)}
                            className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              if (!adminEmpId || !adminPin) {
                                setAdminVerifyMsg(t('issuance.verifyEnterAdminErr'));
                                return;
                              }
                              try {
                                const verifiedUser = await verifyCentralCredentials(adminEmpId, adminPin);
                                if (verifiedUser && (verifiedUser.role?.toUpperCase().includes('SUPER') || verifiedUser.role?.toUpperCase().includes('ADMIN') || verifiedUser.employeeId === 'JPMP-002')) {
                                  setSuperAdminApproved(true);
                                  clearIssErr('superAdminApproved');
                                  setAdminVerifyMsg(t('issuance.verifyAdminSuccess'));
                                } else {
                                  setSuperAdminApproved(false);
                                  setAdminVerifyMsg(t('issuance.verifyAdminInvalid'));
                                }
                              } catch (err) {
                                setSuperAdminApproved(false);
                                setAdminVerifyMsg(t('issuance.verifyAdminErr'));
                              }
                            }}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer"
                          >
                            {t('issuance.verifyAdminBtn')}
                          </button>
                        </div>
                        {adminVerifyMsg && (
                          <p className={`text-[11px] font-mono ${superAdminApproved ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {adminVerifyMsg}
                          </p>
                        )}
                      </div>
                    )}
                    {issuanceFieldErrors.superAdminApproved && (
                      <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                        {localizeValidation(issuanceFieldErrors.superAdminApproved)}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">{t('issuance.issuedByLabel')}</label>
              <input 
                type="text"
                required
                value={issuedBy}
                onChange={e => {
                  setIssuedBy(e.target.value);
                  clearIssErr('issuedBy');
                }}
                className={`w-full px-3 py-2 border rounded-lg text-xs ${
                  issuanceFieldErrors.issuedBy
                    ? 'border-rose-500 ring-1 ring-rose-500'
                    : 'border-slate-200'
                }`}
              />
              {issuanceFieldErrors.issuedBy && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                  {localizeValidation(issuanceFieldErrors.issuedBy)}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">{t('issuance.receivedByLabel')}</label>
              <input 
                type="text"
                required
                placeholder={t('issuance.receivedByPlaceholder')}
                value={receivedBy}
                onChange={e => {
                  setReceivedBy(e.target.value);
                  clearIssErr('receivedBy');
                }}
                className={`w-full px-3 py-2 border rounded-lg text-xs focus:ring-1 focus:outline-none ${
                  issuanceFieldErrors.receivedBy
                    ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                    : 'border-slate-200 focus:ring-slate-400'
                }`}
              />
              {issuanceFieldErrors.receivedBy && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                  {localizeValidation(issuanceFieldErrors.receivedBy)}
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-1.5 pt-2">
            <button 
              type="button" 
              onClick={handleDiscardIssuance} 
              className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              {t('receiving.discardBtn')}
            </button>
            <button 
              type="submit" 
              className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              {t('issuance.submitBtn')}
            </button>
          </div>
        </form>
      )}

      {/* Issuances Logs Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="issuance-grid-panel">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{t('issuance.logHistoryTitle')}</span>
          <span className="text-xs font-mono text-slate-500 font-semibold">{t('issuance.issuancesLogged', { count: filteredIssuances.length })}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-500 font-medium border-b border-slate-200">
                <th className="p-4 font-semibold">{t('issuance.colIssuanceId')}</th>
                <th className="p-4 font-semibold">{t('issuance.colDateIssued')}</th>
                <th className="p-4 font-semibold">{t('issuance.colRequisition')}</th>
                <th className="p-4 font-semibold">{t('issuance.colDepartment')}</th>
                <th className="p-4 font-semibold">{t('issuance.colMaterialDesc')}</th>
                <th className="p-4 font-semibold text-right">{t('issuance.colQtyIssued')}</th>
                <th className="p-4 font-semibold">{t('issuance.colLotIssued')}</th>
                <th className="p-4 font-semibold">{t('issuance.colFifoAudit')}</th>
                <th className="p-4 font-semibold">{t('issuance.colSignatures')}</th>
                <th className="p-4 font-semibold">{t('issuance.colAction')}</th>
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
                const issUnitRes = resolveMasterDataUnit(
                  { unit: iss.unit, partCode: iss.partCode, description: iss.description, lotNumber: iss.lotNumber },
                  registries,
                  stocks
                );
                const matchedStockUnitRes = matchedStock
                  ? resolveMasterDataUnit(matchedStock, registries)
                  : null;

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
                      title={t('issuance.rowExpandTooltip')}
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
                            title={isExpanded ? t('issuance.collapseRowTitle') : t('issuance.expandRowTitle')}
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
                          title={t('issuance.printMrsRowTitle')}
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
                        <span>{formatNumberForUnit(iss.quantityIssued)}</span>{' '}
                        {issUnitRes.isMissing ? (
                          <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 text-[9px] font-bold">
                            {MISSING_UNIT_LABEL}
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-slate-600">{issUnitRes.unit}</span>
                        )}
                      </td>
                      <td className="p-4 font-mono text-slate-700">{iss.lotNumber}</td>
                      <td className="p-4">
                        {iss.fifoVerified ? (
                          <span className="text-emerald-600 font-semibold flex items-center gap-1">
                            <ShieldCheck className="h-4 w-4" /> {t('issuance.passedFifo')}
                          </span>
                        ) : (
                          <span className="text-amber-600 font-semibold flex items-center gap-1" title={t('issuance.overrideOrderTitle')}>
                            <ShieldAlert className="h-4 w-4" /> {t('issuance.overrideWarning')}
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-slate-600 space-y-0.5">
                        <div className="flex items-center gap-1"><User className="h-3 w-3 text-slate-400" /> <span className="text-[10px]">{t('issuance.staffPrefix')}</span> {iss.issuedBy}</div>
                        <div className="flex items-center gap-1"><CornerDownRight className="h-3 w-3 text-slate-400" /> <span className="text-[10px]">{t('issuance.recvPrefix')}</span> {iss.receivedBy}</div>
                      </td>
                      <td className="p-4" data-no-expand="true">
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
                            } else if (val === 'EDIT') {
                              if (!effectiveCanEdit) return;
                              setEditIssuanceFieldErrors({});
                              setEditQtyRequestedInput(String(iss.quantityRequested ?? ''));
                              setEditQtyIssuedInput(String(iss.quantityIssued ?? ''));
                              setEditingIssuance({ ...iss });
                            } else if (val === 'DELETE') {
                              if (!isSuperAdmin) return;
                              setConfirmAction({
                                title: t('issuance.deleteTitle'),
                                message: t('issuance.deleteMsg', { id: iss.id, requisitionNumber: iss.requisitionNumber }),
                                confirmLabel: t('issuance.confirmYesDelete'),
                                confirmVariant: 'danger',
                                onConfirm: () => onDeleteIssuance?.(iss.id)
                              });
                            }
                            e.target.value = '';
                          }}
                          className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                          id={`action-select-iss-${iss.id}`}
                        >
                          <option value="" disabled>{t('issuance.actionsPlaceholder')}</option>
                          <option value="PRINT_MRS">📄 {t('issuance.actionPrintMrs')}</option>
                          <option value="PRINT_PL">📋 {t('issuance.actionPrintPickList')}</option>
                          {effectiveCanEdit && (
                            <option value="EDIT">📝 {t('issuance.actionEditRecord')}</option>
                          )}
                          {isSuperAdmin && (
                            <option value="DELETE">🗑️ {t('issuance.actionDeleteRecord')}</option>
                          )}
                        </select>
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
                                          {t('issuance.reqColon')} <span className="font-mono text-indigo-600">{iss.requisitionNumber}</span>
                                        </span>
                                        <span className="font-mono text-xs text-slate-400">({iss.id})</span>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                          iss.fifoVerified 
                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                                        }`}>
                                          {iss.fifoVerified ? t('issuance.fifoCompliantBadge') : t('issuance.overrideAuditBadge')}
                                        </span>
                                      </div>
                                      <p className="text-xs text-slate-500 mt-0.5">
                                        {t('issuance.targetColon')} <strong className="text-slate-700">{iss.department}</strong> &bull; {t('issuance.partColon')} <strong className="font-mono text-slate-700">{iss.partCode}</strong> - {iss.description}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="bg-slate-100 text-slate-700 font-mono font-semibold px-2.5 py-1 rounded-lg border border-slate-200">
                                      {t('issuance.dateColon')} {iss.date}
                                    </span>
                                    <span className={`font-bold px-2.5 py-1 rounded-lg border font-mono ${
                                      issUnitRes.isMissing
                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                        : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                    }`}>
                                      {t('issuance.issuedColon')} {formatNumberForUnit(iss.quantityIssued)} {issUnitRes.isMissing ? MISSING_UNIT_LABEL : issUnitRes.unit}
                                    </span>
                                    {matchedStock && matchedStockUnitRes && (
                                      <span className="bg-emerald-50 text-emerald-800 font-bold px-2.5 py-1 rounded-lg border border-emerald-200 font-mono">
                                        {t('issuance.currentStockColon')} {formatNumberForUnit(matchedStock.quantity)} {matchedStockUnitRes.isMissing ? MISSING_UNIT_LABEL : matchedStockUnitRes.unit}
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
                                      <span>{t('issuance.cardMaterialWhTitle')}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                      <div>
                                        <span className="text-slate-400 text-[11px] block">{t('issuance.cardPartCode')}</span>
                                        <span className="font-mono font-bold text-slate-800">{iss.partCode}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400 text-[11px] block">{t('issuance.cardCategory')}</span>
                                        <span className="font-semibold text-indigo-700">{registryItem?.category || t('issuance.cardProdMaterial')}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400 text-[11px] block">{t('issuance.cardBatchLot')}</span>
                                        <span className="font-mono font-bold text-slate-800">{iss.lotNumber}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400 text-[11px] block">{t('issuance.cardBinLocation')}</span>
                                        <span className="font-mono font-semibold text-slate-800">{matchedStock?.location || t('issuance.cardStdBay')}</span>
                                      </div>
                                      <div className="col-span-2 pt-1 border-t border-slate-100 flex justify-between items-center text-slate-500 text-[11px]">
                                        <span>{t('issuance.cardUom')}</span>
                                        {issUnitRes.isMissing ? (
                                          <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold">
                                            {MISSING_UNIT_LABEL}
                                          </span>
                                        ) : (
                                          <span className="font-mono font-bold text-slate-700">{issUnitRes.unit}</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Col 2: FIFO Compliance & SOP Verification */}
                                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                      <span>{t('issuance.cardFifoSopTitle')}</span>
                                    </div>
                                    <div className="space-y-2 text-xs">
                                      <div>
                                        <span className="text-slate-400 text-[11px] block">{t('issuance.cardFifoStatus')}</span>
                                        <div className="mt-0.5">
                                          {iss.fifoVerified ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                              <Check className="h-3 w-3" /> {t('issuance.cardStrictFifoOk')}
                                            </span>
                                          ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">
                                              <ShieldAlert className="h-3 w-3" /> {t('issuance.cardManualOverride')}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="bg-slate-50 p-2 rounded-lg border border-slate-150 text-[11px] text-slate-600 space-y-1">
                                        <div className="flex justify-between">
                                          <span>{t('issuance.cardStockAllocation')}</span>
                                          <strong className="text-slate-800">{t('issuance.cardDeductedInv')}</strong>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>{t('issuance.cardReqPurpose')}</span>
                                          <strong className="text-slate-800">{iss.department} · {t('issuance.cardDeptOps')}</strong>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Col 3: Signatures & Quick Print Actions */}
                                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                      <FileSpreadsheet className="h-4 w-4 text-purple-500" />
                                      <span>{t('issuance.cardSignDocsTitle')}</span>
                                    </div>

                                    <div className="space-y-2 text-xs">
                                      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded-lg border border-slate-150">
                                        <div>
                                          <span className="text-slate-400 text-[10px] block">{t('issuance.cardIssuedByWh')}</span>
                                          <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                                            <User className="h-3 w-3 text-slate-400" /> {iss.issuedBy}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-slate-400 text-[10px] block">{t('issuance.cardReceivedByProd')}</span>
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
                                          <Printer className="h-3 w-3" /> {t('issuance.cardBtnReqSlip')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setPrintInitialView('PICKING_LIST');
                                            setSelectedPickingDocIssuance(iss);
                                          }}
                                          className="flex-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-slate-200 flex items-center justify-center gap-1 shadow-2xs"
                                        >
                                          <ClipboardList className="h-3 w-3" /> {t('issuance.cardBtnPickList')}
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
      {typeof document !== 'undefined' && editingIssuance && createPortal(
        <AnimatePresence>
          <motion.div
            key="editing-issuance-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-[100] overflow-y-auto"
          >
            <motion.div
              key="editing-issuance-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full space-y-4 max-h-[calc(100vh-2rem)] my-auto overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Edit className="h-4 w-4 text-indigo-600" /> {t('issuance.editModalTitle', { id: editingIssuance.id })}
                  </h4>
                  <p className="text-[11px] text-slate-500">{t('issuance.editSubtitle')}</p>
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
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.editReqNumLabel')}</label>
                  <input 
                    type="text" 
                    value={editingIssuance.requisitionNumber}
                    onChange={e => {
                      setEditingIssuance({ ...editingIssuance, requisitionNumber: e.target.value });
                      clearEditIssErr('requisitionNumber');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editIssuanceFieldErrors.requisitionNumber
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editIssuanceFieldErrors.requisitionNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editIssuanceFieldErrors.requisitionNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.dateLabel')}</label>
                  <input 
                    type="date" 
                    value={editingIssuance.date}
                    onChange={e => setEditingIssuance({ ...editingIssuance, date: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.editDeptLabel')}</label>
                  <input 
                    type="text" 
                    value={editingIssuance.department}
                    onChange={e => setEditingIssuance({ ...editingIssuance, department: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.editPartCodeLabel')}</label>
                  <input 
                    type="text" 
                    value={editingIssuance.partCode}
                    onChange={e => {
                      setEditingIssuance({ ...editingIssuance, partCode: e.target.value.toUpperCase() });
                      clearEditIssErr('partCode');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editIssuanceFieldErrors.partCode
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editIssuanceFieldErrors.partCode && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editIssuanceFieldErrors.partCode)}
                    </p>
                  )}
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.editDescLabel')}</label>
                  <input 
                    type="text" 
                    value={editingIssuance.description}
                    onChange={e => setEditingIssuance({ ...editingIssuance, description: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.editQtyReqLabel')}</label>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    value={editQtyRequestedInput}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.-]/g, '');
                      setEditQtyRequestedInput(raw);
                      const num = Number(raw);
                      setEditingIssuance({ ...editingIssuance, quantityRequested: raw.trim() === '' || Number.isNaN(num) ? 0 : num });
                      clearEditIssErr('quantityRequested');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editIssuanceFieldErrors.quantityRequested
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editIssuanceFieldErrors.quantityRequested && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editIssuanceFieldErrors.quantityRequested)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.editQtyIssuedLabel')}</label>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    value={editQtyIssuedInput}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.-]/g, '');
                      setEditQtyIssuedInput(raw);
                      const num = Number(raw);
                      setEditingIssuance({ ...editingIssuance, quantityIssued: raw.trim() === '' || Number.isNaN(num) ? 0 : num });
                      clearEditIssErr('quantityIssued');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editIssuanceFieldErrors.quantityIssued
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editIssuanceFieldErrors.quantityIssued && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editIssuanceFieldErrors.quantityIssued)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.editLotLabel')}</label>
                  <input 
                    type="text" 
                    value={editingIssuance.lotNumber}
                    onChange={e => {
                      setEditingIssuance({ ...editingIssuance, lotNumber: e.target.value });
                      clearEditIssErr('lotNumber');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editIssuanceFieldErrors.lotNumber
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editIssuanceFieldErrors.lotNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editIssuanceFieldErrors.lotNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.editUomLabel')}</label>
                  <select
                    value={normalizeUnitCode(editingIssuance.unit)}
                    onChange={e => {
                      const norm = normalizeUnitCode(e.target.value);
                      setEditingIssuance({ ...editingIssuance, unit: norm, unitMissing: !norm });
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono font-bold bg-white"
                  >
                    <option value="">{t('issuance.editSelectUomOpt')}</option>
                    {getAllSelectUomOptions(editingIssuance.unit).map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.editIssuedByLabel')}</label>
                  <input 
                    type="text" 
                    value={editingIssuance.issuedBy}
                    onChange={e => {
                      setEditingIssuance({ ...editingIssuance, issuedBy: e.target.value });
                      clearEditIssErr('issuedBy');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 ${
                      editIssuanceFieldErrors.issuedBy
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editIssuanceFieldErrors.issuedBy && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editIssuanceFieldErrors.issuedBy)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('issuance.editReceivedByLabel')}</label>
                  <input 
                    type="text" 
                    value={editingIssuance.receivedBy}
                    onChange={e => {
                      setEditingIssuance({ ...editingIssuance, receivedBy: e.target.value });
                      clearEditIssErr('receivedBy');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 ${
                      editIssuanceFieldErrors.receivedBy
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editIssuanceFieldErrors.receivedBy && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editIssuanceFieldErrors.receivedBy)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  onClick={() => {
                    setEditIssuanceFieldErrors({});
                    setEditingIssuance(null);
                  }}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
                >
                  {t('common.cancel')}
                </button>
                <button 
                  onClick={() => {
                    const resolved = resolveMasterDataUnit(editingIssuance, registries, stocks);
                    const rawReq = editQtyRequestedInput.trim() === '' ? NaN : Number(editQtyRequestedInput.trim());
                    const rawIss = editQtyIssuedInput.trim() === '' ? NaN : Number(editQtyIssuedInput.trim());
                    const candidate: IssuanceRecord = {
                      ...editingIssuance,
                      quantityRequested: Number.isNaN(rawReq) ? 0 : rawReq,
                      quantityIssued: Number.isNaN(rawIss) ? 0 : rawIss,
                      unit: resolved.unit,
                      unitMissing: resolved.isMissing,
                    };
                    const validation = validateIssuanceRecord(
                      {
                        ...candidate,
                        quantityRequested: editQtyRequestedInput.trim() === '' ? '' : rawReq,
                        quantityIssued: editQtyIssuedInput.trim() === '' ? '' : rawIss,
                      } as any,
                      { requireOperationalFields: true }
                    );
                    const extraErrors: Record<string, string> = { ...validation.fieldErrors };
                    if (!candidate.issuedBy?.trim()) {
                      extraErrors.issuedBy = t('issuance.issuedByRequiredShort');
                    }
                    if (Object.keys(extraErrors).length > 0) {
                      setEditIssuanceFieldErrors(extraErrors);
                      const firstErr = Object.values(extraErrors)[0] || t('delivery.fixValidation');
                      showPrintToast(localizeValidation(firstErr), 'warning');
                      return;
                    }
                    setEditIssuanceFieldErrors({});
                    onEditIssuance?.(candidate);
                    setEditingIssuance(null);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold"
                >
                  {t('issuance.saveChangesBtn')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
      {/* Barcode / QR Code Scanner Modal */}
      <BarcodeScannerModal 
        isOpen={showScannerModal}
        onClose={() => setShowScannerModal(false)}
        onScanResult={handleScanResult}
        resolveScanDetails={resolveIssuanceScanDetails}
        title={t('issuance.scannerTitle')}
        subtitle={t('issuance.scannerSubtitle')}
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
