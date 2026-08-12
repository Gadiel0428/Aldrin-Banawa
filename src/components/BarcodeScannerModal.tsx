/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
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
  Loader2
} from 'lucide-react';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanResult: (code: string) => void;
  title?: string;
  subtitle?: string;
  sampleCodes?: { code: string; label: string; name?: string; description?: string }[];
}

export default function BarcodeScannerModal({
  isOpen,
  onClose,
  onScanResult,
  title = "WMS Barcode Scanner",
  subtitle = "Scan material tag or lot label using USB / Bluetooth handheld barcode scanner",
  sampleCodes = [
    { code: 'RM-RE-089', label: 'Polystyrene Resin', name: 'Polystyrene Resin', description: 'Raw plastic resin grade ABS/PS' },
    { code: 'PM-CB-012', label: 'Carton Boxes', name: 'Carton Boxes', description: 'Double wall packaging boxes' },
    { code: 'CHEM-SOL-05', label: 'Cleaning Solvent', name: 'Cleaning Solvent', description: 'Industrial grade degreaser' },
    { code: 'LOT-2605-A', label: 'Lot 2605-A', name: 'Lot 2605-A', description: 'Batch control lot barcode tag' }
  ]
}: BarcodeScannerModalProps) {
  const [activeTab, setActiveTab] = useState<'scanner' | 'upload'>('scanner');
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const hiddenScannerRegionId = "html5-file-qr-region";

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
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-blue-950/80 backdrop-blur-md animate-fade-in">
      {/* Hidden container for Html5Qrcode offline image scanner engine */}
      <div id={hiddenScannerRegionId} className="hidden" />

      <div className="bg-blue-900 border-2 border-blue-700 rounded-2xl w-full max-w-lg shadow-2xl text-white overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-blue-800 flex items-center justify-between gap-3 bg-blue-950">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="p-2.5 bg-blue-800 text-blue-200 rounded-xl border border-blue-600 shrink-0">
              <Barcode className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="font-bold text-sm sm:text-base text-white tracking-tight leading-tight">
                  {title}
                </h3>
                <span className="text-[10px] font-mono font-bold bg-blue-800 text-blue-100 border border-blue-600 px-2.5 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap shrink-0">
                  WMS HARDWARE SCANNER
                </span>
              </div>
              <p className="text-xs text-blue-200 mt-1 leading-normal">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-center">
            <button
              type="button"
              onClick={() => setAudioEnabled(!audioEnabled)}
              title={audioEnabled ? "Mute scan sound" : "Enable scan sound"}
              className={`p-2 rounded-lg transition border cursor-pointer ${
                audioEnabled ? 'bg-blue-800 text-white border-blue-600' : 'bg-blue-950 text-blue-300 border-blue-800'
              }`}
            >
              {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-blue-200 hover:text-white hover:bg-blue-800 rounded-lg transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-blue-800 bg-blue-950 p-1.5 gap-1.5 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('scanner')}
            className={`flex-1 py-2 px-3 rounded-lg transition flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'scanner'
                ? 'bg-blue-600 text-white font-bold shadow-md'
                : 'text-blue-200 hover:text-white hover:bg-blue-800'
            }`}
          >
            <Barcode className="h-4 w-4" />
            Handheld Scanner
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-2 px-3 rounded-lg transition flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-blue-600 text-white font-bold shadow-md'
                : 'text-blue-200 hover:text-white hover:bg-blue-800'
            }`}
          >
            <Upload className="h-4 w-4" />
            Upload Image
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Success / Verification Circle Loading Overlay */}
          {scannedCode && (
            <div className="bg-slate-950/90 border border-indigo-500/50 rounded-xl p-6 text-center space-y-3 animate-in fade-in duration-200">
              <div className="inline-flex p-3 bg-indigo-500/10 text-indigo-400 rounded-full border border-indigo-500/20">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
              </div>
              <h4 className="font-bold text-indigo-300 text-sm tracking-wide uppercase font-mono">VERIFYING QR CODE & LOGGING IN...</h4>
              <p className="text-xs text-slate-400">Authenticating operator credentials, please wait...</p>
            </div>
          )}

          {/* TAB 1: Hardware Barcode Scanner Input */}
          {activeTab === 'scanner' && !scannedCode && (
            <div className="space-y-4">
              {/* Hardware Input Area */}
              <form onSubmit={handleInputSubmit} className="space-y-3">
                {/* Header Row with Status */}
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <Barcode className="h-4 w-4 text-indigo-400" />
                    Active Barcode Reader Input
                  </label>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Scanner Ready
                  </div>
                </div>

                {/* Sleek Dark Input Bar */}
                <div className="relative bg-slate-950 border-2 border-indigo-500/70 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/20 rounded-xl p-2 transition-all flex items-center gap-2.5 shadow-inner">
                  <div className="pl-2 text-indigo-400 shrink-0 flex items-center">
                    {barcodeInput ? (
                      <Loader2 className="h-5 w-5 text-indigo-400 animate-spin" />
                    ) : (
                      <Barcode className="h-5 w-5 text-indigo-400" />
                    )}
                  </div>

                  <div className="relative flex-1 flex items-center min-h-[38px]">
                    <input
                      ref={inputRef}
                      type="password"
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      placeholder="Scan barcode or type code..."
                      className={`w-full bg-transparent px-2 py-1 text-sm font-mono font-bold focus:outline-none placeholder:text-slate-500 placeholder:font-sans placeholder:font-normal ${
                        barcodeInput ? 'text-transparent caret-indigo-400' : 'text-slate-100'
                      }`}
                      autoFocus
                    />
                    {barcodeInput && (
                      <div className="absolute inset-0 flex items-center pointer-events-none px-2">
                        <span className="text-xs font-mono font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-indigo-400 shrink-0" />
                          CAPTURING BARCODE DATA...
                        </span>
                      </div>
                    )}
                  </div>

                  {barcodeInput && (
                    <button
                      type="button"
                      onClick={() => setBarcodeInput('')}
                      className="p-1 text-slate-500 hover:text-slate-300 rounded transition cursor-pointer"
                      title="Clear input"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={!barcodeInput.trim()}
                    className={`px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 shrink-0 flex items-center gap-2 ${
                      barcodeInput.trim()
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 cursor-pointer'
                        : 'bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed'
                    }`}
                  >
                    {barcodeInput ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-white" />
                        <span>PROCESSING</span>
                      </>
                    ) : (
                      <span>SUBMIT</span>
                    )}
                  </button>
                </div>

                {/* Helper Banner */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex items-start gap-3 text-xs text-slate-400">
                  <div className="p-1.5 bg-slate-800/80 rounded-lg shrink-0 text-indigo-400 border border-slate-700/60">
                    <Keyboard className="h-4 w-4" />
                  </div>
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <p className="font-semibold text-slate-300 text-xs">Automated Hardware Input Receiver</p>
                    <p className="text-[11px] leading-normal text-slate-400">
                      Standard USB or Bluetooth handheld barcode scanners automatically transmit data into this active field.
                    </p>
                  </div>
                </div>
              </form>

              {/* Sample / Test Presets */}
              {sampleCodes && sampleCodes.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>Quick Test Presets (Click to Simulate Scan):</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {sampleCodes.map((sample, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSuccessfulScan(sample.code)}
                        className="text-left p-2.5 bg-slate-950 hover:bg-indigo-950/50 border border-slate-800 hover:border-indigo-500/50 rounded-xl transition group cursor-pointer flex flex-col justify-between gap-1"
                      >
                        <div className="text-xs font-bold text-indigo-300 group-hover:text-indigo-200 truncate">
                          {sample.label || sample.name || sample.code}
                        </div>
                        {sample.description && (
                          <div className="text-[10px] text-slate-500 truncate">
                            {sample.description}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: File Upload Scanner */}
          {activeTab === 'upload' && !scannedCode && (
            <div className="space-y-4 text-center py-2">
              <label className="border-2 border-dashed border-slate-700 hover:border-indigo-500 bg-slate-950/60 hover:bg-slate-950 rounded-2xl p-8 cursor-pointer transition flex flex-col items-center justify-center gap-3">
                <div className="p-4 bg-indigo-600/20 text-indigo-400 rounded-full border border-indigo-500/30">
                  <Upload className="h-8 w-8" />
                </div>
                <div>
                  <h4 className="font-bold text-white text-sm">Select Barcode or QR Image File</h4>
                  <p className="text-xs text-slate-400 mt-1">Parses PNG, JPG, WEBP, or SVG material tag images</p>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {uploadError && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl flex items-center gap-2 text-xs text-amber-300 text-left">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                  <span>{uploadError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex justify-between items-center text-xs text-slate-400">
          <span className="font-mono text-[11px]">Hardware Mode: USB / Bluetooth Barcode Scanner</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold transition cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
