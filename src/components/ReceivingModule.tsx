/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Plus, 
  Search, 
  AlertOctagon, 
  ShieldCheck, 
  Sparkles, 
  Truck, 
  RotateCcw, 
  Trash2, 
  Edit, 
  ScanLine, 
  AlertTriangle, 
  X, 
  CheckCircle2, 
  XCircle, 
  Factory, 
  FileText,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  PackageCheck,
  Tag,
  Activity,
  Check,
  Pencil,
  AlertCircle
} from 'lucide-react';
import { ReceivingRecord, ReturnRecord, MaterialStockItem, getCustomerForPart, MasterRegistryItem, RegistryType, FifoColorsMap } from '../types';
import { resolveFifoColor, getFifoColorForDate, normalizeFifoColor } from '../data';
import BarcodeScannerModal, { ScannedItemPreview } from './BarcodeScannerModal';
import { motion, AnimatePresence } from 'motion/react';
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
import { validateReceivingRecord } from '../../shared/validation';
import { getManilaTodayString } from '../lib/businessDate';
import { useI18n } from '../i18n';

interface ReceivingModuleProps {
  receiving: ReceivingRecord[];
  onAddReceiving: (record: ReceivingRecord) => void;
  onUpdateIqc: (id: string, status: ReceivingRecord['iqcStatus']) => void;
  onEditReceiving?: (record: ReceivingRecord) => void;
  onDeleteReceiving?: (id: string) => void;
  returns: ReturnRecord[];
  onAddReturn: (record: ReturnRecord) => void;
  onUpdateReturnStatus: (id: string, status: ReturnRecord['status']) => void;
  onEditReturn?: (record: ReturnRecord) => void;
  onDeleteReturn?: (id: string) => void;
  stocks?: MaterialStockItem[];
  isSuperAdmin?: boolean;
  canEdit?: boolean;
  registries?: MasterRegistryItem[];
  onOpenRegisterModal?: (type?: RegistryType) => void;
  receivingCategories?: string[];
  onUpdateReceivingCategories?: (categories: string[], renameData?: { oldCat: string; newCat: string }) => void;
  onRegisterCategoryItem?: (item: MasterRegistryItem) => void;
  onUpdateCategoryItem?: (item: MasterRegistryItem) => void;
  onDeleteCategoryItem?: (id: string) => void;
  fifoColorsByMonth?: FifoColorsMap;
}

