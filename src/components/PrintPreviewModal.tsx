/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Printer, 
  X, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  FileText,
  RotateCcw,
  Loader2,
  Download,
  ExternalLink,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import jsPDF from 'jspdf';
import { 
  renderDocumentPages, 
  printPages, 
  savePagesAsPdf, 
  showPrintToast 
} from '../utils/printDocument';

export interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentTitle: string;
  documentSubtitle?: string;
  documentNumber?: string;
  /** Explicit element ref to render via renderDocumentPages */
  targetElementRef?: React.RefObject<HTMLElement | null>;
  /** Or pre-rendered page PNG data URLs (e.g. from pdfjs-dist or prior render) */
  pages?: string[];
  /** Default filename for Save PDF / Electron open */
  filename?: string;
  /** Optional fallback inline children if element ref is not passed */
  children?: React.ReactNode;
  /** Optional view switcher tabs to embed directly in preview toolbar */
  extraToolbarControls?: React.ReactNode;
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  isOpen,
  onClose,
  documentTitle,
  documentSubtitle = 'A4 Print Layout Preview',
  documentNumber,
  targetElementRef,
  pages: initialPages,
  filename = 'JUWEI-WMS-Document.pdf',
  children,
  extraToolbarControls
}) => {
  const [renderedPages, setRenderedPages] = useState<string[]>([]);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const [scale, setScale] = useState<number>(1.0);
  const [fitMode, setFitMode] = useState<'custom' | 'fit-width' | 'actual'>('actual');
  const [visiblePageIndex, setVisiblePageIndex] = useState<number>(0);

  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [isSavingPdf, setIsSavingPdf] = useState<boolean>(false);
  const [isOpeningExternal, setIsOpeningExternal] = useState<boolean>(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fallbackContainerRef = useRef<HTMLDivElement>(null);

  // Render document pages from element or set pre-rendered pages
  const performRender = useCallback(async () => {
    if (initialPages && initialPages.length > 0) {
      setRenderedPages(initialPages);
      setIsRendering(false);
      setRenderError(null);
      return;
    }

    const sourceEl = targetElementRef?.current || fallbackContainerRef.current;
    if (!sourceEl) {
      setRenderError('No printable document reference provided for rendering.');
      return;
    }

    setIsRendering(true);
    setRenderError(null);

    try {
      const generatedPages = await renderDocumentPages(sourceEl);
      if (!generatedPages || generatedPages.length === 0) {
        throw new Error('Render output is empty. No printable content found.');
      }
      setRenderedPages(generatedPages);
    } catch (err: any) {
      const msg = err?.message || 'Failed to render document preview pages.';
      console.error('[PrintPreviewModal] Render error:', err);
      setRenderError(msg);
      showPrintToast(msg, 'error');
    } finally {
      setIsRendering(false);
    }
  }, [initialPages, targetElementRef]);

  useEffect(() => {
    if (isOpen) {
      performRender();
      if (window.innerWidth < 1024) {
        setFitMode('fit-width');
      } else {
        setScale(1.0);
        setFitMode('actual');
      }
      setVisiblePageIndex(0);
    } else {
      setRenderedPages([]);
      setRenderError(null);
      setIsRendering(false);
    }
  }, [isOpen, performRender]);

  // Execute print
  const handleExecutePrint = useCallback(async () => {
    if (isPrinting || renderedPages.length === 0) return;
    setIsPrinting(true);
    try {
      await printPages(renderedPages);
    } catch (err: any) {
      const msg = err?.message || 'Failed to trigger print dialog';
      console.error('[PrintPreviewModal] Print error:', err);
      showPrintToast(msg, 'error');
    } finally {
      setIsPrinting(false);
    }
  }, [isPrinting, renderedPages]);

  // Save PDF
  const handleSavePdf = async () => {
    if (isSavingPdf || renderedPages.length === 0) return;
    setIsSavingPdf(true);
    try {
      const safeFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
      await savePagesAsPdf(renderedPages, safeFilename);
      showPrintToast('PDF document successfully generated and downloaded.', 'success');
    } catch (err: any) {
      const msg = err?.message || 'Failed to save PDF';
      console.error('[PrintPreviewModal] Save PDF error:', err);
      showPrintToast(msg, 'error');
    } finally {
      setIsSavingPdf(false);
    }
  };

  // Optional: Open in host PDF Viewer (Electron)
  const hasElectronViewer = typeof window !== 'undefined' && Boolean(window.electronAPI?.openGeneratedPDF);
  const handleOpenInExternalViewer = async () => {
    if (isOpeningExternal || renderedPages.length === 0 || !window.electronAPI?.openGeneratedPDF) return;
    setIsOpeningExternal(true);
    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });
      for (let i = 0; i < renderedPages.length; i++) {
        if (i > 0) pdf.addPage('a4', 'portrait');
        pdf.addImage(renderedPages[i], 'PNG', 0, 0, 210, 297);
      }
      const arrayBuffer = pdf.output('arraybuffer');
      const safeFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
      const res = await window.electronAPI.openGeneratedPDF(arrayBuffer, safeFilename);
      if (res && res.success) {
        showPrintToast('Document opened in external PDF viewer.', 'info');
      } else {
        throw new Error(res?.error || 'Could not open external PDF viewer');
      }
    } catch (err: any) {
      const msg = err?.message || 'Failed to open in external PDF viewer';
      console.error('[PrintPreviewModal] External viewer error:', err);
      showPrintToast(msg, 'error');
    } finally {
      setIsOpeningExternal(false);
    }
  };

  // Capture Ctrl+P and Escape at top-most level
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        e.stopPropagation();
        handleExecutePrint();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, handleExecutePrint]);

  // Track currently visible page while scrolling
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const pageElements = container.querySelectorAll<HTMLDivElement>('[data-page-index]');
    const containerTop = container.scrollTop + container.clientHeight / 3;

    pageElements.forEach((el) => {
      const offsetTop = el.offsetTop;
      const offsetBottom = offsetTop + el.clientHeight;
      if (containerTop >= offsetTop && containerTop <= offsetBottom) {
        const idx = parseInt(el.getAttribute('data-page-index') || '0', 10);
        setVisiblePageIndex(idx);
      }
    });
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(1.75, Math.round((prev + 0.15) * 100) / 100));
    setFitMode('custom');
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(0.45, Math.round((prev - 0.15) * 100) / 100));
    setFitMode('custom');
  };

  const resetToActual = () => {
    setScale(1.0);
    setFitMode('actual');
  };

  const fitToWidth = () => {
    if (!scrollContainerRef.current) return;
    const containerWidth = scrollContainerRef.current.clientWidth - 64;
    // Standard preview card width is ~794px
    const cardWidth = 794;
    const calculatedScale = Math.min(1.2, Math.max(0.45, Math.floor((containerWidth / cardWidth) * 100) / 100));
    setScale(calculatedScale);
    setFitMode('fit-width');
  };

  if (!isOpen) return null;

  const totalPages = renderedPages.length;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-[200] overflow-hidden bg-slate-950/95 flex flex-col backdrop-blur-xl print:p-0 print:bg-white print:static print:inset-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Document Print Preview"
      >
        {/* Hidden container for fallback inline children if no ref provided */}
        {children && !targetElementRef && (
          <div ref={fallbackContainerRef} className="hidden" aria-hidden="true">
            {children}
          </div>
        )}

        {/* Top Control Bar */}
        <header className="no-print shrink-0 bg-slate-900 border-b border-slate-800 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg z-20">
          
          {/* Zone 1: Document Meta & Specifications */}
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
                <span className="text-slate-300 font-semibold">ISO A4 (210 × 297 mm)</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-emerald-400">10mm Baked Margins</span>
                {totalPages > 0 && (
                  <>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="text-amber-300 font-bold">
                      Page {visiblePageIndex + 1} of {totalPages}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Optional Extra View Switcher Controls */}
          {extraToolbarControls && (
            <div className="hidden lg:flex items-center">
              {extraToolbarControls}
            </div>
          )}

          {/* Zone 2: Interactive Zoom Controls */}
          <div className="flex items-center gap-1.5 bg-slate-950/70 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              type="button"
              onClick={zoomOut}
              disabled={scale <= 0.45 || isRendering}
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
              disabled={scale >= 1.75 || isRendering}
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
              disabled={isRendering}
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
              disabled={isRendering}
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

          {/* Zone 3: Print, Save PDF, Optional External & Close */}
          <div className="flex items-center gap-2">
            {/* Print Button */}
            <button
              type="button"
              onClick={handleExecutePrint}
              disabled={isRendering || isPrinting || totalPages === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-400"
              title="Print document directly (Ctrl+P)"
            >
              {isPrinting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                  <span className="whitespace-nowrap font-mono tracking-tight">PRINTING...</span>
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4" />
                  <span className="whitespace-nowrap font-mono tracking-tight">PRINT</span>
                </>
              )}
            </button>

            {/* Save PDF Button */}
            <button
              type="button"
              onClick={handleSavePdf}
              disabled={isRendering || isSavingPdf || totalPages === 0}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 hover:text-white font-bold text-xs rounded-xl border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
              title="Save document as PDF file to downloads"
            >
              {isSavingPdf ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                  <span className="whitespace-nowrap font-mono tracking-tight">SAVING...</span>
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 text-indigo-400" />
                  <span className="whitespace-nowrap font-mono tracking-tight">SAVE PDF</span>
                </>
              )}
            </button>

            {/* Optional Open in External PDF Viewer (Electron) */}
            {hasElectronViewer && (
              <button
                type="button"
                onClick={handleOpenInExternalViewer}
                disabled={isRendering || isOpeningExternal || totalPages === 0}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-indigo-300 hover:text-white font-bold text-xs rounded-xl border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
                title="Open in system default PDF viewer"
              >
                {isOpeningExternal ? (
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-300" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                <span className="whitespace-nowrap font-mono tracking-tight hidden sm:inline">VIEWER</span>
              </button>
            )}

            <div className="h-5 w-px bg-slate-800 mx-0.5" aria-hidden="true" />

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
              title="Close Preview (Esc)"
              aria-label="Close Preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Subheader info bar */}
        <div className="no-print bg-slate-900/60 border-b border-slate-800/80 px-4 py-1.5 flex items-center justify-between text-[11px] text-slate-400 shrink-0 font-mono">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Exact print preview rendered from document pages</span>
          </div>
          <div className="flex items-center gap-3">
            <span>Press <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-200 border border-slate-700">Ctrl+P</kbd> to print</span>
            <span>·</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-200 border border-slate-700">Esc</kbd> to exit</span>
          </div>
        </div>

        {/* Scrollable Viewport */}
        <main 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto p-4 sm:p-8 flex flex-col items-center bg-slate-950/80 relative"
        >
          {/* State 1: Rendering in progress */}
          {isRendering && (
            <div className="my-auto flex flex-col items-center justify-center p-8 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-sm text-center">
              <Loader2 className="h-10 w-10 text-indigo-500 animate-spin mb-4" />
              <h3 className="text-base font-bold text-white mb-1">Rendering Document Pages...</h3>
              <p className="text-xs text-slate-400 leading-relaxed font-mono">
                Capturing high-resolution A4 layout, awaiting assets, and applying page break rules.
              </p>
            </div>
          )}

          {/* State 2: Render Error */}
          {!isRendering && renderError && (
            <div className="my-auto flex flex-col items-center justify-center p-8 bg-red-950/40 border border-red-500/50 rounded-2xl shadow-2xl max-w-md text-center">
              <AlertCircle className="h-10 w-10 text-red-400 mb-3" />
              <h3 className="text-base font-bold text-red-200 mb-2">Document Render Failed</h3>
              <p className="text-xs text-red-300/90 leading-relaxed font-mono bg-red-950/80 p-3 rounded-lg border border-red-900/60 mb-4 w-full break-words">
                {renderError}
              </p>
              <button
                type="button"
                onClick={performRender}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-lg"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Retry Rendering</span>
              </button>
            </div>
          )}

          {/* State 3: Rendered Page Images */}
          {!isRendering && !renderError && renderedPages.length > 0 && (
            <div 
              style={{ 
                transform: `scale(${scale})`, 
                transformOrigin: 'top center',
                transition: fitMode === 'custom' ? 'none' : 'transform 0.15s ease-out'
              }}
              className="flex flex-col items-center gap-8 pb-20 print:p-0 print:transform-none"
            >
              {renderedPages.map((pageDataUrl, idx) => (
                <div 
                  key={`page-${idx}`}
                  data-page-index={idx}
                  className="flex flex-col items-center"
                >
                  {/* Page index badge */}
                  <div className="no-print mb-2 px-3 py-0.5 bg-slate-900/90 border border-slate-800 text-slate-400 rounded-full text-[11px] font-mono tracking-wider font-semibold shadow-xs">
                    PAGE {idx + 1} OF {totalPages}
                  </div>

                  {/* Physical A4 Sheet Presentation */}
                  <div 
                    className="bg-white rounded-xs shadow-2xl overflow-hidden border border-slate-700/60 relative"
                    style={{
                      width: '210mm',
                      height: '297mm',
                      boxSizing: 'border-box'
                    }}
                  >
                    <img
                      src={pageDataUrl}
                      alt={`Document Page ${idx + 1}`}
                      className="w-full h-full object-contain block bg-white"
                      loading="eager"
                      draggable={false}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </AnimatePresence>
  );
};

export default PrintPreviewModal;
