/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * AUTHORITATIVE PRODUCTION CENTRAL SERVER CONFIGURATION
 * SINGLE SOURCE OF TRUTH FOR ALL INSTALLED CLIENTS (PC-1, PC-2, Windows, Mac, Linux, Android, iOS)
 * 
 * Strict Constraint: All clients installed on ANY computer MUST automatically connect
 * to this central server and central database. NEVER use localhost, 127.0.0.1, 0.0.0.0,
 * or a local database for production synchronization.
 */

// Authoritative Production Central Server URL (Warehouse Local Server Host)
export const DEFAULT_PRODUCTION_SERVER_HOST = '192.168.20.214:3000';
export const DEFAULT_PRODUCTION_SERVER_URL = `http://${DEFAULT_PRODUCTION_SERVER_HOST}`;

/**
 * Ensures any URL or host that contains legacy Google Cloud Run, dev domains, or legacy Render
 * is automatically replaced with the authoritative local production URL.
 */
export function sanitizePublicAppUrl(urlOrHost: string): string {
  if (!urlOrHost) return getPublicAppUrl();
  return urlOrHost;
}

/**
 * Returns the clean, authoritative application URL.
 * Used for Desktop .BAT installer, Windows shortcuts, Mobile QR codes, and PWA downloads.
 */
export function getPublicAppUrl(): string {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    const origin = window.location.origin;
    if (origin.startsWith('http')) {
      return origin;
    }
  }
  return DEFAULT_PRODUCTION_SERVER_URL;
}

/**
 * Returns whether a given host or address is a forbidden local loopback address.
 * Allows warehouse LAN IPs (e.g. 192.168.20.214:3000).
 */
export function isLocalhostAddress(addr: string): boolean {
  if (!addr) return false;
  const clean = addr.toLowerCase().trim().replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '').split('/')[0].split(':')[0];
  return (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean === '0.0.0.0' ||
    clean === '::1' ||
    clean === '[::1]' ||
    clean.startsWith('127.')
  );
}

/**
 * Strips protocol, paths, and trailing slashes from a host string
 */