export default function ReceivingModule({
  receiving,
  onAddReceiving,
  onUpdateIqc,
  onEditReceiving,
  onDeleteReceiving,
  returns,
  onAddReturn,
  onUpdateReturnStatus,
  onEditReturn,
  onDeleteReturn,
  stocks = [],
  isSuperAdmin = false,
  canEdit = false,
  registries = [],
  onOpenRegisterModal: _onOpenRegisterModal,
  receivingCategories: _receivingCategories,
  onUpdateReceivingCategories,
  onRegisterCategoryItem,
  onUpdateCategoryItem,
  onDeleteCategoryItem,
  fifoColorsByMonth
}: ReceivingModuleProps) {
  const { t, localizeValidation } = useI18n();
  const effectiveCanEdit = canEdit || isSuperAdmin;
  const [activeTab, setActiveTab] = useState<'external-internal' | 'returns'>('external-internal');
  const [searchQuery, setSearchQuery] = useState('');
  const [classificationFilter, setClassificationFilter] = useState<string>('ALL');
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [confirmedScanInfo, setConfirmedScanInfo] = useState<ScannedItemPreview | null>(null);

  // States for Editing Modals
  const [editingReceiving, setEditingReceiving] = useState<ReceivingRecord | null>(null);
  const [editingReturn, setEditingReturn] = useState<ReturnRecord | null>(null);
  const [receivingFieldErrors, setReceivingFieldErrors] = useState<Record<string, string>>({});
  const [editReceivingFieldErrors, setEditReceivingFieldErrors] = useState<Record<string, string>>({});
  const [editReceivingQtyInput, setEditReceivingQtyInput] = useState<string>('');

  const clearRecErr = (field: string) => {
    setReceivingFieldErrors(prev => {
      if (!prev[field]) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const clearEditRecErr = (field: string) => {
    setEditReceivingFieldErrors(prev => {
      if (!prev[field]) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  };

  // States for Row-Hover Expansion
  const [expandedReceivingId, setExpandedReceivingId] = useState<string | null>(null);
  const [expandedReturnId, setExpandedReturnId] = useState<string | null>(null);

  // Column Sorting States for Arrivals & Returns
  type ReceivingSortField = 'rrNumber' | 'itemDescription' | 'date' | 'partCode' | 'supplierOrDept' | 'color' | 'quantity' | 'fifoColor' | 'source' | 'poNumber' | 'drNumber' | 'siNumber' | 'iqcStatus';
  type ReturnSortField = 'returnSlipFormNumber' | 'category' | 'date' | 'department' | 'partCode' | 'quantity' | 'condition' | 'status';
  type SortDirection = 'asc' | 'desc';

  const [recSortField, setRecSortField] = useState<ReceivingSortField>('date');
  const [recSortDirection, setRecSortDirection] = useState<SortDirection>('desc');

  const [retSortField, setRetSortField] = useState<ReturnSortField>('date');
  const [retSortDirection, setRetSortDirection] = useState<SortDirection>('desc');

  const handleRecSort = (field: ReceivingSortField) => {
    if (recSortField === field) {
      setRecSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setRecSortField(field);
      setRecSortDirection('asc');
    }
  };

  const handleRetSort = (field: ReturnSortField) => {
    if (retSortField === field) {
      setRetSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setRetSortField(field);
      setRetSortDirection('asc');
    }
  };

  // Yes / No Confirmation Modal State
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    confirmVariant?: 'danger' | 'primary';
    onConfirm: () => void;
  } | null>(null);

  // Centralized Master Data Categories (Single source of truth from Master Data CATEGORY entries)
  const categoryRegistryItems = useMemo(() => {
    return registries.filter(r => r.type === 'CATEGORY' && r.status !== 'INACTIVE');
  }, [registries]);

  const managedCategories = useMemo(() => {
    return Array.from(
      new Set(
        categoryRegistryItems
          .map(r => String(r.name || r.code || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );
  }, [categoryRegistryItems]);

  // Manage Categories Modal States (Super Admin)
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [editingCategoryOriginal, setEditingCategoryOriginal] = useState<string | null>(null);
  const [editingCategoryNewValue, setEditingCategoryNewValue] = useState('');
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const [categoryModalError, setCategoryModalError] = useState('');
  const [categoryModalSuccess, setCategoryModalSuccess] = useState('');

  // Category Management Handlers (Backed by Master Data CATEGORY entries)
  const handleAddCategory = (catToAdd?: string): string | false => {
    const candidate = String(catToAdd !== undefined ? catToAdd : newCategoryInput).trim().toUpperCase();
    if (!candidate) {
      setCategoryModalError(t('receiving.catErrEmpty'));
      return false;
    }
    if (managedCategories.some(c => c.toUpperCase() === candidate)) {
      setCategoryModalError(t('receiving.catErrExists', { cat: candidate }));
      return false;
    }

    const updated = [...managedCategories, candidate];
    if (onRegisterCategoryItem) {
      onRegisterCategoryItem({
        id: generateAuthoritativeId('REG-CAT'),
        type: 'CATEGORY',
        code: candidate,
        name: candidate,
        description: 'Master Data Material Category',
        status: 'ACTIVE',
        dateRegistered: getManilaTodayString(),
      });
    }
    if (onUpdateReceivingCategories) {
      onUpdateReceivingCategories(updated);
    }
    setNewCategoryInput('');
    setCategoryModalError('');
    setCategoryModalSuccess(t('receiving.catSuccessAdd', { cat: candidate }));
    setTimeout(() => setCategoryModalSuccess(''), 3000);
    return candidate;
  };

  const handleRenameCategory = (oldCat: string, newCat: string) => {
    const cleanOld = oldCat.trim().toUpperCase();
    const cleanNew = newCat.trim().toUpperCase();
    if (!cleanNew) {
      setCategoryModalError(t('receiving.catErrNameEmpty'));
      return;
    }
    if (cleanNew !== cleanOld && managedCategories.some(c => c.toUpperCase() === cleanNew)) {
      setCategoryModalError(t('receiving.catErrExists', { cat: cleanNew }));
      return;
    }

    const existingItem = categoryRegistryItems.find(
      r => (r.name || r.code || '').trim().toUpperCase() === cleanOld
    );
    if (existingItem && onUpdateCategoryItem) {
      onUpdateCategoryItem({
        ...existingItem,
        code: cleanNew,
        name: cleanNew,
      });
    }

    const updated = managedCategories.map(c => c.toUpperCase() === cleanOld ? cleanNew : c);
    if (onUpdateReceivingCategories) {
      onUpdateReceivingCategories(updated, { oldCat: cleanOld, newCat: cleanNew });
    }

    // Cascade rename to local form drafts if currently selected
    if (supplierOrDept.toUpperCase() === cleanOld) {
      setSupplierOrDept(cleanNew);
    }
    if (retCategory.toUpperCase() === cleanOld) {
      setRetCategory(cleanNew);
    }
    if (classificationFilter.toUpperCase() === cleanOld) {
      setClassificationFilter(cleanNew);
    }

    setEditingCategoryOriginal(null);
    setEditingCategoryNewValue('');
    setCategoryModalError('');
    setCategoryModalSuccess(t('receiving.catSuccessRename', { oldCat: cleanOld, newCat: cleanNew }));
    setTimeout(() => setCategoryModalSuccess(''), 3000);
  };

  const handleDeleteCategory = (catToDelete: string) => {
    const clean = catToDelete.trim().toUpperCase();

    // Block deleting a category if any existing record still uses it
    const recCount = receiving.filter(r => (r.supplierOrDept || '').trim().toUpperCase() === clean || ((r as any).category || '').trim().toUpperCase() === clean).length;
    const retCount = returns.filter(ret => (ret.category || '').trim().toUpperCase() === clean).length;
    const stockCount = stocks.filter(s => ((s as any).category || '').trim().toUpperCase() === clean).length;
    const inUseCount = recCount + retCount + stockCount;

    if (inUseCount > 0) {
      setCategoryModalError(t('receiving.catErrInUse', { cat: clean, total: inUseCount }));
      return;
    }

    setConfirmAction({
      title: t('receiving.confirmDeleteCatTitle', { cat: clean }),
      message: t('receiving.confirmDeleteCatMsg', { cat: clean }),
      confirmVariant: "danger",
      confirmLabel: t('receiving.confirmYesDelete'),
      onConfirm: () => {
        const existingItem = categoryRegistryItems.find(
          r => (r.name || r.code || '').trim().toUpperCase() === clean
        );
        if (existingItem && onDeleteCategoryItem) {
          onDeleteCategoryItem(existingItem.id);
        }
        const updated = managedCategories.filter(c => c.toUpperCase() !== clean);
        if (onUpdateReceivingCategories) {
          onUpdateReceivingCategories(updated);
        }
        setCategoryModalSuccess(t('receiving.catSuccessDelete', { cat: clean }));
        setTimeout(() => setCategoryModalSuccess(''), 3000);
      }
    });
  };

  const resolveReceivingScanDetails = (scannedCode: string): ScannedItemPreview => {
    const cleanCode = scannedCode.trim();
    const lower = cleanCode.toLowerCase();

    const matchedStock = stocks.find(
      s => (s.lotNumber || '').trim().toLowerCase() === lower ||
           (s.partCode || '').trim().toLowerCase() === lower
    );
    const matchedRegistry = registries.find(
      r => (r.code || '').trim().toLowerCase() === lower ||
           (r.name || '').trim().toLowerCase() === lower ||
           (r.id || '').trim().toLowerCase() === lower
    );
    const stockByRegistryCode = !matchedStock && matchedRegistry
      ? stocks.find(s => (s.partCode || '').trim().toLowerCase() === (matchedRegistry.code || '').trim().toLowerCase())
      : undefined;
    const effectiveStock = matchedStock || stockByRegistryCode;

    if (matchedRegistry) {
      const regUnit = resolveMasterDataUnit(
        { unit: effectiveStock?.unit || matchedRegistry.unit, partCode: matchedRegistry.code, description: matchedRegistry.name },
        registries,
        stocks
      );
      return {
        code: cleanCode,
        itemName: matchedRegistry.name || matchedRegistry.description || matchedRegistry.code,
        lot: effectiveStock?.lotNumber || 'Pending Lot Assignment',
        location: matchedRegistry.location || effectiveStock?.location || 'Unassigned',
        partCode: matchedRegistry.code,
        category: matchedRegistry.category,
        quantityLabel: effectiveStock ? `${effectiveStock.quantity.toLocaleString()} ${regUnit.unit || MISSING_UNIT_LABEL}` : undefined,
        matchedSource: 'REGISTRY'
      };
    }

    if (matchedStock) {
      const stkUnit = resolveMasterDataUnit(matchedStock, registries, stocks);
      return {
        code: cleanCode,
        itemName: matchedStock.description || matchedStock.partCode,
        lot: matchedStock.lotNumber || `LOT-${cleanCode}`,
        location: matchedStock.location || 'Unassigned',
        partCode: matchedStock.partCode,
        quantityLabel: `${matchedStock.quantity.toLocaleString()} ${stkUnit.unit || MISSING_UNIT_LABEL}`,
        matchedSource: 'STOCK'
      };
    }

    return {
      code: cleanCode,
      itemName: `Unregistered Item (${cleanCode})`,
      lot: cleanCode,
      location: 'Unassigned',
      partCode: cleanCode,
      matchedSource: 'UNMATCHED'
    };
  };

  // Handle scanned barcode / QR code result (called after operator taps Confirm)
  const handleScanResult = (scannedCode: string) => {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    setConfirmedScanInfo(resolveReceivingScanDetails(cleanCode));

    // Search in stocks or master registries
    const matchedStock = stocks.find(
      s => (s.partCode || '').toLowerCase() === cleanCode.toLowerCase() || 
           (s.lotNumber || '').toLowerCase() === cleanCode.toLowerCase()
    );
    const matchedRegistry = registries.find(
      r => (r.code || '').toLowerCase() === cleanCode.toLowerCase() ||
           (r.name || '').toLowerCase() === cleanCode.toLowerCase() ||
           (r.id || '').toLowerCase() === cleanCode.toLowerCase()
    );

    if (activeTab === 'external-internal') {
      setShowAddForm(true);
      if (matchedRegistry) {
        setPartCode(matchedRegistry.code);
        setItemDescription(matchedRegistry.description || matchedRegistry.name);
        setLotNumber(matchedRegistry.name);
        if (matchedRegistry.presetSource) setSource(matchedRegistry.presetSource);
        if (matchedRegistry.vendorSupplier) setVendorSupplier(matchedRegistry.vendorSupplier);
        if (matchedRegistry.category) setSupplierOrDept(matchedRegistry.category);
        const normRegUnit = normalizeUnitCode(matchedRegistry.unit);
        if (normRegUnit) setUnit(normRegUnit);
        if (matchedRegistry.location) setLocation(matchedRegistry.location);
        const cust = getCustomerForPart(matchedRegistry.code, matchedRegistry.name);
        if (cust) setCustomer(cust);
      } else if (matchedStock) {
        setPartCode(matchedStock.partCode);
        setItemDescription(matchedStock.description || matchedStock.partCode);
        const normStkUnit = resolveMasterDataUnit(matchedStock, registries, stocks).unit;
        if (normStkUnit) setUnit(normStkUnit);
        setLotNumber(matchedStock.lotNumber || `LOT-${cleanCode}`);
        setLocation(matchedStock.location || '');
        setReorderMin(matchedStock.reorderMin || 0);
        const cust = getCustomerForPart(matchedStock.partCode);
        if (cust) setCustomer(cust);
      } else {
        setPartCode(cleanCode);
        setItemDescription(cleanCode);
        setLotNumber(cleanCode);
      }
    } else {
      setShowReturnForm(true);
      const targetCode = matchedStock?.partCode || matchedRegistry?.code || cleanCode;
      setRetPartCode(targetCode);
      if (matchedRegistry?.category) {
        setRetCategory(matchedRegistry.category);
      } else if (matchedStock?.type) {
        if (matchedStock.type === 'RAW') setRetCategory('RESIN/RAW MATERIALS');
        else if (matchedStock.type === 'PACKAGING') setRetCategory('PACKAGING MATERIALS');
        else if (matchedStock.type === 'CONSUMABLE') setRetCategory('CONSUMABLES');
        else if (matchedStock.type === 'WIP') setRetCategory('WIP (WORK IN PROGRESS)');
        else if (matchedStock.type === 'FG') setRetCategory('FG (FINISHED GOOD)');
      }
      if (matchedStock) {
        setRetDesc(matchedStock.description);
        const normRetUnit = resolveMasterDataUnit(matchedStock, registries, stocks).unit;
        if (normRetUnit) setRetUnit(normRetUnit);
        setRetLot(matchedStock.lotNumber);
      } else if (matchedRegistry) {
        setRetDesc(matchedRegistry.description || matchedRegistry.name);
        const normRegUnit = normalizeUnitCode(matchedRegistry.unit);
        if (normRegUnit) setRetUnit(normRegUnit);
        setRetLot(matchedRegistry.name);
      }
    }
  };
  
  // LocalStorage keys for draft persistence
  const RECEIVING_DRAFT_KEY = 'juwei_wms_draft_receiving';
  const RETURN_DRAFT_KEY = 'juwei_wms_draft_receiving_return';

  const loadReceivingDraft = () => {
    try {
      const raw = localStorage.getItem(RECEIVING_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return null;
  };

  const loadReturnDraft = () => {
    try {
      const raw = localStorage.getItem(RETURN_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return null;
  };

  const initialReceivingDraft = loadReceivingDraft();
  const initialReturnDraft = loadReturnDraft();

  // States for new receiving form
  const [showAddForm, setShowAddForm] = useState<boolean>(() => {
    if (initialReceivingDraft?.showAddForm !== undefined) return Boolean(initialReceivingDraft.showAddForm);
    return Boolean(
      initialReceivingDraft?.supplierOrDept || 
      initialReceivingDraft?.partCode || 
      (initialReceivingDraft?.quantity && initialReceivingDraft.quantity > 0)
    );
  });
  const [source, setSource] = useState<string>(initialReceivingDraft?.source || 'INTERNAL');
  const isInternalSource = (src: string) => src === 'INTERNAL' || src === 'WIP/BOM/FG(Internal)';
  const [modelName, setModelName] = useState(initialReceivingDraft?.modelName || '');
  const [itemDescription, setItemDescription] = useState(initialReceivingDraft?.itemDescription || '');
  const [partCode, setPartCode] = useState(initialReceivingDraft?.partCode || '');
  const [quantity, setQuantity] = useState<number>(initialReceivingDraft?.quantity || 0);
  const [quantityInput, setQuantityInput] = useState<string>(
    initialReceivingDraft?.quantity !== undefined && initialReceivingDraft?.quantity !== 0
      ? String(initialReceivingDraft.quantity)
      : ''
  );
  const [unit, setUnit] = useState(initialReceivingDraft?.unit || 'KG');
  const [lotNumber, setLotNumber] = useState(initialReceivingDraft?.lotNumber || '');
  const [supplierOrDept, setSupplierOrDept] = useState(initialReceivingDraft?.supplierOrDept || '');
  const [poNumber, setPoNumber] = useState(initialReceivingDraft?.poNumber || '');
  const [rrNumber, setRrNumber] = useState(initialReceivingDraft?.rrNumber || '');
  const [drNumber, setDrNumber] = useState(initialReceivingDraft?.drNumber || '');
  const [siNumber, setSiNumber] = useState(initialReceivingDraft?.siNumber || '');
  const [wayBill, setWayBill] = useState(initialReceivingDraft?.wayBill || '');
  const [transferFormNumber, setTransferFormNumber] = useState(initialReceivingDraft?.transferFormNumber || '');
  const [customer, setCustomer] = useState(initialReceivingDraft?.customer || '');
  const [color, setColor] = useState(initialReceivingDraft?.color || '');
  const [receivedDate, setReceivedDate] = useState(initialReceivingDraft?.receivedDate || getManilaTodayString());
  const [expirationDate, setExpirationDate] = useState(initialReceivingDraft?.expirationDate || '');
  const [location, setLocation] = useState(initialReceivingDraft?.location || '');
  const [vendorSupplier, setVendorSupplier] = useState(initialReceivingDraft?.vendorSupplier || '');
  const [reorderMin, setReorderMin] = useState<number>(initialReceivingDraft?.reorderMin || 0);
  const [remarks, setRemarks] = useState(initialReceivingDraft?.remarks || '');

  // Category helpers
  const deptUpper = (supplierOrDept || '').toUpperCase();
  const isConsumableCategory = deptUpper.includes('CONSUMABLE');
  const isOfficeSuppliesCategory = deptUpper.includes('OFFICE');
  const isIndirectBomCategory = deptUpper.includes('INDIRECT') && !isConsumableCategory && !isOfficeSuppliesCategory;
  const isDirectBomCategory = deptUpper.includes('DIRECT BOM') && !isIndirectBomCategory && !isConsumableCategory && !isOfficeSuppliesCategory;
  const isRawCategory = (deptUpper.includes('RAW') || deptUpper.includes('RESIN')) && !isIndirectBomCategory && !isDirectBomCategory && !isConsumableCategory && !isOfficeSuppliesCategory;
  const isPackagingCategory = deptUpper.includes('PACKAGING');
  const isFgCategory = deptUpper.includes('FG') || deptUpper.includes('FINISHED GOOD');
  const isWipCategory = deptUpper.includes('WIP') || deptUpper.includes('WORK IN PROGRESS') || deptUpper.includes('SUB-PART') || isFgCategory;
  
  // States for BOM
  const [bomItems, setBomItems] = useState<{ partCode: string; description: string; quantityRequired: number; unit: string }[]>(
    Array.isArray(initialReceivingDraft?.bomItems) ? initialReceivingDraft.bomItems : []
  );
  const [autoDeductBom, setAutoDeductBom] = useState(initialReceivingDraft?.autoDeductBom ?? true);
  
  // SOP Receiving Condition Verification Checklist
  const [sopReceivingInspection, setSopReceivingInspection] = useState(initialReceivingDraft?.sopReceivingInspection ?? true);
  const [sopMaterialTraceability, setSopMaterialTraceability] = useState(initialReceivingDraft?.sopMaterialTraceability ?? true);
  const [sopQuantityAccuracy, setSopQuantityAccuracy] = useState(initialReceivingDraft?.sopQuantityAccuracy ?? true);
  const [sopMaterialCondition, setSopMaterialCondition] = useState(initialReceivingDraft?.sopMaterialCondition ?? true);
  const [sopSystemRecording, setSopSystemRecording] = useState(initialReceivingDraft?.sopSystemRecording ?? true);

  // Return form states
  const [showReturnForm, setShowReturnForm] = useState<boolean>(() => {
    if (initialReturnDraft?.showReturnForm !== undefined) return Boolean(initialReturnDraft.showReturnForm);
    return Boolean(
      initialReturnDraft?.retCategory || 
      initialReturnDraft?.retPartCode || 
      (initialReturnDraft?.retQty && initialReturnDraft.retQty > 0)
    );
  });
  const [retCategory, setRetCategory] = useState(initialReturnDraft?.retCategory || '');
  const [retDesc, setRetDesc] = useState(initialReturnDraft?.retDesc || '');
  const [retPartCode, setRetPartCode] = useState(initialReturnDraft?.retPartCode || '');
  const [retQty, setRetQty] = useState<number>(initialReturnDraft?.retQty || 0);
  const [retUnit, setRetUnit] = useState(initialReturnDraft?.retUnit || 'KG');
  const [retLot, setRetLot] = useState(initialReturnDraft?.retLot || '');
  const [retDept, setRetDept] = useState(initialReturnDraft?.retDept || '');
  const [retReason, setRetReason] = useState(initialReturnDraft?.retReason || '');
  const [retCondition, setRetCondition] = useState<'Good' | 'Damaged' | 'Contaminated' | 'Unidentified'>(initialReturnDraft?.retCondition || 'Good');
  const [retSlip, setRetSlip] = useState(initialReturnDraft?.retSlip || '');

  // Auto-save receiving draft to localStorage
  useEffect(() => {
    const hasContent = Boolean(
      supplierOrDept ||
      partCode ||
      itemDescription ||
      modelName ||
      lotNumber ||
      quantity > 0 ||
      poNumber ||
      rrNumber ||
      drNumber ||
      siNumber ||
      wayBill ||
      transferFormNumber ||
      customer ||
      color ||
      expirationDate ||
      location ||
      vendorSupplier ||
      remarks ||
      (bomItems && bomItems.length > 0)
    );

    if (hasContent || showAddForm) {
      const draft = {
        showAddForm,
        source,
        modelName,
        itemDescription,
        partCode,
        quantity,
        unit,
        lotNumber,
        supplierOrDept,
        poNumber,
        rrNumber,
        drNumber,
        siNumber,
        wayBill,
        transferFormNumber,
        customer,
        color,
        receivedDate,
        expirationDate,
        location,
        vendorSupplier,
        reorderMin,
        remarks,
        bomItems,
        autoDeductBom,
        sopReceivingInspection,
        sopMaterialTraceability,
        sopQuantityAccuracy,
        sopMaterialCondition,
        sopSystemRecording,
        savedAt: Date.now()
      };
      try {
        localStorage.setItem(RECEIVING_DRAFT_KEY, JSON.stringify(draft));
      } catch (e) {}
    }
  }, [
    showAddForm, source, modelName, itemDescription, partCode, quantity, unit,
    lotNumber, supplierOrDept, poNumber, rrNumber, drNumber, siNumber,
    wayBill, transferFormNumber, customer, color, receivedDate, expirationDate, location,
    vendorSupplier, reorderMin, remarks, bomItems, autoDeductBom,
    sopReceivingInspection, sopMaterialTraceability, sopQuantityAccuracy,
    sopMaterialCondition, sopSystemRecording
  ]);

  // Auto-save return draft to localStorage
  useEffect(() => {
    const hasReturnContent = Boolean(
      retCategory ||
      retDesc ||
      retPartCode ||
      retQty > 0 ||
      retLot ||
      retDept ||
      retReason ||
      retSlip
    );

    if (hasReturnContent || showReturnForm) {
      const draft = {
        showReturnForm,
        retCategory,
        retDesc,
        retPartCode,
        retQty,
        retUnit,
        retLot,
        retDept,
        retReason,
        retCondition,
        retSlip,
        savedAt: Date.now()
      };
      try {
        localStorage.setItem(RETURN_DRAFT_KEY, JSON.stringify(draft));
      } catch (e) {}
    }
  }, [
    showReturnForm, retCategory, retDesc, retPartCode, retQty,
    retUnit, retLot, retDept, retReason, retCondition, retSlip
  ]);

  // Clear helpers
  const clearReceivingDraft = () => {
    try {
      localStorage.removeItem(RECEIVING_DRAFT_KEY);
    } catch (e) {}
  };

  const handleDiscardReceiving = () => {
    clearReceivingDraft();
    setModelName('');
    setItemDescription('');
    setPartCode('');
    setCustomer('');
    setColor('');
    setQuantity(0);
    setQuantityInput('');
    setLotNumber('');
    setSupplierOrDept('');
    setReceivedDate(getManilaTodayString());
    setExpirationDate('');
    setLocation('');
    setVendorSupplier('');
    setReorderMin(0);
    setRemarks('');
    setPoNumber('');
    setRrNumber('');
    setDrNumber('');
    setSiNumber('');
    setWayBill('');
    setTransferFormNumber('');
    setSopReceivingInspection(true);
    setSopMaterialTraceability(true);
    setSopQuantityAccuracy(true);
    setSopMaterialCondition(true);
    setSopSystemRecording(true);
    setBomItems([]);
    setAutoDeductBom(true);
    setConfirmedScanInfo(null);
    setReceivingFieldErrors({});
    setShowAddForm(false);
  };

  const clearReturnDraft = () => {
    try {
      localStorage.removeItem(RETURN_DRAFT_KEY);
    } catch (e) {}
  };

  const handleDiscardReturn = () => {
    clearReturnDraft();
    setRetCategory('');
    setRetDesc('');
    setRetPartCode('');
    setRetQty(0);
    setRetLot('');
    setRetDept('');
    setRetReason('');
    setRetCondition('Good');
    setRetSlip('');
    setConfirmedScanInfo(null);
    setShowReturnForm(false);
  };

  // Handle Receiving Submission
  const handleSubmitReceiving = (e: React.FormEvent) => {
    e.preventDefault();

    const masterUnit = findMasterPresetUnit({ partCode, description: itemDescription }, registries);
    const cleanUnit = normalizeUnitCode(unit) || masterUnit || '';

    // Determine FIFO color code based on received date from synced calendar
    const fifoColor = getFifoColorForDate(receivedDate, fifoColorsByMonth);

    // Discrepancy flag
    const hasConditionDiscrepancy = 
      !sopReceivingInspection || 
      !sopMaterialTraceability || 
      !sopQuantityAccuracy || 
      !sopMaterialCondition || 
      !sopSystemRecording;

    const cleanRr = rrNumber.trim() || undefined;
    const cleanPo = poNumber.trim() || undefined;
    const cleanDr = drNumber.trim() || undefined;
    const cleanSi = siNumber.trim() || undefined;
    const cleanExp = expirationDate.trim() || undefined;
    const rawQty = quantityInput.trim() === '' ? NaN : Number(quantityInput.trim());

    const newRecord: ReceivingRecord = {
      id: generateAuthoritativeId('RCV'),
      ...(cleanRr ? { rrNumber: cleanRr } : {}),
      date: getManilaTodayString(),
      receivedDate,
      ...(cleanExp ? { expirationDate: cleanExp } : {}),
      location: location.trim(),
      vendorSupplier: vendorSupplier.trim() || 'N/A',
      reorderMin,
      remarks,
      source: (isDirectBomCategory || isWipCategory) ? 'INTERNAL' : ((isIndirectBomCategory || isConsumableCategory || isOfficeSuppliesCategory) ? 'EXTERNAL' : source as any),
      itemDescription: itemDescription || lotNumber || partCode,
      partCode: partCode.trim().toUpperCase(),
      modelName: modelName.trim() || undefined,
      color: isRawCategory ? color.trim() || undefined : undefined,
      quantity: Number.isNaN(rawQty) ? 0 : rawQty,
      unit: cleanUnit,
      unitMissing: !cleanUnit,
      lotNumber: lotNumber.trim() || generateAuthoritativeId('LOT'),
      physicalCondition: {
        receivingInspection: sopReceivingInspection,
        materialTraceability: sopMaterialTraceability,
        quantityAccuracy: sopQuantityAccuracy,
        materialConditionCheck: sopMaterialCondition,
        systemRecording: sopSystemRecording,
        boxIntact: sopMaterialCondition,
        noWaterDamage: sopMaterialCondition,
        noPestSign: sopMaterialCondition,
        noContamination: sopMaterialCondition
      },
      ...(cleanPo ? { poNumber: cleanPo } : {}),
      ...(cleanDr ? { drNumber: cleanDr } : {}),
      ...(cleanSi ? { siNumber: cleanSi } : {}),
      wayBill: wayBill.trim() || undefined,
      transferFormNumber: (isWipCategory || isDirectBomCategory) ? (transferFormNumber.trim() || undefined) : undefined,
      supplierOrDept,
      iqcStatus: (isIndirectBomCategory || isConsumableCategory || isOfficeSuppliesCategory) ? 'APPROVED_IQC' : (!isInternalSource(source) ? 'PENDING_IQC' : 'NA'),
      status: hasConditionDiscrepancy ? 'QUARANTINED' : 'DRAFT',
      fifoColorCode: fifoColor,
      bom: isWipCategory ? bomItems : undefined,
      autoDeductBom: isWipCategory ? autoDeductBom : undefined,
      customer: customer || getCustomerForPart(partCode, itemDescription)
    };

    const validation = validateReceivingRecord(
      {
        ...newRecord,
        quantity: quantityInput.trim() === '' ? '' : rawQty,
      } as any,
      receiving,
      { requireOperationalFields: true }
    );

    if (!validation.valid) {
      setReceivingFieldErrors(validation.fieldErrors);
      showPrintToast(localizeValidation(validation.message) || t('receiving.validationWarning'), 'warning');
      return;
    }

    setReceivingFieldErrors({});
    onAddReceiving(newRecord);
    clearReceivingDraft();
    
    // Reset form states
    setModelName('');
    setItemDescription('');
    setPartCode('');
    setCustomer('');
    setColor('');
    setQuantity(0);
    setQuantityInput('');
    setLotNumber('');
    setSupplierOrDept('');
    setReceivedDate(getManilaTodayString());
    setExpirationDate('');
    setLocation('');
    setVendorSupplier('');
    setReorderMin(0);
    setRemarks('');
    setPoNumber('');
    setRrNumber('');
    setDrNumber('');
    setSiNumber('');
    setWayBill('');
    setTransferFormNumber('');
    setSopReceivingInspection(true);
    setSopMaterialTraceability(true);
    setSopQuantityAccuracy(true);
    setSopMaterialCondition(true);
    setSopSystemRecording(true);
    setBomItems([]);
    setAutoDeductBom(true);
    setConfirmedScanInfo(null);
    setShowAddForm(false);
  };

  // Handle Return Submission
  const handleSubmitReturn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!retCategory) {
      showPrintToast(t('receiving.selectCategoryWarning'), 'warning');
      return;
    }
    if (!retDesc || !retPartCode || retQty <= 0 || !retLot || !retDept || !retSlip) {
      showPrintToast(t('receiving.fillRequiredWarning'), 'warning');
      return;
    }

    const masterUnit = findMasterPresetUnit({ partCode: retPartCode, description: retDesc }, registries);
    const cleanRetUnit = normalizeUnitCode(retUnit) || masterUnit;
    if (!cleanRetUnit) {
      showPrintToast(t('receiving.selectValidUomWarning'), 'warning');
      return;
    }

    const newReturn: ReturnRecord = {
      id: generateAuthoritativeId('RET'),
      date: new Date().toISOString().split('T')[0],
      category: retCategory,
      materialDescription: retDesc,
      partCode: retPartCode,
      quantity: retQty,
      unit: cleanRetUnit,
      unitMissing: false,
      lotNumber: retLot,
      department: retDept,
      reason: retReason,
      condition: retCondition,
      iqcEvaluation: retCondition === 'Good' ? 'APPROVED_IQC' : 'PENDING_IQC',
      status: retCondition === 'Good' ? 'APPROVED' : 'QUARANTINED',
      returnSlipFormNumber: retSlip
    };

    onAddReturn(newReturn);
    clearReturnDraft();

    // Reset Form
    setRetCategory('');
    setRetDesc('');
    setRetPartCode('');
    setRetQty(0);
    setRetLot('');
    setRetDept('');
    setRetReason('');
    setRetCondition('Good');
    setRetSlip('');
    setConfirmedScanInfo(null);
    setShowReturnForm(false);
  };

  // Filter logs
  const filteredReceiving = receiving.filter(r => {
    const query = (searchQuery || '').trim().toLowerCase();
    const matchesSearch = 
      (r.itemDescription || '').toLowerCase().includes(query) ||
      (r.partCode || '').toLowerCase().includes(query) ||
      (r.supplierOrDept || '').toLowerCase().includes(query) ||
      (r.source || '').toLowerCase().includes(query) ||
      (r.vendorSupplier && r.vendorSupplier.toLowerCase().includes(query)) ||
      (r.poNumber && r.poNumber.toLowerCase().includes(query)) ||
      (r.drNumber && r.drNumber.toLowerCase().includes(query)) ||
      (r.siNumber && r.siNumber.toLowerCase().includes(query));

    if (!matchesSearch) return false;

    if (classificationFilter === 'ALL') return true;
    if (classificationFilter === 'INTERNAL') return isInternalSource(r.source);
    if (classificationFilter === 'EXTERNAL') return !isInternalSource(r.source);
    return r.supplierOrDept === classificationFilter;
  });

  const filteredReturns = returns.filter(r => {
    const query = (searchQuery || '').trim().toLowerCase();
    const matchesSearch = 
      (r.materialDescription || '').toLowerCase().includes(query) ||
      (r.partCode || '').toLowerCase().includes(query) ||
      (r.department || '').toLowerCase().includes(query) ||
      (r.returnSlipFormNumber || '').toLowerCase().includes(query) ||
      (r.category && r.category.toLowerCase().includes(query));

    if (!matchesSearch) return false;

    if (classificationFilter === 'ALL') return true;
    if (r.category) {
      const catUpper = (r.category || '').toUpperCase();
      const filterUpper = (classificationFilter || '').toUpperCase();
      return catUpper.includes(filterUpper) || filterUpper.includes(catUpper);
    }
    return true;
  });

  // Sorted arrivals list based on current filters and column sort
  const sortedReceiving = useMemo(() => {
    return [...filteredReceiving].sort((a, b) => {
      let result = 0;
      switch (recSortField) {
        case 'partCode': {
          result = (a.partCode || '').localeCompare(b.partCode || '', undefined, { numeric: true, sensitivity: 'base' });
          break;
        }
        case 'itemDescription': {
          result = (a.itemDescription || '').localeCompare(b.itemDescription || '', undefined, { numeric: true, sensitivity: 'base' });
          break;
        }
        case 'quantity': {
          result = (Number(a.quantity) || 0) - (Number(b.quantity) || 0);
          break;
        }
        case 'date': {
          const timeA = a.date ? new Date(a.date).getTime() : 0;
          const timeB = b.date ? new Date(b.date).getTime() : 0;
          result = timeA - timeB;
          break;
        }
        case 'rrNumber': {
          result = (a.rrNumber || a.id || '').localeCompare(b.rrNumber || b.id || '', undefined, { numeric: true, sensitivity: 'base' });
          break;
        }
        case 'supplierOrDept': {
          result = (a.supplierOrDept || '').localeCompare(b.supplierOrDept || '');
          break;
        }
        case 'color': {
          result = (a.color || '').localeCompare(b.color || '');
          break;
        }
        case 'fifoColor': {
          result = (a.fifoColorCode || '').localeCompare(b.fifoColorCode || '');
          break;
        }
        case 'source': {
          const sourceA = a.vendorSupplier || a.source || '';
          const sourceB = b.vendorSupplier || b.source || '';
          result = sourceA.localeCompare(sourceB, undefined, { numeric: true, sensitivity: 'base' });
          break;
        }
        case 'poNumber': {
          result = (a.poNumber || '').localeCompare(b.poNumber || '', undefined, { numeric: true, sensitivity: 'base' });
          break;
        }
        case 'drNumber': {
          result = (a.drNumber || '').localeCompare(b.drNumber || '', undefined, { numeric: true, sensitivity: 'base' });
          break;
        }
        case 'siNumber': {
          result = (a.siNumber || '').localeCompare(b.siNumber || '', undefined, { numeric: true, sensitivity: 'base' });
          break;
        }
        case 'iqcStatus': {
          result = (a.iqcStatus || '').localeCompare(b.iqcStatus || '');
          break;
        }
        default:
          result = 0;
      }
      return recSortDirection === 'asc' ? result : -result;
    });
  }, [filteredReceiving, recSortField, recSortDirection]);

  // Sorted returns list based on current filters and column sort
  const sortedReturns = useMemo(() => {
    return [...filteredReturns].sort((a, b) => {
      let result = 0;
      switch (retSortField) {
        case 'partCode': {
          result = (a.partCode || '').localeCompare(b.partCode || '', undefined, { numeric: true, sensitivity: 'base' });
          if (result === 0) {
            result = (a.materialDescription || '').localeCompare(b.materialDescription || '', undefined, { numeric: true, sensitivity: 'base' });
          }
          break;
        }
        case 'quantity': {
          result = (Number(a.quantity) || 0) - (Number(b.quantity) || 0);
          break;
        }
        case 'date': {
          const timeA = a.date ? new Date(a.date).getTime() : 0;
          const timeB = b.date ? new Date(b.date).getTime() : 0;
          result = timeA - timeB;
          break;
        }
        case 'returnSlipFormNumber': {
          result = (a.returnSlipFormNumber || '').localeCompare(b.returnSlipFormNumber || '', undefined, { numeric: true, sensitivity: 'base' });
          break;
        }
        case 'category': {
          result = (a.category || '').localeCompare(b.category || '');
          break;
        }
        case 'department': {
          result = (a.department || '').localeCompare(b.department || '');
          break;
        }
        case 'condition': {
          result = (a.condition || '').localeCompare(b.condition || '');
          break;
        }
        case 'status': {
          result = (a.status || '').localeCompare(b.status || '');
          break;
        }
        default:
          result = 0;
      }
      return retSortDirection === 'asc' ? result : -result;
    });
  }, [filteredReturns, retSortField, retSortDirection]);

  return (
    <div className="space-y-6" id="receiving-module">
      {/* Official Header Banner matching Dashboard Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-5 rounded-2xl shadow-md border border-slate-800 flex flex-col md:flex-row md:justify-between md:items-center gap-4 text-white">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold font-mono px-2 py-0.5 rounded border border-indigo-500/30">
              {t('receiving.bannerBadge')}
            </span>
            <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block" /> {t('receiving.activeBadge')}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">{t('receiving.moduleTitle')}</h2>
          <p className="text-xs text-slate-300 mt-1">
            {t('receiving.moduleSubtitle')}
          </p>
        </div>
        
        {/* Module Tabs */}
        <div className="flex bg-slate-950/60 p-1.5 rounded-xl border border-slate-700/60 self-start md:self-auto shrink-0">
          <button 
            onClick={() => { setActiveTab('external-internal'); setSearchQuery(''); }}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'external-internal' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <Truck className="h-4 w-4" /> {t('receiving.tabArrivals')}
          </button>
          <button 
            onClick={() => { setActiveTab('returns'); setSearchQuery(''); }}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'returns' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <RotateCcw className="h-4 w-4" /> {t('receiving.tabExcessReturns')}
          </button>
        </div>
      </div>

      {activeTab === 'external-internal' ? (
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto flex-1 max-w-xl">
              <div className="relative w-full sm:w-64">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Search className="h-4 w-4" />
                </span>
                <input 
                  type="text" 
                  placeholder={t('receiving.searchArrivalsPlaceholder')} 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
                />
              </div>

              {/* Category Filter Dropdown */}
              <div className="w-full sm:w-auto">
                <select
                  value={classificationFilter}
                  onChange={e => setClassificationFilter(e.target.value)}
                  className="w-full sm:w-auto px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:ring-1 focus:ring-slate-400 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">{t('receiving.allCategoriesOption', { count: managedCategories.length })}</option>
                  {managedCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button 
                type="button"
                onClick={() => setShowScannerModal(true)}
                className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-3.5 rounded-lg flex items-center justify-center gap-2 shadow-sm transition shrink-0"
                id="btn-scan-receiving-barcode"
              >
                <ScanLine className="h-4 w-4" /> {t('receiving.scanBtn')}
              </button>

              {effectiveCanEdit ? (
                <button 
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 shrink-0"
                  id="btn-log-arrival"
                >
                  <Plus className="h-4 w-4" /> {t('receiving.logNewArrivalBtn')}
                </button>
              ) : (
                <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded font-bold uppercase">
                  {t('receiving.viewOnlyNotice')}
                </span>
              )}
            </div>
          </div>

          {/* Form Modal/Collapsible */}
          {showAddForm && (
            <form 
              noValidate
              onSubmit={handleSubmitReceiving}
              className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6 transition-all"
              id="arrival-form"
            >
              <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-slate-500" /> {t('receiving.entryFormTitle')}
                  </h3>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> {t('receiving.autoSavedDraft')}
                  </span>
                </div>
                <button 
                  type="button" 
                  onClick={handleDiscardReceiving}
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
                    <span><strong>{t('receiving.scanItemLabel')}</strong> {confirmedScanInfo.itemName}</span>
                    <span className="font-mono"><strong>{t('receiving.scanLotLabel')}</strong> {confirmedScanInfo.lot}</span>
                    <span><strong>{t('receiving.scanLocationLabel')}</strong> {confirmedScanInfo.location}</span>
                  </div>
                </div>
              )}

              {/* Category Selector at Top */}
              <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-indigo-900 uppercase tracking-wider">
                    {t('receiving.selectCategoryRequired')}
                  </label>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => setShowCategoriesModal(true)}
                      className="text-[11px] font-mono font-bold text-indigo-700 hover:text-indigo-950 bg-indigo-100/90 hover:bg-indigo-200 border border-indigo-200/80 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title={t('receiving.tooltipManageCats')}
                    >
                      <Tag className="h-3.5 w-3.5 text-indigo-600" />
                      <span>{t('receiving.manageCategoriesBtn')}</span>
                    </button>
                  )}
                </div>
                <select 
                  required
                  value={supplierOrDept}
                  onChange={e => {
                    const cat = e.target.value;
                    if (cat === '__ADD_NEW__') {
                      setShowCategoriesModal(true);
                      return;
                    }
                    setSupplierOrDept(cat);
                    clearRecErr('supplierOrDept');
                  }}
                  className={`w-full px-3.5 py-2.5 bg-white border rounded-lg text-xs font-bold text-indigo-950 focus:ring-2 focus:outline-none cursor-pointer shadow-2xs ${
                    receivingFieldErrors.supplierOrDept
                      ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                      : 'border-indigo-200 focus:ring-indigo-500'
                  }`}
                >
                  <option value="">{t('receiving.selectCategoryOption')}</option>
                  {managedCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  {isSuperAdmin && (
                    <option value="__ADD_NEW__" className="text-indigo-600 font-bold bg-indigo-50/60">{t('receiving.addNewCategoryOption')}</option>
                  )}
                </select>
                {receivingFieldErrors.supplierOrDept && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                    {localizeValidation(receivingFieldErrors.supplierOrDept)}
                  </p>
                )}
                <p className="text-[11px] text-indigo-600 font-medium">
                  {supplierOrDept ? t('receiving.categoryTailoredHint', { category: supplierOrDept }) : t('receiving.categorySelectHint')}
                </p>
              </div>

              {/* Dynamic Category Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">
                      {(isDirectBomCategory || isIndirectBomCategory || isWipCategory) ? t('receiving.labelModelReq') : (isConsumableCategory || isOfficeSuppliesCategory) ? t('receiving.labelItemNameReq') : isRawCategory ? t('receiving.labelResinSackNameReq') : isPackagingCategory ? t('receiving.labelPackagingNameReq') : t('receiving.labelPartNameReq')}
                    </label>
                    <input 
                      type="text"
                      required
                      placeholder={(isDirectBomCategory || isIndirectBomCategory || isWipCategory) ? 'E.G. MODEL-X200' : isConsumableCategory ? 'E.G. GLOVES / WIPER / ALCOHOL' : isOfficeSuppliesCategory ? 'E.G. A4 PAPER / PEN / STAPLER' : isRawCategory ? 'E.G. POLYETHYLENE RESIN SACKS' : 'E.G. ITEM NAME'}
                      value={lotNumber}
                      onChange={e => setLotNumber(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">
                      {(isDirectBomCategory || isIndirectBomCategory || isWipCategory) ? t('receiving.labelPartNameReq') : (isConsumableCategory || isOfficeSuppliesCategory) ? t('receiving.labelItemSpecReq') : isRawCategory ? t('receiving.labelResinGradeReq') : isPackagingCategory ? t('receiving.labelPackagingSpecReq') : t('receiving.labelPartCodeSpecReq')}
                    </label>
                    <input 
                      type="text"
                      required
                      placeholder={isWipCategory ? 'E.G. SUB-ASSEMBLY / BRACKET' : isDirectBomCategory ? 'E.G. FRONT COVER / BRACKET' : isIndirectBomCategory ? 'E.G. HEX BOLT M6 / CUSHION PAD' : isConsumableCategory ? 'E.G. CON-SPEC-001' : isOfficeSuppliesCategory ? 'E.G. 80GSM / BLUE / BOX OF 10' : isRawCategory ? 'E.G. ABS-301-NAT' : isPackagingCategory ? 'E.G. CARTON BOX / TAPE / FILM' : 'E.G. MODEL-X200'}
                      value={partCode}
                      onChange={e => {
                        const val = e.target.value;
                        setPartCode(val);
                        clearRecErr('partCode');
                        const presetUnit = findMasterPresetUnit({ partCode: val, description: itemDescription }, registries);
                        if (presetUnit) {
                          setUnit(presetUnit);
                          clearRecErr('unit');
                        }
                      }}
                      className={`w-full px-3 py-2 border rounded-lg text-xs font-mono focus:ring-1 focus:outline-none ${
                        receivingFieldErrors.partCode
                          ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                          : 'border-slate-200 focus:ring-slate-400'
                      }`}
                    />
                    {receivingFieldErrors.partCode && (
                      <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                        {localizeValidation(receivingFieldErrors.partCode)}
                      </p>
                    )}
                  </div>

                  {isRawCategory && !isIndirectBomCategory && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">
                        {t('receiving.labelResinColor')}
                      </label>
                      <input 
                        type="text"
                        placeholder="E.G. NATURAL, BLACK, RED, BLUE"
                        value={color}
                        onChange={e => setColor(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none font-medium"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">{t('receiving.labelQuantityReq')}</label>
                    <input 
                      type="text"
                      inputMode="decimal"
                      required
                      placeholder={t('receiving.labelQuantityReq')}
                      value={quantityInput}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9.-]/g, '');
                        setQuantityInput(raw);
                        const num = Number(raw);
                        setQuantity(raw.trim() === '' || Number.isNaN(num) ? 0 : num);
                        clearRecErr('quantity');
                      }}
                      className={`w-full px-3 py-2 border rounded-lg text-xs font-mono focus:ring-1 focus:outline-none ${
                        receivingFieldErrors.quantity
                          ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                          : 'border-slate-200 focus:ring-slate-400'
                      }`}
                    />
                    {receivingFieldErrors.quantity && (
                      <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                        {localizeValidation(receivingFieldErrors.quantity)}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">{t('receiving.labelUnitOfMeasureReq')}</label>
                    <select 
                      value={unit}
                      onChange={e => {
                        setUnit(e.target.value);
                        clearRecErr('unit');
                      }}
                      required
                      className={`w-full px-3 py-2 border rounded-lg text-xs focus:ring-1 focus:outline-none font-semibold ${
                        receivingFieldErrors.unit
                          ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                          : 'border-slate-200 focus:ring-slate-400'
                      }`}
                    >
                      <option value="">{t('receiving.selectUomOption')}</option>
                      {getAllSelectUomOptions(unit).map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                    {receivingFieldErrors.unit && (
                      <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                        {localizeValidation(receivingFieldErrors.unit)}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">{t('receiving.labelDateReceivedReq')}</label>
                    <input 
                      type="date"
                      required
                      value={receivedDate}
                      onChange={e => {
                        setReceivedDate(e.target.value);
                        clearRecErr('receivedDate');
                        clearRecErr('expirationDate');
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">{t('receiving.labelExpiryOpt')}</label>
                    <input 
                      type="date"
                      value={expirationDate}
                      onChange={e => {
                        setExpirationDate(e.target.value);
                        clearRecErr('expirationDate');
                      }}
                      className={`w-full px-3 py-2 border rounded-lg text-xs font-mono focus:ring-1 focus:outline-none ${
                        receivingFieldErrors.expirationDate
                          ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                          : 'border-slate-200 focus:ring-slate-400'
                      }`}
                    />
                    {receivingFieldErrors.expirationDate && (
                      <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                        {localizeValidation(receivingFieldErrors.expirationDate)}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">{t('receiving.labelLocationReq')}</label>
                    <input 
                      type="text"
                      required
                      list="registered-locations-list"
                      placeholder="E.G. ZONE A - RACK 04"
                      value={location}
                      onChange={e => {
                        setLocation(e.target.value);
                        clearRecErr('location');
                      }}
                      className={`w-full px-3 py-2 border rounded-lg text-xs focus:ring-1 focus:outline-none ${
                        receivingFieldErrors.location
                          ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                          : 'border-slate-200 focus:ring-slate-400'
                      }`}
                    />
                    {receivingFieldErrors.location && (
                      <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                        {localizeValidation(receivingFieldErrors.location)}
                      </p>
                    )}
                    <datalist id="registered-locations-list">
                      {registries.filter(r => r.type === 'LOCATION' && r.status === 'ACTIVE').map(loc => (
                        <option key={loc.id} value={loc.name} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">
                      {isWipCategory || isDirectBomCategory ? t('receiving.labelDepartmentReq') : t('receiving.labelSupplierVendorReq')}
                    </label>
                    <input 
                      type="text"
                      required
                      list="registered-suppliers-list"
                      placeholder={isWipCategory || isDirectBomCategory ? 'E.G. PRODUCTION DEPT / ASSEMBLY' : 'E.G. APEX CHEMICAL CORP'}
                      value={vendorSupplier}
                      onChange={e => setVendorSupplier(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
                    />
                    <datalist id="registered-suppliers-list">
                      {registries.filter(r => r.type === 'SUPPLIER' && r.status === 'ACTIVE').map(sup => (
                        <option key={sup.id} value={sup.name} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">{t('receiving.labelReorderMin')}</label>
                    <input 
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="E.G. 50"
                      value={reorderMin || ''}
                      onKeyDown={(e) => {
                        if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                          e.preventDefault();
                        }
                      }}
                      onChange={e => {
                        const sanitized = e.target.value.replace(/\D/g, '');
                        setReorderMin(sanitized ? parseInt(sanitized, 10) : 0);
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-400 focus:outline-none"
                    />
                  </div>

                </div>

              {/* VERIFICATION DOCUMENTS SECTION */}
              <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  {t('receiving.verificationDocsHeader')}
                </h4>
                {isDirectBomCategory || isWipCategory ? (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-tight">
                      {isFgCategory ? t('receiving.labelTransferFgtf') : t('receiving.labelTransferPts')}
                    </label>
                    <input 
                      type="text"
                      placeholder={isFgCategory ? 'FGTF-2026-XXXX' : 'PTS-2026-XXXX'}
                      value={transferFormNumber}
                      onChange={e => setTransferFormNumber(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-tight">
                        {t('receiving.rrHeaderLabel')}
                      </label>
                      <input 
                        type="text"
                        placeholder="RR-2026-0001"
                        value={rrNumber}
                        onChange={e => {
                          setRrNumber(e.target.value);
                          clearRecErr('rrNumber');
                        }}
                        className={`w-full px-3 py-2 bg-white border rounded-lg text-xs font-mono focus:ring-1 focus:outline-none ${
                          receivingFieldErrors.rrNumber
                            ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                            : 'border-slate-200 focus:ring-indigo-500'
                        }`}
                      />
                      {receivingFieldErrors.rrNumber && (
                        <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                          {localizeValidation(receivingFieldErrors.rrNumber)}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-tight">
                        {t('receiving.poHeaderLabel')}
                      </label>
                      <input 
                        type="text"
                        placeholder="PO-2026-0001"
                        value={poNumber}
                        onChange={e => {
                          setPoNumber(e.target.value);
                          clearRecErr('poNumber');
                        }}
                        className={`w-full px-3 py-2 bg-white border rounded-lg text-xs font-mono focus:ring-1 focus:outline-none ${
                          receivingFieldErrors.poNumber
                            ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                            : 'border-slate-200 focus:ring-indigo-500'
                        }`}
                      />
                      {receivingFieldErrors.poNumber && (
                        <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                          {localizeValidation(receivingFieldErrors.poNumber)}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-tight">
                        {t('receiving.drHeaderLabel')}
                      </label>
                      <input 
                        type="text"
                        placeholder="DR-00001"
                        value={drNumber}
                        onChange={e => {
                          setDrNumber(e.target.value);
                          clearRecErr('drNumber');
                        }}
                        className={`w-full px-3 py-2 bg-white border rounded-lg text-xs font-mono focus:ring-1 focus:outline-none ${
                          receivingFieldErrors.drNumber
                            ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                            : 'border-slate-200 focus:ring-indigo-500'
                        }`}
                      />
                      {receivingFieldErrors.drNumber && (
                        <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                          {localizeValidation(receivingFieldErrors.drNumber)}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-tight">
                        {t('receiving.siHeaderLabel')}
                      </label>
                      <input 
                        type="text"
                        placeholder="SI-00001"
                        value={siNumber}
                        onChange={e => {
                          setSiNumber(e.target.value);
                          clearRecErr('siNumber');
                        }}
                        className={`w-full px-3 py-2 bg-white border rounded-lg text-xs font-mono focus:ring-1 focus:outline-none ${
                          receivingFieldErrors.siNumber
                            ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                            : 'border-slate-200 focus:ring-indigo-500'
                        }`}
                      />
                      {receivingFieldErrors.siNumber && (
                        <p className="mt-1 text-[11px] font-semibold text-rose-600" role="alert">
                          {localizeValidation(receivingFieldErrors.siNumber)}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* SOP Receiving Condition Verification Checklist */}
              <div className="border-t border-slate-100 pt-4 space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">SOP Receiving Condition Verification Checklist</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">Please physically verify and inspect the items against SOP criteria before checking them off:</p>
                </div>
                
                <div className="space-y-2 bg-slate-50/80 p-4 rounded-xl border border-slate-200">
                  <label className="flex items-start gap-3 p-2.5 bg-white rounded-lg border border-slate-200 cursor-pointer hover:border-indigo-300 transition-colors">
                    <input 
                      type="checkbox"
                      checked={sopReceivingInspection}
                      onChange={e => setSopReceivingInspection(e.target.checked)}
                      className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 mt-0.5 shrink-0"
                    />
                    <div>
                      <span className="block text-xs font-bold text-slate-800">Receiving Inspection & Verification</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">Verify PO/Delivery Receipt, item code, description, quantity, and supplier before acceptance.</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-2.5 bg-white rounded-lg border border-slate-200 cursor-pointer hover:border-indigo-300 transition-colors">
                    <input 
                      type="checkbox"
                      checked={sopMaterialTraceability}
                      onChange={e => setSopMaterialTraceability(e.target.checked)}
                      className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 mt-0.5 shrink-0"
                    />
                    <div>
                      <span className="block text-xs font-bold text-slate-800">Material Identification & Traceability</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">Ensure Lot/Batch No., item code, receiving date, and labels are correctly recorded.</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-2.5 bg-white rounded-lg border border-slate-200 cursor-pointer hover:border-indigo-300 transition-colors">
                    <input 
                      type="checkbox"
                      checked={sopQuantityAccuracy}
                      onChange={e => setSopQuantityAccuracy(e.target.checked)}
                      className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 mt-0.5 shrink-0"
                    />
                    <div>
                      <span className="block text-xs font-bold text-slate-800">Quantity Accuracy</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">Compare physical quantity against PO, Delivery Receipt, and Receiving Report.</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-2.5 bg-white rounded-lg border border-slate-200 cursor-pointer hover:border-indigo-300 transition-colors">
                    <input 
                      type="checkbox"
                      checked={sopMaterialCondition}
                      onChange={e => setSopMaterialCondition(e.target.checked)}
                      className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 mt-0.5 shrink-0"
                    />
                    <div>
                      <span className="block text-xs font-bold text-slate-800">Material Condition & Quality Check</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">Check for damage, contamination, incorrect material, or other visible abnormalities. Segregate non-conforming materials.</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-2.5 bg-white rounded-lg border border-slate-200 cursor-pointer hover:border-indigo-300 transition-colors">
                    <input 
                      type="checkbox"
                      checked={sopSystemRecording}
                      onChange={e => setSopSystemRecording(e.target.checked)}
                      className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 mt-0.5 shrink-0"
                    />
                    <div>
                      <span className="block text-xs font-bold text-slate-800">Receiving Documentation & System Recording</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">Complete Receiving Report and update WMS/system accurately and on time.</span>
                    </div>
                  </label>
                </div>

                {(!sopReceivingInspection || !sopMaterialTraceability || !sopQuantityAccuracy || !sopMaterialCondition || !sopSystemRecording) && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-center gap-2">
                    <AlertOctagon className="h-4 w-4 text-rose-500 shrink-0" />
                    <strong>Discrepancy spotted:</strong> Received materials will automatically be routed to the <strong>Quarantine Area</strong> pending IQC evaluation.
                  </div>
                )}

                {/* Remarks Below Checklist */}
                <div className="pt-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">{t('receiving.remarksLabel')}</label>
                  <textarea 
                    rows={2}
                    placeholder={t('receiving.remarksPlaceholder')}
                    value={remarks}
                    onChange={e => setRemarks(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-2">
                <button 
                  type="button"
                  onClick={handleDiscardReceiving}
                  className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  {t('receiving.discardBtn')}
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  {t('receiving.verifyLogBtn')}
                </button>
              </div>
            </form>
          )}

          {/* Receiving Logs Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-slate-50/50">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{t('receiving.tableLogTitle')}</span>
                <span className="bg-slate-200/80 text-slate-700 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full">
                  {t('receiving.logsFound', { count: filteredReceiving.length })}
                </span>
                <span className="text-[11px] text-slate-500 font-medium hidden md:inline">
                  &bull; {t('receiving.sortedByLabel')} <strong className="text-indigo-700 font-semibold">{recSortField}</strong> ({recSortDirection === 'asc' ? t('receiving.ascLabel') : t('receiving.descLabel')})
                </span>
              </div>
              {filteredReceiving.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('receiving.totalsLabel')}</span>
                  {groupQuantitiesByUnit(
                    filteredReceiving,
                    (rec) => rec.quantity,
                    (rec) => resolveMasterDataUnit(rec, registries, stocks).unit
                  ).buckets.map((b) => (
                    <span
                      key={b.key}
                      className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold border ${
                        b.isMissing
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-white text-slate-800 border-slate-200'
                      }`}
                    >
                      {b.total.toLocaleString()} {b.displayUnit}
                    </span>
                  ))}
                </div>
              )}
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 font-medium border-b border-slate-200 divide-x divide-slate-200/50">
                    {/* 1. RR # */}
                    <th 
                      onClick={() => handleRecSort('rrNumber')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'rrNumber' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colRr') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colRr')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'rrNumber' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>

                    {/* 2. Date Received */}
                    <th 
                      onClick={() => handleRecSort('date')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'date' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colDateReceived') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colDateReceived')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'date' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>

                    {/* 3. Item Type */}
                    <th 
                      onClick={() => handleRecSort('supplierOrDept')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'supplierOrDept' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colItemType') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colItemType')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'supplierOrDept' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>

                    {/* 4. Item/Part Code */}
                    <th 
                      onClick={() => handleRecSort('partCode')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'partCode' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colPartCode') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colPartCode')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'partCode' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>

                    {/* 5. Quantity */}
                    <th 
                      onClick={() => handleRecSort('quantity')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group text-right ${
                        recSortField === 'quantity' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colQuantity') })}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>{t('receiving.colQuantity')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'quantity' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>

                    {/* 6. FIFO Tag Color */}
                    <th 
                      onClick={() => handleRecSort('fifoColor')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'fifoColor' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colFifoColor') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colFifoColor')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'fifoColor' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>

                    {/* 7. SOP Compliance */}
                    <th className="p-3 font-semibold text-slate-600">{t('receiving.colSopCompliance')}</th>

                    {/* 8. IQC Status */}
                    <th 
                      onClick={() => handleRecSort('iqcStatus')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'iqcStatus' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colIqcStatus') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colIqcStatus')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'iqcStatus' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>

                    {/* 9. Action */}
                    <th className="p-3 font-semibold text-slate-600">{t('receiving.colAction')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedReceiving.map(r => {
                    const pc = r.physicalCondition || {};
                    const isNewSop = pc.receivingInspection !== undefined || pc.materialTraceability !== undefined || pc.quantityAccuracy !== undefined || pc.materialConditionCheck !== undefined || pc.systemRecording !== undefined;
                    const isPassed = isNewSop ? (
                      pc.receivingInspection !== false &&
                      pc.materialTraceability !== false &&
                      pc.quantityAccuracy !== false &&
                      pc.materialConditionCheck !== false &&
                      pc.systemRecording !== false
                    ) : (
                      (pc.boxIntact ?? true) &&
                      (pc.noWaterDamage ?? true) &&
                      (pc.noPestSign ?? true) &&
                      (pc.noContamination ?? true)
                    );
                    const totalSopCount = isNewSop ? 5 : 4;
                    const isExpanded = expandedReceivingId === r.id;

                    const matchedStock = stocks.find(s => 
                      (s.partCode || '').trim().toLowerCase() === (r.partCode || '').trim().toLowerCase() && 
                      (!r.lotNumber || (s.lotNumber || '').trim().toLowerCase() === (r.lotNumber || '').trim().toLowerCase())
                    );

                    return (
                      <React.Fragment key={r.id}>
                        <tr 
                          onClick={(e) => {
                            const target = e.target as HTMLElement;
                            if (target.closest('button, select, input, a, [data-no-expand="true"]')) return;
                            setExpandedReceivingId(prev => prev === r.id ? null : r.id);
                          }}
                          className={`cursor-pointer transition-all duration-150 ${
                            isExpanded 
                              ? 'bg-indigo-50/70 border-l-4 border-l-indigo-600 shadow-2xs' 
                              : 'hover:bg-indigo-50/30 hover:border-l-4 hover:border-l-indigo-300'
                          }`}
                          title={t('receiving.rowExpandTooltip')}
                        >
                          {/* 1. RR # */}
                          <td className="p-4 font-mono font-semibold text-slate-900">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedReceivingId(prev => prev === r.id ? null : r.id);
                                }}
                                className={`p-1 rounded-md transition-colors ${
                                  isExpanded ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                                }`}
                                title={isExpanded ? t('receiving.collapseRowBtn') : t('receiving.expandRowBtn')}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <span>{r.rrNumber || r.id}</span>
                            </div>
                          </td>

                          {/* 2. Date Received */}
                          <td className="p-4 text-slate-600 font-mono whitespace-nowrap">{r.date}</td>

                          {/* 3. Item Type */}
                          <td className="p-4">
                            <span className="bg-slate-100 text-slate-800 border border-slate-200 text-[10px] font-extrabold px-2 py-1 rounded font-sans uppercase tracking-tight inline-block whitespace-nowrap">
                              {r.supplierOrDept || t('common.na')}
                            </span>
                          </td>

                          {/* 4. Item/Part Code */}
                          <td className="p-4">
                            <div className="font-mono font-semibold text-slate-800">
                              {r.partCode}
                            </div>
                          </td>

                          {/* 5. Quantity */}
                          <td className="p-4 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                            {(() => {
                              const recUnit = resolveMasterDataUnit(r, registries, stocks);
                              return (
                                <>
                                  {r.quantity.toLocaleString()}{' '}
                                  {recUnit.isMissing ? (
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 text-[9px] font-bold">
                                      {t('common.missingUnit')}
                                    </span>
                                  ) : (
                                    recUnit.unit
                                  )}
                                </>
                              );
                            })()}
                          </td>

                          {/* 6. FIFO Tag Color */}
                          <td className="p-4 whitespace-nowrap">
                            {(() => {
                              const displayColor = normalizeFifoColor(r.fifoColorCode || (r as any).fifoColor, r.receivedDate || r.date, fifoColorsByMonth);
                              const meta = resolveFifoColor(displayColor, undefined, undefined, fifoColorsByMonth);
                              return (
                                <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                                  <span 
                                    className={`h-3 w-3 rounded-full border border-slate-200 shadow-sm ${meta.colorClass}`}
                                    style={meta.hex ? { backgroundColor: meta.hex } : undefined}
                                  />
                                  {displayColor}
                                </span>
                              );
                            })()}
                          </td>

                          {/* 7. SOP Compliance */}
                          <td className="p-4">
                            {isPassed ? (
                              <span className="text-emerald-600 font-medium flex items-center gap-1 text-xs whitespace-nowrap">
                                <ShieldCheck className="h-4 w-4 shrink-0" /> {t('receiving.passedChecklist', { count: totalSopCount })}
                              </span>
                            ) : (
                              <div className="text-rose-600 font-medium space-y-0.5">
                                <div className="flex items-center gap-1 text-xs whitespace-nowrap"><AlertOctagon className="h-3.5 w-3.5 shrink-0" /> {t('receiving.discrepancySpotted')}</div>
                                <div className="text-[10px] text-slate-400">
                                  {isNewSop ? (
                                    [
                                      pc.receivingInspection === false && 'Inspection failed',
                                      pc.materialTraceability === false && 'Traceability issue',
                                      pc.quantityAccuracy === false && 'Qty mismatch',
                                      pc.materialConditionCheck === false && 'Condition defect',
                                      pc.systemRecording === false && 'System recording issue'
                                    ].filter(Boolean).join(', ')
                                  ) : (
                                    [
                                      !pc.boxIntact && 'Box broken',
                                      !pc.noWaterDamage && 'Water spotted',
                                      !pc.noPestSign && 'Pest signs',
                                      !pc.noContamination && 'Contaminated'
                                    ].filter(Boolean).join(', ')
                                  )}
                                </div>
                              </div>
                            )}
                          </td>

                          {/* 8. IQC Status */}
                          <td className="p-4 whitespace-nowrap">
                            {r.iqcStatus === 'NA' ? (
                              <span className="text-slate-400 italic">{t('receiving.iqcNa')}</span>
                            ) : r.iqcStatus === 'PENDING_IQC' ? (
                              <span className="bg-amber-50 border border-amber-100 text-amber-700 px-2 py-1 rounded font-semibold text-[10px]">
                                {t('receiving.awaitingIqcBadge')}
                              </span>
                            ) : r.iqcStatus === 'APPROVED_IQC' ? (
                              <span className="bg-emerald-50 border border-emerald-100 text-emerald-700 px-2 py-1 rounded font-semibold text-[10px]">
                                {t('receiving.iqcApprovedBadge')}
                              </span>
                            ) : (
                              <span className="bg-rose-50 border border-rose-100 text-rose-700 px-2 py-1 rounded font-semibold text-[10px]">
                                {t('receiving.iqcRejectedBadge')}
                              </span>
                            )}
                          </td>

                          {/* 9. Action */}
                          <td className="p-4" data-no-expand="true">
                            {effectiveCanEdit || isSuperAdmin ? (
                              <select
                                defaultValue=""
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === 'APPROVE') {
                                    setConfirmAction({
                                      title: t('receiving.confirmApproveIqcTitle'),
                                      message: t('receiving.confirmApproveIqcMsg', { id: r.rrNumber || r.id, partCode: r.partCode }),
                                      confirmLabel: t('receiving.confirmYesApproveIqc'),
                                      confirmVariant: 'primary',
                                      onConfirm: () => onUpdateIqc(r.id, 'APPROVED_IQC')
                                    });
                                  } else if (val === 'REJECT') {
                                    setConfirmAction({
                                      title: t('receiving.confirmRejectIqcTitle'),
                                      message: t('receiving.confirmRejectIqcMsg', { id: r.rrNumber || r.id, partCode: r.partCode }),
                                      confirmLabel: t('receiving.confirmYesRejectIqc'),
                                      confirmVariant: 'danger',
                                      onConfirm: () => onUpdateIqc(r.id, 'REJECTED_IQC')
                                    });
                                  } else if (val === 'EDIT') {
                                    setEditReceivingFieldErrors({});
                                    setEditReceivingQtyInput(String(r.quantity ?? ''));
                                    setEditingReceiving({ ...r });
                                  } else if (val === 'DELETE') {
                                    if (!isSuperAdmin) return;
                                    setConfirmAction({
                                      title: t('receiving.confirmDeleteTitle'),
                                      message: t('receiving.confirmDeleteMsg', { id: r.rrNumber || r.id, partCode: r.partCode }),
                                      confirmLabel: t('receiving.confirmYesDelete'),
                                      confirmVariant: 'danger',
                                      onConfirm: () => onDeleteReceiving?.(r.id)
                                    });
                                  }
                                  e.target.value = '';
                                }}
                                className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                                id={`action-select-rec-${r.id}`}
                              >
                                <option value="" disabled>{t('receiving.actionsPlaceholder')}</option>
                                {r.iqcStatus === 'PENDING_IQC' && (
                                  <>
                                    <option value="APPROVE">✅ {t('receiving.actionApproveIqc')}</option>
                                    <option value="REJECT">❌ {t('receiving.actionRejectIqc')}</option>
                                  </>
                                )}
                                <option value="EDIT">📝 {t('receiving.actionEditRecord')}</option>
                                {isSuperAdmin && (
                                  <option value="DELETE">🗑️ {t('receiving.actionDeleteRecord')}</option>
                                )}
                              </select>
                            ) : (
                              <span className="text-slate-400 italic font-semibold text-[10px]">{t('receiving.readOnlyTag')}</span>
                            )}
                          </td>
                        </tr>

                        {/* Expandable Card View */}
                        <AnimatePresence>
                          {isExpanded && (
                            <tr>
                              <td colSpan={9} className="p-0 bg-slate-50/80 border-b-2 border-indigo-200">
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
                                              {t('receiving.receivingReportPrefix')} <span className="font-mono text-indigo-600">{r.rrNumber || r.id}</span>
                                            </span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                              r.source === 'INTERNAL' 
                                                ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                            }`}>
                                              {r.source === 'INTERNAL' ? t('receiving.internalTransferBadge') : t('receiving.externalSupplierBadge')}
                                            </span>
                                          </div>
                                          <p className="text-xs text-slate-500 mt-0.5">
                                            {t('receiving.scanItemLabel')} <strong className="font-mono text-slate-700">{r.itemDescription || r.partCode}</strong> &bull; {t('receiving.cardPartLabel')} <strong className="font-mono text-slate-700">{r.partCode}</strong>
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="bg-slate-100 text-slate-700 font-mono font-semibold px-2.5 py-1 rounded-lg border border-slate-200">
                                          {t('receiving.cardReceivedLabel')} {r.date}
                                        </span>
                                        <span className="bg-indigo-50 text-indigo-800 font-bold px-2.5 py-1 rounded-lg border border-indigo-200 font-mono">
                                          {(() => {
                                            const recUnit = resolveMasterDataUnit(r, registries, stocks);
                                            return `${t('receiving.cardQtyLabel')} ${r.quantity.toLocaleString()} ${recUnit.unit || MISSING_UNIT_LABEL}`;
                                          })()}
                                        </span>
                                        {matchedStock && (
                                          <span className="bg-emerald-50 text-emerald-800 font-bold px-2.5 py-1 rounded-lg border border-emerald-200 font-mono">
                                            {t('receiving.activeStockLabel')} {matchedStock.quantity.toLocaleString()} {resolveMasterDataUnit(matchedStock, registries, stocks).unit || MISSING_UNIT_LABEL}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* 3-Column Detailed Metadata Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                      {/* Col 1: Traceability & Shipping Docs */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <FileText className="h-4 w-4 text-indigo-500" />
                                          <span>{t('receiving.traceabilitySection')}</span>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                                          <div className="bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                                            <span className="text-slate-500 text-[11px] font-semibold block mb-0.5">{t('receiving.colorLabelCard')}</span>
                                            {r.color ? (
                                              <span className="bg-purple-50 text-purple-700 text-xs font-bold px-2 py-0.5 rounded border border-purple-200 inline-block font-sans">
                                                {r.color}
                                              </span>
                                            ) : (
                                              <span className="text-slate-400 font-medium">{t('receiving.noneNa')}</span>
                                            )}
                                          </div>
                                          <div className="bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                                            <span className="text-slate-500 text-[11px] font-semibold block mb-0.5">{t('receiving.supplierLabel')}</span>
                                            <span className="font-semibold text-slate-800 truncate block" title={r.vendorSupplier && r.vendorSupplier !== 'N/A' ? r.vendorSupplier : (r.supplierOrDept || t('common.na'))}>
                                              {r.vendorSupplier && r.vendorSupplier !== 'N/A' ? r.vendorSupplier : (r.supplierOrDept || t('common.na'))}
                                            </span>
                                          </div>
                                          <div className="bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                                            <span className="text-slate-500 text-[11px] font-semibold block mb-0.5">PO #:</span>
                                            <span className="font-mono font-semibold text-slate-800">
                                              {r.poNumber ? (
                                                r.poNumber
                                              ) : r.source === 'INTERNAL' && r.transferFormNumber ? (
                                                `${t('receiving.cardSlipPrefix')} ${r.transferFormNumber}`
                                              ) : (
                                                t('common.na')
                                              )}
                                            </span>
                                          </div>
                                          <div className="bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                                            <span className="text-slate-500 text-[11px] font-semibold block mb-0.5">DR #:</span>
                                            <span className="font-mono font-semibold text-slate-800">{r.drNumber || t('common.na')}</span>
                                          </div>
                                          <div className="bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                                            <span className="text-slate-500 text-[11px] font-semibold block mb-0.5">SI #:</span>
                                            <span className="font-mono font-semibold text-slate-800">{r.siNumber || t('common.na')}</span>
                                          </div>
                                          <div className="bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                                            <span className="text-slate-500 text-[11px] font-semibold block mb-0.5">{t('receiving.lotBatchLabel')}</span>
                                            <span className="font-mono font-bold text-indigo-700">{r.lotNumber || t('common.na')}</span>
                                          </div>
                                          <div className="bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                                            <span className="text-slate-500 text-[11px] font-semibold block mb-0.5">{t('receiving.locationAisleLabel')}</span>
                                            <span className="font-mono font-semibold text-slate-800">{r.location || (matchedStock?.location) || 'Main Storage'}</span>
                                          </div>
                                        </div>

                                        {r.bom && r.bom.length > 0 && (
                                          <div className="mt-2 bg-slate-50 border border-slate-200 p-2 rounded-lg">
                                            <span className="text-[10px] font-bold text-indigo-700 uppercase block mb-1">BOM Components ({r.bom.length})</span>
                                            <div className="space-y-1 max-h-[85px] overflow-y-auto pr-1">
                                              {r.bom.map((b, idx) => (
                                                <div key={idx} className="flex justify-between items-center text-[10px] font-mono text-slate-600 leading-tight">
                                                  <span className="truncate max-w-[150px]" title={`${b.partCode}: ${b.description}`}>{b.partCode}</span>
                                                  <span className="font-bold text-slate-800">{b.quantityRequired} {normalizeUnitCode(b.unit) || MISSING_UNIT_LABEL}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                      {/* Col 2: SOP 5-Point Quality Verification */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
                                            <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                            <span>{t('receiving.sopVerificationSection')}</span>
                                          </div>
                                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                            isPassed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                          }`}>
                                            {isPassed ? t('receiving.allPassedBadge') : t('receiving.discrepancyBadge')}
                                          </span>
                                        </div>
                                        
                                        <div className="space-y-1.5 text-xs">
                                          {isNewSop ? (
                                            <>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">1. {t('receiving.discrepancyInspection')}</span>
                                                <span className={pc.receivingInspection !== false ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.receivingInspection !== false ? t('receiving.sopVerifiedTick') : t('receiving.sopFailedTick')}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">2. {t('receiving.discrepancyTraceability')}</span>
                                                <span className={pc.materialTraceability !== false ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.materialTraceability !== false ? t('receiving.sopLotRecorded') : t('receiving.sopUnverified')}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">3. {t('receiving.discrepancyQty')}</span>
                                                <span className={pc.quantityAccuracy !== false ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.quantityAccuracy !== false ? t('receiving.sop100Match') : t('receiving.sopDiscrepancy')}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">4. {t('receiving.discrepancyCondition')}</span>
                                                <span className={pc.materialConditionCheck !== false ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.materialConditionCheck !== false ? t('receiving.sopGoodCond') : t('receiving.sopDefectWet')}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">5. {t('receiving.discrepancySystem')}</span>
                                                <span className={pc.systemRecording !== false ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.systemRecording !== false ? t('receiving.sopLogged') : t('receiving.sopMissing')}
                                                </span>
                                              </div>
                                            </>
                                          ) : (
                                            <>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">{t('receiving.discrepancyBox')}</span>
                                                <span className={pc.boxIntact ?? true ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.boxIntact ?? true ? t('receiving.sopIntactPassed') : t('receiving.sopIntactDamaged')}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">{t('receiving.discrepancyWater')}</span>
                                                <span className={pc.noWaterDamage ?? true ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.noWaterDamage ?? true ? t('receiving.sopMoistureClean') : t('receiving.sopMoistureWater')}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">{t('receiving.discrepancyPest')} / {t('receiving.discrepancyContam')}</span>
                                                <span className={(pc.noPestSign ?? true) && (pc.noContamination ?? true) ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {(pc.noPestSign ?? true) && (pc.noContamination ?? true) ? t('receiving.sopPestFree') : t('receiving.sopPestIssue')}
                                                </span>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      </div>

                                      {/* Col 3: IQC Quality Decision & FIFO Tags */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <Activity className="h-4 w-4 text-purple-500" />
                                          <span>{t('receiving.iqcStagingSection')}</span>
                                        </div>

                                        <div className="space-y-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('receiving.iqcStatusCardLabel')}</span>
                                            <div className="mt-0.5">
                                              {r.iqcStatus === 'NA' ? (
                                                <span className="text-slate-500 font-semibold">{t('receiving.iqcNa')}</span>
                                              ) : r.iqcStatus === 'PENDING_IQC' ? (
                                                <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                  {t('receiving.awaitingIqcLong')}
                                                </span>
                                              ) : r.iqcStatus === 'APPROVED_IQC' ? (
                                                <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                  {t('receiving.passedIqcLong')}
                                                </span>
                                              ) : (
                                                <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                  {t('receiving.rejectedIqcLong')}
                                                </span>
                                              )}
                                            </div>
                                          </div>

                                          <div className="pt-1">
                                            <span className="text-slate-400 text-[11px] block">{t('receiving.assignedFifoTagLabel')}</span>
                                            {(() => {
                                              const displayColor = normalizeFifoColor(r.fifoColorCode || (r as any).fifoColor, r.receivedDate || r.date, fifoColorsByMonth);
                                              const meta = resolveFifoColor(displayColor, undefined, undefined, fifoColorsByMonth);
                                              return (
                                                <div className="flex items-center gap-2 mt-1">
                                                  <span 
                                                    className={`h-4 w-4 rounded-full border border-slate-300 shadow-sm ${meta.colorClass}`}
                                                    style={meta.hex ? { backgroundColor: meta.hex } : undefined}
                                                  />
                                                  <span className="font-semibold text-slate-800">{displayColor}</span>
                                                </div>
                                              );
                                            })()}
                                          </div>

                                          {effectiveCanEdit && r.iqcStatus === 'PENDING_IQC' && (
                                            <div className="pt-2 flex items-center gap-2" data-no-expand="true">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setConfirmAction({
                                                    title: t('receiving.confirmApproveIqcTitle'),
                                                    message: t('receiving.confirmApproveIqcMsg', { id: r.rrNumber || r.id, partCode: r.partCode }),
                                                    confirmLabel: t('receiving.confirmYesApproveIqc'),
                                                    confirmVariant: 'primary',
                                                    onConfirm: () => onUpdateIqc(r.id, 'APPROVED_IQC')
                                                  });
                                                }}
                                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold transition-colors cursor-pointer"
                                              >
                                                {t('receiving.approveIqcBtn')}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setConfirmAction({
                                                    title: t('receiving.confirmRejectIqcTitle'),
                                                    message: t('receiving.confirmRejectIqcMsg', { id: r.rrNumber || r.id, partCode: r.partCode }),
                                                    confirmLabel: t('receiving.confirmYesRejectIqc'),
                                                    confirmVariant: 'danger',
                                                    onConfirm: () => onUpdateIqc(r.id, 'REJECTED_IQC')
                                                  });
                                                }}
                                                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold transition-colors cursor-pointer"
                                              >
                                                {t('receiving.rejectToQuarantineBtn')}
                                              </button>
                                            </div>
                                          )}
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
        </div>
      ) : (
        <div className="space-y-6">
          {/* Returns Tab View */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="relative w-full sm:max-w-xs">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search className="h-4 w-4" />
              </span>
              <input 
                type="text" 
                placeholder={t('receiving.searchReturnsPlaceholder')} 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
              />
            </div>

            {effectiveCanEdit ? (
              <button 
                onClick={() => setShowReturnForm(!showReturnForm)}
                className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5"
                id="btn-log-return"
              >
                <Plus className="h-4 w-4" /> {t('receiving.logReturnBtn')}
              </button>
            ) : (
              <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded font-bold uppercase">
                {t('receiving.viewOnlyNotice')}
              </span>
            )}
          </div>

          {showReturnForm && (
            <form 
              onSubmit={handleSubmitReturn}
              className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4"
              id="return-form"
            >
              <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                    <RotateCcw className="h-4 w-4 text-slate-500" /> {t('receiving.returnFormTitle')}
                  </h3>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> {t('receiving.autoSavedDraft')}
                  </span>
                </div>
                <button 
                  type="button" 
                  onClick={handleDiscardReturn}
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
                    <span><strong>{t('receiving.scanItemLabel')}</strong> {confirmedScanInfo.itemName}</span>
                    <span className="font-mono"><strong>{t('receiving.scanLotLabel')}</strong> {confirmedScanInfo.lot}</span>
                    <span><strong>{t('receiving.scanLocationLabel')}</strong> {confirmedScanInfo.location}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Category Selector at Top of Return Form */}
                <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-2 col-span-1 md:col-span-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-indigo-900 uppercase tracking-wider">
                      {t('receiving.selectCategoryRequired')}
                    </label>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => setShowCategoriesModal(true)}
                        className="text-[11px] font-mono font-bold text-indigo-700 hover:text-indigo-950 bg-indigo-100/90 hover:bg-indigo-200 border border-indigo-200/80 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        title={t('receiving.tooltipManageCats')}
                      >
                        <Tag className="h-3.5 w-3.5 text-indigo-600" />
                        <span>{t('receiving.manageCategoriesBtn')}</span>
                      </button>
                    )}
                  </div>
                  <select 
                    required
                    value={retCategory}
                    onChange={e => {
                      const cat = e.target.value;
                      if (cat === '__ADD_NEW__') {
                        setShowCategoriesModal(true);
                        return;
                      }
                      setRetCategory(cat);
                    }}
                    className="w-full px-3.5 py-2.5 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-indigo-950 focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer shadow-2xs"
                  >
                    <option value="">{t('receiving.selectCategoryOption')}</option>
                    {managedCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    {isSuperAdmin && (
                      <option value="__ADD_NEW__" className="text-indigo-600 font-bold bg-indigo-50/60">{t('receiving.addNewCategoryOption')}</option>
                    )}
                  </select>
                  <p className="text-[11px] text-indigo-600 font-medium">
                    {retCategory ? t('receiving.returnCategoryTailoredHint', { category: retCategory }) : t('receiving.returnCategorySelectHint')}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{t('receiving.returnSlipFormReq')}</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. MRS-2026-081"
                    value={retSlip}
                    onChange={e => setRetSlip(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{t('receiving.returnMaterialDescReq')}</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. Polystyrene Plastic Resin Sacks"
                    value={retDesc}
                    onChange={e => setRetDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{t('receiving.returnPartCodeReq')}</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. RM-RE-089"
                    value={retPartCode}
                    onChange={e => {
                      const val = e.target.value;
                      setRetPartCode(val);
                      const presetUnit = findMasterPresetUnit({ partCode: val, description: retDesc }, registries);
                      if (presetUnit) setRetUnit(presetUnit);
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{t('receiving.returnLotBatchReq')}</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. LOT-2605-A"
                    value={retLot}
                    onChange={e => setRetLot(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{t('receiving.quantityLabel')} *</label>
                  <input 
                    type="number"
                    required
                    min="1"
                    value={retQty || ''}
                    onChange={e => setRetQty(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{t('receiving.labelUnitOfMeasureReq')}</label>
                  <select 
                    value={retUnit}
                    onChange={e => setRetUnit(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none font-semibold"
                  >
                    <option value="">{t('receiving.selectUomOption')}</option>
                    {getAllSelectUomOptions(retUnit).map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{t('receiving.returnDepartmentReq')}</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. Injection Molding Dept"
                    value={retDept}
                    onChange={e => setRetDept(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{t('receiving.returnConditionReq')}</label>
                  <select 
                    value={retCondition}
                    onChange={e => setRetCondition(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
                  >
                    <option value="Good">{t('receiving.condGoodOpt')}</option>
                    <option value="Damaged">{t('receiving.condDamagedOpt')}</option>
                    <option value="Contaminated">{t('receiving.condContaminatedOpt')}</option>
                    <option value="Unidentified">{t('receiving.condUnidentifiedOpt')}</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{t('receiving.returnReasonLabelFull')}</label>
                  <textarea 
                    value={retReason}
                    onChange={e => setRetReason(e.target.value)}
                    rows={2}
                    placeholder={t('receiving.editReturnReasonPlaceholder')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={handleDiscardReturn}
                  className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  {t('receiving.discardBtn')}
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  {t('receiving.processReturnBtn')}
                </button>
              </div>
            </form>
          )}

          {/* Returns Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-slate-50/50">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{t('receiving.returnsTableTitle')}</span>
                <span className="bg-slate-200/80 text-slate-700 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full">
                  {t('receiving.returnsLogged', { count: filteredReturns.length })}
                </span>
                <span className="text-[11px] text-slate-500 font-medium hidden md:inline">
                  &bull; {t('receiving.sortedByLabel')} <strong className="text-indigo-700 font-semibold">{retSortField}</strong> ({retSortDirection === 'asc' ? t('receiving.ascLabel') : t('receiving.descLabel')})
                </span>
              </div>
              {filteredReturns.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('receiving.totalsLabel')}</span>
                  {groupQuantitiesByUnit(
                    filteredReturns,
                    (ret) => ret.quantity,
                    (ret) => resolveMasterDataUnit(ret, registries, stocks).unit
                  ).buckets.map((b) => (
                    <span
                      key={b.key}
                      className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold border ${
                        b.isMissing
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-white text-slate-800 border-slate-200'
                      }`}
                    >
                      {b.total.toLocaleString()} {b.displayUnit}
                    </span>
                  ))}
                </div>
              )}
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 font-medium border-b border-slate-200 divide-x divide-slate-200/50">
                    <th 
                      onClick={() => handleRetSort('returnSlipFormNumber')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        retSortField === 'returnSlipFormNumber' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colSlipForm') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colSlipForm')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {retSortField === 'returnSlipFormNumber' ? (retSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRetSort('category')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        retSortField === 'category' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colCategory') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colCategory')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {retSortField === 'category' ? (retSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRetSort('date')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        retSortField === 'date' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colDateReturned') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colDateReturned')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {retSortField === 'date' ? (retSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRetSort('department')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        retSortField === 'department' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colDepartment') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colDepartment')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {retSortField === 'department' ? (retSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRetSort('partCode')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        retSortField === 'partCode' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colMaterialDetails') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colMaterialDetails')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {retSortField === 'partCode' ? (retSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRetSort('quantity')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group text-right ${
                        retSortField === 'quantity' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colQty') })}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>{t('receiving.colQty')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {retSortField === 'quantity' ? (retSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRetSort('condition')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        retSortField === 'condition' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colPhysicalCondition') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colPhysicalCondition')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {retSortField === 'condition' ? (retSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRetSort('status')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        retSortField === 'status' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title={t('receiving.sortByPrefix', { col: t('receiving.colEvaluationStatus') })}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('receiving.colEvaluationStatus')}</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {retSortField === 'status' ? (retSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th className="p-3 font-semibold text-slate-600">{t('receiving.colRemarksReason')}</th>
                    <th className="p-3 font-semibold text-slate-600">{t('receiving.colAction')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedReturns.map(r => {
                    const isExpanded = expandedReturnId === r.id;
                    const matchedStock = stocks.find(s => 
                      (s.partCode || '').trim().toLowerCase() === (r.partCode || '').trim().toLowerCase() && 
                      (!r.lotNumber || (s.lotNumber || '').trim().toLowerCase() === (r.lotNumber || '').trim().toLowerCase())
                    );
                    const condLabel = r.condition === 'Good'
                      ? t('receiving.condGood')
                      : r.condition === 'Damaged'
                        ? t('receiving.condDamaged')
                        : r.condition === 'Contaminated'
                          ? t('receiving.condContaminated')
                          : t('receiving.condUnidentified');

                    return (
                      <React.Fragment key={r.id}>
                        <tr 
                          onClick={(e) => {
                            const target = e.target as HTMLElement;
                            if (target.closest('button, select, input, a, [data-no-expand="true"]')) return;
                            setExpandedReturnId(prev => prev === r.id ? null : r.id);
                          }}
                          className={`cursor-pointer transition-all duration-150 ${
                            isExpanded 
                              ? 'bg-indigo-50/70 border-l-4 border-l-indigo-600 shadow-2xs' 
                              : 'hover:bg-indigo-50/30 hover:border-l-4 hover:border-l-indigo-300'
                          }`}
                          title={t('receiving.rowExpandTooltip')}
                        >
                          <td className="p-4 font-mono font-bold text-slate-900">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedReturnId(prev => prev === r.id ? null : r.id);
                                }}
                                className={`p-1 rounded-md transition-colors ${
                                  isExpanded ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                                }`}
                                title={isExpanded ? t('receiving.collapseRowBtn') : t('receiving.expandRowBtn')}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <span>{r.returnSlipFormNumber}</span>
                            </div>
                          </td>
                          <td className="p-4 font-medium text-slate-700">
                            <span className="px-2 py-1 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 uppercase tracking-wider">
                              {r.category || t('common.na')}
                            </span>
                          </td>
                          <td className="p-4 text-slate-600 font-mono">{r.date}</td>
                          <td className="p-4 font-medium text-slate-700">{r.department}</td>
                          <td className="p-4">
                            <div className="font-mono font-semibold text-slate-800">{r.partCode}</div>
                            <div className="text-slate-500 text-[11px]">{r.materialDescription}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{t('receiving.scanLotLabel')} {r.lotNumber}</div>
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-slate-800">
                            {(() => {
                              const retUnitInfo = resolveMasterDataUnit(r, registries, stocks);
                              return (
                                <>
                                  {r.quantity.toLocaleString()}{' '}
                                  {retUnitInfo.isMissing ? (
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 text-[9px] font-bold">
                                      {t('common.missingUnit')}
                                    </span>
                                  ) : (
                                    retUnitInfo.unit
                                  )}
                                </>
                              );
                            })()}
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.condition === 'Good' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                              r.condition === 'Damaged' ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-amber-50 text-amber-700 border border-amber-100'
                            }`}>
                              {condLabel}
                            </span>
                          </td>
                          <td className="p-4">
                            {r.status === 'APPROVED' ? (
                              <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded font-semibold text-[10px] border border-emerald-100">
                                {t('receiving.acceptedToStocksBadge')}
                              </span>
                            ) : (
                              <span className="bg-rose-50 text-rose-700 px-2 py-1 rounded font-semibold text-[10px] border border-rose-100">
                                {t('receiving.quarantineRestrictedBadge')}
                              </span>
                            )}
                          </td>
                          <td className="p-4 max-w-xs">
                            {r.reason ? (
                              <span className="text-[11px] text-slate-700 font-medium">{r.reason}</span>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">{t('receiving.noRemarks')}</span>
                            )}
                          </td>
                          <td className="p-4" data-no-expand="true">
                            {effectiveCanEdit || isSuperAdmin ? (
                              <select
                                defaultValue=""
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === 'APPROVE') {
                                    setConfirmAction({
                                      title: t('receiving.confirmApproveReturnTitle'),
                                      message: t('receiving.confirmApproveReturnMsg', { id: r.returnSlipFormNumber, partCode: r.partCode }),
                                      confirmLabel: t('receiving.confirmYesApproveReturn'),
                                      confirmVariant: 'primary',
                                      onConfirm: () => onUpdateReturnStatus(r.id, 'APPROVED')
                                    });
                                  } else if (val === 'EDIT') {
                                    setEditingReturn({ ...r });
                                  } else if (val === 'DELETE') {
                                    if (!isSuperAdmin) return;
                                    setConfirmAction({
                                      title: t('receiving.confirmDeleteReturnTitle'),
                                      message: t('receiving.confirmDeleteReturnMsg', { id: r.returnSlipFormNumber, partCode: r.partCode }),
                                      confirmLabel: t('receiving.confirmYesDelete'),
                                      confirmVariant: 'danger',
                                      onConfirm: () => onDeleteReturn?.(r.id)
                                    });
                                  }
                                  e.target.value = '';
                                }}
                                className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                                id={`action-select-ret-${r.id}`}
                              >
                                <option value="" disabled>{t('receiving.actionsPlaceholder')}</option>
                                {r.status === 'QUARANTINED' && (
                                  <option value="APPROVE">✅ {t('receiving.actionPassQualityApprove')}</option>
                                )}
                                <option value="EDIT">📝 {t('receiving.actionEditRecord')}</option>
                                {isSuperAdmin && (
                                  <option value="DELETE">🗑️ {t('receiving.actionDeleteRecord')}</option>
                                )}
                              </select>
                            ) : (
                              <span className="text-slate-400 italic font-semibold text-[10px]">{t('receiving.readOnlyTag')}</span>
                            )}
                          </td>
                        </tr>

                        {/* Expandable Card View for Return Record */}
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
                                        <div className="p-2.5 bg-purple-50 rounded-lg text-purple-600">
                                          <RotateCcw className="h-5 w-5" />
                                        </div>
                                        <div>
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-slate-900">
                                              {t('receiving.cardSlipPrefix')} <span className="font-mono text-indigo-600">{r.returnSlipFormNumber}</span>
                                            </span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                              r.status === 'APPROVED' 
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                                            }`}>
                                              {r.status === 'APPROVED' ? t('receiving.acceptedToStocksBadge') : t('receiving.quarantineRestrictedBadge')}
                                            </span>
                                          </div>
                                          <p className="text-xs text-slate-500 mt-0.5">
                                            {t('receiving.cardOriginLabel')} <strong className="text-slate-700">{r.department}</strong> &bull; {t('receiving.cardPartLabel')} <strong className="font-mono text-slate-700">{r.partCode}</strong>
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="bg-slate-100 text-slate-700 font-mono font-semibold px-2.5 py-1 rounded-lg border border-slate-200">
                                          {t('receiving.cardDateLabel')} {r.date}
                                        </span>
                                        <span className="bg-purple-50 text-purple-800 font-bold px-2.5 py-1 rounded-lg border border-purple-200 font-mono">
                                          {(() => {
                                            const retUnitInfo = resolveMasterDataUnit(r, registries, stocks);
                                            return `${t('receiving.cardReturnQtyLabel')} ${r.quantity.toLocaleString()} ${retUnitInfo.unit || MISSING_UNIT_LABEL}`;
                                          })()}
                                        </span>
                                        {matchedStock && (
                                          <span className="bg-emerald-50 text-emerald-800 font-bold px-2.5 py-1 rounded-lg border border-emerald-200 font-mono">
                                            {t('receiving.activeStockLabel')} {matchedStock.quantity.toLocaleString()} {resolveMasterDataUnit(matchedStock, registries, stocks).unit || MISSING_UNIT_LABEL}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* 3-Column Detailed Metadata Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                      {/* Col 1: Origin & Batch Information */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <Factory className="h-4 w-4 text-indigo-500" />
                                          <span>{t('receiving.cardOriginBatchSection')}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('receiving.colDepartment')}:</span>
                                            <span className="font-semibold text-slate-800">{r.department}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('receiving.colCategory')}:</span>
                                            <span className="font-semibold text-indigo-700">{r.category || t('common.na')}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('receiving.lotBatchLabel')}</span>
                                            <span className="font-mono font-bold text-slate-800">{r.lotNumber || t('common.na')}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('receiving.cardLocationLabel')}</span>
                                            <span className="font-mono font-semibold text-slate-800">{matchedStock?.location || t('receiving.cardReturnsBay')}</span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Col 2: Physical Condition & QA Notes */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                          <span>{t('receiving.cardConditionReasonSection')}</span>
                                        </div>
                                        <div className="space-y-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('receiving.cardConditionLabel')}</span>
                                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold mt-0.5 ${
                                              r.condition === 'Good' ? 'bg-emerald-100 text-emerald-800' :
                                              r.condition === 'Damaged' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                                            }`}>
                                              {condLabel}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('receiving.cardReasonLabel')}</span>
                                            <p className="text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-150 mt-0.5 text-[11px] leading-relaxed">
                                              {r.reason || t('receiving.cardDefaultReason')}
                                            </p>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Col 3: Quality Disposition & Approvals */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <Activity className="h-4 w-4 text-purple-500" />
                                          <span>{t('receiving.cardQualityDispSection')}</span>
                                        </div>

                                        <div className="space-y-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">{t('receiving.cardCurrentDispLabel')}</span>
                                            <div className="mt-0.5">
                                              {r.status === 'APPROVED' ? (
                                                <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                  {t('receiving.cardPassedQualityMerged')}
                                                </span>
                                              ) : (
                                                <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                  {t('receiving.cardHeldQuarantine')}
                                                </span>
                                              )}
                                            </div>
                                          </div>

                                          {effectiveCanEdit && r.status === 'QUARANTINED' && (
                                            <div className="pt-2" data-no-expand="true">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setConfirmAction({
                                                    title: t('receiving.confirmApproveReturnTitle'),
                                                    message: t('receiving.confirmApproveReturnMsg', { id: r.returnSlipFormNumber, partCode: r.partCode }),
                                                    confirmLabel: t('receiving.confirmYesApproveReturn'),
                                                    confirmVariant: 'primary',
                                                    onConfirm: () => onUpdateReturnStatus(r.id, 'APPROVED')
                                                  });
                                                }}
                                                className="w-full px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-2xs flex items-center justify-center gap-1.5"
                                              >
                                                <Check className="h-3.5 w-3.5" /> {t('receiving.passQualityMergeBtn')}
                                              </button>
                                            </div>
                                          )}
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
        </div>
      )}

      {/* Edit Receiving Record Modal (Super Admin) */}
      {typeof document !== 'undefined' && editingReceiving && createPortal(
        <AnimatePresence>
          <motion.div
            key="editing-receiving-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-[100] overflow-y-auto"
          >
            <motion.div
              key="editing-receiving-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full space-y-4 max-h-[calc(100vh-2rem)] my-auto overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Edit className="h-4 w-4 text-indigo-600" /> {t('receiving.editRecModalTitle', { id: editingReceiving.id })}
                  </h4>
                  <p className="text-[11px] text-slate-500">{t('receiving.superAdminOverwrite')}</p>
                </div>
                <button 
                  onClick={() => setEditingReceiving(null)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.editModalModelLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReceiving.partCode}
                    onChange={e => {
                      setEditingReceiving({ ...editingReceiving, partCode: e.target.value.toUpperCase() });
                      clearEditRecErr('partCode');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editReceivingFieldErrors.partCode
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editReceivingFieldErrors.partCode && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editReceivingFieldErrors.partCode)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('common.date')}</label>
                  <input 
                    type="date" 
                    value={editingReceiving.date}
                    onChange={e => {
                      setEditingReceiving({ ...editingReceiving, date: e.target.value });
                      clearEditRecErr('expirationDate');
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.itemDescriptionLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReceiving.itemDescription}
                    onChange={e => setEditingReceiving({ ...editingReceiving, itemDescription: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.quantityLabel')}</label>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    value={editReceivingQtyInput}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.-]/g, '');
                      setEditReceivingQtyInput(raw);
                      const num = Number(raw);
                      setEditingReceiving({ ...editingReceiving, quantity: raw.trim() === '' || Number.isNaN(num) ? 0 : num });
                      clearEditRecErr('quantity');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editReceivingFieldErrors.quantity
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editReceivingFieldErrors.quantity && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editReceivingFieldErrors.quantity)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.unitLabel')}</label>
                  <select 
                    value={normalizeUnitCode(editingReceiving.unit)}
                    onChange={e => {
                      const clean = normalizeUnitCode(e.target.value);
                      setEditingReceiving({ ...editingReceiving, unit: clean, unitMissing: !clean });
                      clearEditRecErr('unit');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono font-semibold ${
                      editReceivingFieldErrors.unit
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  >
                    <option value="">{t('receiving.selectUomOption')}</option>
                    {getAllSelectUomOptions(editingReceiving.unit).map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  {editReceivingFieldErrors.unit && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editReceivingFieldErrors.unit)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.editModalPartNameLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReceiving.lotNumber}
                    onChange={e => setEditingReceiving({ ...editingReceiving, lotNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.colCategory')}</label>
                  <select 
                    value={editingReceiving.supplierOrDept}
                    onChange={e => {
                      setEditingReceiving({ ...editingReceiving, supplierOrDept: e.target.value });
                      clearEditRecErr('supplierOrDept');
                    }}
                    className={`w-full border px-3 py-1.5 rounded text-xs focus:ring-1 font-medium text-slate-700 cursor-pointer ${
                      editReceivingFieldErrors.supplierOrDept
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  >
                    <option value="">{t('receiving.selectCategoryOption')}</option>
                    {managedCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  {editReceivingFieldErrors.supplierOrDept && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editReceivingFieldErrors.supplierOrDept)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.colIqcStatus')}</label>
                  <select 
                    value={editingReceiving.iqcStatus}
                    onChange={e => setEditingReceiving({ ...editingReceiving, iqcStatus: e.target.value as any })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-bold"
                  >
                    <option value="PENDING_IQC">{t('receiving.editModalIqcPendingOpt')}</option>
                    <option value="APPROVED_IQC">{t('receiving.editModalIqcApprovedOpt')}</option>
                    <option value="REJECTED_IQC">{t('receiving.editModalIqcRejectedOpt')}</option>
                    <option value="NA">{t('receiving.editModalIqcNaOpt')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.editModalDateLabel')}</label>
                  <input 
                    type="date" 
                    value={editingReceiving.receivedDate || editingReceiving.date}
                    onChange={e => {
                      setEditingReceiving({ ...editingReceiving, receivedDate: e.target.value });
                      clearEditRecErr('expirationDate');
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.expirationDateLabel')}</label>
                  <input 
                    type="date" 
                    value={editingReceiving.expirationDate || ''}
                    onChange={e => {
                      setEditingReceiving({ ...editingReceiving, expirationDate: e.target.value });
                      clearEditRecErr('expirationDate');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editReceivingFieldErrors.expirationDate
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editReceivingFieldErrors.expirationDate && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editReceivingFieldErrors.expirationDate)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.editModalLocationLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReceiving.location || ''}
                    onChange={e => {
                      setEditingReceiving({ ...editingReceiving, location: e.target.value });
                      clearEditRecErr('location');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 ${
                      editReceivingFieldErrors.location
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editReceivingFieldErrors.location && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editReceivingFieldErrors.location)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.editModalVendorLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReceiving.vendorSupplier || ''}
                    onChange={e => setEditingReceiving({ ...editingReceiving, vendorSupplier: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.rrNumberLabel')}</label>
                  <input 
                    type="text" 
                    placeholder="RR-2026-0001"
                    value={editingReceiving.rrNumber || ''}
                    onChange={e => {
                      setEditingReceiving({ ...editingReceiving, rrNumber: e.target.value });
                      clearEditRecErr('rrNumber');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editReceivingFieldErrors.rrNumber
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editReceivingFieldErrors.rrNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editReceivingFieldErrors.rrNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.poNumberLabel')}</label>
                  <input 
                    type="text" 
                    placeholder="PO-2026-0001"
                    value={editingReceiving.poNumber || ''}
                    onChange={e => {
                      setEditingReceiving({ ...editingReceiving, poNumber: e.target.value });
                      clearEditRecErr('poNumber');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editReceivingFieldErrors.poNumber
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editReceivingFieldErrors.poNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editReceivingFieldErrors.poNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.drNumberLabel')}</label>
                  <input 
                    type="text" 
                    placeholder="DR-00001"
                    value={editingReceiving.drNumber || ''}
                    onChange={e => {
                      setEditingReceiving({ ...editingReceiving, drNumber: e.target.value });
                      clearEditRecErr('drNumber');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editReceivingFieldErrors.drNumber
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editReceivingFieldErrors.drNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editReceivingFieldErrors.drNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.siNumberLabel')}</label>
                  <input 
                    type="text" 
                    placeholder="SI-00001"
                    value={editingReceiving.siNumber || ''}
                    onChange={e => {
                      setEditingReceiving({ ...editingReceiving, siNumber: e.target.value });
                      clearEditRecErr('siNumber');
                    }}
                    className={`w-full border px-3 py-1.5 rounded focus:ring-1 font-mono ${
                      editReceivingFieldErrors.siNumber
                        ? 'border-rose-500 ring-1 ring-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {editReceivingFieldErrors.siNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-rose-600" role="alert">
                      {localizeValidation(editReceivingFieldErrors.siNumber)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.editModalReorderMinLabel')}</label>
                  <input 
                    type="number" 
                    value={editingReceiving.reorderMin || ''}
                    onChange={e => setEditingReceiving({ ...editingReceiving, reorderMin: Number(e.target.value) })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.remarksLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReceiving.remarks || ''}
                    onChange={e => setEditingReceiving({ ...editingReceiving, remarks: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  onClick={() => {
                    setEditReceivingFieldErrors({});
                    setEditingReceiving(null);
                  }}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
                >
                  {t('common.cancel')}
                </button>
                <button 
                  onClick={() => {
                    const resolved = resolveMasterDataUnit(editingReceiving, registries, stocks);
                    const rawQty = editReceivingQtyInput.trim() === '' ? NaN : Number(editReceivingQtyInput.trim());
                    const candidate: ReceivingRecord = {
                      ...editingReceiving,
                      quantity: Number.isNaN(rawQty) ? 0 : rawQty,
                      unit: resolved.unit,
                      unitMissing: !resolved.unit,
                      rrNumber: editingReceiving.rrNumber?.trim() || undefined,
                      poNumber: editingReceiving.poNumber?.trim() || undefined,
                      drNumber: editingReceiving.drNumber?.trim() || undefined,
                      siNumber: editingReceiving.siNumber?.trim() || undefined,
                      expirationDate: editingReceiving.expirationDate?.trim() || undefined,
                    };
                    const validation = validateReceivingRecord(
                      {
                        ...candidate,
                        quantity: editReceivingQtyInput.trim() === '' ? '' : rawQty,
                      } as any,
                      receiving,
                      { requireOperationalFields: true }
                    );
                    if (!validation.valid) {
                      setEditReceivingFieldErrors(validation.fieldErrors);
                      showPrintToast(localizeValidation(validation.message) || t('receiving.validationWarning'), 'warning');
                      return;
                    }
                    setEditReceivingFieldErrors({});
                    onEditReceiving?.(candidate);
                    setEditingReceiving(null);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold"
                >
                  {t('receiving.saveRecordChanges')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Edit Return Record Modal (Super Admin) */}
      {typeof document !== 'undefined' && editingReturn && createPortal(
        <AnimatePresence>
          <motion.div
            key="editing-return-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-[100] overflow-y-auto"
          >
            <motion.div
              key="editing-return-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full space-y-4 max-h-[calc(100vh-2rem)] my-auto overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Edit className="h-4 w-4 text-indigo-600" /> {t('receiving.editRetModalTitle', { id: editingReturn.returnSlipFormNumber })}
                  </h4>
                  <p className="text-[11px] text-slate-500">{t('receiving.superAdminOverwrite')}</p>
                </div>
                <button 
                  onClick={() => setEditingReturn(null)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.editReturnSlipLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReturn.returnSlipFormNumber}
                    onChange={e => setEditingReturn({ ...editingReturn, returnSlipFormNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('common.date')}</label>
                  <input 
                    type="date" 
                    value={editingReturn.date}
                    onChange={e => setEditingReturn({ ...editingReturn, date: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.colDepartment')}</label>
                  <input 
                    type="text" 
                    value={editingReturn.department}
                    onChange={e => setEditingReturn({ ...editingReturn, department: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.partCodeLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReturn.partCode}
                    onChange={e => setEditingReturn({ ...editingReturn, partCode: e.target.value.toUpperCase() })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.itemDescriptionLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReturn.materialDescription}
                    onChange={e => setEditingReturn({ ...editingReturn, materialDescription: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.editReturnReasonLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReturn.reason || ''}
                    onChange={e => setEditingReturn({ ...editingReturn, reason: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                    placeholder={t('receiving.editReturnReasonPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.colCategory')}</label>
                  <select 
                    value={editingReturn.category || ''}
                    onChange={e => setEditingReturn({ ...editingReturn, category: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-bold text-xs cursor-pointer"
                  >
                    <option value="">{t('receiving.selectCategoryOption')}</option>
                    {managedCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.quantityLabel')}</label>
                  <input 
                    type="number" 
                    value={editingReturn.quantity}
                    onChange={e => setEditingReturn({ ...editingReturn, quantity: Number(e.target.value) })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.unitLabel')}</label>
                  <select
                    value={normalizeUnitCode(editingReturn.unit)}
                    onChange={e => {
                      const clean = normalizeUnitCode(e.target.value);
                      setEditingReturn({ ...editingReturn, unit: clean, unitMissing: !clean });
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono font-semibold"
                  >
                    <option value="">{t('receiving.selectUomOption')}</option>
                    {getAllSelectUomOptions(editingReturn.unit).map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.lotNumberLabel')}</label>
                  <input 
                    type="text" 
                    value={editingReturn.lotNumber}
                    onChange={e => setEditingReturn({ ...editingReturn, lotNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('receiving.returnConditionLabel')}</label>
                  <select 
                    value={editingReturn.condition}
                    onChange={e => setEditingReturn({ ...editingReturn, condition: e.target.value as any })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="Good">{t('receiving.condGood')}</option>
                    <option value="Damaged">{t('receiving.condDamaged')}</option>
                    <option value="Contaminated">{t('receiving.condContaminated')}</option>
                    <option value="Unidentified">{t('receiving.condUnidentified')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">{t('common.status')}</label>
                  <select 
                    value={editingReturn.status}
                    onChange={e => setEditingReturn({ ...editingReturn, status: e.target.value as any })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-bold"
                  >
                    <option value="PENDING">{t('receiving.editReturnStatusPending')}</option>
                    <option value="APPROVED">{t('receiving.editReturnStatusApproved')}</option>
                    <option value="QUARANTINED">{t('receiving.editReturnStatusQuarantined')}</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  onClick={() => setEditingReturn(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
                >
                  {t('common.cancel')}
                </button>
                <button 
                  onClick={() => {
                    const resolved = resolveMasterDataUnit(editingReturn, registries, stocks);
                    if (!resolved.unit) {
                      showPrintToast(t('receiving.configureUomWarning'), 'warning');
                      return;
                    }
                    onEditReturn?.({
                      ...editingReturn,
                      unit: resolved.unit,
                      unitMissing: false,
                    });
                    setEditingReturn(null);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold"
                >
                  {t('receiving.saveReturnChanges')}
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
        resolveScanDetails={resolveReceivingScanDetails}
        title={t('receiving.scannerTitle')}
        subtitle={t('receiving.scannerSubtitle')}
      />
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
                    className={`px-5 py-2 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer ${
                      confirmAction.confirmVariant === 'primary' 
                        ? 'bg-indigo-600 hover:bg-indigo-700' 
                        : 'bg-rose-600 hover:bg-rose-700'
                    }`}
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

      {/* Super Admin Manage Categories Modal Portal */}
      {typeof document !== 'undefined' && showCategoriesModal && isSuperAdmin && createPortal(
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-[999998]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                  <Tag className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold tracking-tight">{t('receiving.manageCatsModalTitle')}</h3>
                    <span className="bg-indigo-500/30 text-indigo-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border border-indigo-400/30">
                      {t('receiving.catsCountBadge', { count: managedCategories.length })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    {t('receiving.manageCatsModalSubtitle')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCategoriesModal(false);
                  setEditingCategoryOriginal(null);
                  setCategoryModalError('');
                  setCategoryModalSuccess('');
                  setCategorySearchQuery('');
                }}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-white/10 transition cursor-pointer"
                title={t('common.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Alert / Notification banners */}
              {categoryModalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2 animate-fadeIn font-semibold">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                  <span>{categoryModalError}</span>
                </div>
              )}
              {categoryModalSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex items-center gap-2 animate-fadeIn font-semibold">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{categoryModalSuccess}</span>
                </div>
              )}

              {/* Add New Category Form */}
              <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
                <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                  {t('receiving.createNewCategory')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={t('receiving.catPlaceholderExample')}
                    value={newCategoryInput}
                    onChange={e => {
                      setNewCategoryInput(e.target.value.toUpperCase());
                      setCategoryModalError('');
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCategory();
                      }
                    }}
                    className="flex-1 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 uppercase font-semibold text-slate-800 bg-white text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddCategory()}
                    className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer uppercase font-mono"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{t('receiving.addCategoryBtn')}</span>
                  </button>
                </div>
              </div>

              {/* Search filter for categories */}
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder={t('receiving.filterCatsPlaceholder')}
                  value={categorySearchQuery}
                  onChange={e => setCategorySearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-xs font-mono uppercase bg-slate-50/50"
                />
              </div>

              {/* Categories List */}
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[280px] overflow-y-auto bg-white shadow-inner">
                {managedCategories
                  .filter(c => !categorySearchQuery || c.toLowerCase().includes(categorySearchQuery.toLowerCase()))
                  .map(cat => {
                    const clean = cat.trim().toUpperCase();
                    const recCount = receiving.filter(r => (r.supplierOrDept || '').trim().toUpperCase() === clean || ((r as any).category || '').trim().toUpperCase() === clean).length;
                    const retCount = returns.filter(ret => (ret.category || '').trim().toUpperCase() === clean).length;
                    const stockCount = stocks.filter(s => ((s as any).category || '').trim().toUpperCase() === clean).length;
                    const inUseCount = recCount + retCount + stockCount;
                    const isEditing = editingCategoryOriginal === cat;

                    return (
                      <div key={cat} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50/80 transition-colors">
                        {isEditing ? (
                          <div className="flex-1 flex items-center gap-2">
                            <input
                              type="text"
                              autoFocus
                              value={editingCategoryNewValue}
                              onChange={e => setEditingCategoryNewValue(e.target.value.toUpperCase())}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleRenameCategory(cat, editingCategoryNewValue);
                                } else if (e.key === 'Escape') {
                                  setEditingCategoryOriginal(null);
                                }
                              }}
                              className="flex-1 border border-indigo-300 px-3 py-1.5 rounded-lg focus:ring-2 focus:ring-indigo-500 uppercase font-semibold text-slate-800 bg-indigo-50/30 text-xs font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => handleRenameCategory(cat, editingCategoryNewValue)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white p-1.5 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer shrink-0"
                              title={t('receiving.saveCatRenameTitle')}
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCategoryOriginal(null)}
                              className="bg-slate-200 hover:bg-slate-300 text-slate-700 p-1.5 rounded-lg text-xs font-bold transition cursor-pointer shrink-0"
                              title={t('common.cancel')}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
                              <span className="font-mono font-bold text-xs text-slate-800 uppercase truncate">
                                {cat}
                              </span>
                              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold shrink-0 ${
                                inUseCount > 0 
                                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' 
                                  : 'bg-slate-100 text-slate-500'
                              }`}>
                                {inUseCount} {inUseCount === 1 ? t('receiving.recordWord') : t('receiving.recordsWord')}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCategoryOriginal(cat);
                                  setEditingCategoryNewValue(cat);
                                  setCategoryModalError('');
                                }}
                                className="text-slate-500 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50 transition cursor-pointer"
                                title={t('receiving.catRenameTitle')}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCategory(cat)}
                                className={`p-1.5 rounded-lg transition cursor-pointer ${
                                  inUseCount > 0 
                                    ? 'text-slate-300 hover:text-slate-400 hover:bg-slate-100' 
                                    : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                                }`}
                                title={inUseCount > 0 ? t('receiving.catDeleteInUseTitle', { count: inUseCount }) : t('receiving.catDeleteTitle')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                {managedCategories.filter(c => !categorySearchQuery || c.toLowerCase().includes(categorySearchQuery.toLowerCase())).length === 0 && (
                  <div className="p-6 text-center text-slate-400 text-xs font-mono">
                    {t('receiving.noMatchingCategories')}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowCategoriesModal(false);
                  setEditingCategoryOriginal(null);
                  setCategoryModalError('');
                  setCategoryModalSuccess('');
                  setCategorySearchQuery('');
                }}
                className="bg-slate-800 hover:bg-slate-900 text-white px-5 py-2 rounded-xl text-xs font-bold transition font-mono uppercase cursor-pointer"
              >
                {t('receiving.doneBtn')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
