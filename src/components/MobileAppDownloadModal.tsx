import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Smartphone, 
  Download, 
  QrCode, 
  Check, 
  Copy, 
  ExternalLink, 
  X, 
  Layers, 
  Sparkles, 
  ShieldCheck, 
  Wifi, 
  Camera, 
  Zap, 
  ArrowRight,
  Info,
  CheckCircle2
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getPublicAppUrl } from '../config/serverConfig';

interface MobileAppDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverAddress?: string;
  onFreshInstallSync?: () => void;
  appVersion?: string;
}

export default function MobileAppDownloadModal({
  isOpen,
  onClose,
  serverAddress,
  onFreshInstallSync,
  appVersion
}: MobileAppDownloadModalProps) {
  const [activeTab, setActiveTab] = useState<'install' | 'qr' | 'apk' | 'handheld'>('install');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState<boolean>(false);
  const [installSuccess, setInstallSuccess] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  // Capture PWA beforeinstallprompt and appinstalled events
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      console.log('[JUWEI WMS] PWA installation confirmed.');
      setInstallSuccess(true);
      setIsInstallable(false);
      if (onFreshInstallSync) {
        onFreshInstallSync();
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Also check if already in standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setIsInstallable(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [onFreshInstallSync]);

  // Clean public production URL (Guarantees no Google/Gmail account sign-in screen on mobile devices)
  const currentUrl = getPublicAppUrl();
  const isHttps = typeof window !== 'undefined' ? window.location.protocol === 'https:' : true;

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      // If browser doesn't expose beforeinstallprompt, guide the user
      alert("To install on Android:\n1. Open this page in Chrome / Samsung Internet\n2. Tap the (⋮) menu button\n3. Tap 'Install app' or 'Add to Home screen'");
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallSuccess(true);
      setDeferredPrompt(null);
      setIsInstallable(false);
      if (onFreshInstallSync) {
        onFreshInstallSync();
      }
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(currentUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  const pwaBuilderUrl = `https://www.pwabuilder.com?url=${encodeURIComponent(currentUrl)}`;

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="mobile-app-download-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <motion.div
            key="mobile-app-download-content"
            initial={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="frosted-glass-modal border border-white/20 rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] my-auto backdrop-blur-3xl"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-slate-950/40 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/20 border border-indigo-400/30 rounded-2xl text-indigo-300 backdrop-blur-md">
                  <Smartphone className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                      JUWEI WMS Mobile APK & App Installation Hub
                    </h3>
                    <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold rounded-full font-mono">
                      ANDROID READY
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 font-mono">
                    Install as a standalone native-like mobile app on Android phones, tablets & scanners
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-slate-800 bg-slate-950/50 px-6 pt-2 gap-2 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab('install')}
                className={`px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border-b-2 transition flex items-center gap-2 cursor-pointer shrink-0 ${
                  activeTab === 'install'
                    ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Download className="h-4 w-4" />
                1-Tap Install / WebAPK
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('qr')}
                className={`px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border-b-2 transition flex items-center gap-2 cursor-pointer shrink-0 ${
                  activeTab === 'qr'
                    ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <QrCode className="h-4 w-4" />
                Scan QR on Mobile
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('apk')}
                className={`px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border-b-2 transition flex items-center gap-2 cursor-pointer shrink-0 ${
                  activeTab === 'apk'
                    ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="h-4 w-4" />
                Package APK (.apk)
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('handheld')}
                className={`px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border-b-2 transition flex items-center gap-2 cursor-pointer shrink-0 ${
                  activeTab === 'handheld'
                    ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Zap className="h-4 w-4" />
                Zebra / Handheld Terminal
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200">

              {/* No Gmail Account Required Banner */}
              <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl flex items-center gap-2.5 text-emerald-300 text-xs">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>Standalone Direct Access:</strong> No Google or Gmail account login required. Mobile scanners and tablets connect directly using internal operator credentials.
                </span>
              </div>

              {/* TAB 1: 1-Tap WebAPK Install */}
              {activeTab === 'install' && (
                <div className="space-y-6">
                  {/* Primary Action Card */}
                  <div className="bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-950 border border-indigo-500/30 rounded-2xl p-6 relative overflow-hidden">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5" />
                          INSTANT MOBILE WEBAPK DEPLOYMENT
                        </span>
                        <h4 className="text-lg font-bold text-white uppercase tracking-tight">
                          Install JUWEI WMS on Android
                        </h4>
                        <p className="text-xs text-slate-300 max-w-md font-sans">
                          Runs in standalone full-screen mode with full hardware barcode/QR camera scanning, offline caching, and automatic real-time sync with desktop terminals.
                        </p>
                      </div>

                      <div className="shrink-0 w-full sm:w-auto">
                        {installSuccess ? (
                          <div className="px-5 py-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-400 font-mono text-xs font-bold flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5" />
                            INSTALLED ON DEVICE
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={handleInstallClick}
                            className="w-full sm:w-auto px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-mono font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2.5 transition cursor-pointer"
                          >
                            <Download className="h-4 w-4" />
                            {isInstallable ? 'Install Android App' : 'Add to Mobile Home Screen'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Features Pill Row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5 pt-4 border-t border-slate-800/80">
                      <div className="flex items-center gap-2 text-slate-300 text-[11px] font-mono">
                        <Camera className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Barcode & QR Scan</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-300 text-[11px] font-mono">
                        <Wifi className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Real-Time Sync</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-300 text-[11px] font-mono">
                        <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
                        <span>PIN Authentication</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-300 text-[11px] font-mono">
                        <Zap className="h-3.5 w-3.5 text-cyan-400" />
                        <span>Offline Caching</span>
                      </div>
                    </div>
                  </div>

                  {/* Step by Step Guide for Android Browsers */}
                  <div className="space-y-3">
                    <h5 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                      How to Install on Android Phone / Tablet:
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                        <div className="h-6 w-6 rounded-full bg-indigo-500/20 text-indigo-400 font-mono text-xs font-bold flex items-center justify-center">
                          1
                        </div>
                        <h6 className="text-xs font-bold text-white font-mono">Open in Mobile Chrome</h6>
                        <p className="text-[11px] text-slate-400">
                          Scan the QR code or open the shared JUWEI WMS URL inside Google Chrome, Samsung Internet, or Microsoft Edge on your Android phone.
                        </p>
                      </div>

                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                        <div className="h-6 w-6 rounded-full bg-indigo-500/20 text-indigo-400 font-mono text-xs font-bold flex items-center justify-center">
                          2
                        </div>
                        <h6 className="text-xs font-bold text-white font-mono">Tap Menu (⋮)</h6>
                        <p className="text-[11px] text-slate-400">
                          Tap the three vertical dots <span className="text-white font-mono font-bold">⋮</span> in the top right corner of your browser toolbar.
                        </p>
                      </div>

                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                        <div className="h-6 w-6 rounded-full bg-indigo-500/20 text-indigo-400 font-mono text-xs font-bold flex items-center justify-center">
                          3
                        </div>
                        <h6 className="text-xs font-bold text-white font-mono">Tap "Install App"</h6>
                        <p className="text-[11px] text-slate-400">
                          Select <span className="text-emerald-400 font-mono font-bold">"Install app"</span> or <span className="text-emerald-400 font-mono font-bold">"Add to Home screen"</span>. The app icon will appear directly in your Android App Drawer!
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: QR Code */}
              {activeTab === 'qr' && (
                <div className="space-y-6">
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row items-center gap-6">
                    {/* QR Code Container */}
                    <div className="bg-white p-3 rounded-2xl shadow-xl shrink-0">
                      <QRCodeSVG 
                        value={currentUrl} 
                        size={180} 
                        level="H" 
                        includeMargin={true}
                      />
                    </div>

                    <div className="space-y-4 flex-1 text-center md:text-left">
                      <div>
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest font-mono">
                          QUICK CAMERA PAIRING
                        </span>
                        <h4 className="text-base font-bold text-white uppercase tracking-tight mt-1">
                          Scan with Android Camera
                        </h4>
                        <p className="text-xs text-slate-400 mt-1">
                          Point your Android smartphone camera or tablet scanner at this QR code to immediately launch the JUWEI WMS mobile workspace.
                        </p>
                      </div>

                      {/* URL Display and Copy Button */}
                      <div className="space-y-2">
                        <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 break-all select-all flex items-center justify-between gap-2">
                          <span className="truncate">{currentUrl}</span>
                        </div>

                        <button
                          type="button"
                          onClick={handleCopyUrl}
                          className="w-full sm:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-mono text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition cursor-pointer"
                        >
                          {copiedUrl ? (
                            <>
                              <Check className="h-4 w-4 text-emerald-400" />
                              <span className="text-emerald-400">Copied to Clipboard!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4" />
                              <span>Copy Mobile Access Link</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Package APK */}
              {activeTab === 'apk' && (
                <div className="space-y-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
                          Android Package (.apk) Information
                        </h4>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Standard Android Application Package specifications for JUWEI WMS:
                        </p>
                      </div>
                      <span className="px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[10px] font-bold rounded-lg font-mono">
                        v{appVersion || (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '')}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
                        <span className="text-slate-500 block text-[10px]">PACKAGE NAME</span>
                        <span className="text-slate-200 font-bold">com.juwei.wms</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
                        <span className="text-slate-500 block text-[10px]">TARGET OS</span>
                        <span className="text-slate-200 font-bold">Android 8.0+ (Oreo to Android 15)</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
                        <span className="text-slate-500 block text-[10px]">REQUIRED PERMISSIONS</span>
                        <span className="text-emerald-400 font-bold">Camera (Barcode), Network, Storage</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
                        <span className="text-slate-500 block text-[10px]">APPLICATION TYPE</span>
                        <span className="text-indigo-400 font-bold">Industrial PWA / WebAPK</span>
                      </div>
                    </div>

                    <div className="p-4 bg-indigo-950/20 border border-indigo-500/20 rounded-xl space-y-2 text-xs">
                      <div className="flex items-center gap-2 font-bold text-indigo-300 font-mono">
                        <Info className="h-4 w-4 text-indigo-400" />
                        How to generate a standalone signed APK file:
                      </div>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        You can package this live web app into a signed Android <code className="text-emerald-400 font-mono">.apk</code> / <code className="text-emerald-400 font-mono">.aab</code> using Microsoft PWABuilder, Bubblewrap CLI, or Android Studio.
                      </p>
                      <div className="pt-2">
                        <a
                          href={pwaBuilderUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold rounded-lg transition"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Build Standalone APK via PWABuilder
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: Zebra / Handheld Terminal */}
              {activeTab === 'handheld' && (
                <div className="space-y-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4">
                    <h4 className="text-sm font-bold text-white uppercase font-mono tracking-wider flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-400" />
                      Industrial Android Scanner & Zebra Setup
                    </h4>
                    <p className="text-xs text-slate-400">
                      Follow these guidelines for dedicated warehouse barcode guns, Zebra TC Series, Honeywell ScanPal, and forklift-mounted tablets:
                    </p>

                    <div className="space-y-3 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                        <span className="font-bold text-white font-mono flex items-center gap-1.5">
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          1. Hardware Barcode Wedge Integration
                        </span>
                        <p className="text-slate-400 text-[11px]">
                          Enable "Keystroke Output" or "Keyboard Wedge" in Zebra DataWedge / Honeywell scanner settings. All scanned barcodes (Part Codes, Lot Numbers, Location Racks) will automatically populate inputs in Receiving, Stock FIFO, and Issuance.
                        </p>
                      </div>

                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                        <span className="font-bold text-white font-mono flex items-center gap-1.5">
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          2. Kiosk & Enterprise Home Screen (EHS)
                        </span>
                        <p className="text-slate-400 text-[11px]">
                          Add JUWEI WMS to Zebra Enterprise Home Screen or Android Kiosk mode to restrict operators to only warehouse functions during shift operations.
                        </p>
                      </div>

                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                        <span className="font-bold text-white font-mono flex items-center gap-1.5">
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          3. Offline Resilience & Shift Data
                        </span>
                        <p className="text-slate-400 text-[11px]">
                          The mobile app stores registered operator credentials and pending transaction sync queues locally. If WiFi coverage drops in deep rack aisles, records queue safely and synchronize once reconnected.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500 text-[11px]">
                JUWEI PLASTIC MOULDING PHILS. INC. • MOBILE EDITION
              </span>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition cursor-pointer"
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
