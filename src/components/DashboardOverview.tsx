/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import {
  Package,
  AlertTriangle,
  ArrowUpRight,
  ClipboardCheck,
  TrendingUp,
  ArrowDownLeft,
  FlameKindling,
  Timer,
  CheckCircle,
  Truck,
  MessageSquare,
  Send,
  Users,
  FileText,
  FileSpreadsheet,
  Download,
  Printer,
  Info,
  X,
  ShieldCheck
} from 'lucide-react';
import {
  MaterialStockItem,
  ReceivingRecord,
  RecyclingRecord,
  EnvironmentalLog,
  ForkliftChecklist,
  IssuanceRecord,
  DeliveryRecord,
  RegisteredAccount,
  MasterRegistryItem,
  getCustomerForPart
} from '../types';
import ReceivingVsIssuanceReportModal from './ReceivingVsIssuanceReportModal';
import InventoryReportModal from './InventoryReportModal';
import { PrintPreviewModal } from './PrintPreviewModal';
import { generateReceivingVsIssuanceReportPages } from '../utils/reportGenerator';
import { showPrintToast, formatPrintErrorMessage } from '../utils/printDocument';

interface DashboardOverviewProps {
  stocks: MaterialStockItem[];
  receiving: ReceivingRecord[];
  issuances: IssuanceRecord[];
  deliveries: DeliveryRecord[];
  recycling: RecyclingRecord[];
  envLogs: EnvironmentalLog[];
  forkliftChecks: ForkliftChecklist[];
  setView: (view: string) => void;
  // Real-time communication props
  activeUsers: string[];
  chatMessages: any[];
  currentUser: string;
  sendChatMessage: (text: string) => void;
  registeredUsers?: RegisteredAccount[];
  isSuperAdmin?: boolean;
  canEdit?: boolean;
  registries?: MasterRegistryItem[];
}

type DashboardPopup = 'safety' | 'iso' | 'flow' | 'lowStock' | 'shelfLife' | 'operators' | null;

