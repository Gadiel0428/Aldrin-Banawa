/// <reference types="vite/client" />

declare const __BUILD_ID__: number | string;
declare const __APP_VERSION__: string;

interface ElectronAPI {
  isElectron?: boolean;
  centralServerUrl?: string;
  printDocument: (options?: any) => Promise<boolean>;
  getAppVersion?: () => string;
}

interface Window {
  electronAPI?: ElectronAPI;
}
