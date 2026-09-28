import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  QrCode, 
  Printer, 
  X, 
  ShieldCheck, 
  Lock, 
  Building2, 
  UserCheck, 
  Check, 
  Copy,
  CreditCard,
  Sparkles,
  Eye,
  EyeOff,
  Phone,
  Download
} from 'lucide-react';
import { RegisteredAccount } from '../types';
import { executePrint } from '../utils/printDocument';

interface AccountQRBadgeModalProps {
  account: RegisteredAccount;
  isOpen: boolean;
  onClose: () => void;
  onDirectLogin?: (account: RegisteredAccount) => void;
}

export default function AccountQRBadgeModal({
  account,
  isOpen,
  onClose,
  onDirectLogin
}: AccountQRBadgeModalProps) {
  const [copied, setCopied] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Structured QR Payload containing Username and PIN Code
  const qrPayload = JSON.stringify({
    type: 'JPMP_WMS_LOGIN_PASS',
    employeeId: account?.employeeId || '',
    username: account?.username || '',
    pin: account?.pin || '1234',
    role: account?.role || ''
  });

  const handleCopyPayload = () => {
    navigator.clipboard.writeText(qrPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadBadge = () => {
    setIsDownloading(true);
    try {
      const svgElement = document.querySelector('#badge-qr-svg-wrapper svg') as SVGGraphicsElement;
      if (!svgElement) {
        setIsDownloading(false);
        return;
      }

      const svgData = new XMLSerializer().serializeToString(svgElement);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      // High-resolution canvas for the badge pass
      canvas.width = 400;
      canvas.height = 540;

      img.onload = () => {
        if (!ctx) return;

        // Background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Header Border
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, 0, canvas.width, 10);

        // Title
        ctx.fillStyle = '#1e40af';
        ctx.font = 'bold 12px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('JUWEI PLASTIC MOULDING PHILS. INC.', 200, 36);

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 15px Arial, sans-serif';
        ctx.fillText('OPERATOR LOGIN QR PASS', 200, 58);

        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 11px Arial, sans-serif';
        ctx.fillText(account.role.toUpperCase(), 200, 76);

        // Draw QR Code
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(90, 95, 220, 220);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.strokeRect(90, 95, 220, 220);
        ctx.drawImage(img, 100, 105, 200, 200);

        // User Info Box
        ctx.fillStyle = '#0f172a';
        ctx.roundRect ? ctx.roundRect(40, 335, 320, 140, 12) : ctx.fillRect(40, 335, 320, 140);
        ctx.fill();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 16px Arial, sans-serif';
        ctx.fillText(account.username.toUpperCase(), 200, 365);

        ctx.fillStyle = '#a5b4fc';
        ctx.font = 'bold 13px monospace';
        ctx.fillText(`EMPLOYEE ID: ${account.employeeId}`, 200, 390);

        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 13px monospace';
        ctx.fillText(`LOGIN PIN: ${account.pin || '1234'}`, 200, 415);

        if (account.phoneNumber) {
          ctx.fillStyle = '#4ade80';
          ctx.font = '11px monospace';
          ctx.fillText(`TEL: ${account.phoneNumber}`, 200, 440);
        }

        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px Arial, sans-serif';
        ctx.fillText('SCAN AT JUWEI WMS GATEWAY TO AUTO-LOGIN', 200, 510);

        const a = document.createElement('a');
        a.download = `JPMP-Pass-${account.username}-${account.employeeId}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
        setIsDownloading(false);
      };

      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    } catch (e) {
      setIsDownloading(false);
    }
  };

  const handlePrintBadge = () => {
    executePrint();
  };

  const modalContent = (
    <AnimatePresence>
      {isOpen && account && (
        <motion.div
          key="qr-badge-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto print:p-0 print:bg-white print:static"
        >
          <motion.div
            key="qr-badge-content"
            initial={{ opacity: 0, scale: 0.94, y: 14, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.94, y: 14, filter: 'blur(8px)' }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="frosted-glass-modal rounded-3xl max-w-sm w-full shadow-2xl text-white overflow-hidden flex flex-col relative border border-white/20 max-h-[calc(100vh-2rem)] my-auto print:max-h-none print:border-none print:shadow-none print:overflow-visible print:bg-transparent"
          >
            {/* Top Accent Line */}
            <div className="h-1 bg-gradient-to-r from-indigo-500 via-sky-400 to-emerald-400 w-full shrink-0 print:hidden" />

            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-white/10 flex justify-between items-center bg-slate-950/60 backdrop-blur-md shrink-0 print:hidden">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-500/20 text-indigo-300 rounded-xl border border-indigo-400/30 backdrop-blur-md">
                  <QrCode className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                    Operator Login QR Badge
                  </h3>
                  <p className="text-[10px] text-indigo-300 font-mono uppercase">
                    Juwei WMS Gateway Pass
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition cursor-pointer"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Badge Card Body - Scrollable if screen height is constrained */}
            <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1 print:p-0 print:overflow-visible">
              {/* Official Pass Badge Graphic (Full Badge Printable Area) */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border-2 border-blue-900 shadow-xl text-blue-950 text-center space-y-2.5 relative overflow-hidden printable-area printable-badge print:border-2 print:border-blue-900 print:shadow-none">
                {/* Watermark / Header */}
                <div className="border-b-2 border-blue-100 pb-2">
                  <div className="text-[10px] font-extrabold text-blue-800 font-mono tracking-widest uppercase">
                    JUWEI PLASTIC MOULDING PHILS. INC.
                  </div>
                  <div className="text-xs font-black text-blue-950 tracking-tight uppercase flex items-center justify-center gap-1.5 mt-0.5">
                    <CreditCard className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    <span>WMS OPERATOR LOGIN QR PASS</span>
                  </div>
                </div>

                {/* QR Code Container */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 inline-block shadow-inner my-0.5" id="badge-qr-svg-wrapper">
                  <QRCodeSVG
                    value={qrPayload}
                    size={135}
                    level="H"
                    includeMargin={true}
                    aria-label={`QR Login Pass for ${account.username}`}
                  />
                </div>

                {/* Operator Credentials */}
                <div className="bg-blue-950 text-white p-3 rounded-xl text-center space-y-1">
                  <div className="text-xs font-black uppercase text-white tracking-wide">
                    {account.username}
                  </div>
                  <div className="text-[11px] font-mono font-bold text-blue-200">
                    EMPLOYEE ID: {account.employeeId}
                  </div>
                  {account.phoneNumber && (
                    <div className="text-[10px] font-mono font-semibold text-emerald-400 flex items-center justify-center gap-1">
                      <Phone className="h-3 w-3 shrink-0" /> <span>{account.phoneNumber}</span>
                    </div>
                  )}
                  <div className="text-[10px] font-semibold text-blue-300 uppercase">
                    {account.role}
                  </div>

                  {/* Security PIN Display */}
                  <div className="pt-2 border-t border-blue-800/80 mt-1.5 flex items-center justify-between px-2">
                    <span className="text-[9px] font-mono font-bold text-blue-200 uppercase flex items-center gap-1">
                      <Lock className="h-3 w-3 text-blue-300 shrink-0" /> LOGIN PIN:
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-mono font-black text-white bg-blue-900 px-2.5 py-0.5 rounded border border-blue-500 tracking-widest min-w-[58px] text-center print:hidden">
                        {showPin ? (account.pin || '1234') : '••••'}
                      </span>
                      <span className="text-sm font-mono font-black text-white bg-blue-900 px-2.5 py-0.5 rounded border border-blue-500 tracking-widest min-w-[58px] text-center hidden print:inline">
                        {account.pin || '1234'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPin(!showPin)}
                        className="p-1 text-blue-300 hover:text-white transition cursor-pointer print:hidden"
                        title={showPin ? "Hide PIN" : "Reveal PIN"}
                      >
                        {showPin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="text-[8px] text-blue-900 font-mono font-bold tracking-tight uppercase">
                  SCAN QR CODE AT WMS LOG IN GATEWAY TO ACCESS SESSION
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-0.5 print:hidden">
                {onDirectLogin && (
                  <button
                    type="button"
                    onClick={() => {
                      onDirectLogin(account);
                      onClose();
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-md uppercase cursor-pointer"
                  >
                    <UserCheck className="h-4 w-4" /> LOG IN AS {account.username}
                  </button>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={handlePrintBadge}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-1 rounded-xl text-[11px] transition flex items-center justify-center gap-1 shadow-sm uppercase cursor-pointer whitespace-nowrap"
                    title="Direct in-app print pass"
                  >
                    <Printer className="h-3.5 w-3.5 shrink-0" /> PRINT
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadBadge}
                    disabled={isDownloading}
                    className="bg-blue-700 hover:bg-blue-600 text-white font-bold py-2 px-1 rounded-xl text-[11px] transition flex items-center justify-center gap-1 shadow-sm uppercase cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    title="Download QR Badge Image as PNG"
                  >
                    <Download className="h-3.5 w-3.5 shrink-0" /> {isDownloading ? 'SAVING...' : 'SAVE PNG'}
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyPayload}
                    className="bg-blue-950 hover:bg-blue-800 text-white border border-blue-700 font-bold py-2 px-1 rounded-xl text-[11px] transition flex items-center justify-center gap-1 uppercase cursor-pointer whitespace-nowrap"
                    title="Copy QR payload string"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-blue-300 shrink-0" /> COPIED!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-blue-300 shrink-0" /> COPY DATA
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-2.5 border-t border-blue-900/60 bg-blue-950/90 text-[10px] text-blue-300 font-mono text-center shrink-0">
              JUWEI WMS OPERATOR SECURITY SYSTEM • QR VERIFICATION ENABLED
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