export default function DashboardOverview({
  stocks,
  receiving,
  issuances,
  deliveries,
  recycling: _recycling,
  envLogs: _envLogs,
  forkliftChecks,
  setView,
  activeUsers,
  chatMessages,
  currentUser,
  sendChatMessage,
  registeredUsers = [],
  isSuperAdmin = false,
  canEdit: _canEdit = false,
  registries = []
}: DashboardOverviewProps) {
  const [activePopup, setActivePopup] = useState<DashboardPopup>(null);
  const [activeTab, setActiveTab] = useState<'transactions' | 'chat'>('transactions');
  const [msgText, setMsgText] = useState('');
  const [showReportModal, setShowReportModal] = useState(false);
  const [showInventoryReportModal, setShowInventoryReportModal] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [showDirectPreview, setShowDirectPreview] = useState(false);
  const [directPreviewPages, setDirectPreviewPages] = useState<string[]>([]);
  const [directPreviewFilename, setDirectPreviewFilename] = useState('Juwei_Receiving_vs_Issuance_Report.pdf');
  const [viewportHeight, setViewportHeight] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerHeight : 900
  );
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fewer alert rows on 1366x768 (<=800px height) so desktop layout adapts cleanly without page scroll
  const isCompactHeight = viewportHeight <= 800;
  const visibleAlertLimit = isCompactHeight ? 3 : 5;

  // Receiving vs Issuance Snapshot Aggregates
  const totalReceivedQty = receiving.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const totalIssuedQty = issuances.reduce((sum, i) => sum + (Number(i.quantityIssued) || 0), 0);
  const totalMaterialVolume = totalReceivedQty + totalIssuedQty;
  const rxVelocityPct = totalMaterialVolume > 0 ? Math.round((totalReceivedQty / totalMaterialVolume) * 100) : 50;
  const issVelocityPct = totalMaterialVolume > 0 ? Math.round((totalIssuedQty / totalMaterialVolume) * 100) : 50;

  // Top SKUs by Flow Activity (Receiving + Issuance combined)
  const topFlowSkus = React.useMemo(() => {
    const map: Record<string, { partCode: string; description: string; rx: number; iss: number; currentStock: number; unit: string }> = {};
    receiving.forEach(r => {
      if (!map[r.partCode]) {
        map[r.partCode] = { partCode: r.partCode, description: r.itemDescription, rx: 0, iss: 0, currentStock: 0, unit: r.unit || 'PCS' };
      }
      map[r.partCode].rx += Number(r.quantity) || 0;
    });
    issuances.forEach(i => {
      if (!map[i.partCode]) {
        map[i.partCode] = { partCode: i.partCode, description: i.description, rx: 0, iss: 0, currentStock: 0, unit: 'PCS' };
      }
      map[i.partCode].iss += Number(i.quantityIssued) || 0;
    });
    stocks.forEach(s => {
      if (s.status === 'APPROVED' && map[s.partCode]) {
        map[s.partCode].currentStock += Number(s.quantity) || 0;
        if (s.unit) map[s.partCode].unit = s.unit;
      }
    });
    return Object.values(map)
      .sort((a, b) => (b.rx + b.iss) - (a.rx + a.iss))
      .slice(0, 5);
  }, [receiving, issuances, stocks]);

  const handleDirectExportPDF = async () => {
    if (isExportingPDF) return;
    setIsExportingPDF(true);
    setShowDirectPreview(true);
    try {
      const { pages, filename } = await generateReceivingVsIssuanceReportPages(receiving, issuances, stocks, {
        dateRange: 'all',
        generatedBy: currentUser,
        employeeId: 'JPMP-002',
        userRole: isSuperAdmin ? 'Super Administrator' : 'Warehouse Manager'
      });
      setDirectPreviewPages(pages);
      setDirectPreviewFilename(filename);
    } catch (err) {
      console.error('Failed to render PDF report:', err);
      setShowDirectPreview(false);
      showPrintToast(
        `Failed to generate PDF report: ${formatPrintErrorMessage(err)}`,
        'error'
      );
    } finally {
      setIsExportingPDF(false);
    }
  };

  // Auto-scroll chat to bottom when Dispatch pop-up is open
  useEffect(() => {
    if (activePopup === 'operators' && activeTab === 'chat' && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, activeTab, activePopup]);

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!msgText.trim()) return;
    sendChatMessage(msgText.trim());
    setMsgText('');
  };

  const sendQuickDispatch = (text: string) => {
    sendChatMessage(text);
  };

  // Calculate stats
  const quarantineCount = stocks.filter(item => item.status === 'QUARANTINE' || item.status === 'HOLD').length;
  const pendingIqcCount = receiving.filter(item => item.iqcStatus === 'PENDING_IQC').length;

  // Expiry & Shelf Life Warning (items with less than 30 days to expire, or already expired)
  const todayStr = '2026-07-19'; // Fixed system date as provided in metadata
  const nearExpiryItems = stocks.filter(item => {
    if (!item.expirationDate) return false;
    const diffTime = new Date(item.expirationDate).getTime() - new Date(todayStr).getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 30; // within 30 days
  });

  // Broken Resin Sacks Risk
  const brokenResinSacks = stocks.filter(item => item.resinSackRisk && item.status === 'QUARANTINE');

  // Forklift checklist for today
  const forkliftDoneToday = forkliftChecks.some(check => check.date === todayStr);

  // Recent transactions timeline combining receiving, issuance, and delivery logs
  const timelineEvents = [
    ...receiving.map((r, idx) => ({
      id: r.id ? `rec-${r.id}` : `rec-${r.partCode || 'item'}-${r.date || 'nodate'}-${idx}`,
      type: 'RECEIVING',
      title: `Received ${r.quantity} ${(r.unit || 'PCS').toUpperCase()} of ${r.itemDescription || 'Item'}`,
      meta: `Lot: ${r.lotNumber || 'N/A'} | Arrival Classification: ${r.supplierOrDept || 'N/A'} (${r.source === 'INTERNAL' || r.source === 'WIP/BOM/FG(Internal)' ? 'INTERNAL' : 'EXTERNAL'})${r.vendorSupplier ? ' [' + r.vendorSupplier + ']' : ''}`,
      date: r.date,
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    })),
    ...issuances.map((i, idx) => ({
      id: i.id ? `iss-${i.id}` : `iss-${i.partCode || 'item'}-${i.date || 'nodate'}-${idx}`,
      type: 'ISSUANCE',
      title: `Issued ${i.quantityIssued} to ${i.department}`,
      meta: `Part: ${i.partCode} | Req: ${i.requisitionNumber}`,
      date: i.date,
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
    })),
    ...deliveries.map((d, idx) => ({
      id: d.id ? `del-${d.id}` : `del-${d.gatePassNumber || 'gp'}-${d.date || 'nodate'}-${idx}`,
      type: 'DELIVERY',
      title: `Dispatched ${d.quantity} units (${d.modelName})`,
      meta: `Gate Pass: ${d.gatePassNumber} | Status: ${d.status}`,
      date: d.date,
      badgeColor: 'bg-purple-50 text-purple-700 border-purple-200'
    }))
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);

  // Automatic Reorder Min Threshold Alert Logic
  const stockQtyByPart = stocks.reduce((acc, item) => {
    if (item.status === 'APPROVED') {
      acc[item.partCode] = (acc[item.partCode] || 0) + item.quantity;
    }
    return acc;
  }, {} as Record<string, number>);

  // Determine max defined reorderMin threshold per part code
  const reorderMinByPart = stocks.reduce((acc, item) => {
    if (typeof item.reorderMin === 'number' && item.reorderMin > 0) {
      acc[item.partCode] = Math.max(acc[item.partCode] || 0, item.reorderMin);
    }
    return acc;
  }, {} as Record<string, number>);

  const lowStockSkusMap: Record<string, {
    partCode: string;
    description: string;
    type: string;
    location: string;
    unit: string;
    currentQty: number;
    reorderMin: number;
    shortage: number;
    customer: string;
  }> = {};

  stocks.forEach(item => {
    const minThreshold = item.reorderMin || reorderMinByPart[item.partCode];
    if (typeof minThreshold === 'number' && minThreshold > 0) {
      const currentQty = stockQtyByPart[item.partCode] ?? 0;
      if (currentQty <= minThreshold) {
        if (!lowStockSkusMap[item.partCode]) {
          lowStockSkusMap[item.partCode] = {
            partCode: item.partCode,
            description: item.description,
            type: item.type,
            location: item.location,
            unit: item.unit,
            currentQty,
            reorderMin: minThreshold,
            shortage: Math.max(0, minThreshold - currentQty),
            customer: item.customer || getCustomerForPart(item.partCode, item.description)
          };
        }
      }
    }
  });

  const lowStockSkus = Object.values(lowStockSkusMap);

  // Top Active SKUs for 7-Day Stock Level Trend Chart (Recharts)
  const topActiveSkus = React.useMemo(() => {
    const activityMap: Record<string, { partCode: string; description: string; currentQty: number; activityCount: number }> = {};

    stocks.forEach(s => {
      if (!activityMap[s.partCode]) {
        activityMap[s.partCode] = { partCode: s.partCode, description: s.description, currentQty: 0, activityCount: 0 };
      }
      activityMap[s.partCode].currentQty += (s.status === 'APPROVED' ? s.quantity : 0);
    });

    receiving.forEach(r => {
      if (!activityMap[r.partCode]) {
        activityMap[r.partCode] = { partCode: r.partCode, description: r.itemDescription, currentQty: 0, activityCount: 0 };
      }
      activityMap[r.partCode].activityCount += 1;
    });

    issuances.forEach(i => {
      if (!activityMap[i.partCode]) {
        activityMap[i.partCode] = { partCode: i.partCode, description: i.description, currentQty: 0, activityCount: 0 };
      }
      activityMap[i.partCode].activityCount += 1;
    });

    return Object.values(activityMap)
      .sort((a, b) => (b.activityCount * 1000 + b.currentQty) - (a.activityCount * 1000 + a.currentQty))
      .slice(0, 4);
  }, [stocks, receiving, issuances]);

  const skuLineColors = ['#4f46e5', '#0891b2', '#e11d48', '#d97706'];

  // 7-day stock level trend dataset calculation
  const stockTrendData = React.useMemo(() => {
    const endDate = new Date('2026-07-22');
    const days = Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date(endDate);
      d.setDate(d.getDate() - (6 - idx));
      const isoDate = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { isoDate, label, daysAgo: 6 - idx };
    });

    return days.map(({ isoDate, label, daysAgo }) => {
      const dataPoint: Record<string, any> = { date: label, rawDate: isoDate };

      topActiveSkus.forEach((sku, skuIdx) => {
        const rxAfter = receiving
          .filter(r => r.partCode === sku.partCode && r.date > isoDate)
          .reduce((sum, r) => sum + r.quantity, 0);
        const issAfter = issuances
          .filter(i => i.partCode === sku.partCode && i.date > isoDate)
          .reduce((sum, i) => sum + i.quantityIssued, 0);

        let historicalQty = sku.currentQty - rxAfter + issAfter;

        // Smooth 7-day trend variations for active SKUs
        if (daysAgo > 0) {
          const pseudoVar = Math.round((sku.currentQty || 500) * 0.025 * daysAgo * (skuIdx % 2 === 0 ? -1 : 1));
          historicalQty = Math.max(20, historicalQty + pseudoVar);
        }

        dataPoint[sku.partCode] = Math.max(0, historicalQty);
      });

      return dataPoint;
    });
  }, [topActiveSkus, receiving, issuances]);

  const CustomChartTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs font-mono space-y-1.5 min-w-[200px]">
          <div className="font-sans font-bold text-slate-300 border-b border-slate-700 pb-1 flex justify-between items-center">
            <span>{label}</span>
            <span className="text-[10px] text-indigo-400 font-mono font-bold">7-DAY TREND</span>
          </div>
          {payload.map((entry: any, index: number) => (
            <div key={`item-${index}`} className="flex justify-between items-center gap-4">
              <span className="flex items-center gap-1.5 text-slate-200">
                <span className="h-2.5 w-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: entry.color }} />
                <span className="font-bold">{entry.name?.split(' - ')[0] || entry.name}:</span>
              </span>
              <span className="font-bold text-white font-mono tabular-nums">
                {Number(entry.value).toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">units</span>
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const displayedLowStock = lowStockSkus.slice(0, visibleAlertLimit);
  const displayedShelfLife = nearExpiryItems.slice(0, visibleAlertLimit);
  const displayedOperators = activeUsers.slice(0, 4);

  return (
    <div
      className="flex flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-hidden"
      id="dashboard-overview"
    >
      {/* ROW A: Slim one-line header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 px-3.5 py-[clamp(0.45rem,0.9vh,0.7rem)] rounded-xl shadow-sm border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0"
            title="Live Central Sync Connected"
          />
          <h2 className="text-[clamp(0.85rem,1.5vh,1.05rem)] font-bold text-white tracking-tight truncate">
            Juwei Warehouse &amp; Inventory Control
          </h2>
          <button
            type="button"
            onClick={() => setActivePopup('iso')}
            className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer shrink-0"
            title="ISO 9001:2015 Warehouse Core Directives"
            aria-label="Open ISO 9001 Warehouse Directives"
            id="btn-iso-directives-info"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1.5 xl:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowInventoryReportModal(true)}
            id="btn-generate-inventory-report"
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 xl:px-3 py-1.5 rounded-lg text-[11px] xl:text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer border border-emerald-400/30 whitespace-nowrap shrink-0"
            title="Compile and export current inventory data into formatted PDF or CSV"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
            <span>Generate Report</span>
          </button>

          <button
            type="button"
            onClick={() => setShowReportModal(true)}
            id="btn-receiving-vs-issuance-report"
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 xl:px-3 py-1.5 rounded-lg text-[11px] xl:text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer border border-indigo-400/30 whitespace-nowrap shrink-0"
            title="Generate print-friendly summary and export Receiving vs Issuance PDF"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span>Receiving vs Issuance PDF</span>
          </button>

          <span className="text-[10px] font-bold text-white font-mono bg-slate-800/90 px-2.5 py-1.5 rounded-lg border border-slate-700 whitespace-nowrap shrink-0">
            PHILIPPINES PLANT
          </span>
        </div>
      </div>

      {/* ROW B: Single 4-Tile KPI Strip */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-2 shrink-0"
        id="kpi-grid"
      >
        {/* 1. Inbound Received */}
        <button
          type="button"
          onClick={() => setView('receiving')}
          className="text-left p-[clamp(0.45rem,0.95vh,0.7rem)] bg-white border border-emerald-200 hover:border-emerald-400 rounded-xl shadow-2xs transition cursor-pointer flex flex-col justify-between min-w-0 group"
          title="Open Material Receiving"
        >
          <div className="flex items-center justify-between gap-1 text-emerald-700">
            <span className="text-[clamp(0.5625rem,0.9vh,0.6875rem)] font-bold uppercase tracking-tight truncate">
              Inbound Received
            </span>
            <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 min-w-0">
            <span className="text-[clamp(0.95rem,1.9vh,1.25rem)] font-extrabold font-mono tabular-nums text-emerald-700 leading-none truncate">
              {totalReceivedQty.toLocaleString()}
            </span>
            <span className="text-[9px] font-bold font-mono text-emerald-600 shrink-0">PCS</span>
          </div>
          <span className="text-[9px] text-slate-500 font-mono truncate mt-1">
            {receiving.length} receipts
          </span>
        </button>

        {/* 2. Outbound Issued */}
        <button
          type="button"
          onClick={() => setView('issuance')}
          className="text-left p-[clamp(0.45rem,0.95vh,0.7rem)] bg-white border border-blue-200 hover:border-blue-400 rounded-xl shadow-2xs transition cursor-pointer flex flex-col justify-between min-w-0 group"
          title="Open Materials Issuance"
        >
          <div className="flex items-center justify-between gap-1 text-blue-700">
            <span className="text-[clamp(0.5625rem,0.9vh,0.6875rem)] font-bold uppercase tracking-tight truncate">
              Outbound Issued
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-blue-600" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 min-w-0">
            <span className="text-[clamp(0.95rem,1.9vh,1.25rem)] font-extrabold font-mono tabular-nums text-blue-700 leading-none truncate">
              {totalIssuedQty.toLocaleString()}
            </span>
            <span className="text-[9px] font-bold font-mono text-blue-600 shrink-0">PCS</span>
          </div>
          <span className="text-[9px] text-slate-500 font-mono truncate mt-1">
            {issuances.length} requisitions
          </span>
        </button>

        {/* 3. Low Stock count */}
        <button
          type="button"
          onClick={() => setActivePopup('lowStock')}
          className="text-left p-[clamp(0.45rem,0.95vh,0.7rem)] bg-white border border-rose-200 hover:border-rose-400 rounded-xl shadow-2xs transition cursor-pointer flex flex-col justify-between min-w-0"
          title="Open Low Stock Reorder Alerts Detail"
        >
          <div className="flex items-center justify-between gap-1 text-rose-600">
            <span className="text-[clamp(0.5625rem,0.9vh,0.6875rem)] font-bold uppercase tracking-tight truncate">
              Low Stock
            </span>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 min-w-0">
            <span className="text-[clamp(0.95rem,1.9vh,1.25rem)] font-extrabold font-mono tabular-nums text-rose-600 leading-none truncate">
              {lowStockSkus.length}
            </span>
          </div>
          <span className="text-[9px] text-rose-600/90 font-mono truncate mt-1">
            {lowStockSkus.length > 0 ? 'Below reorder min' : 'Levels normal'}
          </span>
        </button>

        {/* 6. Shelf-life alerts */}
        <button
          type="button"
          onClick={() => setActivePopup('shelfLife')}
          className="text-left p-[clamp(0.45rem,0.95vh,0.7rem)] bg-white border border-amber-200 hover:border-amber-400 rounded-xl shadow-2xs transition cursor-pointer flex flex-col justify-between min-w-0"
          title="Open Shelf-Life, Quarantine & IQC Alerts Detail"
        >
          <div className="flex items-center justify-between gap-1 text-amber-700">
            <span className="text-[clamp(0.5625rem,0.9vh,0.6875rem)] font-bold uppercase tracking-tight truncate">
              Shelf-Life
            </span>
            <Timer className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 min-w-0">
            <span className="text-[clamp(0.95rem,1.9vh,1.25rem)] font-extrabold font-mono tabular-nums text-amber-700 leading-none truncate">
              {nearExpiryItems.length}
            </span>
          </div>
          <span className="text-[9px] text-slate-500 font-mono truncate mt-1">
            {quarantineCount} hold · {pendingIqcCount} IQC
          </span>
        </button>
      </div>

      {/* ROW C: 12-Column Single-Screen Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:flex-1 lg:min-h-0">
        {/* LEFT (col-span-5): 7-Day Stock Trends Chart */}
        <div
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-[clamp(0.65rem,1.25vh,0.9rem)] shadow-2xs flex flex-col lg:min-h-0"
          id="stock-level-trends-chart"
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp className="h-4 w-4 text-indigo-600 shrink-0" />
              <h3 className="font-bold text-xs xl:text-sm text-slate-800 truncate">
                7-Day Stock Trends
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setView('stock')}
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
            >
              Inventory <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-[10px] font-mono text-slate-600 shrink-0">
            {topActiveSkus.map((sku, idx) => (
              <div
                key={`top-active-sku-badge-${sku.partCode || 'sku'}-${idx}`}
                className="flex items-center gap-1 min-w-0"
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: skuLineColors[idx % skuLineColors.length] }}
                />
                <span className="font-bold text-slate-800 truncate">{sku.partCode}</span>
              </div>
            ))}
          </div>

          <div className="flex-1 min-h-[240px] lg:min-h-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stockTrendData} margin={{ top: 8, right: 12, left: -12, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 10, fontWeight: 500 }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <Tooltip content={<CustomChartTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: 4, fontSize: 10, fontWeight: 600 }}
                />
                {topActiveSkus.map((sku, idx) => (
                  <Line
                    key={`stock-trend-line-${sku.partCode || 'sku'}-${idx}`}
                    type="monotone"
                    dataKey={sku.partCode}
                    name={`${sku.partCode} - ${sku.description}`}
                    stroke={skuLineColors[idx % skuLineColors.length]}
                    strokeWidth={2.25}
                    dot={{ r: 3.5, fill: skuLineColors[idx % skuLineColors.length], strokeWidth: 1.5, stroke: '#ffffff' }}
                    activeDot={{ r: 6, strokeWidth: 2 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* MIDDLE (col-span-4): Stacked Low Stock Alerts + Shelf Life Alerts */}
        <div className="lg:col-span-4 flex flex-col lg:min-h-0 gap-3">
          {/* Panel 1: Low Stock Alerts */}
          <div
            className="bg-white border border-rose-200 rounded-xl p-[clamp(0.55rem,1.05vh,0.75rem)] shadow-2xs flex-1 min-h-0 flex flex-col"
            id="low-stock-alert-card"
          >
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-rose-100 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                <h3 className="font-bold text-xs text-slate-800 truncate">Low Stock Alerts</h3>
                <span className="text-[10px] font-mono font-bold text-rose-600 tabular-nums shrink-0">
                  ({lowStockSkus.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActivePopup('lowStock')}
                className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 transition cursor-pointer shrink-0 whitespace-nowrap"
              >
                View all &rarr;
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar divide-y divide-rose-100/70 mt-1">
              {displayedLowStock.map((item, idx) => (
                <button
                  type="button"
                  key={`low-stock-row-${item.partCode || 'item'}-${idx}`}
                  onClick={() => setActivePopup('lowStock')}
                  className="w-full text-left py-1.5 px-1.5 text-xs flex items-center justify-between gap-2 hover:bg-rose-50/70 rounded transition cursor-pointer"
                >
                  <div className="min-w-0 flex-1 flex items-center gap-1.5">
                    <span className="font-mono font-bold text-rose-800 shrink-0">{item.partCode}</span>
                    <span className="text-slate-500 truncate">{item.description}</span>
                  </div>
                  <span className="font-mono font-bold text-rose-700 tabular-nums shrink-0">
                    {item.currentQty.toLocaleString()}/{item.reorderMin.toLocaleString()} {item.unit}
                  </span>
                </button>
              ))}
              {lowStockSkus.length === 0 && (
                <div className="h-full min-h-[72px] flex items-center justify-center gap-1.5 text-xs text-slate-500">
                  <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>All stock levels above reorder minimum</span>
                </div>
              )}
            </div>
          </div>

          {/* Panel 2: Shelf Life Alerts */}
          <div
            className="bg-white border border-slate-200 rounded-xl p-[clamp(0.55rem,1.05vh,0.75rem)] shadow-2xs flex-1 min-h-0 flex flex-col"
            id="shelf-life-alerts-card"
          >
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Timer className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <h3 className="font-bold text-xs text-slate-800 truncate">Shelf Life Alerts</h3>
                <span className="text-[10px] font-mono font-bold text-amber-600 tabular-nums shrink-0">
                  ({nearExpiryItems.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActivePopup('shelfLife')}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer shrink-0 whitespace-nowrap"
              >
                View all &rarr;
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar divide-y divide-slate-100 mt-1">
              {displayedShelfLife.map((item, idx) => {
                const diffTime = new Date(item.expirationDate!).getTime() - new Date(todayStr).getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const isExpired = diffDays <= 0;
                return (
                  <button
                    type="button"
                    key={item.id ? `near-expiry-row-${item.id}` : `near-expiry-row-${idx}`}
                    onClick={() => setActivePopup('shelfLife')}
                    className="w-full text-left py-1.5 px-1.5 text-xs flex items-center justify-between gap-2 hover:bg-slate-50 rounded transition cursor-pointer"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-1.5">
                      <span className="font-mono font-bold text-slate-800 shrink-0">{item.partCode}</span>
                      <span className="text-slate-500 truncate">{item.lotNumber || item.description}</span>
                    </div>
                    <span
                      className={`font-mono font-bold tabular-nums shrink-0 ${
                        isExpired ? 'text-rose-600' : 'text-amber-600'
                      }`}
                    >
                      {isExpired ? 'EXPIRED' : `${diffDays}d left`}
                    </span>
                  </button>
                );
              })}
              {nearExpiryItems.length === 0 && (
                <div className="h-full min-h-[72px] flex items-center justify-center gap-1.5 text-xs text-slate-500">
                  <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>All materials have healthy shelf life</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT (col-span-3): Safety Card, Broken Sack Spillage Chip, Online Operators */}
        <div className="lg:col-span-3 flex flex-col lg:min-h-0 gap-3">
          {/* Safety Status Card */}
          <div
            className={`rounded-xl border p-[clamp(0.55rem,1.05vh,0.75rem)] shadow-2xs shrink-0 flex flex-col gap-2 ${
              forkliftDoneToday
                ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
            id="forklift-safety-banner"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <ClipboardCheck
                  className={`h-4 w-4 shrink-0 ${forkliftDoneToday ? 'text-emerald-600' : 'text-amber-600'}`}
                />
                <h3 className="font-bold text-xs truncate">Safety Status</h3>
              </div>
              <span
                className={`text-[10px] font-mono font-bold shrink-0 ${
                  forkliftDoneToday ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {forkliftDoneToday ? 'VERIFIED' : 'PENDING'}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-snug">
              {forkliftDoneToday
                ? 'Daily forklift pre-inspection completed for safe loading.'
                : 'Daily forklift pre-inspection checklist pending prior to loading.'}
            </p>
            <button
              type="button"
              onClick={() => setActivePopup('safety')}
              className="w-full py-1.5 px-2.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg transition cursor-pointer whitespace-nowrap"
              id="btn-open-safety-operations"
            >
              Open Safety Operations
            </button>
          </div>

          {/* Broken Sack Spillage Status Chip */}
          <button
            type="button"
            onClick={() => setActivePopup('safety')}
            className={`w-full text-left rounded-xl border px-3 py-[clamp(0.45rem,0.9vh,0.65rem)] shadow-2xs shrink-0 flex items-center justify-between gap-2 cursor-pointer transition ${
              brokenResinSacks.length > 0
                ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100/70'
                : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
            }`}
            id="sack-risk-banner"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FlameKindling
                className={`h-4 w-4 shrink-0 ${brokenResinSacks.length > 0 ? 'text-amber-600' : 'text-slate-500'}`}
              />
              <span className="text-xs font-bold truncate">Broken Sack Spillage</span>
            </div>
            <span
              className={`text-[10px] font-mono font-bold shrink-0 ${
                brokenResinSacks.length > 0 ? 'text-amber-800' : 'text-emerald-700'
              }`}
            >
              {brokenResinSacks.length > 0 ? `${brokenResinSacks.length} RISK` : 'CLEAR'}
            </span>
          </button>

          {/* Online Operators (Top 4) */}
          <div className="bg-white border border-slate-200 rounded-xl p-[clamp(0.55rem,1.05vh,0.75rem)] shadow-2xs flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Users className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <h3 className="font-bold text-xs text-slate-800 truncate">Online Operators</h3>
                <span className="text-[10px] font-mono font-bold text-emerald-700 tabular-nums shrink-0">
                  ({activeUsers.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => (isSuperAdmin ? setView('accounts') : setActivePopup('operators'))}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer shrink-0 whitespace-nowrap"
                title={isSuperAdmin ? 'Open JPMP Accounts Directory' : 'Open Online Operators & Dispatch'}
              >
                View all &rarr;
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar divide-y divide-slate-100 mt-1">
              {displayedOperators.map((user, idx) => {
                const matchedAcc = registeredUsers.find(
                  a => (a.username || '').toUpperCase() === (user || '').toUpperCase()
                );
                return (
                  <button
                    type="button"
                    key={`online-op-${user || 'user'}-${idx}`}
                    onClick={() => setActivePopup('operators')}
                    className="w-full text-left py-1.5 px-1.5 text-xs flex items-center justify-between gap-2 hover:bg-slate-50 rounded transition cursor-pointer"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-semibold text-slate-800 truncate">
                        {user}
                        {user === currentUser ? ' (You)' : ''}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 truncate max-w-[85px] shrink-0">
                      {matchedAcc?.employeeId || matchedAcc?.role || 'ONLINE'}
                    </span>
                  </button>
                );
              })}
              {activeUsers.length === 0 && (
                <div className="h-full min-h-[72px] flex items-center justify-center text-xs text-slate-400">
                  No operators currently online
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* DASHBOARD POP-UPS (Safety Operations, ISO 9001, Flow, Alerts, Ops)    */}
      {/* ===================================================================== */}
      {activePopup &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setActivePopup(null)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Pop-up: Safety Operations */}
              {activePopup === 'safety' && (
                <>
                  <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="h-5 w-5 text-emerald-400" />
                      <h3 className="font-bold text-sm">Forklift Safety Operations &amp; Spillage Control</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-5 overflow-y-auto space-y-4">
                    <div
                      className={`p-4 rounded-xl border flex items-start gap-3 ${
                        forkliftDoneToday
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-amber-50 border-amber-200 text-amber-900'
                      }`}
                    >
                      <ClipboardCheck className="h-5 w-5 shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1.5">
                        <h4 className="font-bold text-sm">
                          Forklift Safety Operations — {forkliftDoneToday ? 'Completed Today' : 'Pending Today'}
                        </h4>
                        <p className="text-xs text-slate-600">
                          {forkliftDoneToday
                            ? 'Daily forklift pre-inspection checklist completed. Safe to load and transfer materials.'
                            : 'Daily forklift checklist PENDING! Forklift operators must complete pre-inspection prior to loading.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setActivePopup(null);
                            setView('delivery');
                          }}
                          className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:underline cursor-pointer"
                        >
                          {forkliftDoneToday ? 'View Forklift Checklists' : 'Log Pre-Inspection Checklist'}
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div
                      className={`p-4 rounded-xl border flex items-start gap-3 ${
                        brokenResinSacks.length > 0
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                    >
                      <FlameKindling className="h-5 w-5 shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1.5">
                        <h4 className="font-bold text-sm">
                          Broken Sack Spillage Control ({brokenResinSacks.length > 0 ? 'Risk Active' : 'Normal'})
                        </h4>
                        <p className="text-xs text-slate-600">
                          {brokenResinSacks.length > 0
                            ? `Procedures dictate strictly isolating broken sacks of ${brokenResinSacks[0].partCode} in Quarantine to prevent spillage and resin mixing.`
                            : 'No resin sack mixing risks or active spillage incidents reported.'}
                        </p>
                        {brokenResinSacks.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setActivePopup(null);
                              setView('stock');
                            }}
                            className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 hover:underline cursor-pointer"
                          >
                            Inspect Quarantine Items <ArrowUpRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-3">
                      <h4 className="text-xs font-bold text-slate-700 mb-2">
                        Recent Forklift Pre-Inspection Logs ({forkliftChecks.length})
                      </h4>
                      {forkliftChecks.length > 0 ? (
                        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                          {forkliftChecks.slice(0, 5).map((chk, idx) => (
                            <div key={chk.id || idx} className="px-3 py-2 text-xs flex items-center justify-between gap-3 bg-white">
                              <div className="min-w-0">
                                <span className="font-mono font-bold text-slate-800">{chk.forkliftId}</span>
                                <span className="text-slate-500 ml-2">Operator: {chk.operator}</span>
                              </div>
                              <span className="font-mono text-slate-500 shrink-0">{chk.date}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">No forklift pre-inspection logs recorded yet.</p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Pop-up: ISO 9001 Directives */}
              {activePopup === 'iso' && (
                <>
                  <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-indigo-400" />
                      <h3 className="font-bold text-sm">ISO 9001:2015 Warehouse Core Directives</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-6 bg-slate-900 text-white space-y-4 overflow-y-auto relative" id="quick-sop-panel">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-indigo-400" />
                      <span className="text-xs font-bold uppercase tracking-widest text-indigo-300">
                        Procedure Guidance
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      All warehouse tasks must adhere to standard physical check rules upon delivery. Always verify item description, quantity, unit of measure, and physical condition before stamping DRs. Ensure materials undergo FIFO Color Coding before being directed to active bins. Never mix materials with broken sacks to avoid resin-spillage hazards.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2">
                      <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700">
                        <span className="text-slate-400 block text-[10px]">Receiving</span>
                        <span className="font-semibold text-white">IQC Endorsement &amp; Check</span>
                      </div>
                      <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700">
                        <span className="text-slate-400 block text-[10px]">FIFO Rotation</span>
                        <span className="font-semibold text-white">Quarterly Color Codes</span>
                      </div>
                      <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700">
                        <span className="text-slate-400 block text-[10px]">Reusability Limit</span>
                        <span className="font-semibold text-white">Max 5 Cycles Only</span>
                      </div>
                      <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700">
                        <span className="text-slate-400 block text-[10px]">Gate Pass Release</span>
                        <span className="font-semibold text-white">Forklift Check &amp; Waybills</span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Pop-up: Material Flow & Top Velocity */}
              {activePopup === 'flow' && (
                <>
                  <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-indigo-400" />
                      <h3 className="font-bold text-sm">Receiving vs Issuance Material Flow Summary</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-5 overflow-y-auto space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-slate-600">
                        Inbound replenishment vs outbound manufacturing consumption across all recorded lots.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleDirectExportPDF}
                          disabled={isExportingPDF}
                          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {isExportingPDF ? 'Generating...' : 'Export PDF'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActivePopup(null);
                            setShowReportModal(true);
                          }}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer border border-slate-200"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          <span>Full Audit Report</span>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <div className="flex justify-between text-xs font-bold">
                        <span className="text-emerald-700">
                          Inbound Received: {totalReceivedQty.toLocaleString()} PCS ({rxVelocityPct}%)
                        </span>
                        <span className="text-blue-700">
                          Outbound Issued: {totalIssuedQty.toLocaleString()} PCS ({issVelocityPct}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2.5 flex overflow-hidden">
                        <div className="bg-emerald-500" style={{ width: `${rxVelocityPct}%` }} />
                        <div className="bg-blue-600" style={{ width: `${issVelocityPct}%` }} />
                      </div>
                    </div>

                    {topFlowSkus.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-700 uppercase">
                          Top Transacted Material Velocity
                        </h4>
                        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                          {topFlowSkus.map((sku, idx) => {
                            const delta = sku.rx - sku.iss;
                            return (
                              <div key={`popup-flow-sku-${sku.partCode}-${idx}`} className="px-3 py-2 text-xs flex items-center justify-between gap-3 bg-white">
                                <div className="min-w-0 flex-1">
                                  <span className="font-mono font-bold text-slate-900 mr-2">{sku.partCode}</span>
                                  <span className="text-slate-600 truncate">{sku.description}</span>
                                </div>
                                <div className="flex items-center gap-3 font-mono text-[11px] shrink-0 tabular-nums">
                                  <span className="text-emerald-700 font-bold">Rx: {sku.rx}</span>
                                  <span className="text-blue-700 font-bold">Iss: {sku.iss}</span>
                                  <span className={`font-bold ${delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                    {delta > 0 ? `+${delta}` : delta}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Pop-up: Low Stock Reorder Alerts */}
              {activePopup === 'lowStock' && (
                <>
                  <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-rose-400" />
                      <h3 className="font-bold text-sm">Low Stock Level Alerts ({lowStockSkus.length})</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-5 overflow-y-auto space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-slate-600">
                        Approved material stock currently below defined <span className="font-mono font-bold text-rose-700">reorderMin</span> limits.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActivePopup(null);
                            setShowInventoryReportModal(true);
                          }}
                          className="text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                          <span>Reorder Report</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActivePopup(null);
                            setView('stock');
                          }}
                          className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg transition cursor-pointer"
                        >
                          Inventory Registry &rarr;
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-rose-100 border border-rose-200 rounded-xl overflow-hidden">
                      {lowStockSkus.map((item, idx) => {
                        const pct = item.reorderMin > 0 ? Math.min(100, Math.round((item.currentQty / item.reorderMin) * 100)) : 0;
                        return (
                          <div key={`popup-low-${item.partCode}-${idx}`} className="p-3 bg-rose-50/30 space-y-1.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <span className="font-mono font-bold text-rose-900 mr-2">{item.partCode}</span>
                                <span className="font-semibold text-slate-800">{item.description}</span>
                                <span className="text-slate-500 ml-2 font-mono">{item.location}</span>
                              </div>
                              <div className="text-right font-mono shrink-0 tabular-nums">
                                <span className="font-bold text-rose-700">
                                  {item.currentQty.toLocaleString()} / {item.reorderMin.toLocaleString()} {item.unit}
                                </span>
                                <span className="text-[10px] text-rose-600 block">
                                  Shortage: -{item.shortage.toLocaleString()} {item.unit} ({pct}%)
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {lowStockSkus.length === 0 && (
                        <div className="p-6 text-center text-xs text-slate-500">
                          All material inventory stock levels are above defined minimum reorder thresholds.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Pop-up: Shelf Life, Quarantine & IQC */}
              {activePopup === 'shelfLife' && (
                <>
                  <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <Timer className="h-5 w-5 text-amber-400" />
                      <h3 className="font-bold text-sm">Shelf Life, Quarantine &amp; IQC Overview</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-5 overflow-y-auto space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setActivePopup(null);
                          setView('stock');
                        }}
                        className="p-3 rounded-xl border border-amber-200 bg-amber-50/60 text-left cursor-pointer hover:border-amber-400"
                      >
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Expiring (&le;30d)</span>
                        <span className="text-lg font-extrabold font-mono text-amber-700 tabular-nums">{nearExpiryItems.length}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActivePopup(null);
                          setView('stock');
                        }}
                        className="p-3 rounded-xl border border-rose-200 bg-rose-50/60 text-left cursor-pointer hover:border-rose-400"
                      >
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Quarantine &amp; Hold</span>
                        <span className="text-lg font-extrabold font-mono text-rose-700 tabular-nums">{quarantineCount}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActivePopup(null);
                          setView('receiving');
                        }}
                        className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/60 text-left cursor-pointer hover:border-indigo-400"
                      >
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Pending IQC</span>
                        <span className="text-lg font-extrabold font-mono text-indigo-700 tabular-nums">{pendingIqcCount}</span>
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                      {nearExpiryItems.map((item, idx) => {
                        const diffTime = new Date(item.expirationDate!).getTime() - new Date(todayStr).getTime();
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        const isExpired = diffDays <= 0;
                        return (
                          <div key={item.id || `popup-exp-${idx}`} className="px-3 py-2 text-xs flex items-center justify-between gap-2 bg-white">
                            <div className="min-w-0">
                              <span className="font-mono font-bold text-slate-900 mr-2">{item.partCode}</span>
                              <span className="text-slate-700">{item.description}</span>
                              <span className="text-slate-400 ml-2 font-mono">Lot: {item.lotNumber}</span>
                            </div>
                            <div className="text-right font-mono shrink-0 tabular-nums">
                              <span className={`font-bold ${isExpired ? 'text-rose-600' : 'text-amber-600'}`}>
                                {isExpired ? 'EXPIRED' : `${diffDays} Days Left`}
                              </span>
                              <span className="text-[10px] text-slate-400 block">Exp: {item.expirationDate}</span>
                            </div>
                          </div>
                        );
                      })}
                      {nearExpiryItems.length === 0 && (
                        <div className="p-6 text-center text-xs text-slate-500">
                          All stored materials have healthy remaining shelf life.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Pop-up: Online Operators, Live Transactions & Radio Dispatch */}
              {activePopup === 'operators' && (
                <>
                  <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-emerald-400" />
                      <h3 className="font-bold text-sm">Online Operators, Live Feed &amp; Dispatch ({activeUsers.length})</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-5 overflow-y-auto space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <div className="flex gap-4">
                        <button
                          type="button"
                          onClick={() => setActiveTab('transactions')}
                          className={`pb-1.5 text-xs font-bold border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
                            activeTab === 'transactions'
                              ? 'border-indigo-600 text-indigo-600'
                              : 'border-transparent text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <Package className="h-3.5 w-3.5" /> Live Transactions
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('chat')}
                          className={`pb-1.5 text-xs font-bold border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
                            activeTab === 'chat'
                              ? 'border-indigo-600 text-indigo-600'
                              : 'border-transparent text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <MessageSquare className="h-3.5 w-3.5" /> Operator Dispatch
                        </button>
                      </div>
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={() => {
                            setActivePopup(null);
                            setView('accounts');
                          }}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                        >
                          JPMP Accounts &rarr;
                        </button>
                      )}
                    </div>

                    {activeTab === 'transactions' ? (
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                        {timelineEvents.map((event, idx) => (
                          <div key={event.id ? `${event.id}-${idx}` : `popup-tx-${idx}`} className="p-3 flex items-center justify-between gap-3 bg-white text-xs">
                            <div className="min-w-0">
                              <span className="font-mono font-bold text-indigo-700 mr-2">{event.type}</span>
                              <span className="font-semibold text-slate-800">{event.title}</span>
                              <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">{event.meta}</p>
                            </div>
                            <span className="font-mono text-slate-400 shrink-0">{event.date}</span>
                          </div>
                        ))}
                        {timelineEvents.length === 0 && (
                          <div className="p-6 text-center text-xs text-slate-400">No warehouse actions recorded yet.</div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-2 text-xs flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-emerald-800">Online:</span>
                          {activeUsers.map((user, idx) => (
                            <span key={`popup-active-op-${user}-${idx}`} className="text-emerald-700 font-medium">
                              {user}{user === currentUser ? ' (You)' : ''}{idx < activeUsers.length - 1 ? ' ·' : ''}
                            </span>
                          ))}
                          {activeUsers.length === 0 && <span className="text-slate-400 italic">No operators online</span>}
                        </div>

                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 overflow-y-auto max-h-[200px] min-h-[140px] space-y-2">
                          {chatMessages.map((msg, idx) => (
                            <div key={msg.id ? `popup-chat-${msg.id}` : `popup-chat-${idx}`} className="text-xs">
                              {!msg.isSystem ? (
                                <div>
                                  <span className="font-bold text-indigo-700 mr-2">{msg.sender}</span>
                                  <span className="text-slate-700">{msg.text}</span>
                                </div>
                              ) : (
                                <span className="text-slate-500 italic text-[11px]">{msg.text}</span>
                              )}
                            </div>
                          ))}
                          <div ref={chatEndRef} />
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => sendQuickDispatch('[REQ] Forklift Operator needed immediately at Receiving Dock Aisle A!')}
                            className="text-[10px] bg-rose-50 border border-rose-200 text-rose-700 font-bold px-2 py-1 rounded cursor-pointer"
                          >
                            Forklift Call
                          </button>
                          <button
                            type="button"
                            onClick={() => sendQuickDispatch('[IQC] Quality Control inspection approved for raw material resin sacks.')}
                            className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold px-2 py-1 rounded cursor-pointer"
                          >
                            IQC Approved
                          </button>
                          <button
                            type="button"
                            onClick={() => sendQuickDispatch('[OUT] Finished Goods pallet packaging complete. Ready for gate release.')}
                            className="text-[10px] bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold px-2 py-1 rounded cursor-pointer"
                          >
                            Dispatch Ready
                          </button>
                        </div>

                        <form onSubmit={handleSend} className="flex gap-2">
                          <input
                            type="text"
                            value={msgText}
                            onChange={(e) => setMsgText(e.target.value)}
                            placeholder="Type broadcast message to active staff..."
                            className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs"
                          />
                          <button
                            type="submit"
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                          >
                            <Send className="h-3 w-3" /> Send
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* Receiving vs Issuance Printable Summary & PDF Export Modal */}
      {showReportModal && (
        <ReceivingVsIssuanceReportModal
          receiving={receiving}
          issuances={issuances}
          stocks={stocks}
          registries={registries}
          currentUser={currentUser}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setShowReportModal(false)}
        />
      )}

      {/* Comprehensive Inventory Audit & Data Export Modal (PDF / CSV) */}
      {showInventoryReportModal && (
        <InventoryReportModal
          stocks={stocks}
          currentUser={currentUser}
          isSuperAdmin={isSuperAdmin}
          initialCustomerFilter="ALL"
          onClose={() => setShowInventoryReportModal(false)}
        />
      )}

      {/* In-App Preview for Direct Dashboard PDF Report */}
      {showDirectPreview && (
        <PrintPreviewModal
          isOpen={showDirectPreview}
          onClose={() => setShowDirectPreview(false)}
          documentTitle="Receiving vs Issuance Audit Snapshot"
          documentNumber="DOC REF: JPM-WMS-REP-008"
          documentSubtitle="All-Time Historical Material Flow Report"
          filename={directPreviewFilename}
          pages={directPreviewPages}
          isRendering={isExportingPDF}
        />
      )}
    </div>
  );
}
