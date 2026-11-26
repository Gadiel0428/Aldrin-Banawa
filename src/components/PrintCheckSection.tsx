/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Printer,
  ScanLine,
  CheckCircle2,
  XCircle,
  RefreshCw,
  FileText,
  ClipboardList,
  Truck,
  QrCode,
  Download,
  Search,
  Eye,
  Loader2,
  Save,
  AlertCircle,
} from 'lucide-react';
import type {
  PrintCheckDocVerification,
  PrintCheckDocumentType,
  PrintCheckLogEntry,
} from '../../shared/types';
import { useI18n } from '../i18n';
import { getManilaTodayString } from '../lib/businessDate';
import { getApiBaseUrl, getAuthHeaders } from '../config/serverConfig';
import {
  renderDocumentPages,
  printPages,
  showPrintToast,
  formatPrintErrorMessage,
} from '../utils/printDocument';
import {
  PRINT_CHECK_DOC_TYPES,
  createSamplePrintCheckCodes,
  doesScannedBarcodeMatch,
  evaluatePrintCheckVerification,
  extractScannedPrintCheckCode,
  loadCachedPrintCheckLogs,
  loadRecentPrinters,
  saveCachedPrintCheckLogs,
  saveRecentPrinter,
} from '../utils/printCheck';
import { Code128Barcode } from './Code128Barcode';
import BarcodeScannerModal from './BarcodeScannerModal';
import PrintPreviewModal from './PrintPreviewModal';

export interface PrintCheckSectionProps {
  currentUser: string;
  currentEmployeeId: string;
  currentRole: string;
  stationId?: string;
  canEdit: boolean;
}

interface DocMetaInfo {
  type: PrintCheckDocumentType;
  titleKey:
    | 'settings.docRequisitionTitle'
    | 'settings.docPickingListTitle'
    | 'settings.docGatePassTitle'
    | 'settings.docQrBadgeTitle';
  subKey:
    | 'settings.docRequisitionSub'
    | 'settings.docPickingListSub'
    | 'settings.docGatePassSub'
    | 'settings.docQrBadgeSub';
  icon: React.ComponentType<{ className?: string }>;
}

const DOC_META: readonly DocMetaInfo[] = [
  {
    type: 'REQUISITION',
    titleKey: 'settings.docRequisitionTitle',
    subKey: 'settings.docRequisitionSub',
    icon: FileText,
  },
  {
    type: 'PICKING_LIST',
    titleKey: 'settings.docPickingListTitle',
    subKey: 'settings.docPickingListSub',
    icon: ClipboardList,
  },
  {
    type: 'GATE_PASS',
    titleKey: 'settings.docGatePassTitle',
    subKey: 'settings.docGatePassSub',
    icon: Truck,
  },
  {
    type: 'QR_BADGE',
    titleKey: 'settings.docQrBadgeTitle',
    subKey: 'settings.docQrBadgeSub',
    icon: QrCode,
  },
];

