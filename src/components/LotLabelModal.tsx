/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, Eye, Download, Loader2, Tag } from 'lucide-react';
import {
  FifoColorsMap,
  MasterRegistryItem,
  MaterialStockItem,
} from '../types';
import { normalizeFifoColor, resolveFifoColor } from '../data';
import { resolveMasterDataUnit } from '../../shared/units';
import { encodeCode128B } from '../utils/barcode128';
import { Code128Barcode } from './Code128Barcode';
import { PrintPreviewModal } from './PrintPreviewModal';
import { ExportMenu } from './ExportMenu';
import {
  LOT_LABEL_PAGE_SIZE_IDS,
  PRINT_PAGE_SIZE_PRESETS,
  PrintPageSizeId,
  formatPrintErrorMessage,
  printPages,
  renderDocumentPages,
  savePagesAsPdf,
  showPrintToast,
} from '../utils/printDocument';
import { useI18n } from '../i18n';

export interface LotLabelModalProps {
  stock: MaterialStockItem | null;
  onClose: () => void;
  registries?: MasterRegistryItem[];
  stocks?: MaterialStockItem[];
  fifoColorsByMonth?: FifoColorsMap;
}

/**
 * Ensures any lot number / part code string is valid printable ASCII (32..126) for Code 128 Set B.
 */
export function resolveLotBarcodeValue(stock: Pick<MaterialStockItem, 'lotNumber' | 'partCode' | 'id'>): string {
  const candidates = [stock.lotNumber, stock.partCode, stock.id];
  for (const raw of candidates) {
    const cleanAscii = String(raw || '')
      .trim()
      .replace(/[^\x20-\x7E]/g, '');
    if (cleanAscii.length > 0) {
      return cleanAscii;
    }
  }
  return 'LOT-UNKNOWN';
}

