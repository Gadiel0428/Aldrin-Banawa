import React, { useState } from 'react';
import { 
  Printer, 
  X, 
  CheckCircle2, 
  Package, 
  Truck, 
  Calendar, 
  User, 
  MapPin, 
  Hash, 
  Barcode, 
  ShieldCheck, 
  ShieldAlert, 
  FileText, 
  FileSpreadsheet, 
  ClipboardList, 
  Building2, 
  Award, 
  FileCheck,
  Check
} from 'lucide-react';
import { DeliveryRecord, IssuanceRecord, MaterialStockItem, MasterRegistryItem } from '../types';

export type DocViewMode = 'OFFICIAL_DOC' | 'PICKING_LIST' | 'SUMMARY_LOG';

interface PrintablePickingListModalProps {
  delivery?: DeliveryRecord | null;
  issuance?: IssuanceRecord | null;
  deliveriesList?: DeliveryRecord[];
  issuancesList?: IssuanceRecord[];
  stocks?: MaterialStockItem[];
  registries?: MasterRegistryItem[];
  initialView?: DocViewMode;
  onClose: () => void;
}

export default function PrintablePickingListModal({
  delivery,
  issuance,
  deliveriesList = [],
  issuancesList = [],
  stocks = [],
  registries = [],
  initialView = 'OFFICIAL_DOC',
  onClose
}: PrintablePickingListModalProps) {
  // Determine primary mode (Delivery vs Issuance)
  const isDeliveryMode = !!delivery || deliveriesList.length > 0;
  const isIssuanceMode = !!issuance || (issuancesList.length > 0 && !isDeliveryMode);

  if (!delivery && !issuance && deliveriesList.length === 0 && issuancesList.length === 0) {
    return null;
  }

  const [viewMode, setViewMode] = useState<DocViewMode>(
    (!delivery && !issuance) ? 'SUMMARY_LOG' : initialView
  );

  const handlePrint = () => {
    window.print();
  };

  // Helper variables for single record view
  const targetDelivery = delivery || deliveriesList[0] || null;
  const targetIssuance = issuance || issuancesList[0] || null;

  const docNumber = isDeliveryMode 
    ? (targetDelivery?.drNumber || targetDelivery?.pickingListNumber || targetDelivery?.gatePassNumber || 'N/A')
    : (targetIssuance?.requisitionNumber || 'N/A');

  const partCode = isDeliveryMode ? (targetDelivery?.partCode || 'N/A') : (targetIssuance?.partCode || 'N/A');
  const description = isDeliveryMode ? (targetDelivery?.modelName || 'N/A') : (targetIssuance?.description || 'N/A');
  const reqQty = isDeliveryMode ? (targetDelivery?.quantity || 0) : (targetIssuance?.quantityRequested || targetIssuance?.quantityIssued || 0);
  const issuedQty = isDeliveryMode ? (targetDelivery?.quantity || 0) : (targetIssuance?.quantityIssued || 0);
  const dateStr = isDeliveryMode ? (targetDelivery?.date || new Date().toISOString().split('T')[0]) : (targetIssuance?.date || new Date().toISOString().split('T')[0]);
  const preparedBy = isDeliveryMode ? (targetDelivery?.preparedBy || 'Warehouse Staff') : (targetIssuance?.issuedBy || 'Warehouse Staff');
  const receivedBy = isDeliveryMode ? 'Carrier Logistics / Customer' : (targetIssuance?.receivedBy || 'Department Supervisor');
  const lotNumber = isDeliveryMode ? 'LOT-2026-FIFO' : (targetIssuance?.lotNumber || 'N/A');

  const matchedStock = stocks.find(s => (s.partCode || '').toLowerCase() === (partCode || '').toLowerCase());
  const matchedRegistry = registries.find(r => (r.code || '').toLowerCase() === (partCode || '').toLowerCase());
  const binLocation = matchedStock?.location || matchedRegistry?.location || 'Zone A - Rack 02 - Bin B14';
  const uom = matchedRegistry?.unit || 'PCS';

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* On-Screen Modal Control Header (Hidden during printing) */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex flex-wrap items-center justify-between shrink-0 no-print border-b border-slate-800 gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600/30 border border-indigo-400/30 rounded-xl text-indigo-300 shrink-0">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base flex items-center gap-2">
                {isDeliveryMode ? 'Official Delivery & Shipping Documentation' : 'Official Material Requisition & Issuance Documentation'}
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono font-bold uppercase">
                  Print Ready
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {isDeliveryMode ? `Ref: ${docNumber}` : `Requisition Ref: ${docNumber}`}
              </p>
            </div>
          </div>

          {/* Document View Switcher Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs font-semibold">
            {(targetDelivery || targetIssuance) && (
              <>
                <button
                  type="button"
                  onClick={() => setViewMode('OFFICIAL_DOC')}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'OFFICIAL_DOC' 
                      ? 'bg-indigo-600 text-white font-bold shadow-sm' 
                      : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>{isDeliveryMode ? 'Delivery Receipt & Gate Pass' : 'Requisition Slip (MRS)'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode('PICKING_LIST')}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'PICKING_LIST' 
                      ? 'bg-indigo-600 text-white font-bold shadow-sm' 
                      : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                  }`}
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  <span>Picking List</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setViewMode('SUMMARY_LOG')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'SUMMARY_LOG' 
                  ? 'bg-indigo-600 text-white font-bold shadow-sm' 
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Summary Log Report</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg transition flex items-center gap-2 cursor-pointer active:scale-95"
              id="btn-print-document-sheet"
            >
              <Printer className="h-4 w-4" />
              <span>PRINT (PDF / PAPER)</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
              title="Close Document View"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Sheet Body */}
        <div className="p-6 sm:p-10 overflow-y-auto flex-1 bg-white" id="printable-document-container">
          <div className="max-w-4xl mx-auto space-y-6 text-slate-900 font-sans">

            {/* ========================================================================= */}
            {/* VIEW MODE 1: OFFICIAL DELIVERY RECEIPT (DR) & GATE PASS SHIPPNG MANIFEST */}
            {/* ========================================================================= */}
            {viewMode === 'OFFICIAL_DOC' && isDeliveryMode && targetDelivery && (
              <div className="space-y-6">
                {/* Official Letterhead Header */}
                <div className="border-b-2 border-slate-900 pb-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-black tracking-wider text-slate-900 uppercase">
                      JUWEI PLASTIC MOLDING INC.
                    </div>
                    <div className="text-[10px] text-slate-600 font-semibold">
                      Subic Bay Freeport Zone, Commercial Complex, Subic Bay, Philippines
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Warehouse & Material Control Division • ISO 9001 / ISO 14001 Certified
                    </div>
                  </div>

                  <div className="text-right space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-300 min-w-[240px]">
                    <div className="text-xs font-black uppercase text-indigo-950 tracking-wider">
                      OFFICIAL DELIVERY RECEIPT & GATE PASS
                    </div>
                    <div className="font-mono text-sm font-black text-slate-900">
                      DR #: {targetDelivery.drNumber || 'DR-2026-PENDING'}
                    </div>
                    <div className="text-[10px] text-slate-600 font-bold">
                      FORM CONTROL #: <span className="font-mono">FORM-JW-DEL-DR-01</span>
                    </div>

                    {/* Barcode Tag */}
                    <div className="pt-1 flex flex-col items-end">
                      <div className="flex gap-[2px] h-6 items-center px-1 bg-white border border-slate-400 rounded">
                        {[1,3,1,2,4,1,2,3,1,1,3,2,1,4,1,2,3,1,2,3,1,4,1].map((w, idx) => (
                          <div key={idx} className="bg-slate-950 h-full" style={{ width: `${w}px` }} />
                        ))}
                      </div>
                      <span className="text-[9px] font-mono text-slate-700 font-bold tracking-widest mt-0.5">
                        *{targetDelivery.drNumber || targetDelivery.gatePassNumber}*
                      </span>
                    </div>
                  </div>
                </div>

                {/* Shipping Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-300 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Gate Pass Ref #</span>
                    <span className="font-mono font-bold text-slate-900 text-sm">{targetDelivery.gatePassNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Customer PO #</span>
                    <span className="font-mono font-bold text-slate-900 text-sm">{targetDelivery.poNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Sales Invoice #</span>
                    <span className="font-mono font-bold text-slate-800">{targetDelivery.salesInvoice || 'SI-2026-PENDING'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Waybill / Carrier #</span>
                    <span className="font-mono font-bold text-slate-800">{targetDelivery.wayBill || 'WB-STANDARD-TRUCK'}</span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Dispatch Date</span>
                    <span className="font-mono font-bold text-slate-800">{targetDelivery.date}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Picking List #</span>
                    <span className="font-mono font-bold text-slate-800">{targetDelivery.pickingListNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Dispatch Status</span>
                    <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 inline-block uppercase">
                      {targetDelivery.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Prepared By</span>
                    <span className="font-bold text-slate-800">{targetDelivery.preparedBy}</span>
                  </div>
                </div>

                {/* Items Specification Table */}
                <div>
                  <div className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex justify-between items-center">
                    <span>Delivered Items Specification & Quantities</span>
                    <span className="text-[10px] text-slate-500 font-medium">Verify physical quantities before carrier departure</span>
                  </div>

                  <table className="w-full text-left border-collapse text-xs border border-slate-300">
                    <thead>
                      <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                        <th className="p-2.5 border-r border-slate-300 text-center w-12">Item</th>
                        <th className="p-2.5 border-r border-slate-300">Part / Material Code</th>
                        <th className="p-2.5 border-r border-slate-300">Model Description</th>
                        <th className="p-2.5 border-r border-slate-300 font-mono">Lot / FIFO Batch</th>
                        <th className="p-2.5 border-r border-slate-300">Storage Location</th>
                        <th className="p-2.5 border-r border-slate-300 text-right">Order Qty</th>
                        <th className="p-2.5 text-right font-bold">Dispatched Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-medium">
                      <tr>
                        <td className="p-2.5 border-r border-slate-300 text-center font-mono font-bold">01</td>
                        <td className="p-2.5 border-r border-slate-300 font-mono font-bold text-slate-900">{targetDelivery.partCode}</td>
                        <td className="p-2.5 border-r border-slate-300 text-slate-800 font-semibold">{targetDelivery.modelName}</td>
                        <td className="p-2.5 border-r border-slate-300 font-mono font-bold text-slate-800">{lotNumber}</td>
                        <td className="p-2.5 border-r border-slate-300 font-mono text-indigo-950 font-bold bg-slate-50">{binLocation}</td>
                        <td className="p-2.5 border-r border-slate-300 text-right font-mono font-bold text-slate-800">{targetDelivery.quantity.toLocaleString()} {uom}</td>
                        <td className="p-2.5 text-right font-mono font-black text-slate-950 text-sm bg-indigo-50/50">{targetDelivery.quantity.toLocaleString()} {uom}</td>
                      </tr>
                      {[2, 3].map((seq) => (
                        <tr key={seq} className="text-slate-400">
                          <td className="p-2.5 border-r border-slate-200 text-center font-mono">0{seq}</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 text-right italic text-[11px]">-------</td>
                          <td className="p-2.5 text-right italic text-[11px]">-------</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Gate Security & Forklift Pre-check Statement */}
                <div className="bg-slate-50 border border-slate-300 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-emerald-100 border border-emerald-500 flex items-center justify-center text-emerald-800 shrink-0 font-bold text-xs">
                      ✓
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 block">Forklift Checklist Clearance</span>
                      <span className="text-[10px] text-slate-600">Pre-inspection completed & signed</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-emerald-100 border border-emerald-500 flex items-center justify-center text-emerald-800 shrink-0 font-bold text-xs">
                      ✓
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 block">Packaging Integrity OK</span>
                      <span className="text-[10px] text-slate-600">Pallet wrap & cartons intact</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-emerald-100 border border-emerald-500 flex items-center justify-center text-emerald-800 shrink-0 font-bold text-xs">
                      ✓
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 block">Gate Pass Release Approved</span>
                      <span className="text-[10px] text-slate-600">Verified by Subic Gate Inspector</span>
                    </div>
                  </div>
                </div>

                {/* Tri-Signature Authorization Block */}
                <div className="pt-6 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-xs text-center">
                  <div>
                    <div className="h-12 border-b-2 border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-900">{targetDelivery.preparedBy}</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 uppercase mt-1 block">Prepared By / Warehouse Logistics</span>
                    <span className="text-[9px] text-slate-500 font-mono">Date: {targetDelivery.date}</span>
                  </div>

                  <div>
                    <div className="h-12 border-b-2 border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-900">Subic Gate Security Supervisor</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 uppercase mt-1 block">Verified & Approved By</span>
                    <span className="text-[9px] text-slate-500 font-mono">Date: _______________</span>
                  </div>

                  <div>
                    <div className="h-12 border-b-2 border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-900">Carrier Driver / Received By</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 uppercase mt-1 block">Driver Name / Plate #: ____________</span>
                    <span className="text-[9px] text-slate-500 font-mono">Signature & Date: _______________</span>
                  </div>
                </div>

                <div className="text-[9px] text-slate-500 text-center border-t border-slate-200 pt-3 font-medium">
                  JUWEI PLASTIC MOLDING INC. • Controlled Shipping Document • White Copy: Customer | Yellow Copy: Gate Security | Pink Copy: Accounting
                </div>
              </div>
            )}


            {/* ========================================================================= */}
            {/* VIEW MODE 1 B: OFFICIAL MATERIAL REQUISITION SLIP (MRS) */}
            {/* ========================================================================= */}
            {viewMode === 'OFFICIAL_DOC' && isIssuanceMode && targetIssuance && (
              <div className="space-y-6">
                {/* Official Letterhead Header */}
                <div className="border-b-2 border-slate-900 pb-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-black tracking-wider text-slate-900 uppercase">
                      JUWEI PLASTIC MOLDING INC.
                    </div>
                    <div className="text-[10px] text-slate-600 font-semibold">
                      Subic Bay Freeport Zone, Building 3A, Commercial Complex, Philippines
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Material Control & Production Planning Division
                    </div>
                  </div>

                  <div className="text-right space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-300 min-w-[240px]">
                    <div className="text-xs font-black uppercase text-indigo-950 tracking-wider">
                      OFFICIAL MATERIAL REQUISITION SLIP (MRS)
                    </div>
                    <div className="font-mono text-sm font-black text-slate-900">
                      REQ #: {targetIssuance.requisitionNumber}
                    </div>
                    <div className="text-[10px] text-slate-600 font-bold">
                      FORM CONTROL #: <span className="font-mono">FORM-JW-ISS-MRS-02</span>
                    </div>

                    {/* Barcode Tag */}
                    <div className="pt-1 flex flex-col items-end">
                      <div className="flex gap-[2px] h-6 items-center px-1 bg-white border border-slate-400 rounded">
                        {[1,3,1,2,4,1,2,3,1,1,3,2,1,4,1,2,3,1,2,3,1,4,1].map((w, idx) => (
                          <div key={idx} className="bg-slate-950 h-full" style={{ width: `${w}px` }} />
                        ))}
                      </div>
                      <span className="text-[9px] font-mono text-slate-700 font-bold tracking-widest mt-0.5">
                        *{targetIssuance.requisitionNumber}*
                      </span>
                    </div>
                  </div>
                </div>

                {/* Requisition Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-300 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Issuance Log Ref</span>
                    <span className="font-mono font-bold text-slate-900 text-sm">{targetIssuance.id}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Requisitioning Department</span>
                    <span className="font-bold text-slate-900 text-sm">{targetIssuance.department}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Date Issued</span>
                    <span className="font-mono font-bold text-slate-800">{targetIssuance.date}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">FIFO Audit Status</span>
                    <span className={`font-bold text-xs px-2 py-0.5 rounded border inline-block ${
                      targetIssuance.fifoVerified 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}>
                      {targetIssuance.fifoVerified ? '✓ PASSED FIFO RULE' : '⚠️ MANUAL OVERRIDE'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Issued By (Warehouse)</span>
                    <span className="font-bold text-slate-800">{targetIssuance.issuedBy}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Received By (Dept)</span>
                    <span className="font-bold text-slate-800">{targetIssuance.receivedBy}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Part / Material Code</span>
                    <span className="font-mono font-bold text-indigo-950">{targetIssuance.partCode}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Batch Lot #</span>
                    <span className="font-mono font-bold text-slate-800">{targetIssuance.lotNumber}</span>
                  </div>
                </div>

                {/* Requisition Material Specification Table */}
                <div>
                  <div className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex justify-between items-center">
                    <span>Requisitioned Material Details & Issued Quantities</span>
                    <span className="text-[10px] text-slate-500 font-medium">Verify material specifications before shop-floor line load</span>
                  </div>

                  <table className="w-full text-left border-collapse text-xs border border-slate-300">
                    <thead>
                      <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                        <th className="p-2.5 border-r border-slate-300 text-center w-12">Item</th>
                        <th className="p-2.5 border-r border-slate-300">Part / Material Code</th>
                        <th className="p-2.5 border-r border-slate-300">Material Description</th>
                        <th className="p-2.5 border-r border-slate-300 font-mono">Lot Number</th>
                        <th className="p-2.5 border-r border-slate-300">Storage Bin</th>
                        <th className="p-2.5 border-r border-slate-300 text-right">Requested Qty</th>
                        <th className="p-2.5 text-right font-bold">Issued Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-medium">
                      <tr>
                        <td className="p-2.5 border-r border-slate-300 text-center font-mono font-bold">01</td>
                        <td className="p-2.5 border-r border-slate-300 font-mono font-bold text-slate-900">{targetIssuance.partCode}</td>
                        <td className="p-2.5 border-r border-slate-300 text-slate-800 font-semibold">{targetIssuance.description}</td>
                        <td className="p-2.5 border-r border-slate-300 font-mono font-bold text-slate-800">{targetIssuance.lotNumber}</td>
                        <td className="p-2.5 border-r border-slate-300 font-mono text-indigo-950 font-bold bg-slate-50">{binLocation}</td>
                        <td className="p-2.5 border-r border-slate-300 text-right font-mono font-bold text-slate-800">{targetIssuance.quantityRequested.toLocaleString()} {uom}</td>
                        <td className="p-2.5 text-right font-mono font-black text-slate-950 text-sm bg-indigo-50/50">{targetIssuance.quantityIssued.toLocaleString()} {uom}</td>
                      </tr>
                      {[2, 3].map((seq) => (
                        <tr key={seq} className="text-slate-400">
                          <td className="p-2.5 border-r border-slate-200 text-center font-mono">0{seq}</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 text-right italic text-[11px]">-------</td>
                          <td className="p-2.5 text-right italic text-[11px]">-------</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Quality Pre-Check Statement */}
                <div className="bg-slate-50 border border-slate-300 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-emerald-100 border border-emerald-500 flex items-center justify-center text-emerald-800 shrink-0 font-bold text-xs">
                      ✓
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 block">Material IQC Clearance</span>
                      <span className="text-[10px] text-slate-600">Approved raw material batch</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-emerald-100 border border-emerald-500 flex items-center justify-center text-emerald-800 shrink-0 font-bold text-xs">
                      ✓
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 block">Quantity Verification</span>
                      <span className="text-[10px] text-slate-600">Physical count matches requisition</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-emerald-100 border border-emerald-500 flex items-center justify-center text-emerald-800 shrink-0 font-bold text-xs">
                      ✓
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 block">FIFO Rule Sequence</span>
                      <span className="text-[10px] text-slate-600">First-In First-Out lot compliance</span>
                    </div>
                  </div>
                </div>

                {/* Signature Authorization Block */}
                <div className="pt-6 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-xs text-center">
                  <div>
                    <div className="h-12 border-b-2 border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-900">{targetIssuance.receivedBy}</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 uppercase mt-1 block">Requested / Received By (Dept Supervisor)</span>
                    <span className="text-[9px] text-slate-500 font-mono">Date: {targetIssuance.date}</span>
                  </div>

                  <div>
                    <div className="h-12 border-b-2 border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-900">{targetIssuance.issuedBy}</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 uppercase mt-1 block">Issued By (Warehouse Logistics)</span>
                    <span className="text-[9px] text-slate-500 font-mono">Date: {targetIssuance.date}</span>
                  </div>

                  <div>
                    <div className="h-12 border-b-2 border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-900">Operations / Planning Manager</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 uppercase mt-1 block">Verified & Approved By</span>
                    <span className="text-[9px] text-slate-500 font-mono">Date: _______________</span>
                  </div>
                </div>

                <div className="text-[9px] text-slate-500 text-center border-t border-slate-200 pt-3 font-medium">
                  JUWEI PLASTIC MOLDING INC. • Controlled Material Document • White Copy: Warehouse | Yellow Copy: Production Dept | Pink Copy: Planning
                </div>
              </div>
            )}


            {/* ========================================================================= */}
            {/* VIEW MODE 2: WAREHOUSE PICKING LIST CHECKLIST */}
            {/* ========================================================================= */}
            {viewMode === 'PICKING_LIST' && (
              <div className="space-y-6">
                <div className="border-b-2 border-slate-900 pb-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold text-slate-700">
                      JUWEI PLASTIC MOLDING INC.
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Subic Bay Freeport Zone • Warehouse & Material Control Division
                    </div>
                  </div>

                  <div className="text-right space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-300">
                    <div className="text-xs font-black uppercase text-indigo-950 tracking-wider">
                      {isDeliveryMode ? 'OFFICIAL DELIVERY PICKING LIST (DPL)' : 'MATERIAL ISSUANCE PICKING SLIP'}
                    </div>
                    <div className="font-mono text-sm font-black text-slate-900">
                      {docNumber}
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium">
                      Document Ref: <span className="font-mono font-bold">JW-WHS-FM-082</span>
                    </div>

                    <div className="pt-1 flex flex-col items-end">
                      <div className="flex gap-[2px] h-6 items-center px-1 bg-white border border-slate-300 rounded">
                        {[1,3,1,2,4,1,2,3,1,1,3,2,1,4,1,2,3,1,2,3,1,4,1].map((w, idx) => (
                          <div key={idx} className="bg-slate-950 h-full" style={{ width: `${w}px` }} />
                        ))}
                      </div>
                      <span className="text-[9px] font-mono text-slate-600 font-bold tracking-widest mt-0.5">
                        *{docNumber}*
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-300 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Date Generated</span>
                    <span className="font-mono font-bold text-slate-800">{dateStr}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">
                      {isDeliveryMode ? 'Client PO Number' : 'Requisitioning Dept'}
                    </span>
                    <span className="font-mono font-bold text-slate-800">
                      {isDeliveryMode ? (targetDelivery?.poNumber || 'N/A') : (targetIssuance?.department || 'N/A')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">
                      {isDeliveryMode ? 'Gate Pass Ref' : 'Requester Name'}
                    </span>
                    <span className="font-mono font-bold text-slate-800">
                      {isDeliveryMode ? (targetDelivery?.gatePassNumber || 'N/A') : (targetIssuance?.receivedBy || 'N/A')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Prepared By</span>
                    <span className="font-bold text-slate-800">{preparedBy}</span>
                  </div>
                </div>

                <div className="border border-indigo-200 bg-indigo-50/50 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                    <span className="text-xs font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                      <Package className="h-4 w-4 text-indigo-600" />
                      Target Item Specification & Required Pick Quantity
                    </span>
                    <span className="text-xs font-mono font-bold bg-indigo-100 text-indigo-900 px-2.5 py-0.5 rounded-full border border-indigo-200">
                      Target: {reqQty.toLocaleString()} {uom}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-500 block">Part / Item Code</span>
                      <span className="font-mono font-bold text-slate-900 text-sm">{partCode}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-slate-500 block">Model / Description</span>
                      <span className="font-semibold text-slate-800 truncate block">{description}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-slate-500 block">Standard Rack / Bin Location</span>
                      <span className="font-mono font-bold text-indigo-900 bg-white px-2 py-0.5 rounded border border-indigo-200 inline-block">
                        {binLocation}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex justify-between items-center">
                    <span>Warehouse Location & FIFO Batch Pick Checklist</span>
                    <span className="text-[10px] text-slate-500 font-medium">Verify Lot Number & Quantities before dispatch</span>
                  </div>

                  <table className="w-full text-left border-collapse text-xs border border-slate-300">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300">
                        <th className="p-2.5 border-r border-slate-300 text-center w-12">Seq</th>
                        <th className="p-2.5 border-r border-slate-300">Part Code</th>
                        <th className="p-2.5 border-r border-slate-300">Item Description</th>
                        <th className="p-2.5 border-r border-slate-300">Storage Zone & Rack Bin</th>
                        <th className="p-2.5 border-r border-slate-300 font-mono">Lot / Batch #</th>
                        <th className="p-2.5 border-r border-slate-300 text-right">Target Qty</th>
                        <th className="p-2.5 border-r border-slate-300 text-center w-28">Actual Picked</th>
                        <th className="p-2.5 text-center w-16">Verify</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-medium">
                      <tr>
                        <td className="p-2.5 border-r border-slate-200 text-center font-mono font-bold text-slate-600">01</td>
                        <td className="p-2.5 border-r border-slate-200 font-mono font-bold text-slate-900">{partCode}</td>
                        <td className="p-2.5 border-r border-slate-200 text-slate-800">{description}</td>
                        <td className="p-2.5 border-r border-slate-200 font-mono font-bold text-indigo-900 bg-slate-50/80">{binLocation}</td>
                        <td className="p-2.5 border-r border-slate-200 font-mono font-bold text-slate-800">{lotNumber}</td>
                        <td className="p-2.5 border-r border-slate-200 text-right font-mono font-bold text-slate-900">{reqQty.toLocaleString()} {uom}</td>
                        <td className="p-2.5 border-r border-slate-200 text-center">
                          <span className="font-mono font-bold text-slate-800">{issuedQty > 0 ? `${issuedQty.toLocaleString()} ${uom}` : '____________'}</span>
                        </td>
                        <td className="p-2.5 text-center">
                          <div className="w-4 h-4 border-2 border-slate-400 rounded mx-auto flex items-center justify-center">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          </div>
                        </td>
                      </tr>
                      {[2, 3].map((seq) => (
                        <tr key={seq} className="text-slate-400">
                          <td className="p-2.5 border-r border-slate-200 text-center font-mono">0{seq}</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 italic text-[11px]">-------------------</td>
                          <td className="p-2.5 border-r border-slate-200 text-right italic text-[11px]">-------</td>
                          <td className="p-2.5 border-r border-slate-200 text-center">____________</td>
                          <td className="p-2.5 text-center">
                            <div className="w-4 h-4 border border-slate-300 rounded mx-auto" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="bg-slate-50 border border-slate-300 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-emerald-100 border border-emerald-400 flex items-center justify-center text-emerald-700 shrink-0 font-bold">
                      ✓
                    </div>
                    <div>
                      <span className="font-bold text-slate-800 block">FIFO Rule Verified</span>
                      <span className="text-[10px] text-slate-500">First-In-First-Out batch sequence followed</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-emerald-100 border border-emerald-400 flex items-center justify-center text-emerald-700 shrink-0 font-bold">
                      ✓
                    </div>
                    <div>
                      <span className="font-bold text-slate-800 block">Packaging Inspection</span>
                      <span className="text-[10px] text-slate-500">Carton/pallet integrity intact & clean</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-emerald-100 border border-emerald-400 flex items-center justify-center text-emerald-700 shrink-0 font-bold">
                      ✓
                    </div>
                    <div>
                      <span className="font-bold text-slate-800 block">Forklift Pre-Check</span>
                      <span className="text-[10px] text-slate-500">Safety inspection signed by operator</span>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-300 grid grid-cols-3 gap-6 text-xs text-center">
                  <div>
                    <div className="h-10 border-b border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-800">{preparedBy}</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase mt-1 block">Picked By / Forklift Operator</span>
                    <span className="text-[9px] text-slate-400">Date & Time: _______________</span>
                  </div>

                  <div>
                    <div className="h-10 border-b border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-800">Warehouse Supervisor</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase mt-1 block">Verified & Approved By</span>
                    <span className="text-[9px] text-slate-400">Date & Time: _______________</span>
                  </div>

                  <div>
                    <div className="h-10 border-b border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-800">{receivedBy}</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase mt-1 block">Received / Gate Inspector</span>
                    <span className="text-[9px] text-slate-400">Date & Time: _______________</span>
                  </div>
                </div>

                <div className="text-[9px] text-slate-400 text-center border-t border-slate-100 pt-3">
                  JUWEI PLASTIC MOLDING INC. • ISO 9001 / ISO 14001 Certified System • Controlled Picking Document
                </div>
              </div>
            )}


            {/* ========================================================================= */}
            {/* VIEW MODE 3: SUMMARY LOG BATCH REPORT TABLE (DELIVERY OR ISSUANCE) */}
            {/* ========================================================================= */}
            {viewMode === 'SUMMARY_LOG' && (
              <div className="space-y-6">
                <div className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <div className="text-xs font-black tracking-wider text-slate-900 uppercase">
                      JUWEI PLASTIC MOLDING INC.
                    </div>
                    <div className="text-[11px] font-bold text-indigo-950 uppercase mt-0.5">
                      {isDeliveryMode ? 'DELIVERY RECORDS & GATE PASS SHIPPING SUMMARY LOG' : 'MATERIAL ISSUANCE & REQUISITION SUMMARY LOG REPORT'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Subic Bay Freeport Zone • Official Warehouse Audit Log Sheet
                    </div>
                  </div>

                  <div className="text-right bg-slate-50 p-2.5 rounded-lg border border-slate-300 text-xs">
                    <div className="font-mono font-bold text-slate-900">
                      REPORT DATE: {new Date().toISOString().split('T')[0]}
                    </div>
                    <div className="text-[10px] text-slate-600 font-medium">
                      TOTAL RECORDS: <span className="font-mono font-bold text-indigo-950">{isDeliveryMode ? deliveriesList.length : issuancesList.length}</span>
                    </div>
                  </div>
                </div>

                {/* Delivery Summary Table */}
                {isDeliveryMode && (
                  <div>
                    <table className="w-full text-left border-collapse text-[11px] border border-slate-300">
                      <thead>
                        <tr className="bg-slate-100 text-slate-900 font-bold border-b border-slate-300 uppercase">
                          <th className="p-2 border-r border-slate-300">Gate Pass #</th>
                          <th className="p-2 border-r border-slate-300 font-mono">Date</th>
                          <th className="p-2 border-r border-slate-300 font-mono">Picking List</th>
                          <th className="p-2 border-r border-slate-300">Cust PO #</th>
                          <th className="p-2 border-r border-slate-300">Part Code & Model</th>
                          <th className="p-2 border-r border-slate-300 text-right">Qty</th>
                          <th className="p-2 border-r border-slate-300">DR / SI #</th>
                          <th className="p-2 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-medium">
                        {deliveriesList.map((d) => (
                          <tr key={d.id} className="hover:bg-slate-50">
                            <td className="p-2 border-r border-slate-200 font-mono font-bold text-slate-900">{d.gatePassNumber}</td>
                            <td className="p-2 border-r border-slate-200 font-mono text-slate-700">{d.date}</td>
                            <td className="p-2 border-r border-slate-200 font-mono text-indigo-900 font-bold">{d.pickingListNumber}</td>
                            <td className="p-2 border-r border-slate-200 font-mono text-slate-700">{d.poNumber}</td>
                            <td className="p-2 border-r border-slate-200">
                              <div className="font-mono font-bold text-slate-900">{d.partCode}</div>
                              <div className="text-[10px] text-slate-600 truncate max-w-[180px]">{d.modelName}</div>
                            </td>
                            <td className="p-2 border-r border-slate-200 text-right font-mono font-bold text-slate-950">
                              {d.quantity.toLocaleString()}
                            </td>
                            <td className="p-2 border-r border-slate-200 font-mono text-[10px]">
                              <div>DR: {d.drNumber || 'N/A'}</div>
                              <div className="text-slate-500">SI: {d.salesInvoice || 'N/A'}</div>
                            </td>
                            <td className="p-2 text-center">
                              <span className="font-bold text-[9px] px-1.5 py-0.5 rounded border bg-slate-100 text-slate-800 border-slate-300 uppercase">
                                {d.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Issuance Summary Table */}
                {isIssuanceMode && (
                  <div>
                    <table className="w-full text-left border-collapse text-[11px] border border-slate-300">
                      <thead>
                        <tr className="bg-slate-100 text-slate-900 font-bold border-b border-slate-300 uppercase">
                          <th className="p-2 border-r border-slate-300 font-mono">Ref ID</th>
                          <th className="p-2 border-r border-slate-300 font-mono">Date</th>
                          <th className="p-2 border-r border-slate-300 font-mono">Requisition #</th>
                          <th className="p-2 border-r border-slate-300">Department</th>
                          <th className="p-2 border-r border-slate-300">Material Details</th>
                          <th className="p-2 border-r border-slate-300 font-mono">Lot #</th>
                          <th className="p-2 border-r border-slate-300 text-right">Qty Issued</th>
                          <th className="p-2 border-r border-slate-300 text-center">FIFO</th>
                          <th className="p-2 text-left">Signatories</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-medium">
                        {issuancesList.map((iss) => (
                          <tr key={iss.id} className="hover:bg-slate-50">
                            <td className="p-2 border-r border-slate-200 font-mono text-slate-600">{iss.id}</td>
                            <td className="p-2 border-r border-slate-200 font-mono text-slate-700">{iss.date}</td>
                            <td className="p-2 border-r border-slate-200 font-mono font-bold text-indigo-900">{iss.requisitionNumber}</td>
                            <td className="p-2 border-r border-slate-200 font-semibold text-slate-800">{iss.department}</td>
                            <td className="p-2 border-r border-slate-200">
                              <div className="font-mono font-bold text-slate-900">{iss.partCode}</div>
                              <div className="text-[10px] text-slate-600 truncate max-w-[180px]">{iss.description}</div>
                            </td>
                            <td className="p-2 border-r border-slate-200 font-mono text-slate-800">{iss.lotNumber}</td>
                            <td className="p-2 border-r border-slate-200 text-right font-mono font-bold text-slate-950">
                              {iss.quantityIssued.toLocaleString()}
                            </td>
                            <td className="p-2 border-r border-slate-200 text-center font-bold text-[10px]">
                              {iss.fifoVerified ? (
                                <span className="text-emerald-700">✓ PASSED</span>
                              ) : (
                                <span className="text-amber-700">⚠️ OVERRIDE</span>
                              )}
                            </td>
                            <td className="p-2 text-[10px] text-slate-700">
                              <div>Iss: {iss.issuedBy}</div>
                              <div className="text-slate-500">Rec: {iss.receivedBy}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Audit Authorization Signatures */}
                <div className="pt-6 border-t-2 border-slate-900 grid grid-cols-2 gap-8 text-xs text-center">
                  <div>
                    <div className="h-10 border-b border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-900">Warehouse Materials Custodian</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 uppercase mt-1 block">Prepared & Audited By</span>
                  </div>

                  <div>
                    <div className="h-10 border-b border-slate-400 flex items-end justify-center pb-1">
                      <span className="font-bold text-slate-900">Warehouse Operations Manager</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 uppercase mt-1 block">Approved & Verified By</span>
                  </div>
                </div>

                <div className="text-[9px] text-slate-500 text-center border-t border-slate-200 pt-3">
                  JUWEI PLASTIC MOLDING INC. • WMS Official Audit Log Report • Generated for Paper Documentation & Archiving
                </div>
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
