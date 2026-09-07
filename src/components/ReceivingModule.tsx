/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  FileCheck2, 
  FileX2, 
  AlertOctagon, 
  ShieldCheck, 
  Sparkles, 
  Truck, 
  Warehouse, 
  History, 
  RotateCcw, 
  Trash2, 
  Edit, 
  FolderPlus, 
  ScanLine, 
  Barcode, 
  AlertTriangle, 
  X, 
  CheckCircle2, 
  XCircle, 
  Boxes, 
  Factory, 
  FileText,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ClipboardList,
  PackageCheck,
  Tag,
  MapPin,
  Calendar,
  Layers,
  Activity,
  Info,
  Check,
  ExternalLink
} from 'lucide-react';
import { ReceivingRecord, ReturnRecord, MaterialStockItem, getCustomerForPart, UOM_OPTIONS, MasterRegistryItem, RegistryType } from '../types';
import { FIFO_COLORS_BY_MONTH } from '../data';
import BarcodeScannerModal from './BarcodeScannerModal';
import { motion, AnimatePresence } from 'motion/react';
import { generateAuthoritativeId } from '../lib/idGenerator';

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
  registries?: MasterRegistryItem[];
  onOpenRegisterModal?: (type?: RegistryType) => void;
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
  registries = [],
  onOpenRegisterModal
}: ReceivingModuleProps) {
  const [activeTab, setActiveTab] = useState<'external-internal' | 'returns'>('external-internal');
  const [searchQuery, setSearchQuery] = useState('');
  const [classificationFilter, setClassificationFilter] = useState<string>('ALL');
  const [showScannerModal, setShowScannerModal] = useState(false);

  // States for Editing Modals
  const [editingReceiving, setEditingReceiving] = useState<ReceivingRecord | null>(null);
  const [editingReturn, setEditingReturn] = useState<ReturnRecord | null>(null);

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

  // Handle scanned barcode / QR code result
  const handleScanResult = (scannedCode: string) => {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

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
        setItemDescription(matchedRegistry.code); // 1. Item Code
        setPartCode(matchedRegistry.description || matchedRegistry.name); // 2. Item Description
        setLotNumber(matchedRegistry.name); // 3. Item Name
        if (matchedRegistry.presetSource) setSource(matchedRegistry.presetSource);
        if (matchedRegistry.vendorSupplier) setVendorSupplier(matchedRegistry.vendorSupplier);
        if (matchedRegistry.category) setSupplierOrDept(matchedRegistry.category);
        if (matchedRegistry.unit) setUnit(matchedRegistry.unit);
        if (matchedRegistry.location) setLocation(matchedRegistry.location);
        const cust = getCustomerForPart(matchedRegistry.code, matchedRegistry.name);
        if (cust) setCustomer(cust);
      } else if (matchedStock) {
        setItemDescription(matchedStock.partCode); // 1. Item Code
        setPartCode(matchedStock.description); // 2. Item Description
        setLotNumber(matchedStock.description || matchedStock.partCode); // 3. Item Name
        setUnit(matchedStock.unit);
        setLotNumber(matchedStock.lotNumber || `LOT-${cleanCode}`);
        setLocation(matchedStock.location || '');
        setReorderMin(matchedStock.reorderMin || 0);
        const cust = getCustomerForPart(matchedStock.partCode);
        if (cust) setCustomer(cust);
      } else {
        setItemDescription(cleanCode);
        setPartCode(cleanCode);
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
        setRetUnit(matchedStock.unit);
        setRetLot(matchedStock.lotNumber);
      } else if (matchedRegistry) {
        setRetDesc(matchedRegistry.description || matchedRegistry.name);
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
  const [receivedDate, setReceivedDate] = useState(initialReceivingDraft?.receivedDate || new Date().toISOString().split('T')[0]);
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
  const [selectedStockIdForBom, setSelectedStockIdForBom] = useState('');
  const [newBomPartCode, setNewBomPartCode] = useState('');
  const [newBomDescription, setNewBomDescription] = useState('');
  const [newBomQty, setNewBomQty] = useState(0);
  const [newBomUnit, setNewBomUnit] = useState('PCS');
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
    wayBill, transferFormNumber, customer, color, receivedDate, location,
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
    setLotNumber('');
    setSupplierOrDept('');
    setReceivedDate(new Date().toISOString().split('T')[0]);
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
    setSelectedStockIdForBom('');
    setNewBomPartCode('');
    setNewBomDescription('');
    setNewBomQty(0);
    setNewBomUnit('pcs');
    setAutoDeductBom(true);
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
    setShowReturnForm(false);
  };

  // Helper functions for BOM item management
  const handleBomItemSelection = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedStockIdForBom(id);
    if (id === '') {
      setNewBomPartCode('');
      setNewBomDescription('');
      setNewBomUnit('pcs');
    } else {
      const found = stocks.find(s => s.id === id);
      if (found) {
        setNewBomPartCode(found.partCode);
        setNewBomDescription(found.description);
        setNewBomUnit(found.unit);
      }
    }
  };

  const handleAddBomItem = () => {
    if (!newBomPartCode || !newBomDescription || newBomQty <= 0) {
      alert('Please specify a valid component part code, description, and quantity.');
      return;
    }

    const itemExists = bomItems.some(item => item.partCode === newBomPartCode);
    if (itemExists) {
      alert('This part code is already added to the BOM list. Remove it first to re-add.');
      return;
    }

    setBomItems(prev => [...prev, {
      partCode: newBomPartCode,
      description: newBomDescription,
      quantityRequired: newBomQty,
      unit: newBomUnit
    }]);

    setSelectedStockIdForBom('');
    setNewBomPartCode('');
    setNewBomDescription('');
    setNewBomQty(0);
    setNewBomUnit('pcs');
  };

  // Handle Receiving Submission
  const handleSubmitReceiving = (e: React.FormEvent) => {
    e.preventDefault();

    if (!supplierOrDept) {
      alert('Please select a Category first.');
      return;
    }

    if (quantity <= 0) {
      alert('Please enter a valid Quantity greater than 0.');
      return;
    }

    if (!partCode.trim() || !location.trim()) {
      alert('Please fill in all required fields.');
      return;
    }

    // Determine FIFO quarterly color code based on today's month
    const currentMonth = new Date().getMonth() + 1; // 1-indexed
    const fifoColor = FIFO_COLORS_BY_MONTH[currentMonth]?.name || 'Silver';

    // Discrepancy flag
    const hasConditionDiscrepancy = 
      !sopReceivingInspection || 
      !sopMaterialTraceability || 
      !sopQuantityAccuracy || 
      !sopMaterialCondition || 
      !sopSystemRecording;

    const generatedRrId = rrNumber.trim() || generateAuthoritativeId('RR');

    const newRecord: ReceivingRecord = {
      id: generatedRrId,
      rrNumber: generatedRrId,
      date: new Date().toISOString().split('T')[0],
      receivedDate,
      location,
      vendorSupplier: vendorSupplier || 'N/A',
      reorderMin,
      remarks,
      source: (isDirectBomCategory || isWipCategory) ? 'INTERNAL' : ((isIndirectBomCategory || isConsumableCategory || isOfficeSuppliesCategory) ? 'EXTERNAL' : source as any),
      itemDescription: itemDescription || lotNumber || partCode,
      partCode: partCode.toUpperCase(),
      modelName: modelName.trim() || undefined,
      color: isRawCategory ? color.trim() || undefined : undefined,
      quantity,
      unit,
      lotNumber: lotNumber || generateAuthoritativeId('LOT'),
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
      poNumber: poNumber.trim() || undefined,
      drNumber: drNumber.trim() || undefined,
      siNumber: siNumber.trim() || undefined,
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

    onAddReceiving(newRecord);
    clearReceivingDraft();
    
    // Reset form states
    setModelName('');
    setItemDescription('');
    setPartCode('');
    setCustomer('');
    setColor('');
    setQuantity(0);
    setLotNumber('');
    setSupplierOrDept('');
    setReceivedDate(new Date().toISOString().split('T')[0]);
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
    setSelectedStockIdForBom('');
    setNewBomPartCode('');
    setNewBomDescription('');
    setNewBomQty(0);
    setNewBomUnit('pcs');
    setAutoDeductBom(true);
    setShowAddForm(false);
  };

  // Handle Return Submission
  const handleSubmitReturn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!retCategory) {
      alert('Please select a Category first.');
      return;
    }
    if (!retDesc || !retPartCode || retQty <= 0 || !retLot || !retDept || !retSlip) {
      alert('Please fill in all required fields.');
      return;
    }

    const newReturn: ReturnRecord = {
      id: generateAuthoritativeId('RET'),
      date: new Date().toISOString().split('T')[0],
      category: retCategory,
      materialDescription: retDesc,
      partCode: retPartCode,
      quantity: retQty,
      unit: retUnit,
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
              RECEIVING & INBOUND LOGISTICS
            </span>
            <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block" /> ACTIVE
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Material Receiving & Returns</h2>
          <p className="text-xs text-slate-300 mt-1">
            Perform physical condition checks, stamp Transfer Slips, control hold statuses, and process returns.
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
            <Truck className="h-4 w-4" /> External & Internal Arrivals
          </button>
          <button 
            onClick={() => { setActiveTab('returns'); setSearchQuery(''); }}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'returns' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <RotateCcw className="h-4 w-4" /> Material Excess Returns
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
                  placeholder="Search description, part code, PO..." 
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
                  <option value="ALL">ALL CATEGORIES</option>
                  <option value="RESIN/RAW MATERIALS">RESIN/RAW MATERIALS</option>
                  <option value="INDIRECT BOM">INDIRECT BOM</option>
                  <option value="DIRECT BOM">DIRECT BOM</option>
                  <option value="CONSUMABLES">CONSUMABLES</option>
                  <option value="PACKAGING MATERIALS">PACKAGING MATERIALS</option>
                  <option value="WIP (WORK IN PROGRESS)">WIP (WORK IN PROGRESS)</option>
                  <option value="FG (FINISHED GOOD)">FG (FINISHED GOOD)</option>
                  <option value="OFFICE SUPPLIES">OFFICE SUPPLIES</option>
                  {registries
                    .filter(r => r.type === 'CATEGORY' && r.status === 'ACTIVE' && 
                      !['RESIN/RAW MATERIALS', 'INDIRECT BOM', 'DIRECT BOM', 'CONSUMABLES', 'PACKAGING MATERIALS', 'WIP (WORK IN PROGRESS)', 'FG (FINISHED GOOD)', 'OFFICE SUPPLIES'].includes(r.name))
                    .map(cat => (
                      <option key={cat.id} value={cat.name}>{cat.name}</option>
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
                <ScanLine className="h-4 w-4" /> Scan
              </button>

              {isSuperAdmin ? (
                <button 
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 shrink-0"
                  id="btn-log-arrival"
                >
                  <Plus className="h-4 w-4" /> Log New Material Arrival
                </button>
              ) : (
                <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded font-bold uppercase">
                  🔒 View-Only Mode
                </span>
              )}
            </div>
          </div>

          {/* Form Modal/Collapsible */}
          {showAddForm && (
            <form 
              onSubmit={handleSubmitReceiving}
              className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6 transition-all"
              id="arrival-form"
            >
              <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-slate-500" /> Receiving Information Entry Form
                  </h3>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Auto-saved draft
                  </span>
                </div>
                <button 
                  type="button" 
                  onClick={handleDiscardReceiving}
                  className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              {/* Category Selector at Top */}
              <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-2">
                <label className="block text-xs font-bold text-indigo-900 uppercase tracking-wider">
                  Select Category *
                </label>
                <select 
                  required
                  value={supplierOrDept}
                  onChange={e => {
                    const cat = e.target.value;
                    setSupplierOrDept(cat);
                  }}
                  className="w-full px-3.5 py-2.5 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-indigo-950 focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer shadow-2xs"
                >
                  <option value="">-- Select Category --</option>
                  <option value="RESIN/RAW MATERIALS">RESIN/RAW MATERIALS</option>
                  <option value="INDIRECT BOM">INDIRECT BOM</option>
                  <option value="DIRECT BOM">DIRECT BOM</option>
                  <option value="CONSUMABLES">CONSUMABLES</option>
                  <option value="PACKAGING MATERIALS">PACKAGING MATERIALS</option>
                  <option value="WIP (WORK IN PROGRESS)">WIP (WORK IN PROGRESS)</option>
                  <option value="FG (FINISHED GOOD)">FG (FINISHED GOOD)</option>
                  <option value="OFFICE SUPPLIES">OFFICE SUPPLIES</option>
                  {registries
                    .filter(r => r.type === 'CATEGORY' && r.status === 'ACTIVE' && 
                      !['RESIN/RAW MATERIALS', 'INDIRECT BOM', 'DIRECT BOM', 'CONSUMABLES', 'PACKAGING MATERIALS', 'WIP (WORK IN PROGRESS)', 'FG (FINISHED GOOD)', 'OFFICE SUPPLIES', 'RAW MATERIALS / RESINS', 'WIP / SUB-PARTS'].includes(r.name))
                    .map(cat => (
                      <option key={cat.id} value={cat.name}>{cat.name}</option>
                    ))}
                </select>
                <p className="text-[11px] text-indigo-600 font-medium">
                  {supplierOrDept ? `Form details tailored for category: "${supplierOrDept}"` : 'Selecting a category will automatically customize required arrival fields.'}
                </p>
              </div>

              {/* Dynamic Category Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">
                      {(isDirectBomCategory || isIndirectBomCategory || isWipCategory) ? 'PART CODE *' : (isPackagingCategory || isConsumableCategory || isOfficeSuppliesCategory) ? 'INTERNAL CODE *' : isRawCategory ? 'RESIN INTERNAL CODE *' : 'ITEM DESCRIPTION / CODE *'}
                    </label>
                    <input 
                      type="text"
                      required
                      placeholder={isWipCategory ? 'E.G. WIP-PRT-001' : isDirectBomCategory ? 'E.G. DIR-PRT-001' : isIndirectBomCategory ? 'E.G. IND-PRT-001' : isConsumableCategory ? 'E.G. CON-INT-001' : isOfficeSuppliesCategory ? 'E.G. OFF-INT-001' : isPackagingCategory ? 'E.G. PKG-INT-001' : isRawCategory ? 'E.G. RSN-INT-001' : 'E.G. ITM-001'}
                      value={itemDescription}
                      onChange={e => setItemDescription(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">
                      {(isDirectBomCategory || isIndirectBomCategory || isWipCategory) ? 'MODEL *' : (isConsumableCategory || isOfficeSuppliesCategory) ? 'ITEM NAME *' : isRawCategory ? 'RESIN SACK / ITEM NAME *' : isPackagingCategory ? 'PACKAGING NAME *' : 'PART NAME *'}
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
                      {(isDirectBomCategory || isIndirectBomCategory || isWipCategory) ? 'PART NAME *' : (isConsumableCategory || isOfficeSuppliesCategory) ? 'ITEM SPECIFICATION *' : isRawCategory ? 'ITEM CODE / RESIN GRADE *' : isPackagingCategory ? 'PACKAGING SPECIFICATION *' : 'PART CODE / SPEC *'}
                    </label>
                    <input 
                      type="text"
                      required
                      placeholder={isWipCategory ? 'E.G. SUB-ASSEMBLY / BRACKET' : isDirectBomCategory ? 'E.G. FRONT COVER / BRACKET' : isIndirectBomCategory ? 'E.G. HEX BOLT M6 / CUSHION PAD' : isConsumableCategory ? 'E.G. CON-SPEC-001' : isOfficeSuppliesCategory ? 'E.G. 80GSM / BLUE / BOX OF 10' : isRawCategory ? 'E.G. ABS-301-NAT' : isPackagingCategory ? 'E.G. CARTON BOX / TAPE / FILM' : 'E.G. MODEL-X200'}
                      value={partCode}
                      onChange={e => setPartCode(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-400 focus:outline-none"
                    />
                  </div>

                  {isRawCategory && !isIndirectBomCategory && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">
                        RESIN / MASTERBATCH COLOR
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
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">QUANTITY *</label>
                    <input 
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      required
                      placeholder="ENTER QUANTITY"
                      value={quantity || ''}
                      onKeyDown={(e) => {
                        if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                          e.preventDefault();
                        }
                      }}
                      onChange={e => {
                        const sanitized = e.target.value.replace(/\D/g, '');
                        setQuantity(sanitized ? parseInt(sanitized, 10) : 0);
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">UNIT OF MEASURE *</label>
                    <select 
                      value={unit}
                      onChange={e => setUnit(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none font-semibold"
                    >
                      {UOM_OPTIONS.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">DATE RECEIVED *</label>
                    <input 
                      type="date"
                      required
                      value={receivedDate}
                      onChange={e => setReceivedDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">LOCATION *</label>
                    <input 
                      type="text"
                      required
                      list="registered-locations-list"
                      placeholder="E.G. ZONE A - RACK 04"
                      value={location}
                      onChange={e => setLocation(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
                    />
                    <datalist id="registered-locations-list">
                      {registries.filter(r => r.type === 'LOCATION' && r.status === 'ACTIVE').map(loc => (
                        <option key={loc.id} value={loc.name} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">
                      {isWipCategory || isDirectBomCategory ? 'DEPARTMENT *' : 'SUPPLIER / VENDOR *'}
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
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">REORDER MIN (MIN THRESHOLD)</label>
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
                  VERIFICATION DOCUMENTS
                </h4>
                {isDirectBomCategory || isWipCategory ? (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-tight">
                      {isFgCategory ? 'FINISHED GOOD TRANSFER FORM (FGTF) #' : 'PRODUCTION TRANSFER SLIP (PTS) #'}
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
                        RECEIVING REPORT (RR) #
                      </label>
                      <input 
                        type="text"
                        placeholder="RR-2026-XXXX"
                        value={rrNumber}
                        onChange={e => setRrNumber(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-tight">
                        PURCHASE ORDER (PO) #
                      </label>
                      <input 
                        type="text"
                        placeholder="PO-2026-XXXX"
                        value={poNumber}
                        onChange={e => setPoNumber(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-tight">
                        DELIVERY RECEIPT (DR) #
                      </label>
                      <input 
                        type="text"
                        placeholder="DR-XXXXX"
                        value={drNumber}
                        onChange={e => setDrNumber(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-tight">
                        SALES INVOICE (SI) #
                      </label>
                      <input 
                        type="text"
                        placeholder="SI-XXXXX"
                        value={siNumber}
                        onChange={e => setSiNumber(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">Remarks</label>
                  <textarea 
                    rows={2}
                    placeholder="Enter any additional SOP verification findings, handling notes, or receiving remarks..."
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
                  Discard
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  Verify and Log Into System
                </button>
              </div>
            </form>
          )}

          {/* Receiving Logs Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-slate-50/50">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Arrival and Verification Records Log</span>
                <span className="bg-slate-200/80 text-slate-700 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full">
                  {filteredReceiving.length} logs found
                </span>
                <span className="text-[11px] text-slate-500 font-medium hidden md:inline">
                  &bull; Sorted by <strong className="text-indigo-700 font-semibold">{recSortField}</strong> ({recSortDirection === 'asc' ? 'Ascending' : 'Descending'})
                </span>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 font-medium border-b border-slate-200 divide-x divide-slate-200/50">
                    <th 
                      onClick={() => handleRecSort('rrNumber')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'rrNumber' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by RR Number"
                    >
                      <div className="flex items-center gap-1">
                        <span>RR #</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'rrNumber' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('itemDescription')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'itemDescription' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by Internal Code"
                    >
                      <div className="flex items-center gap-1">
                        <span>Internal Code</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'itemDescription' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('date')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'date' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by Date Received"
                    >
                      <div className="flex items-center gap-1">
                        <span>Date Received</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'date' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('partCode')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'partCode' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by Item / Part Code"
                    >
                      <div className="flex items-center gap-1">
                        <span>Item/Part Code</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'partCode' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('supplierOrDept')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'supplierOrDept' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by Item Type"
                    >
                      <div className="flex items-center gap-1">
                        <span>Item Type</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'supplierOrDept' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('color')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'color' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by Color"
                    >
                      <div className="flex items-center gap-1">
                        <span>Color</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'color' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('quantity')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group text-right ${
                        recSortField === 'quantity' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by Quantity"
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Quantity</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'quantity' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('fifoColor')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'fifoColor' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by FIFO Tag Color"
                    >
                      <div className="flex items-center gap-1">
                        <span>FIFO Tag Color</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'fifoColor' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('source')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'source' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by Source / Supplier"
                    >
                      <div className="flex items-center gap-1">
                        <span>Source</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'source' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('poNumber')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'poNumber' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by PO #"
                    >
                      <div className="flex items-center gap-1">
                        <span>PO #</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'poNumber' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('drNumber')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'drNumber' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by DR #"
                    >
                      <div className="flex items-center gap-1">
                        <span>DR #</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'drNumber' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleRecSort('siNumber')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'siNumber' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by SI #"
                    >
                      <div className="flex items-center gap-1">
                        <span>SI #</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'siNumber' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th className="p-3 font-semibold text-slate-600">SOP Compliance</th>
                    <th 
                      onClick={() => handleRecSort('iqcStatus')}
                      className={`p-3 font-semibold select-none cursor-pointer transition-colors group ${
                        recSortField === 'iqcStatus' ? 'bg-indigo-50/90 text-indigo-900 border-b-2 border-indigo-600' : 'hover:bg-slate-200/70'
                      }`}
                      title="Sort by IQC Inspection Status"
                    >
                      <div className="flex items-center gap-1">
                        <span>IQC Status</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {recSortField === 'iqcStatus' ? (recSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th className="p-3 font-semibold text-slate-600">Action</th>
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
                          title="Click row to expand receiving details & SOP metadata"
                        >
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
                                title={isExpanded ? 'Collapse row' : 'Expand row details'}
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
                          <td className="p-4">
                            <div className="text-slate-700 font-medium text-xs max-w-[220px]">{r.itemDescription}</div>
                            {r.bom && r.bom.length > 0 && (
                              <div className="mt-1.5 bg-slate-50 border border-slate-200 p-1.5 rounded-lg max-w-[240px]">
                                <span className="text-[9px] font-bold text-indigo-700 uppercase block mb-1">BOM Components ({r.bom.length})</span>
                                <div className="space-y-1 max-h-[80px] overflow-y-auto pr-1">
                                  {r.bom.map((b, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-[9px] font-mono text-slate-600 leading-tight">
                                      <span className="truncate max-w-[140px]" title={`${b.partCode}: ${b.description}`}>{b.partCode}</span>
                                      <span className="font-bold text-slate-800">{b.quantityRequired} {b.unit}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="p-4 text-slate-600 font-mono">{r.date}</td>
                          <td className="p-4">
                            <div className="font-mono font-semibold text-slate-800">
                              {r.partCode}
                            </div>
                          </td>
                          <td className="p-4">
                            <span className="bg-slate-100 text-slate-800 border border-slate-200 text-[10px] font-extrabold px-2 py-1 rounded font-sans uppercase tracking-tight inline-block">
                              {r.supplierOrDept || 'N/A'}
                            </span>
                          </td>
                          <td className="p-4">
                            {r.color ? (
                              <span className="bg-purple-50 text-purple-700 text-xs font-bold px-2 py-0.5 rounded border border-purple-200 inline-block font-sans">
                                {r.color}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">-</span>
                            )}
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-slate-800">{r.quantity.toLocaleString()} {(r.unit || 'PCS').toUpperCase()}</td>
                          <td className="p-4">
                            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                              <span className={`h-3 w-3 rounded-full border border-slate-200 shadow-sm ${
                                r.fifoColorCode === 'Magenta' ? 'bg-fuchsia-600' :
                                r.fifoColorCode === 'Orange' ? 'bg-orange-500' :
                                r.fifoColorCode === 'Dark Green' ? 'bg-emerald-800' :
                                r.fifoColorCode === 'Yellow' ? 'bg-yellow-400' :
                                r.fifoColorCode === 'Navy Blue' ? 'bg-blue-900' :
                                r.fifoColorCode === 'Brown' ? 'bg-amber-800' :
                                r.fifoColorCode === 'Pink' ? 'bg-pink-400' :
                                r.fifoColorCode === 'Violet' ? 'bg-violet-600' :
                                r.fifoColorCode === 'Black' ? 'bg-stone-900' :
                                r.fifoColorCode === 'Light Orange' ? 'bg-orange-300' :
                                r.fifoColorCode === 'Grey' ? 'bg-slate-500' : 'bg-slate-300'
                              }`} />
                              {r.fifoColorCode}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="text-slate-800 text-xs font-semibold max-w-[160px] truncate" title={r.vendorSupplier || 'N/A'}>
                              {r.vendorSupplier && r.vendorSupplier !== 'N/A' ? r.vendorSupplier : 'N/A'}
                            </div>
                          </td>
                          <td className="p-4 font-mono text-xs">
                            {r.poNumber ? (
                              <span className="font-semibold text-slate-800">{r.poNumber}</span>
                            ) : r.source === 'INTERNAL' && r.transferFormNumber ? (
                              <span className="text-[10px] text-blue-600 font-semibold">Slip: {r.transferFormNumber}</span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="p-4 font-mono text-xs">
                            {r.drNumber ? (
                              <span className="font-semibold text-slate-800">{r.drNumber}</span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="p-4 font-mono text-xs">
                            {r.siNumber ? (
                              <span className="font-semibold text-slate-800">{r.siNumber}</span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="p-4">
                            {isPassed ? (
                              <span className="text-emerald-600 font-medium flex items-center gap-1 text-xs">
                                <ShieldCheck className="h-4 w-4" /> Passed {totalSopCount}/{totalSopCount} Checklist
                              </span>
                            ) : (
                              <div className="text-rose-600 font-medium space-y-0.5">
                                <div className="flex items-center gap-1 text-xs"><AlertOctagon className="h-3.5 w-3.5" /> Discrepancy spotted</div>
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
                          <td className="p-4">
                            {r.iqcStatus === 'NA' ? (
                              <span className="text-slate-400 italic">N/A (Internal)</span>
                            ) : r.iqcStatus === 'PENDING_IQC' ? (
                              <span className="bg-amber-50 border border-amber-100 text-amber-700 px-2 py-1 rounded font-semibold text-[10px]">
                                AWAITING IQC
                              </span>
                            ) : r.iqcStatus === 'APPROVED_IQC' ? (
                              <span className="bg-emerald-50 border border-emerald-100 text-emerald-700 px-2 py-1 rounded font-semibold text-[10px]">
                                IQC APPROVED
                              </span>
                            ) : (
                              <span className="bg-rose-50 border border-rose-100 text-rose-700 px-2 py-1 rounded font-semibold text-[10px]">
                                IQC REJECTED (QUARANTINE)
                              </span>
                            )}
                          </td>
                          <td className="p-4" data-no-expand="true">
                            {isSuperAdmin ? (
                              <select
                                defaultValue=""
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === 'APPROVE') {
                                    setConfirmAction({
                                      title: 'Approve IQC Inspection',
                                      message: `Are you sure you want to APPROVE IQC inspection for record ${r.rrNumber || r.id} (${r.partCode})?`,
                                      confirmLabel: 'YES, APPROVE IQC',
                                      confirmVariant: 'primary',
                                      onConfirm: () => onUpdateIqc(r.id, 'APPROVED_IQC')
                                    });
                                  } else if (val === 'REJECT') {
                                    setConfirmAction({
                                      title: 'Reject IQC Inspection',
                                      message: `Are you sure you want to REJECT IQC inspection and route record ${r.rrNumber || r.id} (${r.partCode}) to Quarantine?`,
                                      confirmLabel: 'YES, REJECT IQC',
                                      confirmVariant: 'danger',
                                      onConfirm: () => onUpdateIqc(r.id, 'REJECTED_IQC')
                                    });
                                  } else if (val === 'EDIT') setEditingReceiving({ ...r });
                                  else if (val === 'DELETE') {
                                    setConfirmAction({
                                      title: 'Delete Receiving Record',
                                      message: `Are you sure you want to delete receiving record ${r.rrNumber || r.id} (${r.partCode})?`,
                                      confirmLabel: 'YES, DELETE',
                                      confirmVariant: 'danger',
                                      onConfirm: () => onDeleteReceiving?.(r.id)
                                    });
                                  }
                                  e.target.value = '';
                                }}
                                className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                                id={`action-select-rec-${r.id}`}
                              >
                                <option value="" disabled>Actions...</option>
                                {r.iqcStatus === 'PENDING_IQC' && (
                                  <>
                                    <option value="APPROVE">✅ Approve IQC</option>
                                    <option value="REJECT">❌ Reject IQC</option>
                                  </>
                                )}
                                <option value="EDIT">📝 Edit Record</option>
                                <option value="DELETE">🗑️ Delete Record</option>
                              </select>
                            ) : (
                              <span className="text-slate-400 italic font-semibold text-[10px]">Super Admin Only</span>
                            )}
                          </td>
                        </tr>

                        {/* Expandable Card View */}
                        <AnimatePresence>
                          {isExpanded && (
                            <tr>
                              <td colSpan={15} className="p-0 bg-slate-50/80 border-b-2 border-indigo-200">
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
                                              Receiving Report: <span className="font-mono text-indigo-600">{r.rrNumber || r.id}</span>
                                            </span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                              r.source === 'INTERNAL' 
                                                ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                            }`}>
                                              {r.source === 'INTERNAL' ? 'INTERNAL TRANSFER' : 'EXTERNAL SUPPLIER'}
                                            </span>
                                          </div>
                                          <p className="text-xs text-slate-500 mt-0.5">
                                            Item Code: <strong className="font-mono text-slate-700">{r.itemDescription}</strong> &bull; Part: <strong className="font-mono text-slate-700">{r.partCode}</strong>
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="bg-slate-100 text-slate-700 font-mono font-semibold px-2.5 py-1 rounded-lg border border-slate-200">
                                          Received: {r.date}
                                        </span>
                                        <span className="bg-indigo-50 text-indigo-800 font-bold px-2.5 py-1 rounded-lg border border-indigo-200 font-mono">
                                          Qty: {r.quantity.toLocaleString()} {(r.unit || 'PCS').toUpperCase()}
                                        </span>
                                        {matchedStock && (
                                          <span className="bg-emerald-50 text-emerald-800 font-bold px-2.5 py-1 rounded-lg border border-emerald-200 font-mono">
                                            Active Stock: {matchedStock.quantity.toLocaleString()} {matchedStock.unit}
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
                                          <span>Traceability & Documents</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">PO Number:</span>
                                            <span className="font-mono font-semibold text-slate-800">{r.poNumber || 'N/A'}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">DR Number:</span>
                                            <span className="font-mono font-semibold text-slate-800">{r.drNumber || 'N/A'}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">SI Number:</span>
                                            <span className="font-mono font-semibold text-slate-800">{r.siNumber || 'N/A'}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Lot / Batch #:</span>
                                            <span className="font-mono font-bold text-indigo-700">{r.lotNumber || 'N/A'}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Source / Vendor:</span>
                                            <span className="font-medium text-slate-800 truncate block">{r.vendorSupplier || r.supplierOrDept || 'N/A'}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Location / Aisle:</span>
                                            <span className="font-mono font-semibold text-slate-800">{r.location || (matchedStock?.location) || 'Main Storage'}</span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Col 2: SOP 5-Point Quality Verification */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
                                            <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                            <span>SOP Quality Verification</span>
                                          </div>
                                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                            isPassed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                          }`}>
                                            {isPassed ? 'ALL PASSED' : 'DISCREPANCY'}
                                          </span>
                                        </div>
                                        
                                        <div className="space-y-1.5 text-xs">
                                          {isNewSop ? (
                                            <>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">1. Receiving Inspection:</span>
                                                <span className={pc.receivingInspection !== false ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.receivingInspection !== false ? '✓ Verified' : '✗ Failed'}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">2. Material Traceability:</span>
                                                <span className={pc.materialTraceability !== false ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.materialTraceability !== false ? '✓ Lot Recorded' : '✗ Unverified'}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">3. Quantity Accuracy:</span>
                                                <span className={pc.quantityAccuracy !== false ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.quantityAccuracy !== false ? '✓ 100% Match' : '✗ Discrepancy'}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">4. Material Condition:</span>
                                                <span className={pc.materialConditionCheck !== false ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.materialConditionCheck !== false ? '✓ Good Condition' : '✗ Defect / Wet'}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">5. System Recording:</span>
                                                <span className={pc.systemRecording !== false ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.systemRecording !== false ? '✓ Logged' : '✗ Missing'}
                                                </span>
                                              </div>
                                            </>
                                          ) : (
                                            <>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">Packaging Intact:</span>
                                                <span className={pc.boxIntact ?? true ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.boxIntact ?? true ? '✓ Passed' : '✗ Damaged'}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">Moisture / Water Free:</span>
                                                <span className={pc.noWaterDamage ?? true ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {pc.noWaterDamage ?? true ? '✓ Clean' : '✗ Water Spotted'}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span className="text-slate-600">Pest / Contamination:</span>
                                                <span className={(pc.noPestSign ?? true) && (pc.noContamination ?? true) ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                                  {(pc.noPestSign ?? true) && (pc.noContamination ?? true) ? '✓ Free' : '✗ Issue Found'}
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
                                          <span>IQC & Warehouse Staging</span>
                                        </div>

                                        <div className="space-y-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">IQC Inspection Status:</span>
                                            <div className="mt-0.5">
                                              {r.iqcStatus === 'NA' ? (
                                                <span className="text-slate-500 font-semibold">N/A (Internal Production)</span>
                                              ) : r.iqcStatus === 'PENDING_IQC' ? (
                                                <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                  AWAITING IQC INSPECTION
                                                </span>
                                              ) : r.iqcStatus === 'APPROVED_IQC' ? (
                                                <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                  PASSED IQC & ACCEPTED
                                                </span>
                                              ) : (
                                                <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                  REJECTED (IN QUARANTINE)
                                                </span>
                                              )}
                                            </div>
                                          </div>

                                          <div className="pt-1">
                                            <span className="text-slate-400 text-[11px] block">Assigned FIFO Tag:</span>
                                            <div className="flex items-center gap-2 mt-1">
                                              <span className={`h-4 w-4 rounded-full border border-slate-300 shadow-sm ${
                                                r.fifoColorCode === 'Magenta' ? 'bg-fuchsia-600' :
                                                r.fifoColorCode === 'Orange' ? 'bg-orange-500' :
                                                r.fifoColorCode === 'Dark Green' ? 'bg-emerald-800' :
                                                r.fifoColorCode === 'Yellow' ? 'bg-yellow-400' :
                                                r.fifoColorCode === 'Navy Blue' ? 'bg-blue-900' :
                                                r.fifoColorCode === 'Brown' ? 'bg-amber-800' :
                                                r.fifoColorCode === 'Pink' ? 'bg-pink-400' :
                                                r.fifoColorCode === 'Violet' ? 'bg-violet-600' :
                                                r.fifoColorCode === 'Black' ? 'bg-stone-900' :
                                                r.fifoColorCode === 'Light Orange' ? 'bg-orange-300' :
                                                r.fifoColorCode === 'Grey' ? 'bg-slate-500' : 'bg-slate-300'
                                              }`} />
                                              <span className="font-semibold text-slate-800">{r.fifoColorCode}</span>
                                            </div>
                                          </div>

                                          {isSuperAdmin && r.iqcStatus === 'PENDING_IQC' && (
                                            <div className="pt-2 flex items-center gap-2" data-no-expand="true">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setConfirmAction({
                                                    title: 'Approve IQC Inspection',
                                                    message: `Are you sure you want to APPROVE IQC inspection for record ${r.rrNumber || r.id} (${r.partCode})?`,
                                                    confirmLabel: 'YES, APPROVE IQC',
                                                    confirmVariant: 'primary',
                                                    onConfirm: () => onUpdateIqc(r.id, 'APPROVED_IQC')
                                                  });
                                                }}
                                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold transition-colors cursor-pointer"
                                              >
                                                Approve IQC
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setConfirmAction({
                                                    title: 'Reject IQC Inspection',
                                                    message: `Are you sure you want to REJECT IQC inspection and route record ${r.rrNumber || r.id} (${r.partCode}) to Quarantine?`,
                                                    confirmLabel: 'YES, REJECT IQC',
                                                    confirmVariant: 'danger',
                                                    onConfirm: () => onUpdateIqc(r.id, 'REJECTED_IQC')
                                                  });
                                                }}
                                                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold transition-colors cursor-pointer"
                                              >
                                                Reject to Quarantine
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
                placeholder="Search returned materials..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
              />
            </div>

            {isSuperAdmin ? (
              <button 
                onClick={() => setShowReturnForm(!showReturnForm)}
                className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5"
                id="btn-log-return"
              >
                <Plus className="h-4 w-4" /> Log Production Excess Return (MRS)
              </button>
            ) : (
              <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded font-bold uppercase">
                🔒 View-Only Mode (Log Return restricted to Super Admin)
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
                    <RotateCcw className="h-4 w-4 text-slate-500" /> Return Requisition Entry Form
                  </h3>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Auto-saved draft
                  </span>
                </div>
                <button 
                  type="button" 
                  onClick={handleDiscardReturn}
                  className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Category Selector at Top of Return Form */}
                <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-2 col-span-1 md:col-span-3">
                  <label className="block text-xs font-bold text-indigo-900 uppercase tracking-wider">
                    Select Category *
                  </label>
                  <select 
                    required
                    value={retCategory}
                    onChange={e => setRetCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-indigo-950 focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer shadow-2xs"
                  >
                    <option value="">-- Select Category --</option>
                    <option value="RESIN/RAW MATERIALS">RESIN/RAW MATERIALS</option>
                    <option value="INDIRECT BOM">INDIRECT BOM</option>
                    <option value="DIRECT BOM">DIRECT BOM</option>
                    <option value="CONSUMABLES">CONSUMABLES</option>
                    <option value="PACKAGING MATERIALS">PACKAGING MATERIALS</option>
                    <option value="WIP (WORK IN PROGRESS)">WIP (WORK IN PROGRESS)</option>
                    <option value="FG (FINISHED GOOD)">FG (FINISHED GOOD)</option>
                    <option value="OFFICE SUPPLIES">OFFICE SUPPLIES</option>
                    {registries
                      .filter(r => r.type === 'CATEGORY' && r.status === 'ACTIVE' && 
                        !['RESIN/RAW MATERIALS', 'INDIRECT BOM', 'DIRECT BOM', 'CONSUMABLES', 'PACKAGING MATERIALS', 'WIP (WORK IN PROGRESS)', 'FG (FINISHED GOOD)', 'OFFICE SUPPLIES', 'RAW MATERIALS / RESINS', 'WIP / SUB-PARTS'].includes(r.name))
                      .map(cat => (
                        <option key={cat.id} value={cat.name}>{cat.name}</option>
                      ))}
                  </select>
                  <p className="text-[11px] text-indigo-600 font-medium">
                    {retCategory ? `Return category set to: "${retCategory}"` : 'Selecting a category specifies the material classification for shop-floor return.'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Return Slip (MRS) Form # *</label>
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
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Material Description *</label>
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
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Part Code *</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. RM-RE-089"
                    value={retPartCode}
                    onChange={e => setRetPartCode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Returned Lot / Batch *</label>
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
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Quantity *</label>
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
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Unit of Measure *</label>
                  <select 
                    value={retUnit}
                    onChange={e => setRetUnit(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none font-semibold"
                  >
                    {UOM_OPTIONS.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Returning Department *</label>
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
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Physical Condition *</label>
                  <select 
                    value={retCondition}
                    onChange={e => setRetCondition(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
                  >
                    <option value="Good">Good/Clean (Re-add to FIFO inventory)</option>
                    <option value="Damaged">Damaged (Requires Quarantine Hold)</option>
                    <option value="Contaminated">Contaminated (Requires Quarantine Hold)</option>
                    <option value="Unidentified">Unidentified (Requires Quality Evaluation)</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Return Reason / Detailed Log Remarks</label>
                  <textarea 
                    value={retReason}
                    onChange={e => setRetReason(e.target.value)}
                    rows={2}
                    placeholder="Describe batch completion details or any discrepancy seen on the plant floor."
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
                  Discard
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  Process and Register Return Slip
                </button>
              </div>
            </form>
          )}

          {/* Returns Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-slate-50/50">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Excess Materials Returns Log</span>
                <span className="bg-slate-200/80 text-slate-700 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full">
                  {filteredReturns.length} returns logged
                </span>
                <span className="text-[11px] text-slate-500 font-medium hidden md:inline">
                  &bull; Sorted by <strong className="text-indigo-700 font-semibold">{retSortField}</strong> ({retSortDirection === 'asc' ? 'Ascending' : 'Descending'})
                </span>
              </div>
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
                      title="Sort by Return Slip Form Number"
                    >
                      <div className="flex items-center gap-1">
                        <span>Slip Form</span>
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
                      title="Sort by Category"
                    >
                      <div className="flex items-center gap-1">
                        <span>Category</span>
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
                      title="Sort by Date Returned"
                    >
                      <div className="flex items-center gap-1">
                        <span>Date Returned</span>
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
                      title="Sort by Returning Department"
                    >
                      <div className="flex items-center gap-1">
                        <span>Department</span>
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
                      title="Sort by Material / Part Code"
                    >
                      <div className="flex items-center gap-1">
                        <span>Material Details</span>
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
                      title="Sort by Quantity"
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Qty</span>
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
                      title="Sort by Physical Condition"
                    >
                      <div className="flex items-center gap-1">
                        <span>Physical Condition</span>
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
                      title="Sort by Evaluation Status"
                    >
                      <div className="flex items-center gap-1">
                        <span>Evaluation Status</span>
                        <span className="text-slate-400 group-hover:text-slate-700">
                          {retSortField === 'status' ? (retSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-indigo-600" /> : <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />) : <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                        </span>
                      </div>
                    </th>
                    <th className="p-3 font-semibold text-slate-600">Remarks / Reason</th>
                    <th className="p-3 font-semibold text-slate-600">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedReturns.map(r => {
                    const isExpanded = expandedReturnId === r.id;
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
                            setExpandedReturnId(prev => prev === r.id ? null : r.id);
                          }}
                          className={`cursor-pointer transition-all duration-150 ${
                            isExpanded 
                              ? 'bg-indigo-50/70 border-l-4 border-l-indigo-600 shadow-2xs' 
                              : 'hover:bg-indigo-50/30 hover:border-l-4 hover:border-l-indigo-300'
                          }`}
                          title="Click row to expand return metadata & quality details"
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
                                title={isExpanded ? 'Collapse row' : 'Expand row details'}
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
                              {r.category || 'N/A'}
                            </span>
                          </td>
                          <td className="p-4 text-slate-600 font-mono">{r.date}</td>
                          <td className="p-4 font-medium text-slate-700">{r.department}</td>
                          <td className="p-4">
                            <div className="font-mono font-semibold text-slate-800">{r.partCode}</div>
                            <div className="text-slate-500 text-[11px]">{r.materialDescription}</div>
                            <div className="text-[10px] text-slate-400 mt-1">Lot: {r.lotNumber}</div>
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-slate-800">{r.quantity.toLocaleString()} {(r.unit || 'PCS').toUpperCase()}</td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.condition === 'Good' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                              r.condition === 'Damaged' ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-amber-50 text-amber-700 border border-amber-100'
                            }`}>
                              {r.condition}
                            </span>
                          </td>
                          <td className="p-4">
                            {r.status === 'APPROVED' ? (
                              <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded font-semibold text-[10px] border border-emerald-100">
                                ACCEPTED TO STOCKS
                              </span>
                            ) : (
                              <span className="bg-rose-50 text-rose-700 px-2 py-1 rounded font-semibold text-[10px] border border-rose-100">
                                QUARANTINE / RESTRICTED
                              </span>
                            )}
                          </td>
                          <td className="p-4 max-w-xs">
                            {r.reason ? (
                              <span className="text-[11px] text-slate-700 font-medium">{r.reason}</span>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">No remarks</span>
                            )}
                          </td>
                          <td className="p-4" data-no-expand="true">
                            {isSuperAdmin ? (
                              <select
                                defaultValue=""
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === 'APPROVE') {
                                    setConfirmAction({
                                      title: 'Pass Quality & Approve Return',
                                      message: `Are you sure you want to pass quality inspection and approve return record ${r.returnSlipFormNumber} (${r.partCode}) into stocks?`,
                                      confirmLabel: 'YES, APPROVE RETURN',
                                      confirmVariant: 'primary',
                                      onConfirm: () => onUpdateReturnStatus(r.id, 'APPROVED')
                                    });
                                  } else if (val === 'EDIT') setEditingReturn({ ...r });
                                  else if (val === 'DELETE') {
                                    setConfirmAction({
                                      title: 'Delete Return Record',
                                      message: `Are you sure you want to delete return record ${r.returnSlipFormNumber} (${r.partCode})?`,
                                      confirmLabel: 'YES, DELETE',
                                      confirmVariant: 'danger',
                                      onConfirm: () => onDeleteReturn?.(r.id)
                                    });
                                  }
                                  e.target.value = '';
                                }}
                                className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                                id={`action-select-ret-${r.id}`}
                              >
                                <option value="" disabled>Actions...</option>
                                {r.status === 'QUARANTINED' && (
                                  <option value="APPROVE">✅ Pass Quality & Approve</option>
                                )}
                                <option value="EDIT">📝 Edit Record</option>
                                <option value="DELETE">🗑️ Delete Record</option>
                              </select>
                            ) : (
                              <span className="text-slate-400 italic font-semibold text-[10px]">Super Admin Only</span>
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
                                              Return Slip: <span className="font-mono text-indigo-600">{r.returnSlipFormNumber}</span>
                                            </span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                              r.status === 'APPROVED' 
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                                            }`}>
                                              {r.status === 'APPROVED' ? 'ACCEPTED IN STOCKS' : 'QUARANTINED / RESTRICTED'}
                                            </span>
                                          </div>
                                          <p className="text-xs text-slate-500 mt-0.5">
                                            Origin: <strong className="text-slate-700">{r.department}</strong> &bull; Part: <strong className="font-mono text-slate-700">{r.partCode}</strong>
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="bg-slate-100 text-slate-700 font-mono font-semibold px-2.5 py-1 rounded-lg border border-slate-200">
                                          Date: {r.date}
                                        </span>
                                        <span className="bg-purple-50 text-purple-800 font-bold px-2.5 py-1 rounded-lg border border-purple-200 font-mono">
                                          Return Qty: {r.quantity.toLocaleString()} {(r.unit || 'PCS').toUpperCase()}
                                        </span>
                                        {matchedStock && (
                                          <span className="bg-emerald-50 text-emerald-800 font-bold px-2.5 py-1 rounded-lg border border-emerald-200 font-mono">
                                            Active Stock: {matchedStock.quantity.toLocaleString()} {matchedStock.unit}
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
                                          <span>Origin & Batch Info</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Department:</span>
                                            <span className="font-semibold text-slate-800">{r.department}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Category:</span>
                                            <span className="font-semibold text-indigo-700">{r.category || 'N/A'}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Lot / Batch #:</span>
                                            <span className="font-mono font-bold text-slate-800">{r.lotNumber || 'N/A'}</span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Location:</span>
                                            <span className="font-mono font-semibold text-slate-800">{matchedStock?.location || 'Returns Bay / Shelf'}</span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Col 2: Physical Condition & QA Notes */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                          <span>Material Condition & Reason</span>
                                        </div>
                                        <div className="space-y-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Condition:</span>
                                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold mt-0.5 ${
                                              r.condition === 'Good' ? 'bg-emerald-100 text-emerald-800' :
                                              r.condition === 'Damaged' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                                            }`}>
                                              {r.condition}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Reason for Return:</span>
                                            <p className="text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-150 mt-0.5 text-[11px] leading-relaxed">
                                              {r.reason || 'Excess production material returned to warehouse.'}
                                            </p>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Col 3: Quality Disposition & Approvals */}
                                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                                          <Activity className="h-4 w-4 text-purple-500" />
                                          <span>Quality Disposition</span>
                                        </div>

                                        <div className="space-y-2 text-xs">
                                          <div>
                                            <span className="text-slate-400 text-[11px] block">Current Disposition:</span>
                                            <div className="mt-0.5">
                                              {r.status === 'APPROVED' ? (
                                                <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                  PASSED QUALITY & MERGED TO STOCK
                                                </span>
                                              ) : (
                                                <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                  HELD IN QUARANTINE / RESTRICTED
                                                </span>
                                              )}
                                            </div>
                                          </div>

                                          {isSuperAdmin && r.status === 'QUARANTINED' && (
                                            <div className="pt-2" data-no-expand="true">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setConfirmAction({
                                                    title: 'Pass Quality & Approve Return',
                                                    message: `Are you sure you want to pass quality inspection and approve return record ${r.returnSlipFormNumber} (${r.partCode}) into stocks?`,
                                                    confirmLabel: 'YES, APPROVE RETURN',
                                                    confirmVariant: 'primary',
                                                    onConfirm: () => onUpdateReturnStatus(r.id, 'APPROVED')
                                                  });
                                                }}
                                                className="w-full px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-2xs flex items-center justify-center gap-1.5"
                                              >
                                                <Check className="h-3.5 w-3.5" /> Pass Quality & Merge to Stocks
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
      <AnimatePresence>
        {editingReceiving && (
          <motion.div
            key="editing-receiving-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <motion.div
              key="editing-receiving-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-lg w-full space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Edit className="h-4 w-4 text-indigo-600" /> Edit Registered Material Arrival ({editingReceiving.id})
                  </h4>
                  <p className="text-[11px] text-slate-500">Super Admin Record Overwrite</p>
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
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Model</label>
                  <input 
                    type="text" 
                    value={editingReceiving.partCode}
                    onChange={e => setEditingReceiving({ ...editingReceiving, partCode: e.target.value.toUpperCase() })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Date</label>
                  <input 
                    type="date" 
                    value={editingReceiving.date}
                    onChange={e => setEditingReceiving({ ...editingReceiving, date: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Part Code / Item Code</label>
                  <input 
                    type="text" 
                    value={editingReceiving.itemDescription}
                    onChange={e => setEditingReceiving({ ...editingReceiving, itemDescription: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Quantity</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editingReceiving.quantity || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '');
                      setEditingReceiving({ ...editingReceiving, quantity: val ? parseInt(val, 10) : 0 });
                    }}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Unit of Measure (UOM)</label>
                  <select 
                    value={editingReceiving.unit}
                    onChange={e => setEditingReceiving({ ...editingReceiving, unit: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono font-semibold"
                  >
                    {UOM_OPTIONS.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Part Name</label>
                  <input 
                    type="text" 
                    value={editingReceiving.lotNumber}
                    onChange={e => setEditingReceiving({ ...editingReceiving, lotNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Category</label>
                  <select 
                    value={editingReceiving.supplierOrDept}
                    onChange={e => setEditingReceiving({ ...editingReceiving, supplierOrDept: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded text-xs focus:ring-1 focus:ring-indigo-500 font-medium text-slate-700 cursor-pointer"
                  >
                    <option value="">Select Category...</option>
                    {registries.filter(r => r.type === 'CATEGORY' && r.status === 'ACTIVE').map(cat => (
                      <option key={cat.id} value={cat.name}>{cat.name}</option>
                    ))}
                    {!registries.some(r => r.type === 'CATEGORY' && r.status === 'ACTIVE') && (
                      <>
                        <option value="RAW MATERIALS / RESINS">RAW MATERIALS / RESINS</option>
                        <option value="PACKAGING MATERIALS">PACKAGING MATERIALS</option>
                        <option value="CONSUMABLES">CONSUMABLES</option>
                        <option value="PRODUCTION SUPPLIES">PRODUCTION SUPPLIES</option>
                        <option value="OFFICE SUPPLIES">OFFICE SUPPLIES</option>
                        <option value="WIP / SUB-PARTS">WIP / SUB-PARTS</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">IQC Status</label>
                  <select 
                    value={editingReceiving.iqcStatus}
                    onChange={e => setEditingReceiving({ ...editingReceiving, iqcStatus: e.target.value as any })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-bold"
                  >
                    <option value="PENDING_IQC">PENDING IQC</option>
                    <option value="APPROVED_IQC">APPROVED IQC</option>
                    <option value="REJECTED_IQC">REJECTED IQC</option>
                    <option value="NA">NA (Internal)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Date Received</label>
                  <input 
                    type="date" 
                    value={editingReceiving.receivedDate || editingReceiving.date}
                    onChange={e => setEditingReceiving({ ...editingReceiving, receivedDate: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Location</label>
                  <input 
                    type="text" 
                    value={editingReceiving.location || ''}
                    onChange={e => setEditingReceiving({ ...editingReceiving, location: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Vendor / Supplier / Dept</label>
                  <input 
                    type="text" 
                    value={editingReceiving.vendorSupplier || ''}
                    onChange={e => setEditingReceiving({ ...editingReceiving, vendorSupplier: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Purchase Order (PO) #</label>
                  <input 
                    type="text" 
                    value={editingReceiving.poNumber || ''}
                    onChange={e => setEditingReceiving({ ...editingReceiving, poNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Delivery Receipt (DR) #</label>
                  <input 
                    type="text" 
                    value={editingReceiving.drNumber || ''}
                    onChange={e => setEditingReceiving({ ...editingReceiving, drNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Sales Invoice (SI) #</label>
                  <input 
                    type="text" 
                    value={editingReceiving.siNumber || ''}
                    onChange={e => setEditingReceiving({ ...editingReceiving, siNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Reorder Min</label>
                  <input 
                    type="number" 
                    value={editingReceiving.reorderMin || ''}
                    onChange={e => setEditingReceiving({ ...editingReceiving, reorderMin: Number(e.target.value) })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Remarks</label>
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
                  onClick={() => setEditingReceiving(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    onEditReceiving?.(editingReceiving);
                    setEditingReceiving(null);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold"
                >
                  Save Record Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Return Record Modal (Super Admin) */}
      <AnimatePresence>
        {editingReturn && (
          <motion.div
            key="editing-return-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <motion.div
              key="editing-return-content"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-lg w-full space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Edit className="h-4 w-4 text-indigo-600" /> Edit Registered Return ({editingReturn.returnSlipFormNumber})
                  </h4>
                  <p className="text-[11px] text-slate-500">Super Admin Record Overwrite</p>
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
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Slip Form Number</label>
                  <input 
                    type="text" 
                    value={editingReturn.returnSlipFormNumber}
                    onChange={e => setEditingReturn({ ...editingReturn, returnSlipFormNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Date</label>
                  <input 
                    type="date" 
                    value={editingReturn.date}
                    onChange={e => setEditingReturn({ ...editingReturn, date: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Department</label>
                  <input 
                    type="text" 
                    value={editingReturn.department}
                    onChange={e => setEditingReturn({ ...editingReturn, department: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Part Code</label>
                  <input 
                    type="text" 
                    value={editingReturn.partCode}
                    onChange={e => setEditingReturn({ ...editingReturn, partCode: e.target.value.toUpperCase() })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Material Description</label>
                  <input 
                    type="text" 
                    value={editingReturn.materialDescription}
                    onChange={e => setEditingReturn({ ...editingReturn, materialDescription: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Return Reason / Detailed Log Remarks</label>
                  <input 
                    type="text" 
                    value={editingReturn.reason || ''}
                    onChange={e => setEditingReturn({ ...editingReturn, reason: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                    placeholder="Describe return reason or log remarks"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Category</label>
                  <select 
                    value={editingReturn.category || ''}
                    onChange={e => setEditingReturn({ ...editingReturn, category: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-bold text-xs"
                  >
                    <option value="">Select Category...</option>
                    <option value="RESIN/RAW MATERIALS">RESIN/RAW MATERIALS</option>
                    <option value="INDIRECT BOM">INDIRECT BOM</option>
                    <option value="DIRECT BOM">DIRECT BOM</option>
                    <option value="CONSUMABLES">CONSUMABLES</option>
                    <option value="PACKAGING MATERIALS">PACKAGING MATERIALS</option>
                    <option value="WIP (WORK IN PROGRESS)">WIP (WORK IN PROGRESS)</option>
                    <option value="FG (FINISHED GOOD)">FG (FINISHED GOOD)</option>
                    <option value="OFFICE SUPPLIES">OFFICE SUPPLIES</option>
                    {registries
                      .filter(r => r.type === 'CATEGORY' && r.status === 'ACTIVE')
                      .map(cat => (
                        <option key={cat.id} value={cat.name}>{cat.name}</option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Quantity</label>
                  <input 
                    type="number" 
                    value={editingReturn.quantity}
                    onChange={e => setEditingReturn({ ...editingReturn, quantity: Number(e.target.value) })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Lot Number</label>
                  <input 
                    type="text" 
                    value={editingReturn.lotNumber}
                    onChange={e => setEditingReturn({ ...editingReturn, lotNumber: e.target.value })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Condition</label>
                  <select 
                    value={editingReturn.condition}
                    onChange={e => setEditingReturn({ ...editingReturn, condition: e.target.value as any })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="Good">Good</option>
                    <option value="Damaged">Damaged</option>
                    <option value="Contaminated">Contaminated</option>
                    <option value="Unidentified">Unidentified</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Status</label>
                  <select 
                    value={editingReturn.status}
                    onChange={e => setEditingReturn({ ...editingReturn, status: e.target.value as any })}
                    className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-bold"
                  >
                    <option value="PENDING">PENDING</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="QUARANTINED">QUARANTINED</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  onClick={() => setEditingReturn(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    onEditReturn?.(editingReturn);
                    setEditingReturn(null);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold"
                >
                  Save Return Changes
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
        title="Receiving Material Barcode Scanner"
        subtitle="Use handheld barcode scanner or enter barcode manually"
      />
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
                    className={`px-5 py-2 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm ${
                      confirmAction.confirmVariant === 'primary' 
                        ? 'bg-indigo-600 hover:bg-indigo-700' 
                        : 'bg-rose-600 hover:bg-rose-700'
                    }`}
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
