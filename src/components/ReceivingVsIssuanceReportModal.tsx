import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Printer, 
  Download, 
  FileText, 
  Calendar, 
  Filter, 
  TrendingUp, 
  TrendingDown, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Package, 
  ShieldCheck, 
  CheckCircle2, 
  Layers, 
  Building,
  RefreshCw,
  Search,
  Users
} from 'lucide-react';
import { ReceivingRecord, IssuanceRecord, MaterialStockItem, MasterRegistryItem } from '../types';
import { 
  filterReceivingAndIssuanceData, 
  downloadReceivingVsIssuancePDF, 
  ReportFilterOptions 
} from '../utils/reportGenerator';

interface ReceivingVsIssuanceReportModalProps {
  receiving: ReceivingRecord[];
  issuances: IssuanceRecord[];
  stocks: MaterialStockItem[];
  registries?: MasterRegistryItem[];
  currentUser?: string;
  isSuperAdmin?: boolean;
  onClose: () => void;
}

export default function ReceivingVsIssuanceReportModal({
  receiving,
  issuances,
  stocks,
  registries = [],
  currentUser = 'Aldrin Banawa',
  isSuperAdmin = true,
  onClose
}: ReceivingVsIssuanceReportModalProps) {
  const [dateRange, setDateRange] = useState<'today' | '7days' | '30days' | 'all' | 'custom'>('7days');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [partFilter, setPartFilter] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // Extract unique customers
  const customers = useMemo(() => {
    const custSet = new Set<string>();
    stocks.forEach(s => { if (s.customer) custSet.add(s.customer); });
    receiving.forEach(r => { if (r.customer) custSet.add(r.customer); });
    return Array.from(custSet).sort();
  }, [stocks, receiving]);

  const filterOptions: ReportFilterOptions = useMemo(() => ({
    dateRange,
    startDate,
    endDate,
    customerFilter: customerFilter || undefined,
    partFilter: partFilter || undefined,
    generatedBy: currentUser,
    userRole: isSuperAdmin ? 'Super Administrator' : 'Warehouse Manager',
    employeeId: 'JPMP-002'
  }), [dateRange, startDate, endDate, customerFilter, partFilter, currentUser, isSuperAdmin]);

  const summary = useMemo(() => {
    return filterReceivingAndIssuanceData(receiving, issuances, stocks, filterOptions);
  }, [receiving, issuances, stocks, filterOptions]);

  const handleExportPDF = () => {
    try {
      setIsExporting(true);
      downloadReceivingVsIssuancePDF(receiving, issuances, stocks, filterOptions);
    } catch (err) {
      console.error('Error generating PDF:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const isNetPositive = summary.netDelta >= 0;
  const totalVolume = summary.totalReceivedQty + summary.totalIssuedQty;
  const receivedPct = totalVolume > 0 ? Math.round((summary.totalReceivedQty / totalVolume) * 100) : 50;
  const issuedPct = totalVolume > 0 ? Math.round((summary.totalIssuedQty / totalVolume) * 100) : 50;

  const modalContent = (
    <motion.div
      key="receiving-vs-issuance-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 print:p-0 print:bg-white print:static"
    >
      <motion.div
        key="receiving-vs-issuance-content"
        initial={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="frosted-glass-modal-light w-full max-w-5xl rounded-3xl shadow-2xl border border-white/80 flex flex-col max-h-[calc(100vh-2rem)] my-auto print:max-h-none print:border-none print:shadow-none print:rounded-none print:my-0 overflow-hidden backdrop-blur-3xl"
      >
        
        {/* Modal Header & Navigation (Hidden in Print) */}
        <div className="bg-slate-950/90 backdrop-blur-md text-white px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 rounded-2xl text-indigo-300 border border-indigo-400/30 shadow-md backdrop-blur-md">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-indigo-500/30 text-indigo-300 text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border border-indigo-500/40">
                  ISO 9001:2015 WMS REPORT
                </span>
                <span className="text-emerald-400 text-[10px] font-bold font-mono flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" /> AUDIT READY
                </span>
              </div>
              <h2 className="text-base font-bold text-white tracking-tight mt-0.5">
                Receiving vs Issuance Summary Snapshot
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={handleExportPDF}
              disabled={isExporting}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition shadow-sm flex items-center gap-1.5 cursor-pointer"
              title="Download formatted vector PDF file"
            >
              <Download className="h-3.5 w-3.5" />
              {isExporting ? 'Generating PDF...' : 'Export PDF Document'}
            </button>
            <button
              onClick={handlePrint}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3.5 py-2 rounded-xl transition border border-slate-700 flex items-center gap-1.5 cursor-pointer"
              title="Print formatted document"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
              title="Close report modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Filter Controls Bar (Hidden in Print) */}
        <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 shrink-0 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Date Range Selector */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mr-1">
                <Calendar className="h-3.5 w-3.5 text-slate-400" /> Range:
              </span>
              {(['today', '7days', '30days', 'all', 'custom'] as const).map(range => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={`px-2.5 py-1 rounded-lg font-bold capitalize transition cursor-pointer ${
                    dateRange === range
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {range === '7days' ? 'Past 7 Days' : range === '30days' ? 'Past 30 Days' : range === 'all' ? 'All Time' : range}
                </button>
              ))}
            </div>

            {/* Custom Date Pickers */}
            {dateRange === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-700 font-mono focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-slate-400 font-bold">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-700 font-mono focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            )}

            {/* Filter by Customer & Part Code */}
            <div className="flex items-center gap-2 flex-1 sm:justify-end min-w-[240px]">
              {customers.length > 0 && (
                <select
                  value={customerFilter}
                  onChange={e => setCustomerFilter(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">All Customers</option>
                  {customers.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}

              <div className="relative flex-1 max-w-[200px]">
                <Search className="absolute left-2.5 top-1.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter SKU or item..."
                  value={partFilter}
                  onChange={e => setPartFilter(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-700 focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-400"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Printable Document Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 print:p-0 print:space-y-4 print:overflow-visible bg-slate-100/60 print:bg-white printable-area" id="printable-summary-content">
          
          {/* Official Letterhead & Document Header (Visible in UI and Print) */}
          <div className="bg-white border border-slate-200 print:border-none rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b border-slate-200 gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-slate-900 tracking-tight text-lg sm:text-xl">
                    JUWEI PLASTIC MOULDING PHILIPPINES INC.
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Warehouse Material Management & Flow Audit • ISO 9001:2015 Compliant
                </p>
                <p className="text-[11px] text-indigo-700 font-mono font-bold mt-1">
                  DOC REF: JPM-WMS-REP-008 (RECEIVING VS ISSUANCE AUDIT SNAPSHOT)
                </p>
              </div>

              <div className="text-left sm:text-right font-mono text-xs text-slate-500 space-y-0.5 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 w-full sm:w-auto">
                <p className="font-bold text-slate-800 font-sans">FACILITY: CAVITE PLANT (PHILIPPINES)</p>
                <p className="text-[11px]">Audit Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                <p className="text-[11px]">Period: <span className="font-bold text-slate-700 font-sans">{filterOptions.dateRange === 'today' ? 'Today' : filterOptions.dateRange === '7days' ? 'Past 7 Days' : filterOptions.dateRange === '30days' ? 'Past 30 Days' : 'All-Time'}</span></p>
                <p className="text-[11px] text-slate-600">Generated By: <span className="font-bold">{currentUser}</span> (JPMP-002)</p>
              </div>
            </div>

            {/* Executive KPI Summary 4-Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              
              {/* Total Received */}
              <div className="p-3.5 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-1">
                <div className="flex justify-between items-center text-emerald-800">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider">Inbound Received</span>
                  <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-extrabold text-emerald-700 font-mono">
                    {summary.totalReceivedQty.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-600 font-mono">PCS</span>
                </div>
                <p className="text-[10px] text-emerald-700 font-medium">
                  Across {summary.totalReceivedTxCount} Lot Receipt(s)
                </p>
              </div>

              {/* Total Issued */}
              <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl space-y-1">
                <div className="flex justify-between items-center text-blue-800">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider">Outbound Issued</span>
                  <ArrowUpRight className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-extrabold text-blue-700 font-mono">
                    {summary.totalIssuedQty.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-bold text-blue-600 font-mono">PCS</span>
                </div>
                <p className="text-[10px] text-blue-700 font-medium">
                  Across {summary.totalIssuedTxCount} Requisition(s)
                </p>
              </div>

              {/* Net Delta */}
              <div className={`p-3.5 rounded-xl border space-y-1 ${
                isNetPositive 
                  ? 'bg-indigo-50/80 border-indigo-200 text-indigo-900' 
                  : 'bg-rose-50/80 border-rose-200 text-rose-900'
              }`}>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider">Net Movement Delta</span>
                  {isNetPositive ? (
                    <TrendingUp className="h-4 w-4 text-indigo-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-rose-600" />
                  )}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-2xl font-extrabold font-mono ${
                    isNetPositive ? 'text-indigo-700' : 'text-rose-700'
                  }`}>
                    {summary.netDelta > 0 ? `+${summary.netDelta.toLocaleString()}` : summary.netDelta.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-bold font-mono">PCS</span>
                </div>
                <p className="text-[10px] font-medium opacity-80">
                  {isNetPositive ? 'Inventory Inflow Surplus' : 'Net Outflow Consumption'}
                </p>
              </div>

              {/* Active SKUs */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <div className="flex justify-between items-center text-slate-700">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider">Active Transacted SKUs</span>
                  <Package className="h-4 w-4 text-slate-500" />
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-extrabold text-slate-800 font-mono">
                    {summary.skuBreakdown.length}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500 font-mono">SKUs</span>
                </div>
                <p className="text-[10px] text-slate-500 font-medium">
                  Monitored Part Codes
                </p>
              </div>
            </div>

            {/* Material Inflow vs Outflow Velocity Ratio Bar */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-emerald-700 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                  Inbound Velocity: {summary.totalReceivedQty.toLocaleString()} PCS ({receivedPct}%)
                </span>
                <span className="text-blue-700 flex items-center gap-1.5">
                  Outbound Velocity: {summary.totalIssuedQty.toLocaleString()} PCS ({issuedPct}%)
                  <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 flex overflow-hidden">
                <div 
                  className="bg-emerald-500 transition-all duration-300"
                  style={{ width: `${receivedPct}%` }}
                  title={`Received: ${receivedPct}%`}
                />
                <div 
                  className="bg-blue-600 transition-all duration-300"
                  style={{ width: `${issuedPct}%` }}
                  title={`Issued: ${issuedPct}%`}
                />
              </div>
            </div>
          </div>

          {/* Section 1: Top Material SKUs Inflow vs Outflow Matrix */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 print:border-slate-300">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
              <div>
                <h3 className="font-extrabold text-sm text-slate-900 tracking-tight flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-600" />
                  1. SKU Material Velocity & Flow Matrix
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Part-by-part audit comparing total stock replenishment against production requisitions
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                {summary.skuBreakdown.length} Active SKUs
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-800 text-white font-mono text-[10px] uppercase">
                    <th className="py-2 px-2.5 font-bold rounded-l">Part Code</th>
                    <th className="py-2 px-2.5 font-bold">Material Description</th>
                    <th className="py-2 px-2.5 font-bold text-right text-emerald-300">Received (In)</th>
                    <th className="py-2 px-2.5 font-bold text-right text-blue-300">Issued (Out)</th>
                    <th className="py-2 px-2.5 font-bold text-right">Net Flow</th>
                    <th className="py-2 px-2.5 font-bold text-right">Current Stock</th>
                    <th className="py-2 px-2.5 font-bold text-center rounded-r">Flow State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {summary.skuBreakdown.slice(0, 15).map((sku, idx) => {
                    const isSkuPositive = sku.netDelta >= 0;
                    return (
                      <tr key={`sku-summary-row-${sku.partCode}-${idx}`} className="hover:bg-slate-50/80 transition">
                        <td className="py-2 px-2.5 font-mono font-bold text-slate-800 whitespace-nowrap">
                          {sku.partCode}
                        </td>
                        <td className="py-2 px-2.5 text-slate-700 max-w-[200px] truncate" title={sku.description}>
                          {sku.description}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-600">
                          {sku.receivedQty.toLocaleString()}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-blue-600">
                          {sku.issuedQty.toLocaleString()}
                        </td>
                        <td className={`py-2 px-2.5 text-right font-mono font-bold ${
                          isSkuPositive ? 'text-indigo-600' : 'text-rose-600'
                        }`}>
                          {sku.netDelta > 0 ? `+${sku.netDelta.toLocaleString()}` : sku.netDelta.toLocaleString()}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono text-slate-700">
                          {sku.currentStock.toLocaleString()} {sku.unit}
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <span className={`inline-block text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                            sku.receivedQty > sku.issuedQty
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : sku.issuedQty > sku.receivedQty
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {sku.receivedQty > sku.issuedQty ? 'REPLENISHED' : sku.issuedQty > sku.receivedQty ? 'CONSUMPTION' : 'BALANCED'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {summary.skuBreakdown.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-400 italic">
                        No transactions recorded for the selected audit timeframe.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Recent Receiving Audit Transactions */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 print:border-slate-300">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
              <div>
                <h3 className="font-extrabold text-sm text-slate-900 tracking-tight flex items-center gap-2">
                  <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                  2. Inbound Material Receiving Audit Logs
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Detailed receipts including Delivery Receipt numbers, Lot numbers, and IQC approval verification
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200">
                {summary.filteredReceiving.length} Receipts
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-emerald-700 text-white font-mono text-[10px] uppercase">
                    <th className="py-2 px-2.5 font-bold rounded-l">Date</th>
                    <th className="py-2 px-2.5 font-bold">DR / PO / Slip #</th>
                    <th className="py-2 px-2.5 font-bold">Part Code</th>
                    <th className="py-2 px-2.5 font-bold">Description</th>
                    <th className="py-2 px-2.5 font-bold">Lot #</th>
                    <th className="py-2 px-2.5 font-bold text-right">Qty Received</th>
                    <th className="py-2 px-2.5 font-bold">Supplier / Source</th>
                    <th className="py-2 px-2.5 font-bold text-center rounded-r">IQC Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {summary.filteredReceiving.slice(0, 10).map((r, idx) => (
                    <tr key={`rx-log-row-${r.id || idx}`} className="hover:bg-emerald-50/30 transition">
                      <td className="py-2 px-2.5 font-mono text-slate-600 whitespace-nowrap">{r.date || r.receivedDate}</td>
                      <td className="py-2 px-2.5 font-mono font-bold text-slate-800">{r.drNumber || r.rrNumber || r.transferFormNumber || r.poNumber || 'N/A'}</td>
                      <td className="py-2 px-2.5 font-mono font-bold text-slate-800">{r.partCode}</td>
                      <td className="py-2 px-2.5 text-slate-700 truncate max-w-[180px]">{r.itemDescription}</td>
                      <td className="py-2 px-2.5 font-mono text-slate-600">{r.lotNumber || 'N/A'}</td>
                      <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-700">{r.quantity.toLocaleString()} {r.unit || 'PCS'}</td>
                      <td className="py-2 px-2.5 text-slate-600 truncate max-w-[140px]">{r.supplierOrDept || r.vendorSupplier || 'N/A'}</td>
                      <td className="py-2 px-2.5 text-center">
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                          r.iqcStatus === 'APPROVED_IQC' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          r.iqcStatus === 'PENDING_IQC' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-rose-50 text-rose-700 border-rose-200'
                        }`}>
                          {r.iqcStatus === 'APPROVED_IQC' ? 'APPROVED' : r.iqcStatus === 'PENDING_IQC' ? 'PENDING' : 'REJECTED'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {summary.filteredReceiving.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400 italic">
                        No receiving records found for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 3: Recent Outbound Issuance Audit Transactions */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 print:border-slate-300">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
              <div>
                <h3 className="font-extrabold text-sm text-slate-900 tracking-tight flex items-center gap-2">
                  <ArrowUpRight className="h-4 w-4 text-blue-600" />
                  3. Outbound Material Issuance Audit Logs
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Production requisitions, line allocations, and custodial sign-offs
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                {summary.filteredIssuances.length} Issuances
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-blue-700 text-white font-mono text-[10px] uppercase">
                    <th className="py-2 px-2.5 font-bold rounded-l">Date</th>
                    <th className="py-2 px-2.5 font-bold">Requisition #</th>
                    <th className="py-2 px-2.5 font-bold">Part Code</th>
                    <th className="py-2 px-2.5 font-bold">Description</th>
                    <th className="py-2 px-2.5 font-bold">Lot #</th>
                    <th className="py-2 px-2.5 font-bold text-right">Qty Issued</th>
                    <th className="py-2 px-2.5 font-bold">Department / Line</th>
                    <th className="py-2 px-2.5 font-bold rounded-r">Issued By / Received By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {summary.filteredIssuances.slice(0, 10).map((i, idx) => (
                    <tr key={`iss-log-row-${i.id || idx}`} className="hover:bg-blue-50/30 transition">
                      <td className="py-2 px-2.5 font-mono text-slate-600 whitespace-nowrap">{i.date}</td>
                      <td className="py-2 px-2.5 font-mono font-bold text-slate-800">{i.requisitionNumber}</td>
                      <td className="py-2 px-2.5 font-mono font-bold text-slate-800">{i.partCode}</td>
                      <td className="py-2 px-2.5 text-slate-700 truncate max-w-[180px]">{i.description}</td>
                      <td className="py-2 px-2.5 font-mono text-slate-600">{i.lotNumber || 'N/A'}</td>
                      <td className="py-2 px-2.5 text-right font-mono font-bold text-blue-700">{i.quantityIssued.toLocaleString()} PCS</td>
                      <td className="py-2 px-2.5 text-slate-700">{i.department}</td>
                      <td className="py-2 px-2.5 text-slate-600 text-[11px]">
                        <span className="font-semibold text-slate-800">{i.issuedBy || 'Warehouse Clerk'}</span> / {i.receivedBy || 'Line Operator'}
                      </td>
                    </tr>
                  ))}
                  {summary.filteredIssuances.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400 italic">
                        No issuance records found for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 4: ISO 9001:2015 Quality & Operations Sign-off Block */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 print:border-slate-300">
            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 font-mono">
              MANAGER AUTHORIZATION & AUDIT SIGN-OFF BLOCK
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
              <div className="border border-slate-200 rounded-xl p-3.5 space-y-3 bg-slate-50/50">
                <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                  1. PREPARED & AUDITED BY:
                </span>
                <div className="pt-6 border-b border-slate-300 pb-1">
                  <p className="font-bold text-xs text-slate-800">{currentUser}</p>
                  <p className="text-[10px] text-slate-500 font-mono">Employee ID: JPMP-002 • Super Administrator</p>
                </div>
                <p className="text-[9px] text-slate-400">Warehouse Inventory Control Custodian</p>
              </div>

              <div className="border border-slate-200 rounded-xl p-3.5 space-y-3 bg-slate-50/50">
                <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                  2. QUALITY / IQC VERIFICATION:
                </span>
                <div className="pt-6 border-b border-slate-300 pb-1">
                  <p className="font-bold text-xs text-slate-800">Quality Assurance Inspector</p>
                  <p className="text-[10px] text-slate-500 font-mono">IQC Section • Material Compliance</p>
                </div>
                <p className="text-[9px] text-slate-400">ISO 9001:2015 Physical Check Endorsed</p>
              </div>

              <div className="border border-slate-200 rounded-xl p-3.5 space-y-3 bg-slate-50/50">
                <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                  3. OPERATIONS MANAGER APPROVAL:
                </span>
                <div className="pt-6 border-b border-slate-300 pb-1">
                  <p className="font-bold text-xs text-slate-800">Warehouse Operations Head</p>
                  <p className="text-[10px] text-slate-500 font-mono">Juwei Plastic Moulding Corp</p>
                </div>
                <p className="text-[9px] text-slate-400">Authorized Official Release & Balance Stamp</p>
              </div>
            </div>
          </div>

        </div>

        {/* Modal Footer (Hidden in Print) */}
        <div className="bg-slate-50 border-t border-slate-200 px-5 py-3.5 flex justify-between items-center shrink-0 print:hidden">
          <p className="text-xs text-slate-500">
            Document generated securely from live system state. ISO 9001:2015 Audit compliant.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold px-4 py-2 rounded-xl transition border border-slate-300 flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Preview
            </button>
            <button
              onClick={handleExportPDF}
              disabled={isExporting}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              {isExporting ? 'Generating PDF...' : 'Download PDF (.pdf)'}
            </button>
          </div>
        </div>

      </motion.div>
    </motion.div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
}
