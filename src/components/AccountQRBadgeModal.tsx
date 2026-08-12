import React, { useState } from 'react';
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
  EyeOff
} from 'lucide-react';
import { RegisteredAccount } from './RegisteredAccountsModule';

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

  if (!isOpen || !account) return null;

  // Structured QR Payload containing Username and PIN Code
  const qrPayload = JSON.stringify({
    type: 'JPMP_WMS_LOGIN_PASS',
    employeeId: account.employeeId,
    username: account.username,
    pin: account.pin || '1234',
    role: account.role
  });

  const handleCopyPayload = () => {
    navigator.clipboard.writeText(qrPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrintBadge = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Pop-up blocked. Please allow pop-ups to print the login pass.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>JPMP Login QR Pass - ${account.username} (${account.employeeId})</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background-color: #f8fafc;
              text-transform: uppercase;
            }
            .badge {
              width: 340px;
              border: 2px solid #1e293b;
              border-radius: 16px;
              padding: 24px;
              background: #ffffff;
              text-align: center;
              box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
            }
            .header {
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 12px;
              margin-bottom: 16px;
            }
            .company {
              font-size: 11px;
              font-weight: bold;
              color: #4f46e5;
              letter-spacing: 1px;
            }
            .title {
              font-size: 16px;
              font-weight: 800;
              color: #0f172a;
              margin-top: 4px;
            }
            .role {
              font-size: 10px;
              font-weight: 700;
              color: #64748b;
              margin-top: 2px;
            }
            .qr-container {
              background: #f1f5f9;
              border: 1px solid #cbd5e1;
              border-radius: 12px;
              padding: 16px;
              display: inline-block;
              margin: 12px 0;
            }
            .user-info {
              background: #0f172a;
              color: #ffffff;
              border-radius: 10px;
              padding: 12px;
              margin-top: 12px;
            }
            .emp-name {
              font-size: 14px;
              font-weight: 800;
              color: #38bdf8;
            }
            .emp-id {
              font-size: 12px;
              font-weight: bold;
              color: #a5b4fc;
              margin-top: 2px;
              font-family: monospace;
            }
            .footer {
              font-size: 8px;
              color: #94a3b8;
              margin-top: 14px;
              letter-spacing: 0.5px;
            }
            @media print {
              body { background: none; }
              .badge { box-shadow: none; }
            }
          </style>
        </head>
        <body>
          <div class="badge">
            <div class="header">
              <div class="company">JUWEI PLASTIC MOULDING PHILS. INC.</div>
              <div class="title">OFFICIAL OPERATOR QR LOGIN PASS</div>
              <div class="role">${account.role}</div>
            </div>
            
            <div class="qr-container">
              ${document.getElementById('badge-qr-svg-wrapper')?.innerHTML || ''}
            </div>

            <div class="user-info">
              <div class="emp-name">${account.username}</div>
              <div class="emp-id">ID: ${account.employeeId}</div>
            </div>

            <div class="footer">
              SECURITY CONFIDENTIAL • SCAN AT JUWEI WMS GATEWAY TO AUTO-LOGIN
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-blue-950/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-blue-900 border-2 border-blue-700 rounded-2xl max-w-sm w-full shadow-2xl text-white overflow-hidden flex flex-col relative">
        {/* Top Accent Line */}
        <div className="h-1.5 bg-blue-500 w-full" />

        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-blue-800 flex justify-between items-center bg-blue-950">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-800 text-blue-200 rounded-xl border border-blue-600">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                Operator Login QR Badge
              </h3>
              <p className="text-[10px] text-blue-200 font-mono uppercase">
                Juwei WMS Gateway Pass
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-blue-200 hover:text-white p-1 rounded-lg hover:bg-blue-800 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Badge Card Body */}
        <div className="p-5 space-y-4">
          {/* Official Pass Badge Graphic */}
          <div className="bg-white rounded-2xl p-5 border-2 border-blue-900 shadow-xl text-blue-950 text-center space-y-3 relative overflow-hidden">
            {/* Watermark / Header */}
            <div className="border-b-2 border-blue-100 pb-2">
              <div className="text-[10px] font-extrabold text-blue-800 font-mono tracking-widest uppercase">
                JUWEI PLASTIC MOULDING PHILS. INC.
              </div>
              <div className="text-xs font-black text-blue-950 tracking-tight uppercase flex items-center justify-center gap-1 mt-0.5">
                <CreditCard className="h-3.5 w-3.5 text-blue-600" />
                WMS OPERATOR LOGIN QR PASS
              </div>
            </div>

            {/* QR Code Container */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 inline-block shadow-inner my-1" id="badge-qr-svg-wrapper">
              <QRCodeSVG
                value={qrPayload}
                size={160}
                level="H"
                includeMargin={true}
                aria-label={`QR Login Pass for ${account.username}`}
              />
            </div>

            {/* Operator Credentials */}
            <div className="bg-blue-950 text-white p-3.5 rounded-xl text-center space-y-1">
              <div className="text-xs font-black uppercase text-white tracking-wide">
                {account.username}
              </div>
              <div className="text-[11px] font-mono font-bold text-blue-200">
                EMPLOYEE ID: {account.employeeId}
              </div>
              <div className="text-[10px] font-semibold text-blue-300 uppercase">
                {account.role}
              </div>

              {/* Security PIN Display */}
              <div className="pt-2 border-t border-blue-800 mt-2 flex items-center justify-between px-2">
                <span className="text-[9px] font-mono font-bold text-blue-200 uppercase flex items-center gap-1">
                  <Lock className="h-3 w-3 text-blue-300" /> LOGIN PIN:
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-mono font-black text-white bg-blue-900 px-2.5 py-0.5 rounded border border-blue-500 tracking-widest min-w-[58px] text-center">
                    {showPin ? (account.pin || '1234') : '••••'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="p-1 text-blue-300 hover:text-white transition cursor-pointer"
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
          <div className="space-y-2 pt-1">
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

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handlePrintBadge}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-3 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-sm uppercase cursor-pointer"
              >
                <Printer className="h-4 w-4" /> PRINT BADGE
              </button>

              <button
                type="button"
                onClick={handleCopyPayload}
                className="bg-blue-950 hover:bg-blue-800 text-white border border-blue-700 font-bold py-2 px-3 rounded-xl text-xs transition flex items-center justify-center gap-1.5 uppercase cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-blue-300" /> COPIED!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-blue-300" /> COPY DATA
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-blue-800 bg-blue-950 text-[10px] text-blue-300 font-mono text-center">
          JUWEI WMS OPERATOR SECURITY SYSTEM • QR VERIFICATION ENABLED
        </div>
      </div>
    </div>
  );
}