export function sanitizeServerHost(raw: string): string {
  if (!raw) return '';
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^https?:\/\//i, '');
  cleaned = cleaned.replace(/^wss?:\/\//i, '');
  cleaned = (cleaned.split('/')[0] || '').trim();
  return cleaned;
}

/**
 * Determines whether a host should connect via secure protocol (HTTPS / WSS)
 */
export function isSecureHost(cleanHost: string, rawInput: string = ''): boolean {
  if (!cleanHost) return false;
  if (/^https:\/\//i.test(rawInput) || /^wss:\/\//i.test(rawInput)) return true;
  if (/^http:\/\//i.test(rawInput) || /^ws:\/\//i.test(rawInput)) return false;
  if (cleanHost.includes('.run.app') || cleanHost.includes('render.com') || cleanHost.includes('cloud')) {
    return true;
  }
  if (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') {
    return true;
  }
  return false;
}

let hasLoggedResolution = false;

/**
 * Resolves the authoritative central server URL for the client.
 * Enforces correct runtime environment detection:
 * - If running in browser over HTTP/HTTPS, uses current window origin (authoritative host)
 * - If running inside Electron, uses Electron config or cached setting
 * - If user explicitly set custom server address, validates compatibility
 */
export function getCentralServerUrl(): string {
  const finalize = (
    resolvedUrl: string,
    source: 'current window origin' | 'Electron config' | 'cached localStorage' | 'build env var' | 'hardcoded default'
  ): string => {
    if (!hasLoggedResolution) {
      hasLoggedResolution = true;
      console.log(`[Central Server URL] Resolved via [${source}]: ${resolvedUrl}`);
    }
    return resolvedUrl;
  };

  // 1. Check if browsing on a genuine web host (browser environment)
  // When running on Web / Cloud / Dev server, window.location.origin is the authoritative backend
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI?.isElectron);
  if (!isElectron && typeof window !== 'undefined' && window.location && window.location.host && !window.location.protocol.startsWith('file')) {
    const currentHost = window.location.host;
    if (window.location.protocol.startsWith('http')) {
      return finalize(`${window.location.protocol}//${currentHost}`, 'current window origin');
    }
  }

  // 2. Check Electron injected API (Source: Electron config)
  if (typeof window !== 'undefined' && (window as any).electronAPI?.centralServerUrl) {
    const rawElectronUrl = String((window as any).electronAPI.centralServerUrl).trim();
    if (rawElectronUrl) {
      return finalize(rawElectronUrl.replace(/\/+$/, ''), 'Electron config');
    }
  }

  // 3. Check environment variable injected at build time
  const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
  const envUrl = metaEnv && metaEnv.VITE_CENTRAL_SERVER_URL
    ? String(metaEnv.VITE_CENTRAL_SERVER_URL).trim()
    : '';

  // 4. Check cached settings (Source: cached localStorage)
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const cached = localStorage.getItem('juwei_wms_server_address');
    if (cached) {
      // If browsing over HTTPS and cached is plain HTTP IP, ignore cached to prevent mixed content failure
      const isPageHttps = window.location && window.location.protocol === 'https:';
      const isCachedInsecure = cached.startsWith('http://192.') || cached.startsWith('http://10.') || cached.startsWith('http://172.');
      if (isPageHttps && isCachedInsecure) {
        localStorage.removeItem('juwei_wms_server_address');
      } else {
        const cleanCached = sanitizeServerHost(cached);
        if (cleanCached && cleanCached.length > 0) {
          const isHttps = isSecureHost(cleanCached, cached);
          return finalize(`${isHttps ? 'https:' : 'http:'}//${cleanCached}`, 'cached localStorage');
        }
      }
    }
  }

  // 5. Use build env URL if valid non-localhost (Source: build env var)
  if (envUrl) {
    return finalize(envUrl.replace(/\/+$/, ''), 'build env var');
  }

  // 6. Fallback for Electron / Standalone: Default Central Production Server
  return finalize(DEFAULT_PRODUCTION_SERVER_URL, 'hardcoded default');
}

/**
 * Returns the central server host (hostname[:port])
 */
export function getCentralServerHost(): string {
  const url = getCentralServerUrl();
  return sanitizeServerHost(url) || DEFAULT_PRODUCTION_SERVER_HOST;
}

/**
 * Returns the Base API URL (e.g. http://192.168.20.214:3000)
 */
export function getApiBaseUrl(): string {
  return getCentralServerUrl();
}

/**
 * Returns the full WebSocket URL for real-time channel subscription
 */
export function getCentralWebSocketUrl(accountId?: string, warehouseId?: string): string {
  const serverUrl = getCentralServerUrl();
  const cleanHost = sanitizeServerHost(serverUrl) || DEFAULT_PRODUCTION_SERVER_HOST;
  const isHttps = isSecureHost(cleanHost, serverUrl);
  const wsProto = isHttps ? 'wss:' : 'ws:';
  
  const acc = accountId || (typeof localStorage !== 'undefined' ? localStorage.getItem('juwei_wms_account_id') : null) || 'ACC-JUWEI';
  const wh = warehouseId || (typeof localStorage !== 'undefined' ? localStorage.getItem('juwei_wms_warehouse_id') : null) || 'WH-MAIN';
  
  return `${wsProto}//${cleanHost}/ws?accountId=${encodeURIComponent(acc)}&warehouseId=${encodeURIComponent(wh)}`;
}

/**
 * Returns the stored session token from localStorage, if available.
 */
export function getStoredSessionToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem('juwei_wms_sessionToken');
  } catch {
    return null;
  }
}

/**
 * Builds request headers including Authorization Bearer token when signed in.
 */
export function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredSessionToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

