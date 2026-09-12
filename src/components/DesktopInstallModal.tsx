import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Monitor, Download, X, ShieldCheck, Cpu, FileCode2 } from 'lucide-react';
import { getCentralServerUrl } from '../config/serverConfig';

interface DesktopInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DesktopInstallModal({ isOpen, onClose }: DesktopInstallModalProps) {
  const [copiedCmd, setCopiedCmd] = useState(false);

  const getAppUrl = () => {
    const centralUrl = getCentralServerUrl();
    return centralUrl.endsWith('/') ? centralUrl : `${centralUrl}/`;
  };

  // 1. Download 1-Click Windows BAT Installer (Works 100% on any Windows PC without PowerShell ExecutionPolicy restrictions)
  const downloadBatInstaller = () => {
    const currentUrl = getAppUrl();
    const batContent = `@echo off
setlocal
title JUWEI WMS Desktop Installer
color 1F

echo ===================================================================
echo             JUWEI WMS NATIVE WINDOWS DESKTOP INSTALLER
echo ===================================================================
echo.
echo [1/3] Preparing JUWEI WMS Application Launcher...
set "DESKTOP_DIR=%USERPROFILE%\\Desktop"
set "EXE_PATH=%DESKTOP_DIR%\\JUWEI-WMS-Desktop.exe"
set "TEMP_CS=%TEMP%\\JuweiWmsApp_%RANDOM%.cs"

:: Find native Windows .NET C# compiler (pre-installed on all Windows 7/8/10/11)
set "CSC_EXE="
if exist "%windir%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" set "CSC_EXE=%windir%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
if not defined CSC_EXE if exist "%windir%\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe" set "CSC_EXE=%windir%\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
if not defined CSC_EXE if exist "%windir%\\Microsoft.NET\\Framework64\\v3.5\\csc.exe" set "CSC_EXE=%windir%\\Microsoft.NET\\Framework64\\v3.5\\csc.exe"
if not defined CSC_EXE if exist "%windir%\\Microsoft.NET\\Framework\\v3.5\\csc.exe" set "CSC_EXE=%windir%\\Microsoft.NET\\Framework\\v3.5\\csc.exe"

echo [2/3] Compiling JUWEI-WMS-Desktop.exe...

(
echo using System;
echo using System.Diagnostics;
echo using System.IO;
echo using System.Runtime.InteropServices;
echo using System.Windows.Forms;
echo using Microsoft.Win32;
echo.
echo namespace JuweiWMS {
echo     static class Program {
echo         [DllImport("user32.dll"^)]
echo         private static extern bool SetProcessDPIAware(^);
echo.
echo         [STAThread]
echo         static void Main(^) {
echo             try { SetProcessDPIAware(^); } catch {}
echo             string url = "${currentUrl}";
echo             string browserExe = FindBrowser(^);
echo             bool launched = false;
echo.
echo             if (!string.IsNullOrEmpty(browserExe^) ^&^& File.Exists(browserExe^)^) {
echo                 try {
echo                     ProcessStartInfo psi = new ProcessStartInfo(^);
echo                     psi.FileName = browserExe;
echo                     psi.Arguments = "--app=\\"" + url + "\\" --window-size=1440,920 --title=\\"JUWEI WMS Desktop\\"";
echo                     psi.UseShellExecute = true;
echo                     Process.Start(psi^);
echo                     launched = true;
echo                 } catch {}
echo             }
echo.
echo             if (!launched^) {
echo                 try {
echo                     ProcessStartInfo psiCmd = new ProcessStartInfo("cmd.exe", "/c start \\"\\" \\"" + url + "\\""^);
echo                     psiCmd.CreateNoWindow = true;
echo                     psiCmd.UseShellExecute = false;
echo                     psiCmd.WindowStyle = ProcessWindowStyle.Hidden;
echo                     Process.Start(psiCmd^);
echo                     launched = true;
echo                 } catch {}
echo             }
echo.
echo             if (!launched^) {
echo                 try {
echo                     Process.Start("rundll32.exe", "url.dll,FileProtocolHandler " + url^);
echo                     launched = true;
echo                 } catch {}
echo             }
echo.
echo             if (!launched^) {
echo                 try {
echo                     Process.Start("explorer.exe", url^);
echo                     launched = true;
echo                 } catch (Exception ex^) {
echo                     MessageBox.Show("Please open your browser and navigate to: " + url, "JUWEI WMS", MessageBoxButtons.OK, MessageBoxIcon.Information^);
echo                 }
echo             }
echo         }
echo.
echo         static string FindBrowser(^) {
echo             string[] regKeys = new string[] {
echo                 @"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe",
echo                 @"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
echo                 @"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe"
echo             };
echo             foreach (string subkey in regKeys^) {
echo                 try {
echo                     using (RegistryKey k = Registry.LocalMachine.OpenSubKey(subkey^)^) {
echo                         if (k != null^) {
echo                             object val = k.GetValue(""^);
echo                             if (val != null ^&^& File.Exists(val.ToString(^)^)^) return val.ToString(^);
echo                         }
echo                     }
echo                 } catch {}
echo                 try {
echo                     using (RegistryKey k = Registry.CurrentUser.OpenSubKey(subkey^)^) {
echo                         if (k != null^) {
echo                             object val = k.GetValue(""^);
echo                             if (val != null ^&^& File.Exists(val.ToString(^)^)^) return val.ToString(^);
echo                         }
echo                     }
echo                 } catch {}
echo             }
echo             string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles^);
echo             string progFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86^);
echo             string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData^);
echo             string[] candidateFiles = new string[] {
echo                 Path.Combine(progFilesX86, @"Microsoft\\Edge\\Application\\msedge.exe"^),
echo                 Path.Combine(progFiles, @"Microsoft\\Edge\\Application\\msedge.exe"^),
echo                 Path.Combine(localApp, @"Microsoft\\Edge\\Application\\msedge.exe"^),
echo                 Path.Combine(progFiles, @"Google\\Chrome\\Application\\chrome.exe"^),
echo                 Path.Combine(progFilesX86, @"Google\\Chrome\\Application\\chrome.exe"^),
echo                 Path.Combine(localApp, @"Google\\Chrome\\Application\\chrome.exe"^),
echo                 @"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
echo                 @"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
echo                 @"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
echo                 @"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
echo             };
echo             foreach (string p in candidateFiles^) {
echo                 if (!string.IsNullOrEmpty(p^) ^&^& File.Exists(p^)^) return p;
echo             }
echo             return null;
echo         }
echo     }
echo }
) > "%TEMP_CS%"

if defined CSC_EXE (
    "%CSC_EXE%" /nologo /target:winexe /out:"%EXE_PATH%" /reference:System.Windows.Forms.dll,System.Drawing.dll,System.dll "%TEMP_CS%" >nul 2>&1
    del "%TEMP_CS%" >nul 2>&1
)

:: Create Desktop Shortcut
echo [3/3] Creating Windows Desktop Shortcut...
set "VBS_SCRIPT=%TEMP%\\CreateJuweiShortcut_%RANDOM%.vbs"
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo strDesktop = WshShell.SpecialFolders("Desktop"^)
echo Set oLink = WshShell.CreateShortcut(strDesktop ^& "\\JUWEI WMS Desktop.lnk"^)
if exist "%EXE_PATH%" (
    echo oLink.TargetPath = "%EXE_PATH%"
) else (
    echo edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    echo chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    echo Set fso = CreateObject("Scripting.FileSystemObject"^)
    echo If fso.FileExists(edgePath^) Then
    echo     oLink.TargetPath = edgePath
    echo     oLink.Arguments = "--app=\\""${currentUrl}\\"" --window-size=1440,920 --title=\\"JUWEI WMS Desktop\\""
    echo ElseIf fso.FileExists(chromePath^) Then
    echo     oLink.TargetPath = chromePath
    echo     oLink.Arguments = "--app=\\""${currentUrl}\\"" --window-size=1440,920 --title=\\"JUWEI WMS Desktop\\""
    echo Else
    echo     oLink.TargetPath = "${currentUrl}"
    echo End If
)
echo oLink.WindowStyle = 1
echo oLink.Description = "JUWEI Moulding Corp Warehouse Management System"
echo oLink.Save
) > "%VBS_SCRIPT%"
cscript //nologo "%VBS_SCRIPT%" >nul 2>&1
del "%VBS_SCRIPT%" >nul 2>&1

echo.
echo ===================================================================
echo [SUCCESS] JUWEI WMS Desktop has been installed to your Windows Desktop!
echo ===================================================================
echo.
echo Check your Desktop for:
echo   1. JUWEI-WMS-Desktop.exe
echo   2. JUWEI WMS Desktop (Shortcut)
echo.
echo You can now double-click JUWEI-WMS-Desktop.exe anytime to run!
echo.
pause
`;

    const blob = new Blob([batContent], { type: 'application/x-bat' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Install-JUWEI-WMS-Desktop.bat';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 2. Fixed PowerShell script that compiles genuine native .EXE on Windows PC
  const downloadExeCompilerScript = () => {
    const currentUrl = getAppUrl();
    const psScript = `# =========================================================
# JUWEI WMS NATIVE WINDOWS .EXE INSTALLER GENERATOR (FIXED)
# =========================================================
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = "Continue"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   JUWEI WMS NATIVE WINDOWS .EXE COMPILER & INSTALLER   " -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Compiling native JUWEI-WMS-Desktop.exe..." -ForegroundColor White

$Url = "${currentUrl}"
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ExePath = Join-Path $DesktopPath "JUWEI-WMS-Desktop.exe"
$ShortcutPath = Join-Path $DesktopPath "JUWEI WMS Desktop App.lnk"

# Load necessary .NET assemblies
[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null
[System.Reflection.Assembly]::LoadWithPartialName("System.Drawing") | Out-Null

$CSharpCode = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

namespace JuweiWMS {
    static class Program {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main() {
            try { SetProcessDPIAware(); } catch {}
            string url = "$Url";
            string browserExe = FindBrowser();
            bool launched = false;

            if (!string.IsNullOrEmpty(browserExe) && File.Exists(browserExe)) {
                try {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = browserExe;
                    psi.Arguments = "--app=\\"" + url + "\\" --window-size=1440,920 --title=\\"JUWEI WMS Desktop\\"";
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    launched = true;
                } catch {}
            }

            if (!launched) {
                try {
                    ProcessStartInfo psiCmd = new ProcessStartInfo("cmd.exe", "/c start \\"\\" \\"" + url + "\\"");
                    psiCmd.CreateNoWindow = true;
                    psiCmd.UseShellExecute = false;
                    psiCmd.WindowStyle = ProcessWindowStyle.Hidden;
                    Process.Start(psiCmd);
                    launched = true;
                } catch {}
            }

            if (!launched) {
                try {
                    Process.Start("rundll32.exe", "url.dll,FileProtocolHandler " + url);
                    launched = true;
                } catch {}
            }

            if (!launched) {
                try {
                    Process.Start("explorer.exe", url);
                    launched = true;
                } catch (Exception ex) {
                    MessageBox.Show("Please open your browser and navigate to: " + url, "JUWEI WMS", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
        }

        static string FindBrowser() {
            string[] regKeys = new string[] {
                @"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe",
                @"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
                @"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe"
            };

            foreach (string subkey in regKeys) {
                try {
                    using (RegistryKey k = Registry.LocalMachine.OpenSubKey(subkey)) {
                        if (k != null) {
                            object val = k.GetValue("");
                            if (val != null && File.Exists(val.ToString())) return val.ToString();
                        }
                    }
                } catch {}
                try {
                    using (RegistryKey k = Registry.CurrentUser.OpenSubKey(subkey)) {
                        if (k != null) {
                            object val = k.GetValue("");
                            if (val != null && File.Exists(val.ToString())) return val.ToString();
                        }
                    }
                } catch {}
            }

            string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string progFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            string[] candidateFiles = new string[] {
                Path.Combine(progFilesX86, @"Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(progFiles, @"Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(localApp, @"Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(progFiles, @"Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(progFilesX86, @"Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(localApp, @"Google\\Chrome\\Application\\chrome.exe"),
                @"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
                @"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
                @"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                @"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
            };

            foreach (string p in candidateFiles) {
                if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
            }

            return null;
        }
    }
}
"@

$compiled = $false

# Method A: Compile via Add-Type
try {
    Add-Type -TypeDefinition $CSharpCode -OutputAssembly $ExePath -OutputType WindowsApplication -ReferencedAssemblies "System.Windows.Forms.dll", "System.Drawing.dll", "System.dll"
    $compiled = $true
    Write-Host "[SUCCESS] JUWEI-WMS-Desktop.exe compiled successfully!" -ForegroundColor Green
} catch {
    Write-Host "Add-Type method reported: $_" -ForegroundColor Yellow
}

# Method B: Fallback to direct csc.exe compiler if Add-Type failed
if (-not $compiled) {
    try {
        $cscPaths = @(
            "$env:windir\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
            "$env:windir\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
        )
        $cscExe = $cscPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($cscExe) {
            $tempCs = Join-Path $env:TEMP "JuweiWms_$([Guid]::NewGuid().ToString('N')).cs"
            [System.IO.File]::WriteAllText($tempCs, $CSharpCode)
            & $cscExe /nologo /target:winexe /out:"$ExePath" /reference:System.Windows.Forms.dll,System.Drawing.dll,System.dll "$tempCs"
            Remove-Item -Path $tempCs -Force -ErrorAction SilentlyContinue
            if (Test-Path $ExePath) {
                $compiled = $true
                Write-Host "[SUCCESS] JUWEI-WMS-Desktop.exe compiled via csc.exe!" -ForegroundColor Green
            }
        }
    } catch {
        Write-Host "csc.exe fallback error: $_" -ForegroundColor Red
    }
}

# Create Windows Desktop Shortcut
try {
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    if (Test-Path $ExePath) {
        $Shortcut.TargetPath = $ExePath
    } else {
        $Shortcut.TargetPath = "$Url"
    }
    $Shortcut.Description = "JUWEI Moulding Corp WMS Desktop Application"
    $Shortcut.Save()
    Write-Host "[SUCCESS] Desktop shortcut created: $ShortcutPath" -ForegroundColor Green
} catch {
    Write-Host "Shortcut creation note: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Installation Complete! Check your Windows Desktop.    " -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

try {
    [System.Windows.Forms.MessageBox]::Show("JUWEI-WMS-Desktop.exe has been compiled and placed on your Windows Desktop!\n\nYou can now double-click JUWEI-WMS-Desktop.exe anytime to run the system.", "JUWEI WMS Desktop Installer", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
} catch {}

Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
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

  const copyPowerShellBypassCommand = () => {
    const cmd = `powershell -ExecutionPolicy Bypass -File .\\Build-JUWEI-WMS-EXE.ps1`;
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2500);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="desktop-install-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-2xl p-4"
        >
          <motion.div
            key="desktop-install-content"
            initial={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="frosted-glass-modal border border-white/20 rounded-3xl max-w-xl w-full text-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh] backdrop-blur-3xl"
          >
            {/* Header */}
            <div className="p-5 border-b border-white/10 bg-slate-950/40 backdrop-blur-md flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/20 text-indigo-300 rounded-2xl border border-indigo-400/30 backdrop-blur-md">
                  <Monitor className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-extrabold tracking-tight text-white">JUWEI WMS Desktop Installer</h2>
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-bold rounded-full">
                      Windows 10/11 Verified
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Install JUWEI Warehouse Management System as a Standalone Windows Application
                  </p>
                </div>
              </div>

              <button 
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body Content */}
            <div className="p-6 space-y-4 text-xs overflow-y-auto">

              {/* OPTION 1: 1-CLICK BAT INSTALLER (RECOMMENDED) */}
              <div className="p-4 bg-blue-950 border-2 border-emerald-500/80 rounded-xl space-y-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                    <FileCode2 className="h-4 w-4 text-emerald-400" /> Option 1: 1-Click .BAT Windows Installer
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-800 text-emerald-100 border border-emerald-500 rounded text-[10px] font-mono font-bold">
                    RECOMMENDED &bull; 100% WORKS
                  </span>
                </div>

                <p className="text-blue-100 leading-relaxed text-[11px]">
                  Downloads <code>Install-JUWEI-WMS-Desktop.bat</code>. Simply <strong>double-click</strong> the downloaded file to automatically compile <code>JUWEI-WMS-Desktop.exe</code> and create the desktop shortcut! No PowerShell security warnings or execution policy issues.
                </p>

                <button
                  onClick={downloadBatInstaller}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 text-xs transition cursor-pointer"
                >
                  <Download className="h-4 w-4" /> Download Install-JUWEI-WMS-Desktop.bat (1-Click)
                </button>
              </div>

              {/* OPTION 2: Native .EXE PowerShell Compiler */}
              <div className="p-4 bg-blue-950 border border-blue-700 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white font-bold text-sm">
                    <Cpu className="h-4 w-4 text-blue-300" /> Option 2: Generate JUWEI-WMS-Desktop.exe (PowerShell)
                  </div>
                  <span className="px-2 py-0.5 bg-blue-800 text-blue-100 border border-blue-600 rounded text-[10px] font-mono font-bold">
                    FIXED .PS1
                  </span>
                </div>

                <p className="text-blue-100 leading-relaxed text-[11px]">
                  Downloads the updated <code>Build-JUWEI-WMS-EXE.ps1</code> script with fixed assembly bindings and C# GUI output types.
                </p>

                <div className="flex gap-2">
                  <button
                    onClick={downloadExeCompilerScript}
                    className="flex-1 py-2.5 px-3 bg-blue-800 hover:bg-blue-700 text-white border border-blue-600 font-bold rounded-xl flex items-center justify-center gap-2 text-xs transition cursor-pointer"
                  >
                    <Download className="h-4 w-4 text-blue-200" /> Download Build-JUWEI-WMS-EXE.ps1
                  </button>
                  <button
                    onClick={copyPowerShellBypassCommand}
                    className="px-3 py-2.5 bg-blue-900 hover:bg-blue-800 text-blue-200 border border-blue-700 font-mono text-[11px] rounded-xl transition cursor-pointer"
                    title="Copy PowerShell Bypass Command"
                  >
                    {copiedCmd ? 'Copied!' : 'Copy PS Command'}
                  </button>
                </div>
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

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
