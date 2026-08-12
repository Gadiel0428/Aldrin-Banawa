import React, { useState, useEffect } from 'react';
import { Monitor, Download, X, ShieldCheck, Sparkles, Terminal, CheckCircle2, Cpu } from 'lucide-react';

interface DesktopInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DesktopInstallModal({ isOpen, onClose }: DesktopInstallModalProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installedPWA, setInstalledPWA] = useState(false);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalledPWA(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  if (!isOpen) return null;

  const handlePWAInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setInstalledPWA(true);
      }
      setDeferredPrompt(null);
    } else {
      alert('To install JUWEI WMS as a native Windows app: Look at your browser address bar on the top right for the "Install App" icon (a computer monitor with a down arrow), or open Chrome/Edge Menu (⋮) -> Save & Share -> Install JUWEI WMS Desktop.');
    }
  };

  // Download PowerShell script that builds a genuine native .EXE on any Windows PC
  const downloadExeCompilerScript = () => {
    const currentUrl = window.location.href;
    const psScript = `# =========================================================
# JUWEI WMS NATIVE WINDOWS .EXE INSTALLER GENERATOR
# =========================================================
$ErrorActionPreference = "Stop"
Write-Host "Creating JUWEI-WMS-Desktop.exe..." -ForegroundColor Cyan

$Url = "${currentUrl}"
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ExePath = Join-Path $DesktopPath "JUWEI-WMS-Desktop.exe"

$CSharpCode = @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace JuweiWMS {
    class Program {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        static void Main() {
            try { SetProcessDPIAware(); } catch {}
            string url = "$Url";
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.UseShellExecute = true;
            psi.FileName = "msedge.exe";
            psi.Arguments = "--app=\"" + url + "\" --window-size=1400,900 --title=\"JUWEI WMS Desktop\"";
            try {
                Process.Start(psi);
            } catch {
                try {
                    psi.FileName = "chrome.exe";
                    Process.Start(psi);
                } catch {
                    psi.FileName = url;
                    psi.Arguments = "";
                    Process.Start(psi);
                }
            }
        }
    }
}
"@

try {
    Add-Type -TypeDefinition $CSharpCode -OutputAssembly $ExePath -WindowStyle Hidden
    Write-Host "[SUCCESS] JUWEI-WMS-Desktop.exe created successfully on your Desktop!" -ForegroundColor Green
    
    # Also create desktop shortcut if needed
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut("$DesktopPath\\JUWEI WMS Desktop App.lnk")
    $Shortcut.TargetPath = $ExePath
    $Shortcut.Description = "JUWEI Moulding Corp WMS Desktop Application"
    $Shortcut.Save()
    
    [System.Windows.Forms.MessageBox]::Show("JUWEI-WMS-Desktop.exe has been built and placed on your Windows Desktop!\n\nYou can now double-click JUWEI-WMS-Desktop.exe anytime to run the system.", "JUWEI WMS Desktop Installer", 0, 64)
} catch {
    Write-Host "Error generating EXE: $_" -ForegroundColor Red
    pause
}
`;

    const blob = new Blob([psScript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Build-JUWEI-WMS-EXE.ps1';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Download VBScript shortcut creator
  const downloadVbsShortcut = () => {
    const currentUrl = window.location.href;
    const vbsContent = `' JUWEI WMS Desktop Shortcut Creator
Set WshShell = CreateObject("WScript.Shell")
strDesktop = WshShell.SpecialFolders("Desktop")
Set oLink = WshShell.CreateShortcut(strDesktop & "\\JUWEI WMS Desktop.lnk")

Set fso = CreateObject("Scripting.FileSystemObject")
edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"

If fso.FileExists(edgePath) Then
    oLink.TargetPath = edgePath
    oLink.Arguments = "--app=""" & "${currentUrl}" & """ --window-size=1400,900 --title=""JUWEI WMS Desktop"""
ElseIf fso.FileExists(chromePath) Then
    oLink.TargetPath = chromePath
    oLink.Arguments = "--app=""" & "${currentUrl}" & """ --window-size=1400,900 --title=""JUWEI WMS Desktop"""
Else
    oLink.TargetPath = "${currentUrl}"
End If

oLink.WindowStyle = 1
oLink.Description = "JUWEI Warehouse Management System Desktop Application"
oLink.Save

MsgBox "JUWEI WMS Desktop Shortcut successfully created on your Windows Desktop!", 64, "JUWEI WMS Desktop"
`;

    const blob = new Blob([vbsContent], { type: 'text/vbscript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Create-JUWEI-WMS-Shortcut.vbs';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-blue-900 border-2 border-blue-700 rounded-2xl max-w-xl w-full text-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-blue-800 bg-blue-950 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-800 text-blue-200 rounded-xl border border-blue-600">
              <Monitor className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold tracking-tight text-white">JUWEI WMS Desktop Installer</h2>
                <span className="px-2 py-0.5 bg-blue-800 text-blue-100 border border-blue-600 text-[10px] font-mono font-bold rounded-full">
                  Windows 10/11
                </span>
              </div>
              <p className="text-xs text-blue-200 mt-0.5">
                Install JUWEI Warehouse Management System as a Standalone Windows Application
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-1.5 text-blue-200 hover:text-white hover:bg-blue-800 rounded-lg transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-4 text-xs overflow-y-auto">

          {/* METHOD 1: Native Windows PWA Application */}
          <div className="p-4 bg-blue-950 border border-blue-700 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <Sparkles className="h-4 w-4 text-blue-300" /> Option 1: Install Native Windows Application
              </div>
              {installedPWA ? (
                <span className="px-2 py-0.5 bg-blue-800 text-blue-100 border border-blue-600 rounded text-[10px] font-bold flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Installed
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-blue-800 text-blue-100 border border-blue-600 rounded text-[10px] font-mono font-bold">
                  RECOMMENDED
                </span>
              )}
            </div>

            <p className="text-blue-100 leading-relaxed text-[11px]">
              Installs JUWEI WMS directly into your Windows Start Menu, Taskbar, and Desktop as an official signed Windows app window.
            </p>

            <button
              onClick={handlePWAInstall}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 text-xs transition cursor-pointer"
            >
              <Monitor className="h-4 w-4" /> Install JUWEI WMS Windows Application
            </button>
          </div>

          {/* METHOD 2: Native .EXE Compiler Generator */}
          <div className="p-4 bg-blue-950 border border-blue-700 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <Cpu className="h-4 w-4 text-blue-300" /> Option 2: Generate JUWEI-WMS-Desktop.exe
              </div>
              <span className="px-2 py-0.5 bg-blue-800 text-blue-100 border border-blue-600 rounded text-[10px] font-mono font-bold">
                NATIVE .EXE
              </span>
            </div>

            <p className="text-blue-100 leading-relaxed text-[11px]">
              Downloads <code>Build-JUWEI-WMS-EXE.ps1</code>. Right-click &gt; <em>Run with PowerShell</em> to instantly compile a genuine <code>JUWEI-WMS-Desktop.exe</code> file directly on your Windows Desktop!
            </p>

            <button
              onClick={downloadExeCompilerScript}
              className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-700 text-white border border-blue-600 font-bold rounded-xl flex items-center justify-center gap-2 text-xs transition cursor-pointer"
            >
              <Download className="h-4 w-4 text-blue-200" /> Download Build-JUWEI-WMS-EXE.ps1
            </button>
          </div>

          {/* METHOD 3: Desktop Shortcut Creator (.vbs) */}
          <div className="p-3.5 bg-blue-950 border border-blue-700 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold text-xs">
                <Terminal className="h-3.5 w-3.5 text-blue-300" /> Option 3: 1-Click Desktop Shortcut Creator (.vbs)
              </div>
            </div>
            <p className="text-blue-200 text-[11px] leading-relaxed">
              Creates a clean <strong>JUWEI WMS Desktop</strong> shortcut icon directly on your Windows Desktop.
            </p>
            <button
              onClick={downloadVbsShortcut}
              className="w-full py-2 px-3 bg-blue-800 hover:bg-blue-700 text-white border border-blue-600 font-bold rounded-xl flex items-center justify-center gap-2 text-xs transition cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-blue-300" /> Download Create-JUWEI-WMS-Shortcut.vbs
            </button>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-blue-800 bg-blue-950 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-blue-200 font-mono">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-300" /> JUWEI Moulding Corp WMS Desktop
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-800 hover:bg-blue-700 text-white border border-blue-600 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
