/// <reference types="vite/client" />

declare const __BUILD_ID__: number | string;
declare const __APP_VERSION__: string;

interface ElectronAPI {
  isElectron?: boolean;
  centralServerUrl?: string;
  updateAppVersion?: (version: string) => void;
  getAppVersion?: () => Promise<string> | string;
  openExternal?: (url: string) => Promise<boolean> | boolean;
  openGeneratedPDF?: (pdfData: ArrayBuffer | Uint8Array | string, filename?: string) => Promise<{ success: boolean; filePath?: string; fallback?: string; error?: string }>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
