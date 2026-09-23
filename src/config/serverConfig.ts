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

// Authoritative Cloud Production URL (Render Cloud Production - No Google / Gmail Login Required)
export const DEFAULT_PRODUCTION_SERVER_HOST = 'aldrin-banawa.onrender.com';
export const DEFAULT_PRODUCTION_SERVER_URL = `https://${DEFAULT_PRODUCTION_SERVER_HOST}`;

/**
 * Ensures any URL or host that contains legacy Google Cloud Run or dev domains
 * is automatically replaced with the authoritative Render production URL.
 */
export function sanitizePublicAppUrl(urlOrHost: string): string {
  if (!urlOrHost) return DEFAULT_PRODUCTION_SERVER_URL;
  if (urlOrHost.includes('.run.app') || urlOrHost.includes('ais-dev-') || urlOrHost.includes('ais-pre-')) {
    return DEFAULT_PRODUCTION_SERVER_URL;
  }
  return urlOrHost;
}

/**
 * Returns the clean, authoritative application URL that NEVER requires or prompts for a Gmail account.
 * Used for Desktop .BAT installer, Windows shortcuts, Mobile QR codes, and PWA downloads.
 */
export function getPublicAppUrl(): string {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    const origin = window.location.origin;
    if (origin.includes('.run.app') || origin.includes('ais-dev-') || origin.includes('ais-pre-')) {
      return DEFAULT_PRODUCTION_SERVER_URL;
    }
    if (!isLocalhostAddress(origin)) {
      return origin;
    }
  }
  return DEFAULT_PRODUCTION_SERVER_URL;
}

/**
 * Returns whether a given host or address is a forbidden local address
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
    clean.startsWith('127.') ||
    clean.startsWith('192.168.') ||
    clean.startsWith('10.') ||
    clean.startsWith('172.16.') ||
    clean.startsWith('172.17.') ||
    clean.startsWith('172.18.') ||
    clean.startsWith('172.19.') ||
    clean.startsWith('172.2') ||
    clean.startsWith('172.30.') ||
    clean.startsWith('172.31.') ||
    clean.endsWith('.local')
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
  if (!cleanHost) return true;
  if (/^https:\/\//i.test(rawInput) || /^wss:\/\//i.test(rawInput)) return true;
  if (cleanHost.includes('.run.app') || cleanHost.includes('cloud') || cleanHost.includes('appspot') || cleanHost.includes('render.com')) {
    return true;
  }
  if (isLocalhostAddress(cleanHost)) {
    return typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
  }
  // Default to secure HTTPS/WSS for all remote enterprise hosts
  return true;
}

let hasLoggedResolution = false;

/**
 * Resolves the authoritative central server URL for the client.
 * Enforces production cloud authority:
 * - If running inside Electron, uses central URL
 * - If user entered an address in settings, validates it cannot be localhost
 * - If window.location is on cloud, uses cloud origin
 * - If installed on PC-2 / local / file, automatically resolves to DEFAULT_PRODUCTION_SERVER_URL
 */
export function getCentralServerUrl(): string {
  const finalize = (
    resolvedUrl: string,
    source: 'Electron config' | 'cached localStorage' | 'current window origin' | 'build env var' | 'hardcoded default'
  ): string => {
    if (!hasLoggedResolution) {
      hasLoggedResolution = true;
      console.log(`[Central Server URL] Resolved via [${source}]: ${resolvedUrl}`);
    }
    return resolvedUrl;
  };

  // 1. Check environment variable injected at build time
  const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
  const envUrl = metaEnv && metaEnv.VITE_CENTRAL_SERVER_URL
    ? String(metaEnv.VITE_CENTRAL_SERVER_URL).trim()
    : '';

  // 1. Check Electron injected API (Source: Electron config)
  if (typeof window !== 'undefined' && (window as any).electronAPI?.centralServerUrl) {
    const rawElectronUrl = String((window as any).electronAPI.centralServerUrl).trim();
    const electronUrl = sanitizePublicAppUrl(rawElectronUrl);
    if (electronUrl && !isLocalhostAddress(electronUrl)) {
      return finalize(electronUrl.replace(/\/+$/, ''), 'Electron config');
    }
  }

  // 2. Check cached settings (Source: cached localStorage)
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const cached = localStorage.getItem('juwei_wms_server_address');
    if (cached) {
      if (isLocalhostAddress(cached)) {
        console.warn('[JUWEI-WMS] Disallowed localhost found in cached server address. Purging and redirecting to Central Cloud Server.');
        localStorage.removeItem('juwei_wms_server_address');
      } else {
        const sanitizedCached = sanitizePublicAppUrl(cached);
        if (sanitizedCached !== cached) {
          localStorage.setItem('juwei_wms_server_address', sanitizedCached);
        }
        const cleanCached = sanitizeServerHost(sanitizedCached);
        if (cleanCached && cleanCached.length > 0) {
          const isHttps = isSecureHost(cleanCached, sanitizedCached);
          return finalize(`${isHttps ? 'https:' : 'http:'}//${cleanCached}`, 'cached localStorage');
        }
      }
    }
  }

  // 3. Check if currently browsing on a genuine host (Source: current window origin)
  if (typeof window !== 'undefined' && window.location && window.location.host) {
    const currentHost = window.location.host;
    if (window.location.protocol.startsWith('http')) {
      return finalize(`${window.location.protocol}//${currentHost}`, 'current window origin');
    }
  }

  // 4. Use build env URL if valid non-localhost (Source: build env var)
  if (envUrl && !isLocalhostAddress(envUrl)) {
    return finalize(envUrl.replace(/\/+$/, ''), 'build env var');
  }

  // 5. Absolute Fallback: Default Central Production Cloud Server (Source: hardcoded default)
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
 * Returns the Base API URL (e.g. https://aldrin-banawa.onrender.com)
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