export const PrintCheckSection: React.FC<PrintCheckSectionProps> = ({
  currentUser,
  currentEmployeeId,
  currentRole,
  stationId,
  canEdit,
}) => {
  const { t, dateLocale } = useI18n();
  const checkDate = getManilaTodayString();

  const [sampleCodes, setSampleCodes] = useState<Record<PrintCheckDocumentType, string>>(() =>
    createSamplePrintCheckCodes(checkDate)
  );
  const [scannedByType, setScannedByType] = useState<
    Record<PrintCheckDocumentType, { scannedCode: string; confirmedMatch: boolean; scannedAt?: string }>
  >({
    REQUISITION: { scannedCode: '', confirmedMatch: false },
    PICKING_LIST: { scannedCode: '', confirmedMatch: false },
    GATE_PASS: { scannedCode: '', confirmedMatch: false },
    QR_BADGE: { scannedCode: '', confirmedMatch: false },
  });

  const [recentPrinters, setRecentPrinters] = useState<string[]>(() => loadRecentPrinters());
  const [printer, setPrinter] = useState<string>(() => loadRecentPrinters()[0] || '');
  const [notes, setNotes] = useState<string>('');
  const [activeScanDoc, setActiveScanDoc] = useState<PrintCheckDocumentType | null>(null);

  const [isPrintingAll, setIsPrintingAll] = useState<boolean>(false);
  const [isPreviewRendering, setIsPreviewRendering] = useState<boolean>(false);
  const [printingSingleDoc, setPrintingSingleDoc] = useState<PrintCheckDocumentType | null>(null);
  const [previewPages, setPreviewPages] = useState<string[]>([]);
  const [showPreviewModal, setShowPreviewModal] = useState<boolean>(false);

  const [isSavingLog, setIsSavingLog] = useState<boolean>(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(true);
  const [logs, setLogs] = useState<PrintCheckLogEntry[]>(() =>
    loadCachedPrintCheckLogs<PrintCheckLogEntry>()
  );
  const [logSearch, setLogSearch] = useState<string>('');
  const [logStatusFilter, setLogStatusFilter] = useState<'ALL' | 'PASS' | 'FAIL'>('ALL');

  const docRefs = useRef<Record<PrintCheckDocumentType, HTMLDivElement | null>>({
    REQUISITION: null,
    PICKING_LIST: null,
    GATE_PASS: null,
    QR_BADGE: null,
  });

  const fetchLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/print-check-logs`, {
        cache: 'no-store',
        headers: getAuthHeaders({ Accept: 'application/json' }),
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.logs)) {
          setLogs(json.logs);
          saveCachedPrintCheckLogs(json.logs);
        }
      }
    } catch {
      // Keep local cached logs if offline
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const verificationDocs: PrintCheckDocVerification[] = useMemo(
    () =>
      PRINT_CHECK_DOC_TYPES.map((docType) => ({
        docType,
        expectedCode: sampleCodes[docType],
        scannedCode: scannedByType[docType].scannedCode,
        confirmedMatch: scannedByType[docType].confirmedMatch,
        ...(scannedByType[docType].scannedAt ? { scannedAt: scannedByType[docType].scannedAt } : {}),
      })),
    [sampleCodes, scannedByType]
  );

  const evaluation = useMemo(
    () => evaluatePrintCheckVerification(verificationDocs),
    [verificationDocs]
  );

  const handleResetSamples = () => {
    setSampleCodes(createSamplePrintCheckCodes(getManilaTodayString()));
    setScannedByType({
      REQUISITION: { scannedCode: '', confirmedMatch: false },
      PICKING_LIST: { scannedCode: '', confirmedMatch: false },
      GATE_PASS: { scannedCode: '', confirmedMatch: false },
      QR_BADGE: { scannedCode: '', confirmedMatch: false },
    });
    setNotes('');
  };

  const renderAllSamplePages = async (): Promise<string[]> => {
    const pages: string[] = [];
    for (const docType of PRINT_CHECK_DOC_TYPES) {
      const el = docRefs.current[docType];
      if (!el) continue;
      const rendered = await renderDocumentPages(el);
      pages.push(...rendered);
    }
    return pages;
  };

  const handlePrintAllSamples = async () => {
    if (isPrintingAll || isPreviewRendering) return;
    setIsPrintingAll(true);
    try {
      const pages = await renderAllSamplePages();
      if (pages.length === 0) {
        showPrintToast(t('toasts.printableContainerNotFound'), 'error');
        return;
      }
      await printPages(pages);
      showPrintToast(t('settings.printPreparedToast'), 'info');
    } catch (err) {
      showPrintToast(formatPrintErrorMessage(err), 'error');
    } finally {
      setIsPrintingAll(false);
    }
  };

  const handlePreviewAllSamples = async () => {
    if (isPreviewRendering || isPrintingAll) return;
    setIsPreviewRendering(true);
    try {
      const pages = await renderAllSamplePages();
      if (pages.length === 0) {
        showPrintToast(t('toasts.printableContainerNotFound'), 'error');
        return;
      }
      setPreviewPages(pages);
      setShowPreviewModal(true);
    } catch (err) {
      showPrintToast(formatPrintErrorMessage(err), 'error');
    } finally {
      setIsPreviewRendering(false);
    }
  };

  const handlePrintSingleSample = async (docType: PrintCheckDocumentType) => {
    const el = docRefs.current[docType];
    if (!el || printingSingleDoc) return;
    setPrintingSingleDoc(docType);
    try {
      const pages = await renderDocumentPages(el);
      if (pages.length === 0) {
        showPrintToast(t('toasts.printableContainerNotFound'), 'error');
        return;
      }
      await printPages(pages);
      const meta = DOC_META.find((d) => d.type === docType);
      showPrintToast(
        t('settings.singlePrintPreparedToast', { doc: meta ? t(meta.titleKey) : docType }),
        'info'
      );
    } catch (err) {
      showPrintToast(formatPrintErrorMessage(err), 'error');
    } finally {
      setPrintingSingleDoc(null);
    }
  };

  const handleScanComplete = (rawCode: string) => {
    if (!activeScanDoc) return;
    const normalized = extractScannedPrintCheckCode(rawCode);
    setScannedByType((prev) => ({
      ...prev,
      [activeScanDoc]: {
        scannedCode: normalized,
        confirmedMatch: false, // Operator explicitly confirms match after inspecting
        scannedAt: new Date().toISOString(),
      },
    }));
    setActiveScanDoc(null);
  };

  const handleToggleConfirmMatch = (docType: PrintCheckDocumentType) => {
    const expected = sampleCodes[docType];
    const current = scannedByType[docType];
    if (!doesScannedBarcodeMatch(expected, current.scannedCode)) return;
    setScannedByType((prev) => ({
      ...prev,
      [docType]: {
        ...prev[docType],
        confirmedMatch: !prev[docType].confirmedMatch,
      },
    }));
  };

  const handleSaveLog = async () => {
    if (!canEdit) {
      showPrintToast(t('settings.viewOnlyDisabled'), 'error');
      return;
    }
    const cleanPrinter = printer.trim();
    if (!cleanPrinter) {
      showPrintToast(t('settings.printerRequiredErr'), 'warning');
      return;
    }
    const anyScanned = verificationDocs.some(
      (d) => extractScannedPrintCheckCode(d.scannedCode).length > 0
    );
    if (!anyScanned) {
      showPrintToast(t('settings.scanAtLeastOneErr'), 'warning');
      return;
    }

    setIsSavingLog(true);
    try {
      const updatedRecent = saveRecentPrinter(cleanPrinter);
      setRecentPrinters(updatedRecent);

      const baseUrl = getApiBaseUrl();
      const payload = {
        checkedDate: checkDate,
        printer: cleanPrinter,
        operatorName: currentUser || 'OPERATOR',
        operatorEmployeeId: currentEmployeeId || '',
        stationId,
        documents: verificationDocs,
        notes: notes.trim() || undefined,
      };

      const res = await fetch(`${baseUrl}/api/print-check-logs`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      const nextLogs: PrintCheckLogEntry[] = Array.isArray(json?.logs)
        ? json.logs
        : json?.entry
        ? [json.entry, ...logs]
        : logs;
      setLogs(nextLogs);
      saveCachedPrintCheckLogs(nextLogs);

      if (evaluation.overallStatus === 'PASS') {
        showPrintToast(t('settings.logSavedPassToast', { printer: cleanPrinter }), 'info');
        handleResetSamples();
      } else {
        showPrintToast(
          t('settings.logSavedFailToast', {
            printer: cleanPrinter,
            matched: evaluation.matchedCount,
          }),
          'warning'
        );
      }
    } catch (err: any) {
      showPrintToast(err?.message || t('common.unknownError'), 'error');
    } finally {
      setIsSavingLog(false);
    }
  };

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return logs.filter((entry) => {
      if (logStatusFilter !== 'ALL' && entry.overallStatus !== logStatusFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        entry.checkedDate,
        entry.printer,
        entry.operatorName,
        entry.operatorEmployeeId,
        entry.overallStatus,
        ...(entry.documents || []).flatMap((d) => [d.docType, d.expectedCode, d.scannedCode]),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [logs, logSearch, logStatusFilter]);

  const handleExportLogsCsv = () => {
    if (filteredLogs.length === 0) return;
    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Timestamp', 'Printer', 'Operator', 'Employee ID', 'Matched', 'Status', 'Documents'];
    const rows = filteredLogs.map((row) => [
      row.checkedDate,
      row.checkedAt,
      row.printer,
      row.operatorName,
      row.operatorEmployeeId,
      `${row.matchedCount}/${row.totalCount}`,
      row.overallStatus,
      (row.documents || [])
        .map((d) => `${d.docType}:${d.expectedCode}->${d.scannedCode || 'NONE'}(${d.confirmedMatch ? 'OK' : 'FAIL'})`)
        .join(' | '),
    ]);
    const csv = [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `juwei-print-check-logs-${checkDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activeScanMeta = DOC_META.find((d) => d.type === activeScanDoc);

  return (
    <section
      id="settings-print-check-section"
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
    >
      {/* Section Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-slate-50/70">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Printer className="h-4.5 w-4.5 text-indigo-600 shrink-0" />
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              {t('settings.printCheckTitle')}
            </h2>
            <span className="text-xs font-mono font-semibold text-slate-600 tabular-nums border-l border-slate-300 pl-2.5">
              {t('settings.summaryReady', { confirmed: evaluation.matchedCount })}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1 max-w-3xl">
            {t('settings.printCheckSubtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleResetSamples}
            id="btn-print-check-new-samples"
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{t('settings.newSamplesBtn')}</span>
          </button>

          <button
            type="button"
            onClick={handlePreviewAllSamples}
            disabled={isPreviewRendering || isPrintingAll}
            id="btn-print-check-preview-all"
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isPreviewRendering ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            <span>{t('settings.previewAllBtn')}</span>
          </button>

          <button
            type="button"
            onClick={handlePrintAllSamples}
            disabled={isPrintingAll || isPreviewRendering}
            id="btn-print-check-print-all"
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isPrintingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Printer className="h-3.5 w-3.5" />
            )}
            <span>
              {isPrintingAll ? t('settings.printingAllBtn') : t('settings.printAllBtn')}
            </span>
          </button>
        </div>
      </div>

      {/* Metadata Strip: Printer, Check Date, Operator */}
      <div className="px-5 py-4 border-b border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-4 bg-white">
        <div className="md:col-span-6 space-y-1.5">
          <label
            htmlFor="input-print-check-printer"
            className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600"
          >
            {t('settings.printerLabel')} <span className="text-rose-600">*</span>
          </label>
          <input
            id="input-print-check-printer"
            type="text"
            list="recent-printers-list"
            value={printer}
            onChange={(e) => setPrinter(e.target.value)}
            placeholder={t('settings.printerPlaceholder')}
            className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
          />
          <datalist id="recent-printers-list">
            {recentPrinters.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {recentPrinters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] text-slate-500">
              <span>{t('settings.recentPrintersLabel')}</span>
              {recentPrinters.slice(0, 4).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPrinter(p)}
                  className="text-indigo-700 hover:underline font-medium cursor-pointer"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="md:col-span-3 space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            {t('settings.checkDateLabel')}
          </span>
          <div className="h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center text-xs font-mono font-semibold text-slate-800 tabular-nums">
            {checkDate}
          </div>
        </div>

        <div className="md:col-span-3 space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            {t('settings.operatorLabel')}
          </span>
          <div className="h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-2 text-xs font-medium text-slate-800 truncate">
            <span className="truncate">{currentUser || 'OPERATOR'}</span>
            {currentEmployeeId && (
              <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                {currentEmployeeId}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 4 Sample Document Verification Cards */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/40">
        {DOC_META.map((doc) => {
          const Icon = doc.icon;
          const expectedCode = sampleCodes[doc.type];
          const state = scannedByType[doc.type];
          const hasScan = extractScannedPrintCheckCode(state.scannedCode).length > 0;
          const isMatch = hasScan && doesScannedBarcodeMatch(expectedCode, state.scannedCode);
          const isConfirmed = isMatch && state.confirmedMatch;

          return (
            <div
              key={doc.type}
              id={`print-check-card-${doc.type.toLowerCase()}`}
              className={`rounded-xl border p-4 bg-white flex flex-col justify-between gap-3.5 transition-colors ${
                isConfirmed
                  ? 'border-emerald-300'
                  : hasScan && !isMatch
                  ? 'border-rose-300'
                  : isMatch
                  ? 'border-indigo-300'
                  : 'border-slate-200'
              }`}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="h-8 w-8 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-700 shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900 leading-tight">
                      {t(doc.titleKey)}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {t(doc.subKey)}
                    </p>
                  </div>
                </div>

                <div className="text-[11px] font-semibold shrink-0 flex items-center gap-1">
                  {isConfirmed ? (
                    <span className="text-emerald-700 inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('settings.confirmedBadge')}
                    </span>
                  ) : hasScan && !isMatch ? (
                    <span className="text-rose-700 inline-flex items-center gap-1">
                      <XCircle className="h-3.5 w-3.5" />
                      {t('settings.scannedValueLabel')}
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      {isMatch ? t('settings.confirmMatchBtn') : t('settings.awaitingScan')}
                    </span>
                  )}
                </div>
              </div>

              {/* Expected On-Screen Barcode + Live Symbology Preview */}
              <div className="border-t border-b border-slate-100 py-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {t('settings.onScreenValueLabel')}
                  </span>
                  <span
                    data-testid={`expected-code-${doc.type}`}
                    className="font-mono text-xs font-bold text-slate-900 tabular-nums select-all"
                  >
                    {expectedCode}
                  </span>
                </div>

                <div className="flex items-center justify-center py-1.5 border border-slate-200 rounded-lg bg-white overflow-hidden">
                  {doc.type === 'QR_BADGE' ? (
                    <div className="flex items-center gap-3 py-1">
                      <QRCodeSVG
                        value={expectedCode}
                        size={64}
                        level="M"
                        includeMargin={true}
                      />
                      <div className="text-[11px] text-slate-600 font-mono tabular-nums">
                        <div className="font-bold text-slate-900">{currentUser || 'OPERATOR'}</div>
                        <div>{currentEmployeeId || 'JPMP-OPERATOR'}</div>
                      </div>
                    </div>
                  ) : (
                    <Code128Barcode value={expectedCode} height={38} barWidth={1.6} showText={false} />
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {t('settings.scannedValueLabel')}
                  </span>
                  <span
                    data-testid={`scanned-code-${doc.type}`}
                    className={`font-mono text-xs font-semibold tabular-nums ${
                      !hasScan
                        ? 'text-slate-400'
                        : isMatch
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {hasScan ? state.scannedCode : t('settings.awaitingScan')}
                  </span>
                </div>

                {hasScan && !isMatch && (
                  <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      {t('settings.mismatchError', {
                        scanned: state.scannedCode,
                        expected: expectedCode,
                      })}
                    </span>
                  </p>
                )}

                {isMatch && !isConfirmed && (
                  <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1.5">
                    {t('settings.matchReadyHint')}
                  </p>
                )}
              </div>

              {/* Card Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePrintSingleSample(doc.type)}
                    disabled={Boolean(printingSingleDoc)}
                    id={`btn-print-single-${doc.type.toLowerCase()}`}
                    className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {printingSingleDoc === doc.type ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Printer className="h-3.5 w-3.5" />
                    )}
                    <span>{t('settings.printSingleBtn')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveScanDoc(doc.type)}
                    id={`btn-scan-print-check-${doc.type.toLowerCase()}`}
                    className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <ScanLine className="h-3.5 w-3.5" />
                    <span>{hasScan ? t('settings.rescanBtn') : t('settings.scanBtn')}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggleConfirmMatch(doc.type)}
                  disabled={!isMatch}
                  id={`btn-confirm-print-check-${doc.type.toLowerCase()}`}
                  className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                    isConfirmed
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                      : isMatch
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'
                      : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>
                    {isConfirmed ? t('settings.confirmedBadge') : t('settings.confirmMatchBtn')}
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save / Log Bar */}
      <div className="px-5 py-4 border-t border-slate-200 bg-white flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div className="flex-1 space-y-1">
          <label
            htmlFor="input-print-check-notes"
            className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600"
          >
            {t('settings.notesLabel')}
          </label>
          <input
            id="input-print-check-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('settings.notesPlaceholder')}
            className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
          />
          <p className="text-[11px] text-slate-500">
            {evaluation.allConfirmed ? t('settings.savePassHint') : t('settings.saveFailHint')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleSaveLog}
          disabled={isSavingLog || !canEdit}
          id="btn-save-print-check"
          className="inline-flex items-center justify-center gap-2 px-4 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {isSavingLog ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          <span>{isSavingLog ? t('settings.savingLogBtn') : t('settings.saveLogBtn')}</span>
        </button>
      </div>

      {/* Print Check History Table */}
      <div className="border-t border-slate-200">
        <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{t('settings.historyTitle')}</h3>
            <p className="text-[11px] text-slate-500">{t('settings.historySubtitle')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder={t('settings.searchLogsPlaceholder')}
                className="h-8 pl-8 pr-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 w-52"
              />
            </div>

            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-[11px] font-semibold">
              {(['ALL', 'PASS', 'FAIL'] as const).map((statusOpt) => (
                <button
                  key={statusOpt}
                  type="button"
                  onClick={() => setLogStatusFilter(statusOpt)}
                  className={`px-2.5 py-1 rounded-md transition cursor-pointer whitespace-nowrap shrink-0 ${
                    logStatusFilter === statusOpt
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {statusOpt === 'ALL'
                    ? t('settings.filterAll')
                    : statusOpt === 'PASS'
                    ? t('settings.filterPass')
                    : t('settings.filterFail')}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExportLogsCsv}
              disabled={filteredLogs.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{t('settings.exportCsvBtn')}</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {isLoadingLogs && logs.length === 0 ? (
            <div className="p-5 space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 rounded-lg bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-slate-500">
              {t('settings.emptyLogs')}
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  <th className="py-2.5 px-4">{t('settings.colDate')}</th>
                  <th className="py-2.5 px-4">{t('settings.colPrinter')}</th>
                  <th className="py-2.5 px-4">{t('settings.colUser')}</th>
                  <th className="py-2.5 px-4">{t('settings.colDocuments')}</th>
                  <th className="py-2.5 px-4 text-right">{t('settings.colResult')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap text-slate-800">
                      <div>{entry.checkedDate}</div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(entry.checkedAt).toLocaleTimeString(dateLocale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">
                      <div>{entry.printer}</div>
                      {entry.notes && (
                        <div className="text-[11px] font-normal text-slate-500 truncate max-w-[220px]">
                          {entry.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-slate-800">
                      <div className="font-medium">{entry.operatorName}</div>
                      {entry.operatorEmployeeId && (
                        <div className="text-[10px] font-mono text-slate-500 tabular-nums">
                          {entry.operatorEmployeeId}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
                        {t('settings.verifiedFraction', {
                          matched: entry.matchedCount,
                          total: entry.totalCount,
                        })}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
                        {(entry.documents || []).map((d) => (
                          <span
                            key={d.docType}
                            className={d.confirmedMatch ? 'text-emerald-700' : 'text-rose-700'}
                          >
                            {d.docType}: {d.confirmedMatch ? 'OK' : 'FAIL'}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold whitespace-nowrap tabular-nums">
                      <span
                        className={
                          entry.overallStatus === 'PASS' ? 'text-emerald-700' : 'text-rose-700'
                        }
                      >
                        {entry.overallStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Hidden Offscreen Official Printable A4 Sample Templates (kept in English per SOP standard) */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: '-12000px',
          top: 0,
          width: '760px',
          pointerEvents: 'none',
          opacity: 1,
          zIndex: -1,
        }}
      >
        {/* 1. Sample Requisition Document (MRS) */}
        <div
          ref={(el) => {
            docRefs.current.REQUISITION = el;
          }}
          className="bg-white text-slate-900 p-8 font-sans"
          style={{ width: '760px' }}
        >
          <div className="border-2 border-slate-900 p-6 space-y-5">
            <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-black tracking-wide uppercase">
                  JUWEI PLASTIC MOULDING PHILS. INC.
                </div>
                <div className="text-[10px] font-semibold text-slate-600 uppercase">
                  WAREHOUSE &amp; PRODUCTION CONTROL DEPARTMENT
                </div>
                <h1 className="text-lg font-black tracking-tight uppercase mt-2">
                  MATERIAL REQUISITION SLIP (MRS)
                </h1>
                <div className="text-[10px] font-mono uppercase text-slate-600">
                  PRINT CHECK CALIBRATION SAMPLE • SAMPLE NO: SAMPLE-MRS-2026
                </div>
              </div>
              <div className="border border-slate-800 p-2 bg-white text-center">
                <Code128Barcode value={sampleCodes.REQUISITION} height={48} barWidth={1.8} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs border border-slate-300 p-3 bg-slate-50">
              <div><span className="font-bold">Sample Date:</span> {checkDate}</div>
              <div><span className="font-bold">Printer:</span> {printer || 'PRINTER VERIFICATION'}</div>
              <div><span className="font-bold">Requesting Dept:</span> INJECTION PRODUCTION</div>
              <div><span className="font-bold">Operator:</span> {currentUser || 'OPERATOR'} ({currentEmployeeId || 'JPMP'})</div>
            </div>

            <table className="w-full border-collapse border border-slate-800 text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-800 p-2 text-left">PART CODE</th>
                  <th className="border border-slate-800 p-2 text-left">MATERIAL DESCRIPTION</th>
                  <th className="border border-slate-800 p-2 text-left">LOT NUMBER</th>
                  <th className="border border-slate-800 p-2 text-right">QTY</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-800 p-2 font-mono font-bold">RAW-ABS-BLK-01</td>
                  <td className="border border-slate-800 p-2">ABS PLASTIC RESIN PELLETS (SAMPLE TEST LINE)</td>
                  <td className="border border-slate-800 p-2 font-mono">LOT-SAMPLE-A01</td>
                  <td className="border border-slate-800 p-2 text-right font-mono font-bold">250.00 KG</td>
                </tr>
              </tbody>
            </table>

            <div className="border-t border-slate-300 pt-4 text-[10px] text-slate-600 flex justify-between">
              <span>SOP VERIFICATION: SCAN BARCODE ABOVE AND CONFIRM VALUE MATCHES ON-SCREEN SAMPLE.</span>
              <span className="font-mono font-bold">{sampleCodes.REQUISITION}</span>
            </div>
          </div>
        </div>

        {/* 2. Sample Picking List Document */}
        <div
          ref={(el) => {
            docRefs.current.PICKING_LIST = el;
          }}
          className="bg-white text-slate-900 p-8 font-sans"
          style={{ width: '760px' }}
        >
          <div className="border-2 border-slate-900 p-6 space-y-5">
            <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-black tracking-wide uppercase">
                  JUWEI PLASTIC MOULDING PHILS. INC.
                </div>
                <div className="text-[10px] font-semibold text-slate-600 uppercase">
                  INVENTORY &amp; FIFO / FEFO DISPATCH STAGING
                </div>
                <h1 className="text-lg font-black tracking-tight uppercase mt-2">
                  WAREHOUSE PICKING LIST
                </h1>
                <div className="text-[10px] font-mono uppercase text-slate-600">
                  PRINT CHECK CALIBRATION SAMPLE • PICK REF: SAMPLE-DPL-2026
                </div>
              </div>
              <div className="border border-slate-800 p-2 bg-white text-center">
                <Code128Barcode value={sampleCodes.PICKING_LIST} height={48} barWidth={1.8} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs border border-slate-300 p-3 bg-slate-50">
              <div><span className="font-bold">Pick Date:</span> {checkDate}</div>
              <div><span className="font-bold">Printer:</span> {printer || 'PRINTER VERIFICATION'}</div>
              <div><span className="font-bold">Staging Zone:</span> BAY 1 / FIFO PRIORITY</div>
              <div><span className="font-bold">Picker:</span> {currentUser || 'OPERATOR'} ({currentEmployeeId || 'JPMP'})</div>
            </div>

            <table className="w-full border-collapse border border-slate-800 text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-800 p-2 text-left">BIN LOCATION</th>
                  <th className="border border-slate-800 p-2 text-left">PART CODE</th>
                  <th className="border border-slate-800 p-2 text-left">LOT / BATCH</th>
                  <th className="border border-slate-800 p-2 text-right">PICK QTY</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-800 p-2 font-mono font-bold">ZONE A - RACK 01</td>
                  <td className="border border-slate-800 p-2 font-mono">FG-HOUSING-V2</td>
                  <td className="border border-slate-800 p-2 font-mono">LOT-SAMPLE-B02</td>
                  <td className="border border-slate-800 p-2 text-right font-mono font-bold">500 PCS</td>
                </tr>
              </tbody>
            </table>

            <div className="border-t border-slate-300 pt-4 text-[10px] text-slate-600 flex justify-between">
              <span>SOP VERIFICATION: VERIFY FIFO BIN TAG AND SCAN PICKING LIST BARCODE ON-SCREEN.</span>
              <span className="font-mono font-bold">{sampleCodes.PICKING_LIST}</span>
            </div>
          </div>
        </div>

        {/* 3. Sample Gate Pass / Delivery Receipt Document */}
        <div
          ref={(el) => {
            docRefs.current.GATE_PASS = el;
          }}
          className="bg-white text-slate-900 p-8 font-sans"
          style={{ width: '760px' }}
        >
          <div className="border-2 border-slate-900 p-6 space-y-5">
            <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-black tracking-wide uppercase">
                  JUWEI PLASTIC MOULDING PHILS. INC.
                </div>
                <div className="text-[10px] font-semibold text-slate-600 uppercase">
                  LOGISTICS SECURITY &amp; OUTBOUND DISPATCH CONTROL
                </div>
                <h1 className="text-lg font-black tracking-tight uppercase mt-2">
                  DELIVERY RECEIPT &amp; GATE PASS
                </h1>
                <div className="text-[10px] font-mono uppercase text-slate-600">
                  PRINT CHECK CALIBRATION SAMPLE • GATE PASS: SAMPLE-GP-2026
                </div>
              </div>
              <div className="border border-slate-800 p-2 bg-white text-center">
                <Code128Barcode value={sampleCodes.GATE_PASS} height={48} barWidth={1.8} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs border border-slate-300 p-3 bg-slate-50">
              <div><span className="font-bold">Release Date:</span> {checkDate}</div>
              <div><span className="font-bold">Printer:</span> {printer || 'PRINTER VERIFICATION'}</div>
              <div><span className="font-bold">Consignee:</span> SAMPLE LOGISTICS PARTNER</div>
              <div><span className="font-bold">Waybill No.:</span> SAMPLE-WB-001</div>
            </div>

            <table className="w-full border-collapse border border-slate-800 text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-800 p-2 text-left">PART CODE</th>
                  <th className="border border-slate-800 p-2 text-left">SHIPPING DESCRIPTION</th>
                  <th className="border border-slate-800 p-2 text-right">DISPATCH QTY</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-800 p-2 font-mono font-bold">FG-EXPORT-01</td>
                  <td className="border border-slate-800 p-2">EXPORT SHIPPING CARTONS (CALIBRATION SAMPLE)</td>
                  <td className="border border-slate-800 p-2 text-right font-mono font-bold">12 CARTONS</td>
                </tr>
              </tbody>
            </table>

            <div className="grid grid-cols-2 gap-8 pt-6 text-[10px]">
              <div className="border-t border-slate-800 pt-1 text-center font-semibold uppercase">
                PREPARED / VERIFIED BY: {currentUser || 'OPERATOR'}
              </div>
              <div className="border-t border-slate-800 pt-1 text-center font-semibold uppercase">
                GUARD ON DUTY / GATE RELEASE SIGNATURE
              </div>
            </div>

            <div className="border-t border-slate-300 pt-3 text-[10px] text-slate-600 flex justify-between">
              <span>SOP VERIFICATION: SCAN GATE PASS BARCODE BEFORE VEHICLE EXIT AUTHORIZATION.</span>
              <span className="font-mono font-bold">{sampleCodes.GATE_PASS}</span>
            </div>
          </div>
        </div>

        {/* 4. Sample QR Badge Document */}
        <div
          ref={(el) => {
            docRefs.current.QR_BADGE = el;
          }}
          className="bg-white text-slate-900 p-10 font-sans flex flex-col items-center"
          style={{ width: '760px' }}
        >
          <div
            className="border-2 border-slate-900 rounded-2xl overflow-hidden bg-white shadow-sm"
            style={{ width: '420px' }}
          >
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-black tracking-widest uppercase">JUWEI WMS</div>
                <div className="text-[10px] text-slate-300 uppercase">
                  JUWEI PLASTIC MOULDING PHILS. INC.
                </div>
              </div>
              <div className="text-[10px] font-mono font-bold uppercase border border-slate-600 px-2 py-0.5 rounded">
                QR BADGE SAMPLE
              </div>
            </div>

            <div className="p-6 flex flex-col items-center text-center space-y-4">
              <div className="p-3 bg-white border-2 border-slate-900 rounded-xl">
                <QRCodeSVG
                  value={sampleCodes.QR_BADGE}
                  size={170}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <div>
                <div className="text-base font-black text-slate-900 uppercase">
                  {currentUser || 'OPERATOR'}
                </div>
                <div className="text-xs font-mono font-bold text-indigo-700 mt-0.5">
                  {currentEmployeeId || 'JPMP-OPERATOR'} • {currentRole || 'WAREHOUSE CLERK'}
                </div>
              </div>

              <div className="w-full border-t border-slate-200 pt-3 space-y-1 text-xs font-mono">
                <div className="text-[10px] text-slate-500 uppercase">
                  SAMPLE QR BADGE CODE
                </div>
                <div className="font-bold text-slate-900 tracking-wider">
                  {sampleCodes.QR_BADGE}
                </div>
                <div className="text-[10px] text-slate-500">
                  DATE: {checkDate} • PRINTER: {printer || 'CALIBRATION'}
                </div>
              </div>
            </div>

            <div className="bg-slate-100 border-t border-slate-300 px-4 py-2.5 text-center text-[9px] font-mono font-semibold text-slate-700 uppercase">
              JUWEI WMS OPERATOR SECURITY SYSTEM • PRINT CHECK SAMPLE
            </div>
          </div>
        </div>
      </div>

      {/* Barcode Scanner Modal */}
      {activeScanDoc && (
        <BarcodeScannerModal
          isOpen={Boolean(activeScanDoc)}
          onClose={() => setActiveScanDoc(null)}
          onScanResult={handleScanComplete}
          title={t('settings.scannerTitle', {
            doc: activeScanMeta ? t(activeScanMeta.titleKey) : activeScanDoc,
          })}
          subtitle={t('settings.scannerSubtitle', {
            expected: sampleCodes[activeScanDoc],
          })}
        />
      )}

      {/* Full 4-Page A4 Preview Modal */}
      <PrintPreviewModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        documentTitle="JUWEI Print Check Calibration Pack (4 Sample Documents)"
        documentSubtitle="Requisition • Picking List • Gate Pass • QR Badge"
        documentNumber={`PCHK-${checkDate}`}
        filename={`JUWEI-Print-Check-${checkDate}.pdf`}
        pages={previewPages}
        isRendering={isPreviewRendering}
      />
    </section>
  );
};

export default PrintCheckSection;
