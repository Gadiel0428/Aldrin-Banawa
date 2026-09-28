/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Printer, 
  Download, 
  FileText, 
  FileSpreadsheet,
  Filter, 
  TrendingUp, 
  Package, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle,
  Layers, 
  Search,
  Building,
  Check,
  Eye
} from 'lucide-react';
import { PrintPreviewModal } from './PrintPreviewModal';
import { MaterialStockItem, getCustomerForPart } from '../types';
import { 
  filterInventoryData, 
  downloadInventoryReportPDF, 
  downloadInventoryReportCSV,
  InventoryReportOptions 
} from '../utils/inventoryReportGenerator';

interface InventoryReportModalProps {
  stocks: MaterialStockItem[];
  currentUser?: string;
  isSuperAdmin?: boolean;
  initialCustomerFilter?: string;
  onClose: () => void;
}

export default function InventoryReportModal({
  stocks,
  currentUser = 'Aldrin Banawa',
  isSuperAdmin = true,
  initialCustomerFilter = 'ALL',
  onClose
}: InventoryReportModalProps) {
  const [customerFilter, setCustomerFilter] = useState<string>(initialCustomerFilter);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'APPROVED' | 'LOW_STOCK' | 'QUARANTINE_HOLD'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [isExportingCSV, setIsExportingCSV] = useState(false);
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  // Editable Signatories State
  const todayStr = new Date().toISOString().split('T')[0];
  const [signatories, setSignatories] = useState({
    auditedByName: `${currentUser} (JPMP-002)`,
    auditedByTitle: 'Warehouse Inventory Custodian',
    auditedByDate: todayStr,
    auditorName: 'QA / IQC Inspector',
    auditorTitle: 'FIFO Rotation & Quarantine Validated',
    auditorDate: todayStr,
    approvedByName: 'Warehouse Operations Head',
    approvedByTitle: 'Juwei Plastic Moulding Corp Plant',
    approvedByDate: todayStr,
  });

  // Extract unique customers
  const customers = useMemo(() => {
    const custSet = new Set<string>();
    stocks.forEach(s => {
      const cust = s.customer || getCustomerForPart(s.partCode, s.description);
      if (cust) custSet.add(cust);
    });
    return Array.from(custSet).sort();
  }, [stocks]);

  const reportOptions: InventoryReportOptions = useMemo(() => ({
    customerFilter: customerFilter !== 'ALL' ? customerFilter : undefined,
    statusFilter,
    searchQuery,
    generatedBy: currentUser,
    userRole: isSuperAdmin ? 'Super Administrator' : 'Warehouse Manager',
    employeeId: 'JPMP-002',
    reportTitle: customerFilter !== 'ALL' 
      ? `JUWEI WMS INVENTORY REPORT • ${customerFilter.toUpperCase()}`
      : 'JUWEI WMS MASTER INVENTORY AUDIT REPORT',
    ...signatories
  }), [customerFilter, statusFilter, searchQuery, currentUser, isSuperAdmin, signatories]);

  const summary = useMemo(() => {
    return filterInventoryData(stocks, reportOptions);
  }, [stocks, reportOptions]);

  const handleExportPDF = () => {
    try {
      setIsExportingPDF(true);
      downloadInventoryReportPDF(stocks, reportOptions);
    } catch (err) {
      console.error('Failed to export PDF:', err);
    } finally {
      setTimeout(() => setIsExportingPDF(false), 600);
    }
  };

  const handleExportCSV = () => {
    try {
      setIsExportingCSV(true);
      downloadInventoryReportCSV(stocks, reportOptions);
      setCopiedSuccess(true);
      setTimeout(() => setCopiedSuccess(false), 2500);
    } catch (err) {
      console.error('Failed to export CSV:', err);
    } finally {
      setTimeout(() => setIsExportingCSV(false), 600);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const reportContent = (
    <div className="space-y-6">
      {/* Printable Report Header */}
            <div className="border-b-2 border-slate-900 pb-4">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                    JUWEI PLASTIC MOULDING PHILIPPINES INC.
                  </h1>
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mt-0.5">
                    Warehouse Inventory Audit & Material Status Report
                  </p>
                  <p className="text-[11px] font-mono text-indigo-700 mt-1">
                    DOC REF: JPM-WMS-INV-001 | ISO 9001:2015 AUDIT READY
                  </p>
                </div>
                <div className="text-right text-xs font-mono text-slate-600">
                  <p className="font-bold text-slate-900">PHILIPPINES PLANT</p>
                  <p>Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                  <p>Auditor: {currentUser} (JPMP-002)</p>
                </div>
              </div>

              <div className="mt-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs flex flex-wrap justify-between items-center text-slate-700 gap-2">
                <div>
                  <span className="font-bold">Customer Scope:</span> {customerFilter !== 'ALL' ? customerFilter : 'All Customers (Canon, Brother, Dyson, General)'}
                </div>
                <div>
                  <span className="font-bold">Status Scope:</span> {statusFilter === 'APPROVED' ? 'Approved Stock Only' : statusFilter === 'LOW_STOCK' ? 'Low Stock Reorder Alerts' : statusFilter === 'QUARANTINE_HOLD' ? 'Quarantine & Hold Area' : 'Complete Inventory'}
                </div>
                <div className="font-mono text-indigo-800 font-bold">
                  Total Records: {summary.items.length} lots | {summary.uniquePartCount} unique SKUs
                </div>
              </div>
            </div>

            {/* Executive KPI Summary 4-Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              {/* Approved Stock */}
              <div className="p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/50">
                <div className="flex justify-between items-center text-emerald-800 mb-1">
                  <span className="text-[10px] font-extrabold uppercase font-mono">Approved Stock</span>
                  <Package className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold text-emerald-700 font-mono">
                    {summary.approvedQty.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-600 font-mono">PCS</span>
                </div>
                <p className="text-[10px] text-emerald-700 font-medium mt-0.5">
                  Verified in active bins
                </p>
              </div>

              {/* Low Stock Alerts */}
              <div className={`p-3.5 rounded-2xl border ${
                summary.lowStockCount > 0 ? 'bg-rose-50/60 border-rose-200 text-rose-900' : 'bg-slate-50/60 border-slate-200 text-slate-800'
              }`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] font-extrabold uppercase font-mono">Reorder Min Alerts</span>
                  <AlertTriangle className={`h-4 w-4 ${summary.lowStockCount > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-2xl font-extrabold font-mono ${summary.lowStockCount > 0 ? 'text-rose-700' : 'text-slate-800'}`}>
                    {summary.lowStockCount}
                  </span>
                  <span className="text-[10px] font-bold font-mono">SKUs</span>
                </div>
                <p className="text-[10px] font-medium mt-0.5 opacity-80">
                  {summary.lowStockCount > 0 ? 'Below minimum reorder limit' : 'All thresholds normal'}
                </p>
              </div>

              {/* Quarantine & Hold */}
              <div className="p-3.5 rounded-2xl border border-amber-200 bg-amber-50/50">
                <div className="flex justify-between items-center text-amber-800 mb-1">
                  <span className="text-[10px] font-extrabold uppercase font-mono">Quarantine & Hold</span>
                  <ShieldCheck className="h-4 w-4 text-amber-600" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold text-amber-700 font-mono">
                    {(summary.quarantineQty + summary.holdQty).toLocaleString()}
                  </span>
                  <span className="text-[10px] font-bold text-amber-600 font-mono">PCS</span>
                </div>
                <p className="text-[10px] text-amber-700 font-medium mt-0.5">
                  Restricted in isolation
                </p>
              </div>

              {/* Total Gross Volume */}
              <div className="p-3.5 rounded-2xl border border-indigo-200 bg-indigo-50/50">
                <div className="flex justify-between items-center text-indigo-800 mb-1">
                  <span className="text-[10px] font-extrabold uppercase font-mono">Total Warehouse Stock</span>
                  <Layers className="h-4 w-4 text-indigo-600" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold text-indigo-700 font-mono">
                    {summary.totalQty.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-bold text-indigo-600 font-mono">PCS</span>
                </div>
                <p className="text-[10px] text-indigo-700 font-medium mt-0.5">
                  Across all warehouse zones
                </p>
              </div>
            </div>

            {/* Customer Allocation Breakdown Tags */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-extrabold text-slate-700 uppercase font-mono flex items-center gap-1.5">
                  <Building className="h-3.5 w-3.5 text-indigo-600" /> Customer Allocation Breakdown:
                </span>
                <span className="text-[10px] font-mono text-slate-400">Approved & Active Stock</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {Object.entries(summary.customerBreakdown).map(([cust, val]) => (
                  <div key={cust} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-[11px] font-bold text-slate-800 block truncate">{cust}</span>
                    <div className="flex justify-between items-baseline mt-1 font-mono">
                      <span className="text-xs font-extrabold text-indigo-700">{val.qty.toLocaleString()} PCS</span>
                      <span className="text-[10px] text-slate-500">{val.count} lots</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Itemized Inventory Table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white font-bold text-[10px] uppercase font-mono tracking-wider">
                      <th className="p-2.5">Part Code</th>
                      <th className="p-2.5">Item Description</th>
                      <th className="p-2.5">Customer</th>
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5">Location</th>
                      <th className="p-2.5">Lot No.</th>
                      <th className="p-2.5 text-right">Qty</th>
                      <th className="p-2.5">FIFO Color</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Reorder Min</th>
                      <th className="p-2.5">Shelf Life / Expiry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {summary.items.map((item, idx) => (
                      <tr 
                        key={item.id ? `modal-inv-item-${item.id}` : `modal-inv-${idx}`}
                        className={`hover:bg-slate-50/80 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                      >
                        <td className="p-2.5 font-mono font-bold text-slate-900 whitespace-nowrap">
                          {item.partCode}
                        </td>
                        <td className="p-2.5 font-medium text-slate-800 max-w-[200px] truncate" title={item.description}>
                          {item.description}
                        </td>
                        <td className="p-2.5 font-bold text-slate-700 whitespace-nowrap">
                          {item.resolvedCustomer}
                        </td>
                        <td className="p-2.5">
                          <span className="text-[9px] bg-slate-100 text-slate-700 font-bold px-1.5 py-0.5 rounded uppercase font-mono">
                            {item.type}
                          </span>
                        </td>
                        <td className="p-2.5 font-mono text-slate-600 whitespace-nowrap">
                          {item.location}
                        </td>
                        <td className="p-2.5 font-mono text-slate-700 whitespace-nowrap">
                          {item.lotNumber}
                        </td>
                        <td className="p-2.5 font-mono font-bold text-slate-900 text-right whitespace-nowrap">
                          {Number(item.quantity).toLocaleString()} <span className="text-[10px] text-slate-500 font-normal">{item.unit}</span>
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span className="text-[10px] font-semibold text-slate-700">
                            {item.fifoColor || 'N/A'}
                          </span>
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded-full border ${
                            item.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            item.status === 'QUARANTINE' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          {item.reorderMinThreshold > 0 ? (
                            <span className={`font-mono text-[10px] font-bold ${item.isLowStock ? 'text-rose-700' : 'text-slate-600'}`}>
                              {item.isLowStock ? `⚠️ LOW (${item.currentTotalPartQty}/${item.reorderMinThreshold})` : `${item.reorderMinThreshold} ${item.unit}`}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[10px]">--</span>
                          )}
                        </td>
                        <td className="p-2.5 whitespace-nowrap font-mono text-[10px] text-slate-600">
                          {item.expirationDate ? (
                            <span className={item.shelfLifeStatus.includes('Expired') ? 'text-rose-700 font-bold' : item.shelfLifeStatus.includes('FEFO') ? 'text-amber-700 font-bold' : 'text-slate-700'}>
                              {item.expirationDate} ({item.shelfLifeStatus})
                            </span>
                          ) : (
                            <span className="text-slate-400">No Expiry</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {summary.items.length === 0 && (
                      <tr>
                        <td colSpan={11} className="p-8 text-center text-slate-400 text-sm italic">
                          No matching inventory items found for the selected filter criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Official Manager Sign-off & Audit Stamp */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4.5 space-y-3 print:bg-white print:border-slate-300">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-200 pb-2">
                <span className="text-[10px] font-bold text-slate-700 uppercase font-mono tracking-wider">
                  OFFICIAL INVENTORY AUDIT SIGN-OFF & MANAGER ENDORSEMENT
                </span>
                <span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-0.5 no-print">
                  ✍️ Editable Signatories (Review before printing/exporting)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                {/* Signatory 1 */}
                <div className="space-y-1.5 border border-slate-200 rounded-xl p-3 bg-white/70 print:bg-transparent print:border-slate-300">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono block">Prepared & Audited By:</span>
                  <div className="border-b border-slate-300 pb-1.5 space-y-1">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-400 no-print block">Signatory Name</label>
                      <input
                        type="text"
                        value={signatories.auditedByName}
                        onChange={e => setSignatories(prev => ({ ...prev, auditedByName: e.target.value }))}
                        placeholder="Auditor Name"
                        className="w-full font-bold text-xs text-slate-800 bg-white border border-slate-300 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 print:border-none print:p-0 print:bg-transparent print:text-black"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-400 no-print block">Title / Department</label>
                      <input
                        type="text"
                        value={signatories.auditedByTitle}
                        onChange={e => setSignatories(prev => ({ ...prev, auditedByTitle: e.target.value }))}
                        placeholder="Role / Title"
                        className="w-full text-[10px] font-mono text-slate-600 bg-white border border-slate-300 rounded px-2 py-0.5 focus:ring-1 focus:ring-indigo-500 print:border-none print:p-0 print:bg-transparent print:text-slate-700"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-400 no-print block">Audit Date</label>
                      <input
                        type="date"
                        value={signatories.auditedByDate}
                        onChange={e => setSignatories(prev => ({ ...prev, auditedByDate: e.target.value }))}
                        className="w-full text-[10px] font-mono text-slate-700 bg-white border border-slate-300 rounded px-2 py-0.5 focus:ring-1 focus:ring-indigo-500 print:border-none print:p-0 print:bg-transparent print:text-black"
                      />
                    </div>
                  </div>
                </div>

                {/* Signatory 2 */}
                <div className="space-y-1.5 border border-slate-200 rounded-xl p-3 bg-white/70 print:bg-transparent print:border-slate-300">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono block">Quality Assurance & IQC:</span>
                  <div className="border-b border-slate-300 pb-1.5 space-y-1">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-400 no-print block">Inspector Name</label>
                      <input
                        type="text"
                        value={signatories.auditorName}
                        onChange={e => setSignatories(prev => ({ ...prev, auditorName: e.target.value }))}
                        placeholder="Inspector Name"
                        className="w-full font-bold text-xs text-slate-800 bg-white border border-slate-300 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 print:border-none print:p-0 print:bg-transparent print:text-black"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-400 no-print block">Validation Endorsement</label>
                      <input
                        type="text"
                        value={signatories.auditorTitle}
                        onChange={e => setSignatories(prev => ({ ...prev, auditorTitle: e.target.value }))}
                        placeholder="Endorsement / Section"
                        className="w-full text-[10px] font-mono text-slate-600 bg-white border border-slate-300 rounded px-2 py-0.5 focus:ring-1 focus:ring-indigo-500 print:border-none print:p-0 print:bg-transparent print:text-slate-700"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-400 no-print block">Validation Date</label>
                      <input
                        type="date"
                        value={signatories.auditorDate}
                        onChange={e => setSignatories(prev => ({ ...prev, auditorDate: e.target.value }))}
                        className="w-full text-[10px] font-mono text-slate-700 bg-white border border-slate-300 rounded px-2 py-0.5 focus:ring-1 focus:ring-indigo-500 print:border-none print:p-0 print:bg-transparent print:text-black"
                      />
                    </div>
                  </div>
                </div>

                {/* Signatory 3 */}
                <div className="space-y-1.5 border border-slate-200 rounded-xl p-3 bg-white/70 print:bg-transparent print:border-slate-300">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono block">Approved By Operations:</span>
                  <div className="border-b border-slate-300 pb-1.5 space-y-1">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-400 no-print block">Approver Name</label>
                      <input
                        type="text"
                        value={signatories.approvedByName}
                        onChange={e => setSignatories(prev => ({ ...prev, approvedByName: e.target.value }))}
                        placeholder="Approver Name"
                        className="w-full font-bold text-xs text-slate-800 bg-white border border-slate-300 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 print:border-none print:p-0 print:bg-transparent print:text-black"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-400 no-print block">Position / Facility</label>
                      <input
                        type="text"
                        value={signatories.approvedByTitle}
                        onChange={e => setSignatories(prev => ({ ...prev, approvedByTitle: e.target.value }))}
                        placeholder="Position or Plant"
                        className="w-full text-[10px] font-mono text-slate-600 bg-white border border-slate-300 rounded px-2 py-0.5 focus:ring-1 focus:ring-indigo-500 print:border-none print:p-0 print:bg-transparent print:text-slate-700"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-400 no-print block">Approval Date</label>
                      <input
                        type="date"
                        value={signatories.approvedByDate}
                        onChange={e => setSignatories(prev => ({ ...prev, approvedByDate: e.target.value }))}
                        className="w-full text-[10px] font-mono text-slate-700 bg-white border border-slate-300 rounded px-2 py-0.5 focus:ring-1 focus:ring-indigo-500 print:border-none print:p-0 print:bg-transparent print:text-black"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
    </div>
  );

  const modalContent = (
    <AnimatePresence>
      <motion.div
        key="inventory-report-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 print:p-0 print:bg-white print:static"
      >
        <motion.div
          key="inventory-report-content"
          initial={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
          animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="frosted-glass-modal-light w-full max-w-5xl rounded-3xl shadow-2xl border border-white/80 flex flex-col max-h-[calc(100vh-2rem)] my-auto print:max-h-none print:border-none print:shadow-none print:rounded-none print:my-0 overflow-hidden print:overflow-visible backdrop-blur-3xl"
        >
          {/* Modal Header (Hidden during Print) */}
          <div className="bg-slate-950/90 backdrop-blur-md text-white px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 shrink-0 print:hidden">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-2xl text-indigo-300 border border-indigo-400/30 shadow-md backdrop-blur-md">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-bold text-white tracking-tight">
                    Inventory Audit & Material Report Generator
                  </h2>
                  <span className="bg-indigo-500/30 text-indigo-300 text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border border-indigo-500/40">
                    ISO 9001:2015 COMPLIANT
                  </span>
                  <span className="text-emerald-400 text-[10px] font-bold font-mono flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    LIVE VIEW
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">
                  Compile current warehouse stock, customer allocations, reorder alerts, and FIFO bins into formatted PDF or CSV
                </p>
              </div>
            </div>

            {/* Quick Action Buttons in Modal Header */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowPrintPreview(true)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-slate-700"
              >
                <Eye className="h-4 w-4 text-indigo-400" />
                <span>Print Preview</span>
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                disabled={isExportingCSV}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer border border-emerald-400/30"
                title="Export current view as formatted CSV Spreadsheet"
              >
                {copiedSuccess ? <Check className="h-3.5 w-3.5 text-white" /> : <Download className="h-3.5 w-3.5" />}
                <span>{isExportingCSV ? 'Exporting...' : copiedSuccess ? 'CSV Exported!' : 'Export CSV'}</span>
              </button>

              <button
                type="button"
                onClick={handleExportPDF}
                disabled={isExportingPDF}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer border border-indigo-400/30"
                title="Download formatted multi-page PDF audit report"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>{isExportingPDF ? 'Generating...' : 'Export PDF'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowPrintPreview(true)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-slate-700"
                title="Preview report in A4 layout before opening system print dialog"
              >
                <Eye className="h-3.5 w-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Print Preview</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-slate-700"
                title="Print this report directly"
              >
                <Printer className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Print</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer ml-1"
                title="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Filter Toolbar (Hidden during Print) */}
          <div className="bg-slate-50/90 border-b border-slate-200/80 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Filter className="h-3.5 w-3.5 text-indigo-600" /> Filter View:
              </span>

              {/* Customer Selector */}
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase font-mono">Customer:</label>
                <select
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  className="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-800 focus:ring-1 focus:ring-indigo-500 focus:outline-none shadow-2xs"
                >
                  <option value="ALL">All Customers & Accounts</option>
                  {customers.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase font-mono">Status:</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-800 focus:ring-1 focus:ring-indigo-500 focus:outline-none shadow-2xs"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="APPROVED">Approved Only (Ready)</option>
                  <option value="LOW_STOCK">Low Stock Reorder Alerts</option>
                  <option value="QUARANTINE_HOLD">Quarantine & Hold Bins</option>
                </select>
              </div>

              {/* Search input */}
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search SKU, lot, bin..."
                  className="bg-white border border-slate-300 rounded-xl pl-8 pr-3 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:ring-1 focus:ring-indigo-500 focus:outline-none w-36 sm:w-44 shadow-2xs"
                />
              </div>
            </div>

            <div className="text-xs text-slate-500 font-mono">
              Filtered: <span className="font-bold text-indigo-700">{summary.items.length}</span> Lots (<span className="font-bold text-slate-800">{summary.uniquePartCount}</span> SKUs)
            </div>
          </div>

          {/* Scrollable Report Body */}
          <div className={`flex-1 overflow-y-auto p-6 space-y-6 ${showPrintPreview ? "" : "printable-area"} print:p-0 print:overflow-visible`} id="printable-inventory-report">
            {reportContent}
          </div>

          {/* Modal Footer Controls */}
          <div className="bg-slate-50/90 border-t border-slate-200/80 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
            <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
              <ShieldCheck className="h-4 w-4 text-indigo-600" />
              <span>Certified ISO 9001:2015 WMS Inventory Audit</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportCSV}
                disabled={isExportingCSV}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>{isExportingCSV ? 'Generating CSV...' : 'Download CSV'}</span>
              </button>

              <button
                type="button"
                onClick={handleExportPDF}
                disabled={isExportingPDF}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Download className="h-4 w-4" />
                <span>{isExportingPDF ? 'Generating PDF...' : 'Download PDF Report'}</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>

        {showPrintPreview && (
          <PrintPreviewModal
            isOpen={showPrintPreview}
            onClose={() => setShowPrintPreview(false)}
            documentTitle="Warehouse Inventory Audit & Material Status Report"
            documentNumber="DOC REF: JPM-WMS-INV-001"
            documentSubtitle="ISO 9001:2015 Comprehensive Stock Audit"
            onPrint={handlePrint}
          >
            {reportContent}
          </PrintPreviewModal>
        )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
}