export const LotLabelModal: React.FC<LotLabelModalProps> = ({
  stock,
  onClose,
  registries = [],
  stocks = [],
  fifoColorsByMonth,
}) => {
  const { t } = useI18n();
  const [pageSizeId, setPageSizeId] = useState<PrintPageSizeId>('LABEL_50X30');
  const [copies, setCopies] = useState<number>(1);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [isSavingPdf, setIsSavingPdf] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [isRenderingPreview, setIsRenderingPreview] = useState<boolean>(false);
  const [previewPages, setPreviewPages] = useState<string[]>([]);
  const printableLabelRef = useRef<HTMLDivElement>(null);

  const pageSpec = PRINT_PAGE_SIZE_PRESETS[pageSizeId] || PRINT_PAGE_SIZE_PRESETS.LABEL_50X30;

  const pageSizeLabels: Record<PrintPageSizeId, string> = {
    LABEL_50X30: t('stocks.labelPage50x30'),
    LABEL_70X40: t('stocks.labelPage70x40'),
    LABEL_100X50: t('stocks.labelPage100x50'),
    A4_PORTRAIT: t('stocks.labelPageA4'),
    A4_LANDSCAPE: 'ISO A4 Landscape (297 × 210 mm)',
  };

  const labelData = useMemo(() => {
    if (!stock) return null;
    const unitInfo = resolveMasterDataUnit(stock, registries, stocks);
    const unitText = unitInfo.isMissing ? t('common.missingUnit') : unitInfo.unit;
    const fifoName = normalizeFifoColor(stock.fifoColor, stock.receivedDate, fifoColorsByMonth);
    const fifoMeta = resolveFifoColor(fifoName, undefined, undefined, fifoColorsByMonth);
    const barcodeValue = resolveLotBarcodeValue(stock);

    let totalModules = 180;
    try {
      totalModules = encodeCode128B(barcodeValue, 10).totalModules;
    } catch {
      totalModules = 180;
    }

    // Fit barcode cleanly inside the printable clone width with quiet zones
    const maxBarcodeAreaPx = Math.max(240, (pageSpec.isLabel ? pageSpec.cloneWidthPx : 420) - 36);
    const computedBarWidth = Math.max(1, Math.min(2.2, Number((maxBarcodeAreaPx / totalModules).toFixed(2))));

    return {
      partCode: stock.partCode || 'N/A',
      description: stock.description || 'N/A',
      lotNumber: stock.lotNumber || 'N/A',
      quantityText: `${Number(stock.quantity || 0).toLocaleString()} ${unitText}`,
      unitMissing: unitInfo.isMissing,
      fifoName,
      fifoHex: fifoMeta.hex || '#334155',
      receivedDate: stock.receivedDate || 'N/A',
      location: stock.location || '',
      barcodeValue,
      barWidth: computedBarWidth,
    };
  }, [stock, registries, stocks, fifoColorsByMonth, pageSpec, t]);

  const buildRenderedPages = useCallback(async (): Promise<string[]> => {
    const el = printableLabelRef.current;
    if (!el) {
      throw new Error(t('toasts.printableContainerNotFound'));
    }
    const basePages = await renderDocumentPages(el, { pageSize: pageSpec });
    const count = Math.max(1, Math.min(50, Math.floor(copies || 1)));
    if (count === 1) return basePages;
    const repeated: string[] = [];
    for (let i = 0; i < count; i++) {
      repeated.push(...basePages);
    }
    return repeated;
  }, [pageSpec, copies, t]);

  const renderPreview = useCallback(async () => {
    setIsRenderingPreview(true);
    try {
      const pages = await buildRenderedPages();
      setPreviewPages(pages);
    } catch (err) {
      console.error('[LotLabelModal] Preview render error:', err);
      showPrintToast(`Label preview failed: ${formatPrintErrorMessage(err)}`, 'error');
    } finally {
      setIsRenderingPreview(false);
    }
  }, [buildRenderedPages]);

  useEffect(() => {
    if (!showPreview) return;
    const raf = requestAnimationFrame(() => {
      renderPreview();
    });
    return () => cancelAnimationFrame(raf);
  }, [showPreview, pageSizeId, copies, renderPreview]);

  useEffect(() => {
    if (!stock || showPreview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stock, showPreview, onClose]);

  if (!stock || !labelData) return null;

  const handleDirectPrint = async () => {
    if (isPrinting || isSavingPdf) return;
    setIsPrinting(true);
    try {
      const pages = await buildRenderedPages();
      await printPages(pages, { pageSize: pageSpec });
    } catch (err) {
      console.error('[LotLabelModal] Print error:', err);
      showPrintToast(`Print label failed: ${formatPrintErrorMessage(err)}`, 'error');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleSavePdf = async () => {
    if (isPrinting || isSavingPdf) return;
    setIsSavingPdf(true);
    try {
      const pages = await buildRenderedPages();
      const safeLot = (labelData.lotNumber || 'LOT').replace(/[^a-zA-Z0-9-_]/g, '_');
      const safePart = (labelData.partCode || 'PART').replace(/[^a-zA-Z0-9-_]/g, '_');
      await savePagesAsPdf(pages, `JUWEI-Label-${safePart}-${safeLot}.pdf`, { pageSize: pageSpec });
    } catch (err) {
      console.error('[LotLabelModal] Save PDF error:', err);
      showPrintToast(`Save label PDF failed: ${formatPrintErrorMessage(err)}`, 'error');
    } finally {
      setIsSavingPdf(false);
    }
  };

  const handleOpenPreview = async () => {
    setShowPreview(true);
    await renderPreview();
  };

  const isCompactLabel = pageSizeId === 'LABEL_50X30';
  const barcodeHeight = pageSizeId === 'LABEL_50X30' ? 32 : pageSizeId === 'LABEL_70X40' ? 40 : 44;

  const labelDom = (
    <div
      ref={printableLabelRef}
      style={{
        width: pageSpec.isLabel ? `${pageSpec.cloneWidthPx}px` : '440px',
        backgroundColor: '#ffffff',
        color: '#0f172a',
        border: '2px solid #0f172a',
        borderRadius: '4px',
        padding: isCompactLabel ? '7px 9px' : '10px 12px',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Row: Part Code & FIFO Color Badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          paddingBottom: isCompactLabel ? '4px' : '6px',
          borderBottom: '1.5px solid #0f172a',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: '8.5px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: '#475569',
              textTransform: 'uppercase',
              lineHeight: 1.1,
            }}
          >
            {t('stocks.labelPartCode')}
          </div>
          <div
            style={{
              fontSize: isCompactLabel ? '15px' : '18px',
              fontWeight: 800,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: '#0f172a',
              lineHeight: 1.15,
              wordBreak: 'break-all',
            }}
          >
            {labelData.partCode}
          </div>
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: isCompactLabel ? '3px 6px' : '4px 8px',
            border: '1.5px solid #0f172a',
            borderRadius: '3px',
            backgroundColor: '#f8fafc',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: isCompactLabel ? '10px' : '12px',
              height: isCompactLabel ? '10px' : '12px',
              borderRadius: '2px',
              border: '1px solid #0f172a',
              backgroundColor: labelData.fifoHex,
              flexShrink: 0,
            }}
          />
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: '7.5px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              {t('stocks.labelFifoColor')}
            </div>
            <div style={{ fontSize: isCompactLabel ? '10.5px' : '12px', fontWeight: 800, color: '#0f172a' }}>
              {labelData.fifoName}
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      <div
        style={{
          marginTop: isCompactLabel ? '4px' : '6px',
          marginBottom: isCompactLabel ? '5px' : '7px',
        }}
      >
        <div
          style={{
            fontSize: isCompactLabel ? '11px' : '12.5px',
            fontWeight: 600,
            color: '#1e293b',
            lineHeight: 1.25,
            maxHeight: isCompactLabel ? '28px' : '34px',
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}
        >
          {labelData.description}
        </div>
      </div>

      {/* Lot / Quantity / Received Date Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.25fr 1fr 0.95fr',
          gap: '6px',
          padding: isCompactLabel ? '4px 6px' : '6px 8px',
          backgroundColor: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: '3px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '8px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            {t('stocks.labelLotNumber')}
          </div>
          <div
            style={{
              fontSize: isCompactLabel ? '11px' : '12.5px',
              fontWeight: 800,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: '#0f172a',
              wordBreak: 'break-all',
              lineHeight: 1.2,
            }}
          >
            {labelData.lotNumber}
          </div>
        </div>

        <div style={{ minWidth: 0, borderLeft: '1px solid #cbd5e1', paddingLeft: '6px' }}>
          <div style={{ fontSize: '8px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            {t('stocks.labelQuantity')}
          </div>
          <div
            style={{
              fontSize: isCompactLabel ? '11.5px' : '13px',
              fontWeight: 800,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: labelData.unitMissing ? '#be123c' : '#0f172a',
              lineHeight: 1.2,
            }}
          >
            {labelData.quantityText}
          </div>
        </div>

        <div style={{ minWidth: 0, borderLeft: '1px solid #cbd5e1', paddingLeft: '6px' }}>
          <div style={{ fontSize: '8px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            {t('stocks.labelReceivedDate')}
          </div>
          <div
            style={{
              fontSize: isCompactLabel ? '10.5px' : '12px',
              fontWeight: 700,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: '#0f172a',
              lineHeight: 1.2,
            }}
          >
            {labelData.receivedDate}
          </div>
        </div>
      </div>

      {/* Code 128 Barcode */}
      <div
        style={{
          marginTop: isCompactLabel ? '4px' : '6px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
        }}
      >
        <Code128Barcode
          value={labelData.barcodeValue}
          height={barcodeHeight}
          barWidth={labelData.barWidth}
          showText={true}
          className="px-1 py-0.5"
        />
      </div>
    </div>
  );

  const pageSizeSwitcher = (
    <div className="flex items-center gap-1 bg-slate-950/70 border border-slate-800 p-1 rounded-lg text-xs">
      {LOT_LABEL_PAGE_SIZE_IDS.map((id) => {
        const active = pageSizeId === id;
        const spec = PRINT_PAGE_SIZE_PRESETS[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => setPageSizeId(id)}
            className={`px-2 py-1 rounded font-mono text-[11px] transition cursor-pointer ${
              active
                ? 'bg-indigo-600 text-white font-bold'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            {spec.isLabel ? `${spec.widthMm}×${spec.heightMm} mm` : 'A4'}
          </button>
        );
      })}
    </div>
  );

  const modalContent = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('stocks.printLabelTitle')}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 shrink-0">
              <Tag className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm sm:text-base truncate">{t('stocks.printLabelTitle')}</h3>
              <p className="text-xs text-slate-300 font-mono truncate">
                {labelData.partCode} · {t('stocks.lotPrefix')} {labelData.lotNumber}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Options Bar */}
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="lot-label-page-size" className="text-xs font-bold text-slate-700">
              {t('stocks.labelPageSizeLabel')}
            </label>
            <select
              id="lot-label-page-size"
              value={pageSizeId}
              onChange={(e) => setPageSizeId(e.target.value as PrintPageSizeId)}
              className="text-xs font-semibold border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
            >
              {LOT_LABEL_PAGE_SIZE_IDS.map((id) => (
                <option key={id} value={id}>
                  {pageSizeLabels[id]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="lot-label-copies" className="text-xs font-bold text-slate-700">
              {t('stocks.labelCopiesLabel')}
            </label>
            <input
              id="lot-label-copies"
              type="number"
              min={1}
              max={50}
              value={copies}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10);
                setCopies(Number.isFinite(parsed) ? Math.max(1, Math.min(50, parsed)) : 1);
              }}
              className="w-16 text-xs font-mono font-bold text-center border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        </div>

        {/* Label Preview Stage */}
        <div className="p-6 bg-slate-100/80 overflow-auto flex-1 flex flex-col items-center justify-center gap-3">
          <div className="text-[11px] font-mono font-semibold text-slate-500">
            {pageSizeLabels[pageSizeId]} · {copies} {copies === 1 ? t('stocks.labelCopySingular') : t('stocks.labelCopyPlural')}
          </div>
          <div className="bg-white p-3 rounded-lg shadow-lg border border-slate-300/80 inline-flex items-center justify-center">
            {labelDom}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
          >
            {t('common.close')}
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              id="btn-confirm-print-lot-label"
              variant="indigo"
              disabled={isPrinting || isSavingPdf}
              icon={
                isPrinting || isSavingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <Printer className="h-3.5 w-3.5 shrink-0" />
                )
              }
              items={[
                {
                  id: 'btn-lot-label-print-direct',
                  label: t('stocks.printLabelBtn'),
                  icon: <Printer className="h-3.5 w-3.5 text-indigo-600" />,
                  onClick: handleDirectPrint,
                  disabled: isPrinting || isSavingPdf,
                },
                {
                  id: 'btn-lot-label-save-pdf',
                  label: t('modals.printChrome.savePdf'),
                  icon: <Download className="h-3.5 w-3.5 text-emerald-600" />,
                  onClick: handleSavePdf,
                  disabled: isPrinting || isSavingPdf,
                },
                {
                  id: 'btn-lot-label-preview',
                  label: t('modals.printChrome.btnPreview'),
                  icon: <Eye className="h-3.5 w-3.5 text-slate-600" />,
                  onClick: handleOpenPreview,
                  disabled: isPrinting || isSavingPdf,
                },
              ]}
            />
          </div>
        </div>
      </div>

      {showPreview && (
        <PrintPreviewModal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          documentTitle={t('stocks.printLabelTitle')}
          documentSubtitle={`${labelData.partCode} · ${labelData.lotNumber}`}
          documentNumber={labelData.lotNumber}
          filename={`JUWEI-Label-${labelData.partCode}-${labelData.lotNumber}.pdf`}
          pages={previewPages}
          isRendering={isRenderingPreview}
          pageSize={pageSpec}
          extraToolbarControls={pageSizeSwitcher}
        />
      )}
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};

export default LotLabelModal;
