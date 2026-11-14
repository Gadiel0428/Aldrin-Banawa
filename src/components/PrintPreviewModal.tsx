import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import {
  Printer,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FileText,
  RotateCcw,
  Loader2,
  Download
} from 'lucide-react';
import {
  printPages,
  savePagesAsPdf,
  showPrintToast,
  formatPrintErrorMessage
} from '../utils/printDocument';

export interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentTitle: string;
  documentSubtitle?: string;
  documentNumber?: string;
  filename?: string;
  pages: string[];
  isRendering?: boolean;
  extraToolbarControls?: React.ReactNode;
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  isOpen,
  onClose,
  documentTitle,
  documentSubtitle = 'A4 Print Layout Preview',
  documentNumber,
  filename,
  pages,
  isRendering = false,
  extraToolbarControls
}) => {
  const [scale, setScale] = useState<number>(1.0);
  const [fitMode, setFitMode] = useState<'custom' | 'fit-width' | 'actual'>('actual');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isLandscapePages, setIsLandscapePages] = useState<boolean>(false);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [isSavingPdf, setIsSavingPdf] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const totalPages = pages.length;
  const baseWidthPx = isLandscapePages ? 1050 : 760;

  // Detect portrait vs landscape page aspect from the first rendered page
  useEffect(() => {
    if (!pages || pages.length === 0) {
      setIsLandscapePages(false);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setIsLandscapePages(img.naturalWidth > img.naturalHeight);
      }
    };
    img.src = pages[0];
    return () => {
      cancelled = true;
    };
  }, [pages]);

  const fitToWidth = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const containerWidth = scrollContainerRef.current.clientWidth - 48;
    const calculatedScale = Math.min(
      1.25,
      Math.max(0.35, Math.floor((containerWidth / baseWidthPx) * 100) / 100)
    );
    setScale(calculatedScale);
    setFitMode('fit-width');
  }, [baseWidthPx]);

  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1);
      if (window.innerWidth < 1024 || isLandscapePages) {
        fitToWidth();
      } else {
        setScale(1.0);
        setFitMode('actual');
      }
    }
  }, [isOpen, isLandscapePages, fitToWidth]);

  const resolvedFilename =
    filename ||
    `${documentNumber ? `JUWEI-${documentNumber}` : documentTitle || 'JUWEI-Document'}.pdf`;

  const handlePrint = useCallback(async () => {
    if (isPrinting || isRendering || pages.length === 0) return;
    setIsPrinting(true);
    try {
      await printPages(pages);
    } catch (err) {
      console.error('[PrintPreviewModal] Print error:', err);
      showPrintToast(
        `Print failed: ${formatPrintErrorMessage(err)}`,
        'error'
      );
    } finally {
      setIsPrinting(false);
    }
  }, [isPrinting, isRendering, pages]);

  const handleSavePdf = useCallback(async () => {
    if (isSavingPdf || isRendering || pages.length === 0) return;
    setIsSavingPdf(true);
    try {
      await savePagesAsPdf(pages, resolvedFilename);
    } catch (err) {
      console.error('[PrintPreviewModal] Save PDF error:', err);
      showPrintToast(
        `Save PDF failed: ${formatPrintErrorMessage(err)}`,
        'error'
      );
    } finally {
      setIsSavingPdf(false);
    }
  }, [isSavingPdf, isRendering, pages, resolvedFilename]);

  // Keyboard shortcuts: Escape to close, Ctrl/Cmd+P to print
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handlePrint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, handlePrint]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container || pages.length <= 1) {
      setCurrentPage(1);
      return;
    }
    const pageEls = container.querySelectorAll<HTMLElement>('[data-preview-page]');
    const containerTop = container.getBoundingClientRect().top;
    const viewportMid = containerTop + container.clientHeight * 0.35;

    let activePage = 1;
    let bestDist = Infinity;
    pageEls.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const center = rect.top + rect.height * 0.5;
      const dist = Math.abs(center - viewportMid);
      if (dist < bestDist) {
        bestDist = dist;
        activePage = Number(el.dataset.previewPage || '1');
      }
    });
    setCurrentPage(activePage);
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(2.0, Math.round((prev + 0.15) * 100) / 100));
    setFitMode('custom');
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(0.35, Math.round((prev - 0.15) * 100) / 100));
    setFitMode('custom');
  };

  const resetToActual = () => {
    setScale(1.0);
    setFitMode('actual');
  };

  if (!isOpen) return null;

  const modalContent = (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[220] overflow-hidden bg-slate-950/95 flex flex-col backdrop-blur-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Document Print Preview"
      >
        {/* Top Control Bar */}
        <header className="shrink-0 bg-slate-900 border-b border-slate-800 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg z-20">
          {/* Document Meta */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 rounded-xl shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="truncate">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm sm:text-base text-slate-100 truncate">
                  {documentTitle}
                </h2>
                {documentNumber && (
                  <span className="font-mono text-xs text-indigo-400 font-semibold px-2 py-0.5 bg-indigo-950/80 border border-indigo-800/60 rounded">
                    {documentNumber}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 font-mono">
                <span>{documentSubtitle}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-slate-300 font-semibold">
                  {isLandscapePages ? 'ISO A4 Landscape (297 × 210 mm)' : 'ISO A4 (210 × 297 mm)'}
                </span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-emerald-400 font-bold">
                  {totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : 'Preparing...'}
                </span>
              </div>
            </div>
          </div>

          {/* Optional Document Switcher Controls */}
          {extraToolbarControls && (
            <div className="hidden lg:flex items-center">
              {extraToolbarControls}
            </div>
          )}

          {/* Zoom Controls */}
          <div className="flex items-center gap-1.5 bg-slate-950/70 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              type="button"
              onClick={zoomOut}
              disabled={scale <= 0.35}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
              title="Zoom Out (-15%)"
              aria-label="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>

            <span className="font-mono tabular-nums text-slate-200 font-semibold px-2 min-w-[52px] text-center select-none text-[11px]">
              {Math.round(scale * 100)}%
            </span>

            <button
              type="button"
              onClick={zoomIn}
              disabled={scale >= 2.0}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
              title="Zoom In (+15%)"
              aria-label="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </button>

            <div className="h-4 w-px bg-slate-800 mx-1" aria-hidden="true" />

            <button
              type="button"
              onClick={resetToActual}
              className={`px-2 py-1 rounded-lg font-medium transition cursor-pointer ${
                fitMode === 'actual'
                  ? 'bg-slate-800 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="100% Actual Scale"
            >
              <RotateCcw className="h-3 w-3 inline mr-1" />
              100%
            </button>

            <button
              type="button"
              onClick={fitToWidth}
              className={`px-2 py-1 rounded-lg font-medium transition cursor-pointer ${
                fitMode === 'fit-width'
                  ? 'bg-slate-800 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Fit to Window Width"
            >
              <Maximize2 className="h-3 w-3 inline mr-1" />
              Fit
            </button>
          </div>

          {/* Action Buttons: Print, Save PDF, Close */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting || isRendering || pages.length === 0}
              className={`px-4 py-2 ${
                isPrinting || isRendering || pages.length === 0
                  ? 'bg-indigo-800 text-indigo-300 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white cursor-pointer'
              } font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-400`}
              title="Print Document (Ctrl+P)"
            >
              {isPrinting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                  <span className="whitespace-nowrap font-mono tracking-tight">PRINTING...</span>
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4" />
                  <span className="whitespace-nowrap font-mono tracking-tight">Print</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleSavePdf}
              disabled={isSavingPdf || isRendering || pages.length === 0}
              className={`px-4 py-2 ${
                isSavingPdf || isRendering || pages.length === 0
                  ? 'bg-emerald-900 text-emerald-300 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white cursor-pointer'
              } font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-400`}
              title="Save Timestamped A4 PDF File"
            >
              {isSavingPdf ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                  <span className="whitespace-nowrap font-mono tracking-tight">SAVING PDF...</span>
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  <span className="whitespace-nowrap font-mono tracking-tight">Save PDF</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1.5 border border-slate-700"
              title="Close Preview (Esc)"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
              <span>Close</span>
            </button>
          </div>
        </header>

        {/* Status Bar */}
        <div className="bg-slate-900/60 border-b border-slate-800/80 px-4 py-1.5 flex items-center justify-between text-[11px] text-slate-400 shrink-0 font-mono">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
            <span>
              {totalPages > 0
                ? `Page ${currentPage} of ${totalPages} · Crisp A4 Render Ready`
                : 'Rendering A4 Print Pages...'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>
              Press <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-200 border border-slate-700">Ctrl+P</kbd> to print
            </span>
            <span>·</span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-200 border border-slate-700">Esc</kbd> to close
            </span>
          </div>
        </div>

        {/* Scrollable Page Image Viewport */}
        <main
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto p-4 sm:p-8 flex flex-col items-center gap-6 bg-slate-950/90 relative"
        >
          {isRendering ? (
            <div className="my-auto flex flex-col items-center gap-3 text-slate-300 py-16">
              <Loader2 className="h-10 w-10 animate-spin text-indigo-400" />
              <p className="text-sm font-mono font-bold text-white">RENDERING A4 PRINT PAGES...</p>
              <p className="text-xs text-slate-400">Formatting tables, signatories, and pagination</p>
            </div>
          ) : pages.length === 0 ? (
            <div className="my-auto text-center text-slate-400 py-16 font-mono text-sm">
              No rendered pages available to preview.
            </div>
          ) : (
            pages.map((pageSrc, idx) => {
              const pageNumber = idx + 1;
              return (
                <div
                  key={`preview-page-${pageNumber}`}
                  data-preview-page={pageNumber}
                  className="flex flex-col items-center gap-2 shrink-0"
                >
                  <div
                    className="bg-white shadow-2xl border border-slate-700/40 overflow-hidden"
                    style={{
                      width: `${Math.round(baseWidthPx * scale)}px`,
                    }}
                  >
                    <img
                      src={pageSrc}
                      alt={`Page ${pageNumber} of ${totalPages}`}
                      className="block w-full h-auto select-none"
                      draggable={false}
                    />
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 font-semibold">
                    Page {pageNumber} of {totalPages}
                  </span>
                </div>
              );
            })
          )}
        </main>
      </div>
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
};

export default PrintPreviewModal;
