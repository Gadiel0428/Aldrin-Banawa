/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  Barcode, 
  X, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Keyboard, 
  Volume2, 
  VolumeX, 
  Radio, 
  Loader2,
  Camera,
  CameraOff,
  RefreshCw,
  ScanLine
} from 'lucide-react';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanResult: (code: string) => void;
  title?: string;
  subtitle?: string;
  initialTab?: 'scanner' | 'camera' | 'upload';
}

export default function BarcodeScannerModal({
  isOpen,
  onClose,
  onScanResult,
  title = "Barcode & QR Scanner",
  subtitle = "Scan material tag, lot label, or QR code using USB / Bluetooth scanner, camera, or image upload",
  initialTab = 'scanner'
}: BarcodeScannerModalProps) {
  const [activeTab, setActiveTab] = useState<'scanner' | 'camera' | 'upload'>(initialTab);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);

  // Camera states
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraScannerRef = useRef<Html5Qrcode | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const hiddenScannerRegionId = "html5-file-qr-region";
  const cameraRegionId = "html5-camera-view-region";

  // Web Audio API beep generator for successful barcode scan
  const playScanBeep = () => {
    if (!audioEnabled) return;
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, ctx.currentTime); // High pitch A6
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      console.warn("Audio context error", e);
    }
  };

  const handleSuccessfulScan = (decodedText: string) => {
    const clean = decodedText.trim();
    if (!clean) return;
    playScanBeep();
    setBarcodeInput('');
    setScannedCode(clean);
    
    // Stop camera if active
    if (cameraScannerRef.current) {
      cameraScannerRef.current.stop().catch(() => {}).finally(() => {
        try {
          cameraScannerRef.current?.clear();
        } catch {}
        cameraScannerRef.current = null;
        setCameraActive(false);
      });
    }

    setTimeout(() => {
      onScanResult(clean);
      onClose();
      setScannedCode(null);
    }, 450);
  };

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (barcodeInput.trim()) {
      handleSuccessfulScan(barcodeInput.trim());
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    try {
      const html5QrCode = new Html5Qrcode(hiddenScannerRegionId);
      const decodedText = await html5QrCode.scanFile(file, true);
      handleSuccessfulScan(decodedText);
      html5QrCode.clear();
    } catch (err: any) {
      console.error("File barcode scan error:", err);
      setUploadError("Could not detect a valid Barcode or QR Code in the uploaded image. Please try another photo or enter manually.");
    }
  };

  // Safely stop camera helper
  const safelyStopCamera = async () => {
    if (cameraScannerRef.current) {
      try {
        await cameraScannerRef.current.stop();
        cameraScannerRef.current.clear();
      } catch (e) {
        // Ignored
      }
      cameraScannerRef.current = null;
    }
    setCameraActive(false);
    setCameraStarting(false);
  };

  // Manage camera lifecycle
  useEffect(() => {
    let isCancelled = false;

    if (isOpen && activeTab === 'camera' && !scannedCode) {
      setCameraError(null);
      setCameraStarting(true);

      const timer = setTimeout(async () => {
        try {
          await safelyStopCamera();
          if (isCancelled) return;

          const scanner = new Html5Qrcode(cameraRegionId);
          cameraScannerRef.current = scanner;

          await scanner.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
              aspectRatio: 1.333333
            },
            (decodedText) => {
              if (!isCancelled) {
                handleSuccessfulScan(decodedText);
              }
            },
            () => {
              // Frame scanner tick
            }
          );

          if (!isCancelled) {
            setCameraActive(true);
            setCameraStarting(false);
          }
        } catch (err: any) {
          console.warn("Camera start failed:", err);
          if (!isCancelled) {
            setCameraStarting(false);
            setCameraActive(false);
            setCameraError("Camera access unavailable, permission denied, or in use by another app. You can switch to Handheld Scanner or Upload Image.");
          }
        }
      }, 200);

      return () => {
        isCancelled = true;
        clearTimeout(timer);
        safelyStopCamera();
      };
    } else {
      safelyStopCamera();
    }
  }, [isOpen, activeTab, scannedCode]);

  // Auto-focus barcode input whenever scanner modal opens or scanner tab is active
  useEffect(() => {
    if (isOpen) {
      setScannedCode(null);
      setBarcodeInput('');
      setUploadError(null);
      if (activeTab === 'scanner') {
        const timer = setTimeout(() => {
          inputRef.current?.focus();
        }, 150);
        return () => clearTimeout(timer);
      }
    } else {
      safelyStopCamera();
    }
  }, [isOpen, activeTab]);

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="barcode-scanner-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[105] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto"
        >
          {/* Hidden container for Html5Qrcode offline image scanner engine */}
          <div id={hiddenScannerRegionId} className="hidden" />

          <motion.div
            key="barcode-scanner-content"
            initial={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="frosted-glass-modal border border-white/20 rounded-3xl w-full max-w-lg shadow-2xl text-slate-100 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] my-auto backdrop-blur-3xl bg-slate-900/95"
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-3 bg-slate-950/40 backdrop-blur-md">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="p-2 bg-indigo-500/20 text-indigo-300 rounded-2xl border border-indigo-400/30 shrink-0 backdrop-blur-md">
                  <Barcode className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-sm text-white tracking-tight">
                    {title}
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setAudioEnabled(!audioEnabled)}
                  title={audioEnabled ? "Mute scan sound" : "Enable scan sound"}
                  className={`p-1.5 rounded-xl transition border cursor-pointer ${
                    audioEnabled ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-slate-950 text-slate-500 border-slate-800'
                  }`}
                >
                  {audioEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    safelyStopCamera();
                    onClose();
                  }}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Minimalist Tab Navigation */}
            <div className="px-5 pt-3 pb-1">
              <div className="flex p-1 bg-slate-950/60 rounded-xl border border-slate-800/80 text-xs gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('scanner')}
                  className={`flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer text-xs font-medium ${
                    activeTab === 'scanner'
                      ? 'bg-slate-800 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Barcode className="h-3.5 w-3.5" />
                  <span className="truncate">Handheld Scanner</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('camera')}
                  className={`flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer text-xs font-medium ${
                    activeTab === 'camera'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span className="truncate">Live Camera</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className={`flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer text-xs font-medium ${
                    activeTab === 'upload'
                      ? 'bg-slate-800 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span className="truncate">Upload Image</span>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Success / Verification Circle Loading Overlay */}
              {scannedCode && (
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-6 text-center space-y-2.5 animate-in fade-in duration-200">
                  <div className="inline-flex p-2.5 bg-indigo-500/10 text-indigo-400 rounded-full border border-indigo-500/20">
                    <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                  </div>
                  <h4 className="font-mono text-xs font-bold text-slate-200 uppercase tracking-wider">Verifying Barcode Data...</h4>
                  <p className="text-[11px] text-slate-400 font-mono break-all max-h-24 overflow-y-auto">{scannedCode}</p>
                </div>
              )}

              {/* TAB 1: Hardware Barcode Scanner Input */}
              {activeTab === 'scanner' && !scannedCode && (
                <div className="space-y-3.5">
                  <form onSubmit={handleInputSubmit} className="space-y-2.5">
                    {/* Header Row with Minimalist Status */}
                    <div className="flex items-center justify-between px-0.5">
                      <span className="text-[11px] font-mono font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Barcode className="h-3.5 w-3.5 text-slate-500" />
                        Active Barcode Reader Input
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span>Scanner Ready</span>
                      </div>
                    </div>

                    {/* Minimalist Input Bar */}
                    <div className="relative bg-slate-950/70 border border-slate-700/80 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500/30 rounded-xl p-1.5 transition-all flex items-center gap-2 shadow-xs">
                      <div className="pl-2.5 text-slate-400 shrink-0 flex items-center">
                        {barcodeInput ? (
                          <Loader2 className="h-4 w-4 text-indigo-400 animate-spin" />
                        ) : (
                          <Barcode className="h-4 w-4 text-slate-500" />
                        )}
                      </div>

                      <div className="relative flex-1 flex items-center min-h-[36px]">
                        <input
                          ref={inputRef}
                          type="text"
                          autoComplete="off"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          name="barcode_scan_input"
                          value={barcodeInput}
                          onChange={(e) => setBarcodeInput(e.target.value)}
                          placeholder="Scan barcode or type code..."
                          className="w-full bg-transparent px-1 text-sm font-mono focus:outline-none placeholder:text-slate-500 placeholder:font-sans placeholder:text-xs text-slate-100"
                          autoFocus
                        />
                      </div>

                      {barcodeInput && (
                        <button
                          type="button"
                          onClick={() => setBarcodeInput('')}
                          className="p-1 text-slate-500 hover:text-slate-300 rounded transition cursor-pointer"
                          title="Clear input"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <button
                        type="submit"
                        disabled={!barcodeInput.trim()}
                        className={`px-3.5 py-2 rounded-lg text-xs font-medium tracking-wide transition-all shrink-0 flex items-center gap-1.5 ${
                          barcodeInput.trim()
                            ? 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer shadow-xs'
                            : 'bg-slate-800/80 text-slate-500 border border-slate-700/40 cursor-not-allowed'
                        }`}
                      >
                        {barcodeInput ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                            <span>Processing</span>
                          </>
                        ) : (
                          <span>Submit</span>
                        )}
                      </button>
                    </div>

                    {/* Minimalist Subtle Note */}
                    <div className="pt-1 flex items-center gap-2 text-[11px] text-slate-400 px-1">
                      <Keyboard className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                      <span>Handheld scanners automatically input and submit barcode values into this field.</span>
                    </div>
                  </form>
                </div>
              )}

              {/* TAB 2: Live Camera Video Scanner */}
              {activeTab === 'camera' && !scannedCode && (
                <div className="space-y-3">
                  <div className="relative rounded-2xl overflow-hidden bg-black/90 border border-slate-700 aspect-video flex flex-col items-center justify-center">
                    {/* Live HTML5 QR Scanner Container */}
                    <div id={cameraRegionId} className="w-full h-full" />

                    {cameraStarting && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-xs gap-2 p-4 text-center">
                        <Loader2 className="h-8 w-8 text-indigo-400 animate-spin" />
                        <span className="text-xs text-slate-300 font-medium">Initializing camera feed...</span>
                      </div>
                    )}

                    {cameraError && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 p-4 text-center gap-2.5">
                        <div className="p-2.5 bg-rose-500/20 text-rose-400 rounded-full">
                          <CameraOff className="h-6 w-6" />
                        </div>
                        <p className="text-xs text-rose-300 max-w-xs">{cameraError}</p>
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setActiveTab('scanner')}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                          >
                            Use Handheld Scanner
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveTab('upload')}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                          >
                            Upload Photo
                          </button>
                        </div>
                      </div>
                    )}

                    {cameraActive && !cameraError && (
                      <div className="absolute top-2 left-2 z-10 px-2.5 py-1 rounded-full bg-slate-950/80 border border-emerald-500/40 text-[10px] font-mono text-emerald-400 flex items-center gap-1.5 backdrop-blur-sm pointer-events-none">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        <span>Camera Active: Point at QR / Barcode</span>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-400 text-center">
                    Hold material lot tag, roll barcode, or QR code steady inside the frame.
                  </p>
                </div>
              )}

              {/* TAB 3: File Upload Scanner */}
              {activeTab === 'upload' && !scannedCode && (
                <div className="space-y-3 text-center py-1">
                  <label className="border border-dashed border-slate-700/80 hover:border-slate-500 bg-slate-950/40 hover:bg-slate-950/70 rounded-xl p-6 cursor-pointer transition flex flex-col items-center justify-center gap-2.5">
                    <div className="p-2.5 bg-slate-800 text-slate-300 rounded-full border border-slate-700">
                      <Upload className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-medium text-slate-200 text-xs">Select Barcode or QR Image</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">PNG, JPG, WEBP, or SVG material tag images</p>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>

                  {uploadError && (
                    <div className="p-2.5 bg-amber-950/30 border border-amber-800/40 rounded-lg flex items-center gap-2 text-xs text-amber-300 text-left">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span className="text-[11px]">{uploadError}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-2.5 border-t border-slate-800/80 bg-slate-950/40 flex justify-between items-center text-[11px] text-slate-400">
              <span className="font-mono text-slate-500">USB / Bluetooth Scanner Ready</span>
              <button
                type="button"
                onClick={() => {
                  safelyStopCamera();
                  onClose();
                }}
                className="px-3 py-1 bg-slate-800/80 hover:bg-slate-800 text-slate-300 rounded-lg font-medium transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
}
