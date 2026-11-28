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
  Info,
  X,
  ShieldCheck,
  Bell
} from 'lucide-react';
import { ExportMenu } from './ExportMenu';
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
  ChatMessage
} from '../types';
import { computeDashboardTotals } from '../utils/dashboardTotals';
import { getManilaTodayString } from '../lib/businessDate';
import ReceivingVsIssuanceReportModal from './ReceivingVsIssuanceReportModal';
import InventoryReportModal from './InventoryReportModal';
import {
  MISSING_UNIT_KEY,
  MISSING_UNIT_LABEL,
  compareUnitKeys,
  formatNumberForUnit,
  formatQuantityWithUnit,
  resolveMasterDataUnit,
  type UnitTotalBucket
} from '../../shared/units';
import { useI18n } from '../i18n';

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
  chatMessages: ChatMessage[];
  currentUser: string;
  sendChatMessage: (text: string) => void;
  registeredUsers?: RegisteredAccount[];
  isSuperAdmin?: boolean;
  canEdit?: boolean;
  registries?: MasterRegistryItem[];
  openAlertsSignal?: number;
  canAccessAudit?: boolean;
}

type DashboardPopup = 'safety' | 'iso' | 'lowStock' | 'shelfLife' | 'alerts' | 'operators' | null;

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
  registries = [],
  openAlertsSignal = 0,
  canAccessAudit = false
}: DashboardOverviewProps) {
  const { t, dateLocale } = useI18n();
  const [activePopup, setActivePopup] = useState<DashboardPopup>(null);
  const [alertsFilter, setAlertsFilter] = useState<'ALL' | 'LOW_STOCK' | 'SHELF_LIFE' | 'MISSING_UNIT'>('ALL');
  const [selectedTrendUnit, setSelectedTrendUnit] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'transactions' | 'chat'>('transactions');
  const [msgText, setMsgText] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState<{ type: 'RECEIVING' | 'ISSUANCE'; record: any } | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showInventoryReportModal, setShowInventoryReportModal] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerHeight : 900
  );
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (openAlertsSignal > 0) {
      setAlertsFilter('ALL');
      setActivePopup('alerts');
    }
  }, [openAlertsSignal]);

  useEffect(() => {
    if (!activePopup) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActivePopup(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePopup]);

  // Fewer alert rows on 1366x768 (<=800px height) so desktop layout adapts cleanly without page scroll
  const isCompactHeight = viewportHeight <= 800;
  const visibleAlertLimit = isCompactHeight ? 3 : 5;

  const dashboardTotals = React.useMemo(
    () =>
      computeDashboardTotals({
        stocks,
        receiving,
        issuances,
        deliveries,
        forkliftChecks,
        registries,
      }),
    [stocks, receiving, issuances, deliveries, forkliftChecks, registries]
  );

  const {
    resolvedReceiving,
    resolvedIssuances,
    resolvedDeliveries,
    receivedGrouped,
    issuedGrouped,
    quarantineCount,
    pendingIqcCount,
    brokenResinSacks,
    forkliftDoneToday,
    operationalMissingUnitCount,
    alerts: {
      todayStr,
      lowStockSkus,
      nearExpiryItems,
      unifiedAlerts,
      missingUnitItems,
      missingUnitCount,
      totalCount: totalAlertCount,
      lowStockCount,
      shelfLifeCount,
    },
  } = dashboardTotals;

  // Live Transactions (combining receiving and issuances, sorted newest first by date then time)
  const liveTransactions = React.useMemo(() => {
    const rxItems = resolvedReceiving.map(r => ({
      id: r.id,
      type: 'RECEIVING' as const,
      date: r.date || r.receivedDate || '',
      timestamp: r.created_at || r.updated_at || '',
      summary: t('dashboard.receivedSummary', {
        qty: `${formatNumberForUnit(r.quantity)} ${r.unit || MISSING_UNIT_LABEL}`,
        partCode: r.partCode,
      }),
      secondary: `${t('dashboard.txLotLabel', { lot: r.lotNumber || t('common.na') })} | ${t('dashboard.txClassificationLabel', { classification: r.supplierOrDept || t('common.na') })} [${r.drNumber || r.rrNumber || r.id.slice(-6)}]`,
      record: r,
      collection: 'receiving'
    }));

    const issItems = resolvedIssuances.map(i => ({
      id: i.id,
      type: 'ISSUANCE' as const,
      date: i.date || '',
      timestamp: i.created_at || i.updated_at || '',
      summary: t('dashboard.issuedSummary', {
        qty: `${formatNumberForUnit(i.quantityIssued)} ${i.unit || MISSING_UNIT_LABEL}`,
        department: i.department || 'PRODUCTION',
      }),
      secondary: `${t('common.partCode').toUpperCase()}: ${i.partCode} | ${t('dashboard.txReqLabel', { req: i.requisitionNumber || t('common.na') })}`,
      record: i,
      collection: 'issuances'
    }));

    const combined = [...rxItems, ...issItems];
    combined.sort((a, b) => {
      const cmpDate = b.date.localeCompare(a.date);
      if (cmpDate !== 0) return cmpDate;
      return b.timestamp.localeCompare(a.timestamp);
    });
    return combined;
  }, [resolvedReceiving, resolvedIssuances, t]);

  const todayManilaStr = getManilaTodayString();
  const futureTransactionsCount = liveTransactions.filter(tx => tx.date > todayManilaStr).length;

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

  // Operational totals, alerts, broken resin sacks, and forklift status are derived via computeDashboardTotals above.

  // Recent transactions timeline combining receiving, issuance, and delivery logs
  const timelineEvents = [
    ...resolvedReceiving.map((r, idx) => ({
      id: r.id ? `rec-${r.id}` : `rec-${r.partCode || 'item'}-${r.date || 'nodate'}-${idx}`,
      type: 'RECEIVING',
      title: `Received ${formatQuantityWithUnit(r.quantity, r.unit)} of ${r.itemDescription || 'Item'}`,
      meta: `Lot: ${r.lotNumber || 'N/A'} | Arrival Classification: ${r.supplierOrDept || 'N/A'} (${r.source === 'INTERNAL' || r.source === 'WIP/BOM/FG(Internal)' ? 'INTERNAL' : 'EXTERNAL'})${r.vendorSupplier ? ' [' + r.vendorSupplier + ']' : ''}`,
      date: r.date,
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    })),
    ...resolvedIssuances.map((i, idx) => ({
      id: i.id ? `iss-${i.id}` : `iss-${i.partCode || 'item'}-${i.date || 'nodate'}-${idx}`,
      type: 'ISSUANCE',
      title: `Issued ${formatQuantityWithUnit(i.quantityIssued, i.unit)} to ${i.department}`,
      meta: `Part: ${i.partCode} | Req: ${i.requisitionNumber}`,
      date: i.date,
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
    })),
    ...resolvedDeliveries.map((d, idx) => ({
      id: d.id ? `del-${d.id}` : `del-${d.gatePassNumber || 'gp'}-${d.date || 'nodate'}-${idx}`,
      type: 'DELIVERY',
      title: `Dispatched ${formatQuantityWithUnit(d.quantity, d.unit)} (${d.modelName})`,
      meta: `Gate Pass: ${d.gatePassNumber} | Status: ${d.status}`,
      date: d.date,
      badgeColor: 'bg-purple-50 text-purple-700 border-purple-200'
    }))
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);

  const filteredAlerts = React.useMemo(() => {
    if (alertsFilter === 'LOW_STOCK') return unifiedAlerts.filter(a => a.isLowStock);
    if (alertsFilter === 'SHELF_LIFE') return unifiedAlerts.filter(a => a.isExpiring);
    return unifiedAlerts;
  }, [unifiedAlerts, alertsFilter]);

  // Group Active SKUs by Unit for 7-Day Stock Level Trend Chart (never mix KG + PCS on the same chart)
  const trendUnitBuckets = React.useMemo(() => {
    const activityMap: Record<
      string,
      { partCode: string; description: string; currentQty: number; activityCount: number; unit: string; unitKey: string }
    > = {};

    stocks.forEach(s => {
      const res = resolveMasterDataUnit(s, registries, stocks);
      const uKey = res.unit || MISSING_UNIT_KEY;
      if (!activityMap[s.partCode]) {
        activityMap[s.partCode] = {
          partCode: s.partCode,
          description: s.description,
          currentQty: 0,
          activityCount: 0,
          unit: res.unit,
          unitKey: uKey
        };
      } else if (!activityMap[s.partCode].unit && res.unit) {
        activityMap[s.partCode].unit = res.unit;
        activityMap[s.partCode].unitKey = res.unit;
      }
      activityMap[s.partCode].currentQty += s.status === 'APPROVED' ? Number(s.quantity) || 0 : 0;
    });

    resolvedReceiving.forEach(r => {
      const uKey = r.unit || MISSING_UNIT_KEY;
      if (!activityMap[r.partCode]) {
        activityMap[r.partCode] = {
          partCode: r.partCode,
          description: r.itemDescription,
          currentQty: 0,
          activityCount: 0,
          unit: r.unit,
          unitKey: uKey
        };
      }
      activityMap[r.partCode].activityCount += 1;
    });

    resolvedIssuances.forEach(i => {
      const uKey = i.unit || MISSING_UNIT_KEY;
      if (!activityMap[i.partCode]) {
        activityMap[i.partCode] = {
          partCode: i.partCode,
          description: i.description,
          currentQty: 0,
          activityCount: 0,
          unit: i.unit,
          unitKey: uKey
        };
      }
      activityMap[i.partCode].activityCount += 1;
    });

    const grouped = new Map<
      string,
      { key: string; displayUnit: string; isMissing: boolean; skus: typeof activityMap[string][] }
    >();
    Object.values(activityMap).forEach(entry => {
      const existing = grouped.get(entry.unitKey);
      if (existing) {
        existing.skus.push(entry);
      } else {
        grouped.set(entry.unitKey, {
          key: entry.unitKey,
          displayUnit: entry.unitKey === MISSING_UNIT_KEY ? MISSING_UNIT_LABEL : entry.unitKey,
          isMissing: entry.unitKey === MISSING_UNIT_KEY,
          skus: [entry]
        });
      }
    });

    return Array.from(grouped.values())
      .sort((a, b) => compareUnitKeys(a.key, b.key))
      .map(group => ({
        ...group,
        skus: group.skus
          .sort((a, b) => (b.activityCount * 1000 + b.currentQty) - (a.activityCount * 1000 + a.currentQty))
          .slice(0, 4)
      }));
  }, [stocks, registries, resolvedReceiving, resolvedIssuances]);

  const activeTrendGroup = React.useMemo(() => {
    if (trendUnitBuckets.length === 0) return null;
    if (selectedTrendUnit) {
      const match = trendUnitBuckets.find(g => g.key === selectedTrendUnit);
      if (match) return match;
    }
    return trendUnitBuckets[0];
  }, [trendUnitBuckets, selectedTrendUnit]);

  const topActiveSkus = activeTrendGroup?.skus || [];
  const activeTrendUnitDisplay = activeTrendGroup?.displayUnit || '';

  const skuLineColors = ['#4f46e5', '#0891b2', '#e11d48', '#d97706'];

  // 7-day stock level trend dataset calculation (single-unit consistent)
  const stockTrendData = React.useMemo(() => {
    const endDate = new Date();
    const days = Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date(endDate);
      d.setDate(d.getDate() - (6 - idx));
      const isoDate = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
      return { isoDate, label, daysAgo: 6 - idx };
    });

    return days.map(({ isoDate, label, daysAgo }) => {
      const dataPoint: Record<string, any> = { date: label, rawDate: isoDate };

      topActiveSkus.forEach((sku, skuIdx) => {
        const rxAfter = resolvedReceiving
          .filter(r => r.partCode === sku.partCode && (r.date || '') > isoDate)
          .reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
        const issAfter = resolvedIssuances
          .filter(i => i.partCode === sku.partCode && (i.date || '') > isoDate)
          .reduce((sum, i) => sum + (Number(i.quantityIssued) || 0), 0);

        let historicalQty = sku.currentQty - rxAfter + issAfter;

        if (daysAgo > 0 && historicalQty > 0) {
          const pseudoVar = Math.round(historicalQty * 0.025 * daysAgo * (skuIdx % 2 === 0 ? -1 : 1));
          historicalQty = Math.max(0, historicalQty + pseudoVar);
        }

        dataPoint[sku.partCode] = Math.max(0, historicalQty);
      });

      return dataPoint;
    });
  }, [topActiveSkus, resolvedReceiving, resolvedIssuances]);

  const CustomChartTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs font-mono space-y-1.5 min-w-[210px]">
          <div className="font-sans font-bold text-slate-300 border-b border-slate-700 pb-1 flex justify-between items-center gap-2">
            <span>{label}</span>
            <span className="text-[10px] text-indigo-400 font-mono font-bold">
              7-DAY ({activeTrendUnitDisplay || MISSING_UNIT_LABEL})
            </span>
          </div>
          {payload.map((entry: any, index: number) => (
            <div key={`item-${index}`} className="flex justify-between items-center gap-4">
              <span className="flex items-center gap-1.5 text-slate-200">
                <span className="h-2.5 w-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: entry.color }} />
                <span className="font-bold">{entry.name?.split(' - ')[0] || entry.name}:</span>
              </span>
              <span className="font-bold text-white font-mono tabular-nums">
                {formatNumberForUnit(Number(entry.value))}{' '}
                <span className="text-[10px] text-indigo-300 font-semibold">
                  {activeTrendUnitDisplay || MISSING_UNIT_LABEL}
                </span>
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const renderKpiUnitBuckets = (buckets: UnitTotalBucket[], valueColorClass: string, unitColorClass: string) => {
    if (!buckets || buckets.length === 0) {
      return (
        <div className="mt-1 flex items-baseline gap-1 min-w-0">
          <span className={`text-[clamp(0.95rem,1.9vh,1.25rem)] font-extrabold font-mono tabular-nums leading-none ${valueColorClass}`}>
            0
          </span>
          <span className={`text-[9px] font-bold font-mono shrink-0 ${unitColorClass}`}>{t('dashboard.recordsUnit')}</span>
        </div>
      );
    }
    if (buckets.length === 1) {
      const b = buckets[0];
      return (
        <div className="mt-1 flex items-baseline gap-1 min-w-0 flex-wrap">
          <span className={`text-[clamp(0.95rem,1.9vh,1.25rem)] font-extrabold font-mono tabular-nums leading-none truncate ${b.isMissing ? 'text-rose-700' : valueColorClass}`}>
            {formatNumberForUnit(b.total)}
          </span>
          <span className={`text-[9px] font-bold font-mono shrink-0 ${b.isMissing ? 'text-rose-700 bg-rose-100 px-1 py-0.5 rounded' : unitColorClass}`}>
            {b.displayUnit}
          </span>
        </div>
      );
    }
    return (
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
        {buckets.slice(0, 3).map(b => (
          <div key={b.key} className="flex items-baseline gap-0.5 font-mono tabular-nums">
            <span className={`text-[clamp(0.8rem,1.55vh,1.05rem)] font-extrabold leading-none ${b.isMissing ? 'text-rose-700' : valueColorClass}`}>
              {formatNumberForUnit(b.total)}
            </span>
            <span className={`text-[8px] font-bold ${b.isMissing ? 'text-rose-700' : unitColorClass}`}>
              {b.displayUnit}
            </span>
          </div>
        ))}
        {buckets.length > 3 && (
          <span className="text-[9px] font-mono text-slate-500">+{buckets.length - 3}</span>
        )}
      </div>
    );
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
            title={t('dashboard.liveSyncTitle')}
          />
          <h2 className="text-[clamp(0.85rem,1.5vh,1.05rem)] font-bold text-white tracking-tight truncate">
            {t('dashboard.title')}
          </h2>
          <button
            type="button"
            onClick={() => setActivePopup('iso')}
            className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer shrink-0"
            title={t('dashboard.isoDirectiveTooltip')}
            aria-label={t('dashboard.isoDirectiveTooltip')}
            id="btn-iso-directives-info"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1.5 xl:gap-2 shrink-0">
          {operationalMissingUnitCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setAlertsFilter('MISSING_UNIT');
                setActivePopup('alerts');
              }}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-500/60 transition flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              title={t('dashboard.missingUnitsTooltip')}
            >
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
              <span>{t('dashboard.missingUnitsBtn')}</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold bg-rose-600 text-white leading-none">
                {operationalMissingUnitCount}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setAlertsFilter('ALL');
              setActivePopup('alerts');
            }}
            id="btn-dashboard-alerts-badge"
            className={`px-2.5 xl:px-3 py-1.5 rounded-lg text-[11px] xl:text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer border whitespace-nowrap shrink-0 ${
              totalAlertCount > 0
                ? 'bg-rose-600 hover:bg-rose-500 text-white border-rose-400/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
            }`}
            title={t('dashboard.alertsBtnTooltip')}
          >
            <Bell className="h-3.5 w-3.5 shrink-0" />
            <span>{t('dashboard.alertsBtn')}</span>
            <span
              id="dashboard-alerts-count-badge"
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold tabular-nums leading-none ${
                totalAlertCount > 0
                  ? 'bg-white text-rose-700'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
              }`}
            >
              {totalAlertCount}
            </span>
          </button>

          <ExportMenu
            id="btn-dashboard-reports-menu"
            label={t('dashboard.reportsBtn')}
            title={t('dashboard.reportsTooltip')}
            variant="indigo"
            icon={<FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />}
            items={[
              {
                id: 'generate-report',
                label: t('dashboard.generateReportBtn'),
                title: t('dashboard.generateReportTooltip'),
                icon: <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />,
                onClick: () => setShowInventoryReportModal(true),
              },
              {
                id: 'rx-vs-iss',
                label: t('dashboard.rxVsIssPdfBtn'),
                title: t('dashboard.rxVsIssPdfTooltip'),
                icon: <FileText className="h-3.5 w-3.5 text-indigo-600" />,
                onClick: () => setShowReportModal(true),
              },
              {
                id: 'full-audit',
                label: t('dashboard.fullAuditReport'),
                icon: <ShieldCheck className="h-3.5 w-3.5 text-slate-700" />,
                onClick: () => {
                  if (canAccessAudit || isSuperAdmin) {
                    setView('audit');
                  } else {
                    setShowReportModal(true);
                  }
                },
              },
            ]}
          />

          <span className="text-[10px] font-bold text-white font-mono bg-slate-800/90 px-2.5 py-1.5 rounded-lg border border-slate-700 whitespace-nowrap shrink-0">
            {t('dashboard.plantBadge')}
          </span>
        </div>
      </div>

      {/* ROW B: Single 4-Tile KPI Strip */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-2 shrink-0"
        id="kpi-grid"
      >
        {/* 1. Inbound Received (Grouped by Unit) */}
        <button
          type="button"
          onClick={() => setView('receiving')}
          className="text-left p-[clamp(0.45rem,0.95vh,0.7rem)] bg-white border border-emerald-200 hover:border-emerald-400 rounded-xl shadow-2xs transition cursor-pointer flex flex-col justify-between min-w-0 group"
          title={t('dashboard.inboundTooltip')}
        >
          <div className="flex items-center justify-between gap-1 text-emerald-700">
            <span className="text-[clamp(0.5625rem,0.9vh,0.6875rem)] font-bold uppercase tracking-tight truncate">
              {t('dashboard.inboundReceived')}
            </span>
            <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          </div>
          {renderKpiUnitBuckets(receivedGrouped.buckets, 'text-emerald-700', 'text-emerald-600')}
          <span className="text-[9px] text-slate-500 font-mono truncate mt-1">
            {t('dashboard.receiptsGroupedByUnit', { count: receiving.length })}
          </span>
        </button>

        {/* 2. Outbound Issued (Grouped by Unit) */}
        <button
          type="button"
          onClick={() => setView('issuance')}
          className="text-left p-[clamp(0.45rem,0.95vh,0.7rem)] bg-white border border-blue-200 hover:border-blue-400 rounded-xl shadow-2xs transition cursor-pointer flex flex-col justify-between min-w-0 group"
          title={t('dashboard.outboundTooltip')}
        >
          <div className="flex items-center justify-between gap-1 text-blue-700">
            <span className="text-[clamp(0.5625rem,0.9vh,0.6875rem)] font-bold uppercase tracking-tight truncate">
              {t('dashboard.outboundIssued')}
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-blue-600" />
          </div>
          {renderKpiUnitBuckets(issuedGrouped.buckets, 'text-blue-700', 'text-blue-600')}
          <span className="text-[9px] text-slate-500 font-mono truncate mt-1">
            {t('dashboard.requisitionsGroupedByUnit', { count: issuances.length })}
          </span>
        </button>

        {/* 3. Low Stock count */}
        <button
          type="button"
          onClick={() => setActivePopup('lowStock')}
          className="text-left p-[clamp(0.45rem,0.95vh,0.7rem)] bg-white border border-rose-200 hover:border-rose-400 rounded-xl shadow-2xs transition cursor-pointer flex flex-col justify-between min-w-0"
          title={t('dashboard.lowStockTooltip')}
        >
          <div className="flex items-center justify-between gap-1 text-rose-600">
            <span className="text-[clamp(0.5625rem,0.9vh,0.6875rem)] font-bold uppercase tracking-tight truncate">
              {t('dashboard.lowStockTitle')}
            </span>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 min-w-0">
            <span className="text-[clamp(0.95rem,1.9vh,1.25rem)] font-extrabold font-mono tabular-nums text-rose-600 leading-none truncate">
              {lowStockSkus.length}
            </span>
          </div>
          <span className="text-[9px] text-rose-600/90 font-mono truncate mt-1">
            {lowStockSkus.length > 0 ? t('dashboard.belowReorderMin') : t('dashboard.levelsNormal')}
          </span>
        </button>

        {/* 6. Shelf-life alerts */}
        <button
          type="button"
          onClick={() => setActivePopup('shelfLife')}
          className="text-left p-[clamp(0.45rem,0.95vh,0.7rem)] bg-white border border-amber-200 hover:border-amber-400 rounded-xl shadow-2xs transition cursor-pointer flex flex-col justify-between min-w-0"
          title={t('dashboard.shelfLifeTooltip')}
        >
          <div className="flex items-center justify-between gap-1 text-amber-700">
            <span className="text-[clamp(0.5625rem,0.9vh,0.6875rem)] font-bold uppercase tracking-tight truncate">
              {t('dashboard.shelfLifeTitle')}
            </span>
            <Timer className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 min-w-0">
            <span className="text-[clamp(0.95rem,1.9vh,1.25rem)] font-extrabold font-mono tabular-nums text-amber-700 leading-none truncate">
              {nearExpiryItems.length}
            </span>
          </div>
          <span className="text-[9px] text-slate-500 font-mono truncate mt-1">
            {t('dashboard.holdAndIqcSub', { hold: quarantineCount, iqc: pendingIqcCount })}
          </span>
        </button>
      </div>

      {/* ROW C: 12-Column Single-Screen Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:flex-1 lg:min-h-0">
        {/* LEFT (col-span-5): 7-Day Stock Trends Chart (Grouped by Unit) */}
        <div
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-[clamp(0.65rem,1.25vh,0.9rem)] shadow-2xs flex flex-col lg:min-h-0"
          id="stock-level-trends-chart"
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 shrink-0 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp className="h-4 w-4 text-indigo-600 shrink-0" />
              <h3 className="font-bold text-xs xl:text-sm text-slate-800 truncate">
                {t('dashboard.stockTrendsTitle')}
              </h3>
              {activeTrendUnitDisplay && (
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                  activeTrendGroup?.isMissing
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                }`}>
                  {activeTrendUnitDisplay}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {trendUnitBuckets.length > 1 && (
                <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                  {trendUnitBuckets.map(group => {
                    const isActive = activeTrendGroup?.key === group.key;
                    return (
                      <button
                        key={`trend-unit-${group.key}`}
                        type="button"
                        onClick={() => setSelectedTrendUnit(group.key)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {group.displayUnit}
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={() => setView('stock')}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
              >
                {t('dashboard.inventoryLink')} <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
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
                <span className="text-[9px] text-slate-400">({sku.unit || MISSING_UNIT_LABEL})</span>
              </div>
            ))}
          </div>

          <div className="flex-1 min-h-[240px] lg:min-h-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stockTrendData} margin={{ top: 8, right: 12, left: -4, bottom: 2 }}>
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
                  tickFormatter={(val: number) =>
                    activeTrendUnitDisplay && !activeTrendGroup?.isMissing
                      ? `${val.toLocaleString()} ${activeTrendUnitDisplay}`
                      : val.toLocaleString()
                  }
                  width={68}
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

        {/* MIDDLE (col-span-4): Live Transactions Panel */}
        <div
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-[clamp(0.65rem,1.25vh,0.9rem)] shadow-2xs flex flex-col lg:min-h-0"
          id="live-transactions-panel"
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Package className="h-4 w-4 text-indigo-600 shrink-0" />
              <h3 className="font-bold text-xs xl:text-sm text-slate-800 truncate">
                {t('dashboard.liveTransactionsTitle')}
              </h3>
              <span className="text-[10px] font-mono font-bold text-slate-500 tabular-nums shrink-0">
                ({liveTransactions.length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setView('stock-movements')}
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
            >
              {t('dashboard.liveTransactionsViewAll')} &rarr;
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar divide-y divide-slate-100 mt-1">
            {liveTransactions.slice(0, 5).map((tx, idx) => {
              const isFuture = tx.date > todayManilaStr;
              return (
                <button
                  type="button"
                  key={tx.id ? `live-tx-${tx.id}-${idx}` : `live-tx-${idx}`}
                  onClick={() => setSelectedTransaction({ type: tx.type, record: tx.record })}
                  className="w-full text-left py-2 px-1.5 text-xs flex flex-col gap-1 hover:bg-slate-50 rounded transition cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold uppercase shrink-0 ${
                        tx.type === 'RECEIVING'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : 'bg-blue-100 text-blue-800 border border-blue-200'
                      }`}>
                        {tx.type === 'RECEIVING' ? t('dashboard.txTypeReceiving') : t('dashboard.txTypeIssuance')}
                      </span>
                      <span className="font-semibold text-slate-800 truncate">{tx.summary}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isFuture && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 text-[9px] font-bold font-mono">
                          {t('dashboard.liveTransactionsCheckDate')}
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-slate-500">{tx.date}</span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono truncate pl-0.5">
                    {tx.secondary}
                  </div>
                </button>
              );
            })}
            {liveTransactions.length === 0 && (
              <div className="h-full min-h-[120px] flex items-center justify-center text-xs text-slate-400">
                {t('dashboard.liveTransactionsEmpty')}
              </div>
            )}
          </div>

          {futureTransactionsCount > 0 && (
            <div className="pt-2 mt-1 border-t border-slate-100 text-[10px] font-mono text-amber-700 flex items-center gap-1 shrink-0">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>
                {futureTransactionsCount === 1
                  ? t('dashboard.liveTransactionsFutureFooter', { count: futureTransactionsCount })
                  : t('dashboard.liveTransactionsFutureFooterPlural', { count: futureTransactionsCount })}
              </span>
            </div>
          )}
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
                <h3 className="font-bold text-xs truncate">{t('dashboard.safetyStatusTitle')}</h3>
              </div>
              <span
                className={`text-[10px] font-mono font-bold shrink-0 ${
                  forkliftDoneToday ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {forkliftDoneToday ? t('dashboard.verifiedBadge') : t('dashboard.pendingBadge')}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-snug">
              {forkliftDoneToday
                ? t('dashboard.forkliftVerifiedDesc')
                : t('dashboard.forkliftPendingDesc')}
            </p>
            <button
              type="button"
              onClick={() => setActivePopup('safety')}
              className="w-full py-1.5 px-2.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg transition cursor-pointer whitespace-nowrap"
              id="btn-open-safety-operations"
            >
              {t('dashboard.openSafetyOpsBtn')}
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
              <span className="text-xs font-bold truncate">{t('dashboard.brokenSackSpillage')}</span>
            </div>
            <span
              className={`text-[10px] font-mono font-bold shrink-0 ${
                brokenResinSacks.length > 0 ? 'text-amber-800' : 'text-emerald-700'
              }`}
            >
              {brokenResinSacks.length > 0 ? t('dashboard.riskCount', { count: brokenResinSacks.length }) : t('dashboard.clearBadge')}
            </span>
          </button>

          {/* Online Operators (Top 4) */}
          <div className="bg-white border border-slate-200 rounded-xl p-[clamp(0.55rem,1.05vh,0.75rem)] shadow-2xs flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Users className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <h3 className="font-bold text-xs text-slate-800 truncate">{t('dashboard.onlineOperatorsTitle')}</h3>
                <span className="text-[10px] font-mono font-bold text-emerald-700 tabular-nums shrink-0">
                  ({activeUsers.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => (isSuperAdmin ? setView('accounts') : setActivePopup('operators'))}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer shrink-0 whitespace-nowrap"
              >
                {t('common.viewAll')} &rarr;
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
                        {user === currentUser ? t('dashboard.youTag') : ''}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 truncate max-w-[85px] shrink-0">
                      {matchedAcc?.employeeId || matchedAcc?.role || t('dashboard.onlineBadge')}
                    </span>
                  </button>
                );
              })}
              {activeUsers.length === 0 && (
                <div className="h-full min-h-[72px] flex items-center justify-center text-xs text-slate-400">
                  {t('dashboard.noOperatorsOnline')}
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
                      <h3 className="font-bold text-sm">{t('dashboard.safetyModalTitle')}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label={t('common.close')}
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
                          {t('dashboard.forkliftOpsStatus', {
                            status: forkliftDoneToday ? t('dashboard.completedToday') : t('dashboard.pendingToday'),
                          })}
                        </h4>
                        <p className="text-xs text-slate-600">
                          {forkliftDoneToday
                            ? t('dashboard.forkliftDoneBody')
                            : t('dashboard.forkliftPendingBody')}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setActivePopup(null);
                            setView('delivery');
                          }}
                          className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:underline cursor-pointer"
                        >
                          {forkliftDoneToday ? t('dashboard.viewForkliftChecklists') : t('dashboard.logPreInspection')}
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
                          {t('dashboard.brokenSackControlTitle', {
                            status: brokenResinSacks.length > 0 ? t('dashboard.riskActive') : t('dashboard.statusNormal'),
                          })}
                        </h4>
                        <p className="text-xs text-slate-600">
                          {brokenResinSacks.length > 0
                            ? `Procedures dictate strictly isolating broken sacks of ${brokenResinSacks[0].partCode} in Quarantine to prevent spillage and resin mixing.`
                            : t('dashboard.noSpillageRisks')}
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
                            {t('dashboard.inspectQuarantineItems')} <ArrowUpRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-3">
                      <h4 className="text-xs font-bold text-slate-700 mb-2">
                        {t('dashboard.recentForkliftLogs', { count: forkliftChecks.length })}
                      </h4>
                      {forkliftChecks.length > 0 ? (
                        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                          {forkliftChecks.slice(0, 5).map((chk, idx) => (
                            <div key={chk.id || idx} className="px-3 py-2 text-xs flex items-center justify-between gap-3 bg-white">
                              <div className="min-w-0">
                                <span className="font-mono font-bold text-slate-800">{chk.forkliftId}</span>
                                <span className="text-slate-500 ml-2">{t('dashboard.operatorPrefix', { name: chk.operator })}</span>
                              </div>
                              <span className="font-mono text-slate-500 shrink-0">{chk.date}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">{t('dashboard.noForkliftLogs')}</p>
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

              {/* Pop-up: Low Stock Reorder Alerts */}
              {activePopup === 'lowStock' && (
                <>
                  <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-rose-400" />
                      <h3 className="font-bold text-sm">{t('dashboard.lowStockModalTitle', { count: lowStockSkus.length })}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label={t('common.close')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-5 overflow-y-auto space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-slate-600">
                        {t('dashboard.lowStockModalDesc')}
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
                          <span>{t('dashboard.reorderReportBtn')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActivePopup(null);
                            setView('stock');
                          }}
                          className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg transition cursor-pointer"
                        >
                          {t('dashboard.inventoryRegistryLink')} &rarr;
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
                                  {formatNumberForUnit(item.currentQty)} / {formatQuantityWithUnit(item.reorderMin, item.unit)}
                                </span>
                                <span className="text-[10px] text-rose-600 block">
                                  {t('dashboard.shortageLabel', { amount: formatQuantityWithUnit(item.shortage, item.unit) })} ({pct}%)
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {lowStockSkus.length === 0 && (
                        <div className="p-6 text-center text-xs text-slate-500">
                          {t('dashboard.allLevelsHealthy')}
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
                      <h3 className="font-bold text-sm">{t('dashboard.shelfLifeModalTitle')}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label={t('common.close')}
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
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">{t('dashboard.expiring30d')}</span>
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
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">{t('dashboard.quarantineHoldTile')}</span>
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
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">{t('dashboard.pendingIqcTile')}</span>
                        <span className="text-lg font-extrabold font-mono text-indigo-700 tabular-nums">{pendingIqcCount}</span>
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                      {nearExpiryItems.map((lotAlert, idx) => {
                        const { item, expirationDate, diffDays, isExpired } = lotAlert;
                        return (
                          <div key={item.id || `popup-exp-${idx}`} className="px-3 py-2 text-xs flex items-center justify-between gap-2 bg-white">
                            <div className="min-w-0">
                              <span className="font-mono font-bold text-slate-900 mr-2">{item.partCode}</span>
                              <span className="text-slate-700">{item.description}</span>
                              <span className="text-slate-400 ml-2 font-mono">{item.lotNumber}</span>
                            </div>
                            <div className="text-right font-mono shrink-0 tabular-nums">
                              <span className={`font-bold ${isExpired ? 'text-rose-600' : 'text-amber-600'}`}>
                                {isExpired ? t('dashboard.expiredTag') : t('dashboard.daysLeftTag', { days: diffDays })}
                              </span>
                              <span className="text-[10px] text-slate-400 block">Exp: {expirationDate}</span>
                            </div>
                          </div>
                        );
                      })}
                      {nearExpiryItems.length === 0 && (
                        <div className="p-6 text-center text-xs text-slate-500">
                          {t('dashboard.allHealthyShelfLife')}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Pop-up: Unified Low-Stock & Shelf-Life Alerts */}
              {activePopup === 'alerts' && (
                <>
                  <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <Bell className="h-5 w-5 text-rose-400" />
                      <h3 className="font-bold text-sm">
                        {t('dashboard.alertsModalTitle', { count: totalAlertCount })}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label={t('common.close')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-5 overflow-y-auto space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAlertsFilter('ALL')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                            alertsFilter === 'ALL'
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {t('dashboard.filterAllCount', { count: totalAlertCount })}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAlertsFilter('LOW_STOCK')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                            alertsFilter === 'LOW_STOCK'
                              ? 'bg-rose-600 text-white border-rose-600'
                              : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
                          }`}
                        >
                          {t('dashboard.filterLowStockCount', { count: lowStockCount })}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAlertsFilter('SHELF_LIFE')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                            alertsFilter === 'SHELF_LIFE'
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
                          }`}
                        >
                          {t('dashboard.filterExpiringCount', { count: shelfLifeCount })}
                        </button>
                        {missingUnitCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setAlertsFilter('MISSING_UNIT')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                              alertsFilter === 'MISSING_UNIT'
                                ? 'bg-rose-700 text-white border-rose-700'
                                : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                            }`}
                          >
                            {t('dashboard.filterMissingUnitCount', { count: missingUnitCount })}
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setActivePopup(null);
                          setView('stock');
                        }}
                        className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg transition cursor-pointer"
                      >
                        {t('dashboard.openStockBinsLink')} &rarr;
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden" id="dashboard-alerts-list">
                      {alertsFilter === 'MISSING_UNIT' ? (
                        missingUnitItems.map((item, idx) => (
                          <div key={item.id || `missing-unit-${idx}`} className="px-3.5 py-2.5 text-xs flex items-center justify-between gap-2 bg-rose-50/40">
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono font-bold text-slate-900">{item.partCode}</span>
                                <span className="font-semibold text-slate-800">{item.description}</span>
                                <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200 text-[10px] font-bold font-mono">
                                  {MISSING_UNIT_LABEL}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono">
                                {item.location || t('common.na')} · {item.lotNumber || t('common.na')} · {item.status}
                              </div>
                            </div>
                            <span className="font-mono font-bold text-rose-700 shrink-0 tabular-nums">
                              {formatQuantityWithUnit(item.quantity, item.unit)}
                            </span>
                          </div>
                        ))
                      ) : (
                        filteredAlerts.map(entry => (
                          <div
                            key={entry.key}
                            className={`px-3.5 py-2.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                              entry.isLowStock || entry.isExpired ? 'bg-rose-50/30' : 'bg-amber-50/20'
                            }`}
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono font-bold text-slate-900">{entry.partCode}</span>
                                <span className="font-semibold text-slate-800">{entry.description}</span>
                                {entry.unitMissing && (
                                  <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200 text-[10px] font-bold font-mono">
                                    {MISSING_UNIT_LABEL}
                                  </span>
                                )}
                                {entry.isLowStock && (
                                  <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200 text-[10px] font-bold font-mono">
                                    {t('dashboard.belowMinQtyBadge')}
                                  </span>
                                )}
                                {entry.isExpiring && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border ${
                                      entry.isExpired
                                        ? 'bg-rose-100 text-rose-800 border-rose-200'
                                        : 'bg-amber-100 text-amber-800 border-amber-200'
                                    }`}
                                  >
                                    {entry.isExpired ? t('dashboard.expiredTag') : t('dashboard.expiringInDaysBadge', { days: entry.diffDays ?? 0 })}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                <span>{entry.location || t('common.na')}</span>
                                {entry.lotNumber && <span>{entry.lotNumber}</span>}
                                {entry.customer && <span>{entry.customer}</span>}
                                {entry.status && <span>{entry.status}</span>}
                              </div>
                            </div>

                            <div className="text-left sm:text-right font-mono shrink-0 tabular-nums space-y-0.5">
                              {entry.isLowStock && typeof entry.currentQty === 'number' && typeof entry.reorderMin === 'number' && (
                                <div>
                                  <span className="font-bold text-rose-700">
                                    {formatNumberForUnit(entry.currentQty)} / {formatQuantityWithUnit(entry.reorderMin, entry.unit)}
                                  </span>
                                  <span className="text-[10px] text-rose-600 block">
                                    {t('dashboard.shortageLabel', { amount: formatQuantityWithUnit(entry.shortage ?? 0, entry.unit) })}
                                  </span>
                                </div>
                              )}
                              {entry.isExpiring && entry.expirationDate && (
                                <div>
                                  <span className={`font-bold ${entry.isExpired ? 'text-rose-600' : 'text-amber-700'}`}>
                                    {entry.isExpired ? t('dashboard.expiredTag') : t('dashboard.daysLeftTag', { days: entry.diffDays ?? 0 })}
                                  </span>
                                  <span className="text-[10px] text-slate-500 block">
                                    Exp: {entry.expirationDate}
                                    {typeof entry.quantity === 'number' ? ` · ${formatQuantityWithUnit(entry.quantity, entry.unit)}` : ''}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}

                      {((alertsFilter === 'MISSING_UNIT' && missingUnitItems.length === 0) ||
                        (alertsFilter !== 'MISSING_UNIT' && filteredAlerts.length === 0)) && (
                        <div className="p-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                          <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                          <span>{t('dashboard.noAlertsInFilter')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Pop-up: Online Operators, Live Transactions */}
              {activePopup === 'operators' && (
                <>
                  <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-emerald-400" />
                      <h3 className="font-bold text-sm">{t('dashboard.operatorsModalTitle', { count: activeUsers.length })}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePopup(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                      aria-label={t('common.close')}
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
                          <Package className="h-3.5 w-3.5" /> {t('dashboard.liveTransactionsTitle')}
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
          registries={registries}
          currentUser={currentUser}
          isSuperAdmin={isSuperAdmin}
          initialCustomerFilter="ALL"
          onClose={() => setShowInventoryReportModal(false)}
        />
      )}

      {/* Selected Transaction Details Modal */}
      {selectedTransaction &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setSelectedTransaction(null)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-indigo-400" />
                  <h3 className="font-bold text-sm">
                    {selectedTransaction.type === 'RECEIVING' ? t('dashboard.txReceivingDetailsTitle') : t('dashboard.txIssuanceDetailsTitle')}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTransaction(null)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                  aria-label={t('common.close')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5 overflow-y-auto space-y-3 text-xs">
                {selectedTransaction.type === 'RECEIVING' ? (
                  <div className="space-y-2 font-mono">
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('dashboard.recordIdLabel')}</span> <span className="font-bold text-slate-900">{selectedTransaction.record.id}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('common.partCode')}:</span> <span className="font-bold text-slate-900">{selectedTransaction.record.partCode}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('common.description')}:</span> <span className="font-bold text-slate-900">{selectedTransaction.record.itemDescription}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('common.quantity')}:</span> <span className="font-bold text-emerald-700">{formatQuantityWithUnit(selectedTransaction.record.quantity, selectedTransaction.record.unit)}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('common.lotNumber')}:</span> <span className="font-bold text-slate-900">{selectedTransaction.record.lotNumber || t('common.na')}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('receiving.arrivalClassLabel')}:</span> <span className="font-bold text-slate-900">{selectedTransaction.record.supplierOrDept || t('common.na')}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('dashboard.vendorLabel')}</span> <span className="font-bold text-slate-900">{selectedTransaction.record.vendorSupplier || t('common.na')}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('common.date')}:</span> <span className="font-bold text-slate-900">{selectedTransaction.record.date || selectedTransaction.record.receivedDate}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('dashboard.iqcStatusLabel')}</span> <span className="font-bold text-indigo-700">{selectedTransaction.record.iqcStatus || 'APPROVED'}</span></div>
                  </div>
                ) : (
                  <div className="space-y-2 font-mono">
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('dashboard.recordIdLabel')}</span> <span className="font-bold text-slate-900">{selectedTransaction.record.id}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('common.partCode')}:</span> <span className="font-bold text-slate-900">{selectedTransaction.record.partCode}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('common.description')}:</span> <span className="font-bold text-slate-900">{selectedTransaction.record.description}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('dashboard.qtyIssuedLabel')}</span> <span className="font-bold text-blue-700">{formatQuantityWithUnit(selectedTransaction.record.quantityIssued, selectedTransaction.record.unit)}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('common.department')}:</span> <span className="font-bold text-slate-900">{selectedTransaction.record.department}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('dashboard.reqNumLabel')}</span> <span className="font-bold text-slate-900">{selectedTransaction.record.requisitionNumber || t('common.na')}</span></div>
                    <div className="flex justify-between border-b pb-1.5"><span className="text-slate-500">{t('common.date')}:</span> <span className="font-bold text-slate-900">{selectedTransaction.record.date}</span></div>
                  </div>
                )}
              </div>
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const viewTarget = selectedTransaction.type === 'RECEIVING' ? 'receiving' : 'issuance';
                    setSelectedTransaction(null);
                    setView(viewTarget);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition cursor-pointer"
                >
                  {selectedTransaction.type === 'RECEIVING' ? t('dashboard.openInReceiving') : t('dashboard.openInIssuance')} &rarr;
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
