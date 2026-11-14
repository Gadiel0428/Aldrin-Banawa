import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Printer, 
  X, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Eye, 
  EyeOff, 
  FileText,
  RotateCcw,
  Loader2
} from 'lucide-react';
import { exportElementAsPDF } from '../utils/printDocument';

export interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentTitle: string;
  documentSubtitle?: string;
  documentNumber?: string;
  children: React.ReactNode;
  onPrint?: () => void;
  /** Optional view switcher tabs to embed directly in preview toolbar */
  extraToolbarControls?: React.ReactNode;
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  isOpen,
  onClose,
  documentTitle,
  documentSubtitle = 'A4 Print Layout Preview',
  documentNumber,
  children,
  onPrint,
  extraToolbarControls
}) => {
  const [scale, setScale] = useState<number>(1.0);
  const [showMarginGuides, setShowMarginGuides] = useState<boolean>(true);
  const [fitMode, setFitMode] = useState<'custom' | 'fit-width' | 'actual'>('actual');
  const [isExportingPDF, setIsExportingPDF] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const paperSheetRef = useRef<HTMLDivElement>(null);

  // Keyboard accessibility: Escape to close, Ctrl/Cmd+P to trigger print
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handleExecutePrint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset or adjust zoom on open
  useEffect(() => {
    if (isOpen) {
      // Auto-fit if viewport is small (e.g. tablet or compact window)
      if (window.innerWidth < 1024) {
        fitToWidth();
      } else {
        setScale(1.0);
        setFitMode('actual');
      }
    }
  }, [isOpen]);

  const handleExecutePrint = async () => {
    if (isExportingPDF) return;
    if (paperSheetRef.current) {
      setIsExportingPDF(true);
      try {
        const filename = `${documentNumber ? `JUWEI-${documentNumber}` : 'JUWEI-Document'}.pdf`;
        await exportElementAsPDF(paperSheetRef.current, filename);
      } catch (err) {
        console.error('[PrintPreviewModal] PDF export error:', err);
      } finally {
        setIsExportingPDF(false);
      }
    } else if (onPrint) {
      onPrint();
    }
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
    const containerWidth = scrollContainerRef.current.clientWidth - 48; // padding allowance
    // A4 width is 210mm ≈ 794px at 96dpi
    const a4PixelWidth = 794;
    const calculatedScale = Math.min(1.2, Math.max(0.45, Math.floor((containerWidth / a4PixelWidth) * 100) / 100));
    setScale(calculatedScale);
    setFitMode('fit-width');
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-[200] overflow-hidden bg-slate-950/95 flex flex-col backdrop-blur-xl print:p-0 print:bg-white print:static print:inset-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Document Print Preview"
      >
        {/* Top Floating Control Bar (Hidden on actual print) */}
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
                <span className="text-emerald-400">10mm Top & Side Margins</span>
              </div>
            </div>
          </div>

          {/* Optional Extra View Switcher Controls (e.g. Doc Mode tabs) */}
          {extraToolbarControls && (
            <div className="hidden lg:flex items-center">
              {extraToolbarControls}
            </div>
          )}

          {/* Zone 2: Interactive Zoom & Margin Guide Controls */}
          <div className="flex items-center gap-1.5 bg-slate-950/70 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              type="button"
              onClick={zoomOut}
              disabled={scale <= 0.45}
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
              disabled={scale >= 1.75}
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

            <div className="h-4 w-px bg-slate-800 mx-1" aria-hidden="true" />

            {/* Toggle 10mm Print Margin Guides */}
            <button
              type="button"
              onClick={() => setShowMarginGuides(!showMarginGuides)}
              className={`px-2 py-1 rounded-lg flex items-center gap-1.5 font-medium transition cursor-pointer ${
                showMarginGuides
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle 10mm Margin Boundaries"
            >
              {showMarginGuides ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              <span>Guides</span>
            </button>
          </div>

          {/* Zone 3: Print Action & Close */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExecutePrint}
              disabled={isExportingPDF}
              className={`px-4 py-2 ${isExportingPDF ? 'bg-indigo-800 text-indigo-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white cursor-pointer'} font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-400`}
              title="Generate real A4 PDF file and open directly (Ctrl+P)"
            >
              {isExportingPDF ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                  <span className="whitespace-nowrap font-mono tracking-tight">GENERATING PDF...</span>
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4" />
                  <span className="whitespace-nowrap font-mono tracking-tight">PRINT DOCUMENT</span>
                </>
              )}
            </button>

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

        {/* Informational Sheet Banner above paper canvas */}
        <div className="no-print bg-slate-900/60 border-b border-slate-800/80 px-4 py-1.5 flex items-center justify-between text-[11px] text-slate-400 shrink-0 font-mono">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Exact @page layout preview (A4: 210 × 297 mm, 10mm margin on all edges)</span>
          </div>
          <div className="flex items-center gap-3">
            <span>Press <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-200 border border-slate-700">Ctrl+P</kbd> to print directly</span>
            <span>·</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-200 border border-slate-700">Esc</kbd> to exit</span>
          </div>
        </div>

        {/* Paper Canvas Viewport Area */}
        <main 
          ref={scrollContainerRef}
          className="flex-1 overflow-auto p-4 sm:p-8 flex justify-center items-start bg-slate-950/80 relative print:p-0 print:overflow-visible print:bg-white"
        >
          {/* Scalable Container */}
          <div 
            style={{ 
              transform: `scale(${scale})`, 
              transformOrigin: 'top center',
              transition: fitMode === 'custom' ? 'none' : 'transform 0.15s ease-out'
            }}
            className="pb-16 print:p-0 print:transform-none"
          >
            {/* Realistic A4 Physical Sheet Container */}
            <article 
              ref={paperSheetRef}
              className="printable-area bg-white text-slate-900 shadow-2xl relative transition-shadow duration-200 mx-auto print:shadow-none print:m-0"
              style={{
                width: '210mm',
                minHeight: '297mm',
                boxSizing: 'border-box',
                padding: '10mm', // Matches @page { size: A4; margin: 10mm; }
              }}
            >
              {/* Optional Visual 10mm Margin Guide Overlay (strictly hidden during print) */}
              {showMarginGuides && (
                <div 
                  className="no-print pointer-events-none absolute inset-[10mm] border border-dashed border-sky-400/40 rounded-none z-10"
                  aria-hidden="true"
                >
                  <div className="absolute -top-3 left-2 bg-sky-50 text-sky-700 border border-sky-300 text-[9px] font-mono px-1.5 py-0.2 rounded shadow-2xs font-bold uppercase">
                    10mm Print Margin Guide
                  </div>
                  <div className="absolute -bottom-3 right-2 bg-sky-50 text-sky-700 border border-sky-300 text-[9px] font-mono px-1.5 py-0.2 rounded shadow-2xs font-bold uppercase">
                    A4 Boundary
                  </div>
                </div>
              )}

              {/* Document Content Rendered Exactly with Print Typography */}
              <div className="w-full text-slate-900 font-sans print-content-body">
                {children}
              </div>
            </article>
          </div>
        </main>
      </div>
    </AnimatePresence>
  );
};

export default PrintPreviewModal;
