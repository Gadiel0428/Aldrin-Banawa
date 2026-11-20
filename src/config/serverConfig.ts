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

import logger from '../lib/logger';

interface RuntimeServerConfig {
  centralServerUrl?: string;
  centralServerHost?: string;
}

let runtimeServerConfig: RuntimeServerConfig = {};

/**
 * Loads server-config.json into memory so standalone/browser clients use the
 * authoritative server address configured in server-config.json.
 */
export async function loadServerConfig(): Promise<void> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  if (window.location?.protocol === 'file:') return;

  const candidates = ['./server-config.json', '/server-config.json'];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data === 'object') {
        runtimeServerConfig = {
          centralServerUrl: typeof data.centralServerUrl === 'string' ? data.centralServerUrl.trim() : undefined,
          centralServerHost: typeof data.centralServerHost === 'string' ? data.centralServerHost.trim() : undefined,
        };
        return;
      }
    } catch {
      // Try next candidate
    }
  }
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
  return getCentralServerUrl();
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
  if (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') {
    return true;
  }
  return false;
}

let hasLoggedResolution = false;

/**
 * Resolves the authoritative central server URL for the client.
 * Uses only the user-set server address, the running browser origin,
 * Electron config, or server-config.json (never cloud fallbacks).
 */
export function getCentralServerUrl(): string {
  const finalize = (
    resolvedUrl: string,
    source: 'current window origin' | 'Electron config' | 'user localStorage' | 'server-config.json' | 'build env var'
  ): string => {
    if (!hasLoggedResolution) {
      hasLoggedResolution = true;
      logger.debug(`[Central Server URL] Resolved via [${source}]: ${resolvedUrl}`);
    }
    return resolvedUrl;
  };

  // 1. Check explicit user setting in localStorage
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const cached = localStorage.getItem('juwei_wms_server_address');
    if (cached) {
      const isPageHttps = window.location && window.location.protocol === 'https:';
      const isCachedInsecure = cached.startsWith('http://192.') || cached.startsWith('http://10.') || cached.startsWith('http://172.');
      const isLegacyCloud = cached.includes('.run.app') || cached.includes('render.com') || cached.includes('ais-dev-') || cached.includes('ais-pre-');
      if ((isPageHttps && isCachedInsecure) || isLegacyCloud) {
        localStorage.removeItem('juwei_wms_server_address');
      } else {
        const cleanCached = sanitizeServerHost(cached);
        if (cleanCached && cleanCached.length > 0) {
          const isHttps = isSecureHost(cleanCached, cached);
          return finalize(`${isHttps ? 'https:' : 'http:'}//${cleanCached}`, 'user localStorage');
        }
      }
    }
  }

  // 2. Check if browsing on a genuine web host (browser environment)
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI?.isElectron);
  if (!isElectron && typeof window !== 'undefined' && window.location && window.location.host && !window.location.protocol.startsWith('file')) {
    const currentHost = window.location.host;
    if (window.location.protocol.startsWith('http')) {
      return finalize(`${window.location.protocol}//${currentHost}`, 'current window origin');
    }
  }

  // 3. Check Electron injected API (populated from server-config.json)
  if (typeof window !== 'undefined' && (window as any).electronAPI?.centralServerUrl) {
    const rawElectronUrl = String((window as any).electronAPI.centralServerUrl).trim();
    if (rawElectronUrl) {
      return finalize(rawElectronUrl.replace(/\/+$/, ''), 'Electron config');
    }
  }

  // 4. Check server-config.json loaded at startup
  const cfgUrl = runtimeServerConfig.centralServerUrl
    || (runtimeServerConfig.centralServerHost ? `http://${sanitizeServerHost(runtimeServerConfig.centralServerHost)}` : '');
  if (cfgUrl) {
    return finalize(cfgUrl.replace(/\/+$/, ''), 'server-config.json');
  }

  // 5. Check environment variable injected at build time
  const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
  const envUrl = metaEnv && metaEnv.VITE_CENTRAL_SERVER_URL
    ? String(metaEnv.VITE_CENTRAL_SERVER_URL).trim()
    : '';
  if (envUrl) {
    return finalize(envUrl.replace(/\/+$/, ''), 'build env var');
  }

  return '';
}

/**
 * Returns the central server host (hostname[:port])
 */
export function getCentralServerHost(): string {
  const url = getCentralServerUrl();
  return sanitizeServerHost(url);
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
  const cleanHost = sanitizeServerHost(serverUrl);
  if (!cleanHost) return '';
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

