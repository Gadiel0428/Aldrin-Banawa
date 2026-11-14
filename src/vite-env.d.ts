/// <reference types="vite/client" />

declare const __BUILD_ID__: number | string;
declare const __APP_VERSION__: string;

interface ElectronAPI {
  isElectron?: boolean;
  centralServerUrl?: string;
  updateAppVersion?: (version: string) => void;
  getAppVersion?: () => Promise<string> | string;
  openExternal?: (url: string) => Promise<boolean> | boolean;
}

interface Window {
  electronAPI?: ElectronAPI;
}
