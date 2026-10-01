/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  ArrowLeftRight, 
  PackageSearch, 
  RotateCcw, 
  Trash2, 
  Truck, 
  Thermometer, 
  Download, 
  Upload, 
  RefreshCw,
  Clock,
  Briefcase,
  Wifi,
  WifiOff,
  UserPlus,
  LogIn,
  LogOut,
  UserCheck,
  Fingerprint,
  IdCard,
  User,
  Lock,
  Unlock,
  Edit3,
  Boxes,
  Eye,
  EyeOff,
  Users,
  FolderPlus,
  Barcode,
  QrCode,
  Printer,
  ScanLine,
  Sparkles,
  CheckCircle2,
  Monitor,
  Loader2,
  Copy,
  Check,
  X,
  Database,
  Archive,
  Phone,
  Smartphone,
  Radio,
  Activity,
  Server,
  ShieldCheck,
  Info,
  ExternalLink
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import AccountQRBadgeModal from './components/AccountQRBadgeModal';
import DesktopInstallModal from './components/DesktopInstallModal';
import MobileAppDownloadModal from './components/MobileAppDownloadModal';
import { ConfirmModal, ConfirmActionConfig } from './components/ConfirmModal';
import BarcodeScannerModal from './components/BarcodeScannerModal';
import CentralDatabaseModal from './components/CentralDatabaseModal';
import { ServerBackupsModal } from './components/ServerBackupsModal';
import ActiveUsersModal from './components/ActiveUsersModal';
import { SyncStatus } from './components/SyncStatus';
import { StockMovementView } from './components/StockMovement';
import { ProductList } from './components/ProductList';
import { InventoryTable } from './components/InventoryTable';
import { createStockMovement } from './database/movements';

import { 
  fetchCentralDatabaseSnapshot,
  verifyCentralCredentials,
  registerCentralAccount,
  updateCentralAccount,
  updateCentralPin,
  deleteCentralAccount,
  clearAllAccountsExceptSuperAdmin,
  upsertCentralRecord,
  deleteCentralRecord,
  performCentralGlobalReset,
  resolveAccountPin
} from './lib/centralApi';

import { 
  MaterialStockItem, 
  MaterialType,
  ReceivingRecord, 
  ReturnRecord, 
  RecyclingRecord, 
  IssuanceRecord, 
  DeliveryRecord, 
  EnvironmentalLog,
  ForkliftChecklist,
  MasterRegistryItem,
  RegisteredAccount,
  ActivePresenceUser,
  QueuedMutation
} from './types';
import { generateAuthoritativeId } from './lib/idGenerator';

import { 
  INITIAL_STOCK, 
  INITIAL_RECEIVING, 
  INITIAL_RETURNS, 
  INITIAL_RECYCLING, 
  INITIAL_ISSUANCE, 
  INITIAL_DELIVERIES, 
  INITIAL_ENV_LOGS, 
  INITIAL_FORKLIFT_CHECKS 
} from './data';

import DashboardOverview from './components/DashboardOverview';
import ReceivingModule, { DEFAULT_RECEIVING_CATEGORIES } from './components/ReceivingModule';
import StockFIFOControl from './components/StockFIFOControl';
import RecyclingModule from './components/RecyclingModule';
import IssuanceModule from './components/IssuanceModule';
import DeliveryModule from './components/DeliveryModule';
import EnvironmentalModule from './components/EnvironmentalModule';
import RegisteredAccountsModule, { DEFAULT_OPERATIONAL_ROLES } from './components/RegisteredAccountsModule';
import MasterRegistryModule, { DEFAULT_MASTER_REGISTRIES } from './components/MasterRegistryModule';
import VersionUpdateBanner from './components/VersionUpdateBanner';

import {
  DEFAULT_PRODUCTION_SERVER_HOST,
  DEFAULT_PRODUCTION_SERVER_URL,
  getCentralServerUrl,
  getCentralServerHost,
  getApiBaseUrl,
  getCentralWebSocketUrl,
  isLocalhostAddress,
  sanitizeServerHost,
  isSecureHost as isSecureServerHost
} from './config/serverConfig';
import StartupDiagnosticsModal from './components/StartupDiagnosticsModal';

// Isolated real-time clock component to prevent full application re-render cycles every second
function LiveClock() {
  const [time, setTime] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hidden lg:inline-flex items-center gap-1.5 text-[11px] font-mono font-medium text-slate-600 bg-slate-100/80 px-2.5 h-8 rounded-lg border border-slate-200 shrink-0">
      <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      <span>
        {time.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })} • {time.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  );
}

const DEFAULT_ONLINE_CLOUD_HOST = DEFAULT_PRODUCTION_SERVER_HOST;

export { getApiBaseUrl, getCentralServerUrl, getCentralServerHost, sanitizeServerHost, isSecureServerHost };

function getDefaultServerAddress(): string {
  return getCentralServerHost();
}

export function wsOpen(ws: WebSocket | null): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

// Helpers for offline mutation sync queue
function getPendingSyncQueue(): Record<string, any[]> {
  try {
    const raw = localStorage.getItem('juwei_wms_pending_sync');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

function savePendingSyncQueue(queue: Record<string, any[]>) {
  try {
    localStorage.setItem('juwei_wms_pending_sync', JSON.stringify(queue));
  } catch (e) {}
}

function markPendingSync(collection: string, data: any[]) {
  // Direct live synchronizations are transmitted immediately via WebSockets and REST server endpoints.
  // We do not queue whole collection arrays to prevent stale overwrites across users.
}

function clearPendingSync(collection: string) {
  try {
    localStorage.removeItem('juwei_wms_pending_sync');
  } catch (e) {}
}

export default function App() {
  const [view, setView] = useState<string>('dashboard');
  const [showDesktopInstallModal, setShowDesktopInstallModal] = useState<boolean>(false);
  const [showMobileInstallModal, setShowMobileInstallModal] = useState<boolean>(false);

  // Optimistic local mutation timestamp tracker to prevent in-flight clobbering / race conditions
  const lastMutationTimes = useRef<{ [col: string]: number }>({});

  // Central Database is the single source of truth - state is pure in-memory populated from server
  const [stocks, setStocks] = useState<MaterialStockItem[]>([]);
  const [receiving, setReceiving] = useState<ReceivingRecord[]>([]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [recycling, setRecycling] = useState<RecyclingRecord[]>([]);
  const [issuances, setIssuances] = useState<IssuanceRecord[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [envLogs, setEnvLogs] = useState<EnvironmentalLog[]>([]);
  const [forkliftChecks, setForkliftChecks] = useState<ForkliftChecklist[]>([]);
  const [registries, setRegistries] = useState<MasterRegistryItem[]>([]);

  // Startup cleanup: Purge any legacy stale client-side caches to prevent resurrection
  useEffect(() => {
    try {
      const keysToClean = [
        'juwei_wms_cache_stocks',
        'juwei_wms_cache_receiving',
        'juwei_wms_cache_returns',
        'juwei_wms_cache_recycling',
        'juwei_wms_cache_issuances',
        'juwei_wms_cache_deliveries',
        'juwei_wms_cache_envLogs',
        'juwei_wms_cache_forkliftChecks',
        'juwei_wms_cache_registries',
        'juwei_wms_master_registries',
        'juwei_wms_pending_sync'
      ];
      keysToClean.forEach(key => localStorage.removeItem(key));
    } catch (e) {}
  }, []);

  // User Authentication / Registration states - Persist login state reliably across page focus and reloads
  const [currentUser, setCurrentUser] = useState<string>(() => {
    try { return localStorage.getItem('juwei_wms_currentUser') || ''; } catch (e) { return ''; }
  });
  const [currentRole, setCurrentRole] = useState<string>(() => {
    try { return localStorage.getItem('juwei_wms_userRole') || ''; } catch (e) { return ''; }
  });
  const [currentEmployeeId, setCurrentEmployeeId] = useState<string>(() => {
    try { return localStorage.getItem('juwei_wms_employeeId') || ''; } catch (e) { return ''; }
  });
  const [currentPermission, setCurrentPermission] = useState<string>(() => {
    try { return localStorage.getItem('juwei_wms_userPermission') || 'LIMITED_ACCESS'; } catch (e) { return 'LIMITED_ACCESS'; }
  });
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('juwei_wms_isLoggedIn');
      const user = localStorage.getItem('juwei_wms_currentUser');
      const empId = localStorage.getItem('juwei_wms_employeeId');
      const role = localStorage.getItem('juwei_wms_userRole');
      const shouldRestore = stored === 'true' && Boolean(user);
      if (shouldRestore) {
        console.log(`[AUTH STARTUP] Restoring persistent login session for user: ${user} (${empId || 'NO_ID'}), role: ${role || 'NO_ROLE'}`);
      } else {
        console.log(`[AUTH STARTUP] Landing on login screen (storedLoggedIn=${stored}, storedUser=${user || 'NONE'})`);
      }
      return shouldRestore;
    } catch (e) {
      console.warn('[AUTH STARTUP] Error reading stored session from localStorage:', e);
      return false;
    }
  });
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');

  // Central Database modal state
  const [showCentralDatabaseModal, setShowCentralDatabaseModal] = useState<boolean>(false);
  // Super Admin Server Automated Backups modal state
  const [showBackupsModal, setShowBackupsModal] = useState<boolean>(false);
  // Startup Diagnostics and Multi-PC Real-Time Sync Verifier modal state
  const [showStartupDiagnosticsModal, setShowStartupDiagnosticsModal] = useState<boolean>(false);
  // User Logout Confirmation modal state
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState<boolean>(false);

  // Persistent Device Identifier across sessions
  const getPersistentDeviceId = (): string => {
    if (typeof window === 'undefined') return 'DEV-SERVER';
    try {
      let id = localStorage.getItem('juwei_wms_device_id');
      if (!id) {
        const ua = window.navigator.userAgent || '';
        const isAndroid = /android/i.test(ua);
        const isWindows = /windows/i.test(ua);
        const isIOS = /ipad|iphone|ipod/i.test(ua);
        const prefix = isAndroid ? 'dev_android' : (isIOS ? 'dev_ios' : (isWindows ? 'dev_win' : 'dev_desk'));
        id = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
        localStorage.setItem('juwei_wms_device_id', id);
      }
      return id;
    } catch (e) {
      return 'DEV-LOCAL';
    }
  };

  const getPlatformType = (): string => {
    if (typeof window === 'undefined') return 'Desktop';
    const ua = window.navigator.userAgent || '';
    if (/android/i.test(ua)) return 'Android';
    if (/ipad|iphone|ipod/i.test(ua)) return 'iOS';
    if (/windows/i.test(ua)) return 'Windows';
    return 'Desktop';
  };

  // Helper to obtain persistent workstation / session identifier
  const getStationId = (): string => {
    if (typeof window === 'undefined') return 'WS-MASTER';
    try {
      let id = sessionStorage.getItem('juwei_wms_station_id') || localStorage.getItem('juwei_wms_station_id');
      if (!id) {
        id = 'WS-' + Math.random().toString(36).substring(2, 6).toUpperCase();
        sessionStorage.setItem('juwei_wms_station_id', id);
        localStorage.setItem('juwei_wms_station_id', id);
      }
      return id;
    } catch (e) {
      return 'WS-LOCAL';
    }
  };

  const getPlatformName = (): string => {
    if (typeof window === 'undefined') return 'Server/Desktop';
    const ua = window.navigator.userAgent || '';
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    const isAndroid = /android/i.test(ua);
    const isWindows = /windows/i.test(ua);
    const isMac = /macintosh|mac os x/i.test(ua);
    const isIOS = /ipad|iphone|ipod/i.test(ua);

    if (isStandalone) {
      if (isAndroid) return 'Android PWA';
      if (isWindows) return 'Windows PWA';
      if (isIOS) return 'iOS PWA';
      return 'Installed PWA App';
    }
    if (isWindows) return 'Windows Workstation';
    if (isAndroid) return 'Android Handheld / Scanner';
    if (isIOS) return 'iOS Mobile Terminal';
    if (isMac) return 'macOS Terminal';
    return 'Web Terminal';
  };

  // Unique session and connection IDs for this client tab
  const clientSessionId = useRef<string>(`sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
  const clientConnectionId = useRef<string>('');

  // Real-time states
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [activePresence, setActivePresence] = useState<ActivePresenceUser[]>([]);
  const [wsPresence, setWsPresence] = useState<ActivePresenceUser[]>([]);
  const [localTabsPresence, setLocalTabsPresence] = useState<ActivePresenceUser[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isManualSyncing, setIsManualSyncing] = useState<boolean>(false);
  const [serverAddress, setServerAddress] = useState<string>(() => getCentralServerHost());
  const [wsLatency, setWsLatency] = useState<number | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<Date>(new Date());
  const [liveSyncToast, setLiveSyncToast] = useState<{ id: string; author: string; action: string; time: string } | null>(null);
  const [showActiveUsersModal, setShowActiveUsersModal] = useState<boolean>(false);
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false);
  const [newVersionString, setNewVersionString] = useState<string>('');
  const [installedDesktopVersion, setInstalledDesktopVersion] = useState<string>(() => {
    try {
      return localStorage.getItem('juwei_wms_installed_version') || '';
    } catch (e) {
      return '';
    }
  });
  const [appVersion, setAppVersion] = useState<string>(() => {
    if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
      return String(__APP_VERSION__).replace(/^v/i, '');
    }
    return '';
  });
  const updateAvailableRef = useRef<boolean>(false);

  // Accurate semver comparator: returns true ONLY if candidate is strictly newer than current
  const isNewerVersion = (candidateVer?: string, currentVer?: string): boolean => {
    if (!candidateVer || !currentVer) return false;
    const s = String(candidateVer).replace(/^v/i, '').trim();
    const c = String(currentVer).replace(/^v/i, '').trim();
    if (!s || !c || s === c) return false;

    const sParts = s.split('.').map(n => parseInt(n, 10) || 0);
    const cParts = c.split('.').map(n => parseInt(n, 10) || 0);
    const maxLen = Math.max(sParts.length, cParts.length);

    for (let i = 0; i < maxLen; i++) {
      const sVal = sParts[i] || 0;
      const cVal = cParts[i] || 0;
      if (sVal > cVal) return true;
      if (sVal < cVal) return false;
    }
    return false;
  };

  // Cross-tab zero-latency synchronization channel
  const syncChannelRef = useRef<BroadcastChannel | null>(null);

  // Helper to check if two presence user lists are meaningfully equal to avoid full UI re-renders
  const arePresenceListsEqual = (a: ActivePresenceUser[], b: ActivePresenceUser[]): boolean => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const itemA = a[i];
      const itemB = b[i];
      if (
        itemA.stationId !== itemB.stationId ||
        itemA.username !== itemB.username ||
        itemA.role !== itemB.role ||
        itemA.activeView !== itemB.activeView ||
        itemA.employeeId !== itemB.employeeId
      ) {
        return false;
      }
    }
    return true;
  };

  // Helper to upsert a single user into active user list safely without dropping other accounts or flickering
  const upsertUserInState = (prev: RegisteredAccount[], user: any): RegisteredAccount[] => {
    if (!user) return prev;
    const rawEmpId = String(user.employeeId || user.employee_id || '').toUpperCase().trim();
    const empId = rawEmpId.startsWith('JPMP-') ? rawEmpId : `JPMP-${rawEmpId.replace(/^EMP-/, '')}`;
    if (!empId) return prev;
    unmarkUserAsDeleted(empId);

    const safePrev = Array.isArray(prev) ? prev : [superAdminAccount];
    const existingIdx = safePrev.findIndex(u => (u.employeeId || '').toUpperCase() === empId);
    const existing = existingIdx >= 0 ? safePrev[existingIdx] : null;
    
    // CRITICAL: Preserve existing PIN if incoming user payload omits PIN (e.g. from session broadcast or public sync). Never fall back to '1234'.
    const effectivePin = (user?.pin && String(user.pin).trim()) || (existing?.pin && String(existing.pin).trim()) || (empId === 'JPMP-002' ? '0423' : '');
    const isCompromised = effectivePin === '1234' || !!user?.isPinCompromised || !!existing?.isPinCompromised;

    const formattedUser: RegisteredAccount = {
      username: (user.username || existing?.username || (empId === 'JPMP-002' ? 'ALDRIN BANAWA' : 'OPERATOR')).toUpperCase(),
      role: (user.role || existing?.role || (empId === 'JPMP-002' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE CLERK')).toUpperCase(),
      employeeId: empId,
      phoneNumber: user.phoneNumber || user.phone_number || existing?.phoneNumber || (empId === 'JPMP-002' ? '+639669858846' : ''),
      permission: user.permission || existing?.permission || (empId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
      pin: effectivePin,
      isPinCompromised: isCompromised,
      status: user.status || existing?.status || 'ACTIVE',
      lastActive: user.lastActive || user.last_active || existing?.lastActive || undefined
    };

    let next: RegisteredAccount[];
    if (existingIdx >= 0) {
      if (
        existing &&
        existing.username === formattedUser.username &&
        existing.role === formattedUser.role &&
        existing.permission === formattedUser.permission &&
        existing.pin === formattedUser.pin &&
        existing.status === formattedUser.status &&
        existing.phoneNumber === formattedUser.phoneNumber
      ) {
        return safePrev;
      }
      next = [...safePrev];
      next[existingIdx] = formattedUser;
    } else {
      next = [...safePrev, formattedUser];
    }
    return next;
  };

  // Unified Presence Combiner & Active Terminals Reconciler
  useEffect(() => {
    const myStationId = getStationId();
    const myDeviceId = getPersistentDeviceId();
    const myConnId = clientConnectionId.current;
    const mySessionId = clientSessionId.current;

    const selfItem: ActivePresenceUser = {
      connection_id: myConnId,
      connectionId: myConnId,
      sessionId: mySessionId,
      session_id: mySessionId,
      deviceId: myDeviceId,
      device_id: myDeviceId,
      stationId: myStationId,
      user_id: currentEmployeeId ? `USR-${currentEmployeeId}` : 'ANONYMOUS',
      username: currentUser || 'JUWEI OPERATOR',
      employeeId: currentEmployeeId || (currentUser?.toUpperCase().includes('ALDRIN') ? 'JPMP-002' : ''),
      role: currentRole || (currentPermission === 'FULL_ACCESS' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE OPERATOR'),
      permission: currentPermission || 'LIMITED_ACCESS',
      platform: getPlatformType(),
      deviceName: `${getPlatformType()} Terminal - ${myStationId}`,
      activeView: view,
      connectedAt: new Date().toISOString(),
      lastPing: Date.now(),
      source: 'self'
    };

    const combined: ActivePresenceUser[] = [
      selfItem,
      ...wsPresence.map(p => ({
        ...p,
        source: (p.connection_id && p.connection_id === myConnId ? 'self' : (p.source || 'websocket')) as ('websocket' | 'central' | 'local' | 'self')
      })),
      ...localTabsPresence.map(p => ({ ...p, source: (p.source || 'local') as ('websocket' | 'central' | 'local' | 'self') }))
    ];

    const map = new Map<string, ActivePresenceUser>();
    const now = Date.now();

    for (const item of combined) {
      if (!item || !item.username) continue;
      
      const connId = item.connection_id || (item as any).connectionId;
      const sessId = item.session_id || (item as any).sessionId;
      const key = connId || sessId || item.stationId || (item.employeeId ? `${item.employeeId}_${item.username}` : `${item.username}_${item.source || 'terminal'}`);

      // If this item is a remote reflection of the current client tab itself, let selfItem take precedence
      if (connId && connId === myConnId && item.source !== 'self') {
        continue;
      }
      if (!connId && item.stationId === myStationId && item.source !== 'self') {
        continue;
      }

      // Check stale cutoff ONLY for broadcast channel / local tabs that haven't pinged in 30s
      if (item.source === 'local' && item.lastPing && (now - item.lastPing > 30000)) {
        continue;
      }

      // If self is already in map, don't overwrite with remote copy of self
      if (map.has(key)) {
        const existing = map.get(key)!;
        if (existing.source === 'self') continue;
      }
      map.set(key, item);
    }

    const uniqueList = Array.from(map.values());
    setActivePresence(prev => arePresenceListsEqual(prev, uniqueList) ? prev : uniqueList);

    const userNames = Array.from(new Set(uniqueList.map(p => p.username.trim().toUpperCase())));
    const finalNames = userNames.length > 0 ? userNames : [selfItem.username.trim().toUpperCase()];
    setActiveUsers(prev => {
      if (prev.length === finalNames.length && prev.every((name, i) => name === finalNames[i])) {
        return prev;
      }
      return finalNames;
    });
  }, [currentUser, currentEmployeeId, currentRole, currentPermission, view, wsPresence, localTabsPresence]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const channel = new BroadcastChannel('juwei_wms_live_sync_v1');
        syncChannelRef.current = channel;

        channel.onmessage = (event) => {
          const payload = event.data;
          if (!payload || !payload.type) return;

          if (payload.type === 'presence_heartbeat') {
            if (payload.presence && payload.presence.stationId && payload.presence.stationId !== getStationId()) {
              setLocalTabsPresence(prev => {
                const filtered = prev.filter(p => p.stationId !== payload.presence.stationId);
                return [...filtered, { ...payload.presence, source: 'local', lastPing: Date.now() }];
              });
            }
          } else if (payload.type === 'presence_request') {
            if (payload.fromStationId !== getStationId()) {
              try {
                channel.postMessage({
                  type: 'presence_heartbeat',
                  presence: {
                    stationId: getStationId(),
                    username: currentUser || 'JUWEI OPERATOR',
                    employeeId: currentEmployeeId || (currentUser?.toUpperCase().includes('ALDRIN') ? 'JPMP-002' : ''),
                    role: currentRole || (currentPermission === 'FULL_ACCESS' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE OPERATOR'),
                    activeView: view,
                    connectedAt: new Date().toISOString(),
                    lastPing: Date.now()
                  }
                });
              } catch (e) {}
            }
          } else if (payload.type === 'presence_leave') {
            if (payload.stationId) {
              setLocalTabsPresence(prev => prev.filter(p => p.stationId !== payload.stationId));
            }
          } else if (payload.type === 'sync_collection') {
            const { collection, data } = payload;
            if (Array.isArray(data)) {
              const norm = normalizeRecords(collection, data);
              switch (collection) {
                case 'stocks': setStocks(prev => reconcileCollection('stocks', prev, norm)); break;
                case 'receiving': setReceiving(prev => reconcileCollection('receiving', prev, norm)); break;
                case 'returns': setReturns(prev => reconcileCollection('returns', prev, norm)); break;
                case 'recycling': setRecycling(prev => reconcileCollection('recycling', prev, norm)); break;
                case 'issuances': setIssuances(prev => reconcileCollection('issuances', prev, norm)); break;
                case 'deliveries': setDeliveries(prev => reconcileCollection('deliveries', prev, norm)); break;
                case 'envLogs': setEnvLogs(prev => reconcileCollection('envLogs', prev, norm)); break;
                case 'forkliftChecks': setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, norm)); break;
                case 'registries': setRegistries(prev => reconcileCollection('registries', prev, norm)); break;
                case 'registeredUsers': setRegisteredUsers(prev => reconcileUsers(prev, data)); break;
                case 'operationalRoles': {
                  const cleaned = Array.from(new Set<string>(data.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
                  if (cleaned.length > 0) {
                    setOperationalRoles(cleaned);
                    try { localStorage.setItem('juwei_wms_operationalRoles', JSON.stringify(cleaned)); } catch (e) {}
                  }
                  break;
                }
                case 'receivingCategories': {
                  const cleaned = Array.from(new Set<string>(data.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
                  if (cleaned.length > 0) {
                    setReceivingCategories(cleaned);
                    try { localStorage.setItem('juwei_wms_receivingCategories', JSON.stringify(cleaned)); } catch (e) {}
                  }
                  break;
                }
              }
              setLastSyncedTime(new Date());
            }
          } else if (payload.type === 'upsert_record') {
            const { collection, record, author, actionDesc } = payload;
            if (record && record.id && collection) {
              unmarkRecordAsDeletedLocally(record.id);
              setLastSyncedTime(new Date());
              if (author && author !== (currentUser || '')) {
                setLiveSyncToast({
                  id: record.id,
                  author,
                  action: actionDesc || `Updated ${collection} record`,
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
              }
              const updateFn = (prev: any[]) => {
                const idx = prev.findIndex(it => it.id === record.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = record;
                  return next;
                }
                return [record, ...prev];
              };
              switch (collection) {
                case 'stocks': setStocks(updateFn); break;
                case 'receiving': setReceiving(updateFn); break;
                case 'returns': setReturns(updateFn); break;
                case 'recycling': setRecycling(updateFn); break;
                case 'issuances': setIssuances(updateFn); break;
                case 'deliveries': setDeliveries(updateFn); break;
                case 'envLogs': setEnvLogs(updateFn); break;
                case 'forkliftChecks': setForkliftChecks(updateFn); break;
                case 'registries': setRegistries(updateFn); break;
              }
            }
          } else if (payload.type === 'delete_record') {
            const { collection, id } = payload;
            if (collection && id) {
              markRecordAsDeletedLocally(id);
              setLastSyncedTime(new Date());
              const filterFn = (prev: any[]) => prev.filter(it => it.id !== id);
              switch (collection) {
                case 'stocks': setStocks(filterFn); break;
                case 'receiving': setReceiving(filterFn); break;
                case 'returns': setReturns(filterFn); break;
                case 'recycling': setRecycling(filterFn); break;
                case 'issuances': setIssuances(filterFn); break;
                case 'deliveries': setDeliveries(filterFn); break;
                case 'envLogs': setEnvLogs(filterFn); break;
                case 'forkliftChecks': setForkliftChecks(filterFn); break;
                case 'registries': setRegistries(filterFn); break;
              }
            }
          } else if (payload.type === 'account_registered') {
            const { user, author } = payload;
            if (user && user.employeeId) {
              setRegisteredUsers(prev => upsertUserInState(prev, user));
              if (author && author !== (currentUser || '')) {
                setLiveSyncToast({
                  id: String(Date.now()),
                  author,
                  action: `Registered operator ${user.username || user.employeeId}`,
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
              }
            }
          } else if (payload.type === 'account_updated') {
            const { user, author } = payload;
            if (user && user.employeeId) {
              setRegisteredUsers(prev => upsertUserInState(prev, user));
              if ((currentEmployeeId || '').toUpperCase() === (user.employeeId || '').toUpperCase()) {
                if (user.role) setCurrentRole(user.role);
                if (user.permission) setCurrentPermission(user.permission);
                if (user.username) setCurrentUser(user.username);
              }
              if (author && author !== (currentUser || '')) {
                setLiveSyncToast({
                  id: String(Date.now()),
                  author,
                  action: `Updated operator ${user.username || user.employeeId}`,
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
              }
            }
          } else if (payload.type === 'delete_account') {
            const { employeeId } = payload;
            if (employeeId && employeeId !== 'JPMP-002') {
              markUserAsDeleted(employeeId);
              setRegisteredUsers(prev => prev.filter(u => u.employeeId.toUpperCase() !== employeeId.toUpperCase()));
            }
          } else if (payload.type === 'GLOBAL_RESET') {
            const ver = Number(payload.systemResetVersion) || Date.now();
            purgeAllLocalOfflineCachesAndQueues(ver);
            setStocks([]);
            setReceiving([]);
            setReturns([]);
            setRecycling([]);
            setIssuances([]);
            setDeliveries([]);
            setEnvLogs([]);
            setForkliftChecks([]);
            setRegistries([]);
            setLiveSyncToast({
              id: String(Date.now()),
              author: payload.resetBy || 'Super Administrator',
              action: `GLOBAL RESET: Central database cleared`,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            });
            setLastSyncedTime(new Date());
          } else if (payload.type === 'all_accounts_cleared') {
            setRegisteredUsers([superAdminAccount]);
          } else if (payload.type === 'client_installed') {
            if (payload.stationId && payload.stationId !== getStationId()) {
              setLiveSyncToast({
                id: String(Date.now()),
                author: payload.username || 'System',
                action: `Terminal ${payload.stationId} (${payload.platform || 'Device'}) completed fresh install & synced`,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              });
            }
          } else if (payload.type === 'activity_toast') {
            setLiveSyncToast({
              id: String(Date.now()),
              author: payload.author || 'Workstation',
              action: payload.action || 'Updated data',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            });
          }
        };

        // Request presence from other tabs and broadcast self
        channel.postMessage({
          type: 'presence_request',
          fromStationId: getStationId()
        });

        // Emit initial presence heartbeat
        channel.postMessage({
          type: 'presence_heartbeat',
          presence: {
            stationId: getStationId(),
            username: currentUser || 'JUWEI OPERATOR',
            employeeId: currentEmployeeId || (currentUser?.toUpperCase().includes('ALDRIN') ? 'JPMP-002' : ''),
            role: currentRole || (currentPermission === 'FULL_ACCESS' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE OPERATOR'),
            activeView: view,
            connectedAt: new Date().toISOString(),
            lastPing: Date.now()
          }
        });

        // Periodic local presence broadcast
        const heartbeatTimer = setInterval(() => {
          try {
            channel.postMessage({
              type: 'presence_heartbeat',
              presence: {
                stationId: getStationId(),
                username: currentUser || 'JUWEI OPERATOR',
                employeeId: currentEmployeeId || (currentUser?.toUpperCase().includes('ALDRIN') ? 'JPMP-002' : ''),
                role: currentRole || (currentPermission === 'FULL_ACCESS' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE OPERATOR'),
                activeView: view,
                connectedAt: new Date().toISOString(),
                lastPing: Date.now()
              }
            });
          } catch (e) {}
        }, 6000);

        const handleUnload = () => {
          try {
            channel.postMessage({
              type: 'presence_leave',
              stationId: getStationId()
            });
          } catch (e) {}
        };
        window.addEventListener('beforeunload', handleUnload);

        return () => {
          clearInterval(heartbeatTimer);
          window.removeEventListener('beforeunload', handleUnload);
          try { channel.close(); } catch (e) {}
        };
      } catch (e) {}
    }
  }, [currentUser, currentEmployeeId, currentRole, view]);

  // Auto-dismiss live sync toast notifications after 2.8 seconds
  useEffect(() => {
    if (liveSyncToast) {
      const timer = setTimeout(() => {
        setLiveSyncToast(null);
      }, 2800);
      return () => clearTimeout(timer);
    }
  }, [liveSyncToast]);

  useEffect(() => {
    // Enforce custom JUWEI WMS branding and dynamic tab title with live appVersion
    try {
      document.title = appVersion 
        ? `JUWEI WAREHOUSE MANAGEMENT SYSTEM v${appVersion}` 
        : 'JUWEI WAREHOUSE MANAGEMENT SYSTEM';
      const svgIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="%231e1b4b"/><polygon points="32,10 52,21 32,32 12,21" fill="%23818cf8"/><polygon points="12,21 32,32 32,53 12,42" fill="%234338ca"/><polygon points="32,32 52,21 52,42 32,53" fill="%23312e81"/><circle cx="32" cy="21" r="5" fill="%2310b981"/></svg>';
      const dataUrl = 'data:image/svg+xml;utf8,' + svgIcon;
      const links = document.querySelectorAll("link[rel*='icon']");
      links.forEach(el => el.parentNode?.removeChild(el));

      const newLink = document.createElement('link');
      newLink.type = 'image/svg+xml';
      newLink.rel = 'icon';
      newLink.href = dataUrl;
      document.head.appendChild(newLink);
    } catch (e) {}
  }, [appVersion]);

  useEffect(() => {
    // Sync version from authoritative build-info endpoint
    const fetchBuildInfo = async () => {
      try {
        const centralUrl = getCentralServerUrl();
        const endpoints = [
          '/api/build-info',
          '/build-info.json',
          ...(centralUrl ? [`${centralUrl}/api/build-info`, `${centralUrl}/build-info.json`] : [])
        ];
        const uniqueEndpoints = Array.from(new Set(endpoints.filter(Boolean)));
        for (const ep of uniqueEndpoints) {
          try {
            const res = await fetch(ep, { cache: 'no-store', headers: { Accept: 'application/json' } });
            if (res.ok) {
              const data = await res.json();
              if (data?.version) {
                const cleanVer = String(data.version).replace(/^v/i, '').trim();
                if (cleanVer) {
                  setAppVersion(cleanVer);
                  if (typeof window !== 'undefined' && window.electronAPI?.updateAppVersion) {
                    window.electronAPI.updateAppVersion(cleanVer);
                  }
                }
                break;
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    };
    fetchBuildInfo();

    // Query installed desktop version from Electron if running inside Electron wrapper
    if (typeof window !== 'undefined' && window.electronAPI?.getAppVersion) {
      try {
        Promise.resolve(window.electronAPI.getAppVersion()).then((ver) => {
          if (ver) {
            const cleanVer = String(ver).replace(/^v/i, '').trim();
            console.log('[JUWEI WMS] Installed Electron Desktop version:', cleanVer);
            setInstalledDesktopVersion(cleanVer);
            try {
              localStorage.setItem('juwei_wms_installed_version', cleanVer);
            } catch (e) {}
          }
        }).catch(() => {});
      } catch (e) {}
    }
  }, []);

  // Direct employee ID and PIN login form states with Remember Login
  const [loginEmployeeId, setLoginEmployeeId] = useState<string>(() => {
    try {
      return localStorage.getItem('juwei_wms_rememberedEmployeeId') || '';
    } catch (e) {
      return '';
    }
  });
  const [rememberLogin, setRememberLogin] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem('juwei_wms_rememberedEmployeeId'));
    } catch (e) {
      return false;
    }
  });
  const [loginPin, setLoginPin] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [showPin, setShowPin] = useState<boolean>(false);
  const [showLoginQrScanner, setShowLoginQrScanner] = useState<boolean>(false);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [qrBadgeAccount, setQrBadgeAccount] = useState<RegisteredAccount | null>(null);
  
  // PIN code security flow states
  const [pinPromptUser, setPinPromptUser] = useState<RegisteredAccount | null>(null);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [newlyRegisteredUser, setNewlyRegisteredUser] = useState<RegisteredAccount | null>(null);
  const [showNewlyRegisteredPin, setShowNewlyRegisteredPin] = useState<boolean>(false);
  const [confirmActionApp, setConfirmActionApp] = useState<ConfirmActionConfig | null>(null);
  
  const superAdminAccount: RegisteredAccount = { 
    username: 'ALDRIN BANAWA', 
    role: 'SUPER ADMINISTRATOR', 
    employeeId: 'JPMP-002', 
    phoneNumber: '+639669858846',
    permission: 'FULL_ACCESS', 
    pin: '0423',
    status: 'ACTIVE'
  };

  const getDeletedUserIds = (): Set<string> => {
    try {
      const raw = localStorage.getItem('juwei_wms_deleted_accounts_v1') || localStorage.getItem('juwei_wms_deletedAccounts');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          return new Set(arr.map((id: string) => String(id).toUpperCase().trim()));
        }
      }
    } catch (e) {}
    return new Set<string>();
  };

  const markUserAsDeleted = (employeeId: string) => {
    try {
      const cleanId = (employeeId || '').trim().toUpperCase();
      if (!cleanId || cleanId === 'JPMP-002' || cleanId.endsWith('-002') || cleanId.includes('002')) return;
      const targetUser = registeredUsers.find(u => (u.employeeId || '').toUpperCase() === cleanId);
      if (targetUser && (((targetUser.username || '').toUpperCase().includes('ALDRIN BANAWA')) || (targetUser.username || '').toUpperCase() === 'SUPER ADMIN')) {
        return;
      }
      const set = getDeletedUserIds();
      set.add(cleanId);
      localStorage.setItem('juwei_wms_deleted_accounts_v1', JSON.stringify(Array.from(set)));
      localStorage.setItem('juwei_wms_deletedAccounts', JSON.stringify(Array.from(set)));
    } catch (e) {}
  };

  const unmarkUserAsDeleted = (employeeId: string) => {
    try {
      const cleanId = (employeeId || '').trim().toUpperCase();
      if (!cleanId) return;
      const set = getDeletedUserIds();
      if (set.has(cleanId)) {
        set.delete(cleanId);
        localStorage.setItem('juwei_wms_deleted_accounts_v1', JSON.stringify(Array.from(set)));
        localStorage.setItem('juwei_wms_deletedAccounts', JSON.stringify(Array.from(set)));
      }
    } catch (e) {}
  };

  const sanitizeUsersList = (incomingList?: any[]): RegisteredAccount[] => {
    const userMap = new Map<string, RegisteredAccount>();
    userMap.set('JPMP-002', { ...superAdminAccount });

    const source = Array.isArray(incomingList) ? incomingList : [];

    const deletedSet = getDeletedUserIds();

    source.forEach((u: any) => {
      if (!u || (!u.employeeId && !u.employee_id)) return;
      const rawEmpId = String(u.employeeId || u.employee_id || '').toUpperCase();
      const empId = rawEmpId.startsWith('JPMP-') ? rawEmpId : `JPMP-${rawEmpId.replace(/^EMP-/, '')}`;
      if (deletedSet.has(empId) && empId !== 'JPMP-002') return;

      const cleanPin = (u?.pin && String(u.pin).trim()) || (empId === 'JPMP-002' ? '0423' : '');
      const isCompromised = cleanPin === '1234' || !!u.isPinCompromised;
      userMap.set(empId, {
        username: (u.username || 'OPERATOR').toUpperCase(),
        role: (u.role || 'WAREHOUSE CLERK').toUpperCase(),
        employeeId: empId,
        phoneNumber: u.phoneNumber || u.phone_number || '',
        permission: u.permission || (empId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
        pin: cleanPin,
        isPinCompromised: isCompromised,
        status: u.status || 'ACTIVE',
        lastActive: u.lastActive || u.last_active || undefined
      });
    });

    // Guarantee Super Admin
    userMap.set('JPMP-002', { ...superAdminAccount });

    return Array.from(userMap.values());
  };

  const [registeredUsers, setRegisteredUsers] = useState<RegisteredAccount[]>([superAdminAccount]);

  // Operational Roles state centrally managed and synced
  const [operationalRoles, setOperationalRoles] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('juwei_wms_operationalRoles');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return Array.from(new Set<string>(parsed.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
        }
      }
    } catch (e) {}
    return DEFAULT_OPERATIONAL_ROLES;
  });

  const handleUpdateOperationalRoles = async (newRoles: string[]) => {
    const cleaned = Array.from(new Set<string>(newRoles.map(r => String(r || '').trim().toUpperCase()).filter(Boolean)));
    if (cleaned.length === 0) return;
    setOperationalRoles(cleaned);
    try {
      localStorage.setItem('juwei_wms_operationalRoles', JSON.stringify(cleaned));
    } catch (e) {}

    // Broadcast cross-tab immediately
    try {
      syncChannelRef.current?.postMessage({
        type: 'collection_updated',
        collection: 'operationalRoles',
        data: cleaned
      });
    } catch (e) {}

    // Send WebSocket notification to central server
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'update_roles',
          roles: cleaned,
          author: currentUser || 'Super Admin',
          permission: currentPermission,
          timestamp: new Date().toISOString()
        }));
      } catch (e) {}
    }

    // REST API persistence fallback
    try {
      const baseUrl = getApiBaseUrl();
      await fetch(`${baseUrl}/api/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-permission': currentPermission || '',
          'x-employee-id': currentEmployeeId || ''
        },
        body: JSON.stringify({
          roles: cleaned,
          author: currentUser
        })
      });
    } catch (e) {
      console.warn('Failed to sync roles via REST fallback:', e);
    }
  };

  // Receiving Categories state centrally managed and synced
  const [receivingCategories, setReceivingCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('juwei_wms_receivingCategories');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return Array.from(new Set<string>(parsed.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
        }
      }
    } catch (e) {}
    return DEFAULT_RECEIVING_CATEGORIES;
  });

  const handleUpdateReceivingCategories = async (newCategories: string[], renameData?: { oldCat: string; newCat: string }) => {
    const cleaned = Array.from(new Set<string>(newCategories.map(r => String(r || '').trim().toUpperCase()).filter(Boolean)));
    if (cleaned.length === 0) return;
    setReceivingCategories(cleaned);
    try {
      localStorage.setItem('juwei_wms_receivingCategories', JSON.stringify(cleaned));
    } catch (e) {}

    // Cascade rename to local state immediately if renaming
    if (renameData && renameData.oldCat && renameData.newCat) {
      const cleanOld = renameData.oldCat.trim().toUpperCase();
      const cleanNew = renameData.newCat.trim().toUpperCase();
      if (cleanOld && cleanNew && cleanOld !== cleanNew) {
        setReceiving(prev => prev.map(r => {
          let ch = false;
          const up = { ...r };
          if ((r.supplierOrDept || '').trim().toUpperCase() === cleanOld) {
            up.supplierOrDept = cleanNew;
            ch = true;
          }
          if (((r as any).category || '').trim().toUpperCase() === cleanOld) {
            (up as any).category = cleanNew;
            ch = true;
          }
          return ch ? { ...up, version: (r.version || 1) + 1, updated_at: new Date().toISOString() } : r;
        }));

        setReturns(prev => prev.map(ret => {
          if ((ret.category || '').trim().toUpperCase() === cleanOld) {
            return { ...ret, category: cleanNew, version: (ret.version || 1) + 1, updated_at: new Date().toISOString() };
          }
          return ret;
        }));

        setStocks(prev => prev.map(s => {
          if (((s as any).category || '').trim().toUpperCase() === cleanOld) {
            return { ...s, category: cleanNew, version: (s.version || 1) + 1, updated_at: new Date().toISOString() } as any;
          }
          return s;
        }));
      }
    }

    // Broadcast cross-tab immediately
    try {
      syncChannelRef.current?.postMessage({
        type: 'collection_updated',
        collection: 'receivingCategories',
        data: cleaned
      });
    } catch (e) {}

    // Send WebSocket notification to central server
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'update_categories',
          categories: cleaned,
          renameData,
          author: currentUser || 'Super Admin',
          permission: currentPermission,
          timestamp: new Date().toISOString()
        }));
      } catch (e) {}
    }

    // REST API persistence fallback
    try {
      const baseUrl = getApiBaseUrl();
      await fetch(`${baseUrl}/api/categories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-permission': currentPermission || '',
          'x-employee-id': currentEmployeeId || ''
        },
        body: JSON.stringify({
          action: renameData ? 'rename' : 'set',
          categories: cleaned,
          oldCat: renameData?.oldCat,
          newCat: renameData?.newCat,
          author: currentUser
        })
      });
    } catch (e) {
      console.warn('Failed to sync categories via REST fallback:', e);
    }
  };

  // Keep active logged-in user's role, permissions, and status in sync with live registered accounts directory
  useEffect(() => {
    if (!isLoggedIn || !currentEmployeeId) return;
    const cleanId = currentEmployeeId.toUpperCase();
    const currentRecord = registeredUsers.find(u => (u.employeeId || '').toUpperCase() === cleanId);
    
    // Safety guard: If the account is not found in registeredUsers yet (e.g. during the first few seconds after reconnect
    // while the account list loads from server/WebSocket), do NOT log the user out. Only skip updating until account list arrives.
    if (!currentRecord) {
      return;
    }

    // Update role / permissions if modified by Super Admin
    if (currentRecord.permission && currentRecord.permission !== currentPermission) {
      setCurrentPermission(currentRecord.permission);
      localStorage.setItem('juwei_wms_userPermission', currentRecord.permission);
    }
    if (currentRecord.role && currentRecord.role !== currentRole) {
      setCurrentRole(currentRecord.role);
      localStorage.setItem('juwei_wms_userRole', currentRecord.role);
    }
    if (currentRecord.username && currentRecord.username !== currentUser) {
      setCurrentUser(currentRecord.username);
      localStorage.setItem('juwei_wms_currentUser', currentRecord.username);
    }
  }, [registeredUsers, isLoggedIn, currentEmployeeId, currentPermission, currentRole, currentUser]);

  // Clipboard feedback state
  const [linkCopied, setLinkCopied] = useState<boolean>(false);

  // Initialize standard fallback state
  const resetStateToDefaults = () => {
    executeSuperAdminGlobalReset();
  };

  const resetAccountsToDefaults = () => {
    const isSuperAdminOperating = 
      currentEmployeeId === 'JPMP-002' || 
      (currentUser || '').toUpperCase().includes('ALDRIN') || 
      currentRole === 'SUPER ADMINISTRATOR';

    if (!isSuperAdminOperating) {
      alert("UNAUTHORIZED: Only Super Administrator (JPMP-002) is authorized to wipe operator accounts.");
      return;
    }

    const defaultAccounts = [
      superAdminAccount
    ];
    setRegisteredUsers(defaultAccounts);
    try {
      localStorage.removeItem('juwei_wms_deleted_accounts');
    } catch (e) {}
    syncCollection('registeredUsers', defaultAccounts);
    const baseUrl = getApiBaseUrl();
    fetch(`${baseUrl}/api/reset-database`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-user-employee-id': currentEmployeeId || 'JPMP-002',
        'x-user-role': currentRole || 'SUPER ADMINISTRATOR',
        'x-user-permission': currentPermission || 'FULL_ACCESS',
        'x-user-pin': '0423'
      },
      body: JSON.stringify({
        employeeId: currentEmployeeId || 'JPMP-002',
        role: currentRole || 'SUPER ADMINISTRATOR',
        permission: currentPermission || 'FULL_ACCESS',
        pin: '0423',
        confirmed: true,
        author: `${currentUser || 'ALDRIN BANAWA'} (${currentEmployeeId || 'JPMP-002'})`,
        wipeUsers: true
      })
    }).catch(() => {});
    // Also log out any active session if we reset the accounts
    handleLogout();
  };

  // Normalizer helper for records coming from central database, REST, and WebSocket
  const normalizeRecords = (colName: string, items: any[]): any[] => {
    if (!Array.isArray(items)) return [];
    return items.map((r: any) => {
      if (!r || typeof r !== 'object') return r;
      switch (colName) {
        case 'stocks':
          return {
            id: r.id || `STK-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            partCode: r.partCode || r.part_code || '',
            description: r.description || '',
            type: r.type || 'RAW',
            location: r.location || 'Zone A',
            quantity: Number(r.quantity) || 0,
            unit: r.unit || 'PCS',
            lotNumber: r.lotNumber || r.lot_number || '',
            modelName: r.modelName || r.model_name,
            color: r.color,
            receivedDate: r.receivedDate || r.received_date || new Date().toISOString().split('T')[0],
            expirationDate: r.expirationDate || r.expiration_date,
            fifoColor: r.fifoColor || r.fifo_color || 'Dark Green',
            status: r.status || 'APPROVED',
            resinSackRisk: Boolean(r.resinSackRisk || r.resin_sack_risk),
            shelfLifeDays: r.shelfLifeDays || r.shelf_life_days ? Number(r.shelfLifeDays || r.shelf_life_days) : undefined,
            customer: r.customer,
            reorderMin: r.reorderMin || r.reorder_min ? Number(r.reorderMin || r.reorder_min) : undefined,
            remarks: r.remarks,
            bom: r.bom || []
          };
        case 'receiving':
          return {
            id: r.id || `RCV-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            receivedDate: r.receivedDate || r.received_date || r.date,
            location: r.location,
            vendorSupplier: r.vendorSupplier || r.vendor_supplier,
            reorderMin: r.reorderMin || r.reorder_min ? Number(r.reorderMin || r.reorder_min) : undefined,
            remarks: r.remarks,
            source: r.source || 'Resin(External)',
            itemDescription: r.itemDescription || r.item_description || '',
            partCode: r.partCode || r.part_code || '',
            modelName: r.modelName || r.model_name,
            color: r.color,
            quantity: Number(r.quantity) || 0,
            unit: r.unit || 'PCS',
            lotNumber: r.lotNumber || r.lot_number || '',
            physicalCondition: r.physicalCondition || r.physical_condition || {},
            rrNumber: r.rrNumber || r.rr_number,
            poNumber: r.poNumber || r.po_number,
            drNumber: r.drNumber || r.dr_number,
            siNumber: r.siNumber || r.si_number,
            wayBill: r.wayBill || r.way_bill,
            transferFormNumber: r.transferFormNumber || r.transfer_form_number,
            supplierOrDept: r.supplierOrDept || r.supplier_or_dept || 'Internal',
            iqcStatus: r.iqcStatus || r.iqc_status || 'PENDING_IQC',
            status: r.status || 'DRAFT',
            fifoColorCode: r.fifoColorCode || r.fifo_color_code || 'Dark Green',
            bom: r.bom || [],
            autoDeductBom: Boolean(r.autoDeductBom || r.auto_deduct_bom),
            customer: r.customer
          };
        case 'returns':
          return {
            id: r.id || `RET-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            category: r.category,
            materialDescription: r.materialDescription || r.material_description || '',
            partCode: r.partCode || r.part_code || '',
            quantity: Number(r.quantity) || 0,
            unit: r.unit || 'PCS',
            lotNumber: r.lotNumber || r.lot_number || '',
            department: r.department || 'Production',
            reason: r.reason || 'Excess Material',
            condition: r.condition || 'Good',
            iqcEvaluation: r.iqcEvaluation || r.iqc_evaluation || 'PENDING_IQC',
            status: r.status || 'PENDING',
            returnSlipFormNumber: r.returnSlipFormNumber || r.return_slip_form_number || ''
          };
        case 'recycling':
          return {
            id: r.id || `CYC-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            itemType: r.itemType || r.item_type || 'Carton Box',
            quantity: Number(r.quantity) || 0,
            condition: r.condition || 'Reusable',
            reuseCycleCount: Number(r.reuseCycleCount || r.reuse_cycle_count) || 1,
            disposition: r.disposition || 'Re-used',
            logSheetNumber: r.logSheetNumber || r.log_sheet_number || ''
          };
        case 'issuances':
          return {
            id: r.id || `ISS-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            requisitionNumber: r.requisitionNumber || r.requisition_number || '',
            department: r.department || 'Assembly',
            partCode: r.partCode || r.part_code || '',
            description: r.description || '',
            quantityRequested: Number(r.quantityRequested || r.quantity_requested) || 0,
            quantityIssued: Number(r.quantityIssued || r.quantity_issued) || 0,
            lotNumber: r.lotNumber || r.lot_number || '',
            fifoVerified: Boolean(r.fifoVerified || r.fifo_verified),
            issuedBy: r.issuedBy || r.issued_by || 'Storekeeper',
            receivedBy: r.receivedBy || r.received_by || 'Line Operator'
          };
        case 'deliveries':
          return {
            id: r.id || `DEL-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            pickingListNumber: r.pickingListNumber || r.picking_list_number || '',
            poNumber: r.poNumber || r.po_number || '',
            modelName: r.modelName || r.model_name || '',
            partCode: r.partCode || r.part_code || '',
            quantity: Number(r.quantity) || 0,
            packagingConditionOk: Boolean(r.packagingConditionOk ?? r.packaging_condition_ok ?? true),
            fifoVerified: Boolean(r.fifoVerified ?? r.fifo_verified ?? false),
            forkliftChecklistSigned: Boolean(r.forkliftChecklistSigned ?? r.forklift_checklist_signed ?? false),
            gatePassNumber: r.gatePassNumber || r.gate_pass_number || '',
            drNumber: r.drNumber || r.dr_number,
            salesInvoice: r.salesInvoice || r.sales_invoice,
            wayBill: r.wayBill || r.way_bill,
            status: r.status || 'PREPARING',
            preparedBy: r.preparedBy || r.preparedBy || 'Dispatch Supervisor',
            loadedBy: r.loadedBy || r.loaded_by
          };
        case 'envLogs':
          return {
            id: r.id || `ENV-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            timestamp: r.timestamp || new Date().toISOString(),
            zone: r.zone || 'Raw Material Storage Zone',
            occupiedSlots: Number(r.occupiedSlots || r.occupied_slots) || 0,
            totalSlots: Number(r.totalSlots || r.total_slots) || 150,
            cleanlinessOk: Boolean(r.cleanlinessOk ?? r.cleanliness_ok ?? true),
            ventilationOk: Boolean(r.ventilationOk ?? r.ventilation_ok ?? true),
            pestFree: Boolean(r.pestFree ?? r.pest_free ?? true),
            recordedBy: r.recordedBy || r.recorded_by || 'Inspector'
          };
        case 'forkliftChecks':
          return {
            id: r.id || `FLK-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            operator: r.operator || 'Operator',
            forkliftId: r.forkliftId || r.forklift_id || 'FL-01',
            brakesOk: Boolean(r.brakesOk ?? r.brakes_ok ?? true),
            lightsOk: Boolean(r.lightsOk ?? r.lights_ok ?? true),
            hydraulicOk: Boolean(r.hydraulicOk ?? r.hydraulic_ok ?? true),
            steeringOk: Boolean(r.steeringOk ?? r.steering_ok ?? true),
            tiresOk: Boolean(r.tiresOk ?? r.tires_ok ?? true),
            batteryFluidOk: Boolean(r.batteryFluidOk ?? r.battery_fluid_ok ?? true),
            remarks: r.remarks
          };
        case 'registries':
          return {
            id: r.id || `REG-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            type: r.type || 'PART_CODE',
            code: r.code || '',
            name: r.name || '',
            description: r.description,
            status: r.status || 'ACTIVE',
            dateRegistered: r.dateRegistered || r.date_registered || new Date().toISOString().split('T')[0],
            presetSource: r.presetSource || r.preset_source,
            category: r.category,
            vendorSupplier: r.vendorSupplier || r.vendor_supplier,
            unit: r.unit,
            location: r.location
          };
        default:
          return r;
      }
    });
  };

  const getDeletedRecordIds = (): Set<string> => {
    try {
      const raw = localStorage.getItem('juwei_wms_deleted_records_v1');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          return new Set(arr);
        }
      }
    } catch (e) {}
    return new Set<string>();
  };

  // Track deleted record IDs locally to avoid resurrecting deleted items from stale snapshots
  const deletedRecordIds = useRef<Set<string>>(getDeletedRecordIds());
  // Track recently mutated record IDs locally to protect local in-flight edits from temporary rollback
  const recentlyMutatedRecords = useRef<Map<string, number>>(new Map());

  const markRecordMutatedLocally = (id: string) => {
    if (!id) return;
    recentlyMutatedRecords.current.set(id, Date.now());
    if (recentlyMutatedRecords.current.size > 2000) {
      const now = Date.now();
      for (const [key, time] of recentlyMutatedRecords.current.entries()) {
        if (now - time > 60000) recentlyMutatedRecords.current.delete(key);
      }
    }
  };

  const markRecordAsDeletedLocally = (id: string) => {
    if (!id) return;
    deletedRecordIds.current.add(id);
    recentlyMutatedRecords.current.delete(id);
    try {
      const set = getDeletedRecordIds();
      set.add(id);
      if (set.size > 2000) {
        const first = set.values().next().value;
        if (first) set.delete(first);
      }
      localStorage.setItem('juwei_wms_deleted_records_v1', JSON.stringify(Array.from(set)));
    } catch (e) {}
  };

  const unmarkRecordAsDeletedLocally = (id: string) => {
    if (!id) return;
    deletedRecordIds.current.delete(id);
    try {
      const set = getDeletedRecordIds();
      if (set.has(id)) {
        set.delete(id);
        localStorage.setItem('juwei_wms_deleted_records_v1', JSON.stringify(Array.from(set)));
      }
    } catch (e) {}
  };

  const isRecordDeletedLocally = (id: string) => {
    return Boolean(id && (deletedRecordIds.current.has(id) || getDeletedRecordIds().has(id)));
  };

  // Offline Mutations Queue Storage & Processor
  const PENDING_MUTATIONS_KEY = 'juwei_wms_mutation_queue_v1';

  const getPendingMutations = (): QueuedMutation[] => {
    try {
      const raw = localStorage.getItem(PENDING_MUTATIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  };

  const savePendingMutations = (mutations: QueuedMutation[]) => {
    try {
      localStorage.setItem(PENDING_MUTATIONS_KEY, JSON.stringify(mutations));
    } catch (e) {}
  };

  const queueOfflineMutation = (mutation: Omit<QueuedMutation, 'id' | 'timestamp'>) => {
    const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
    const item: QueuedMutation = {
      ...mutation,
      id: `MUT-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: Date.now(),
      reset_version: currentResetVer
    };
    const list = getPendingMutations();
    list.push(item);
    savePendingMutations(list);
  };

  const flushPendingMutationsQueue = async () => {
    const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
    const allMutations = getPendingMutations();
    // Drop any mutation created under an older reset version
    const mutations = allMutations.filter(m => !m.reset_version || m.reset_version >= currentResetVer);
    if (mutations.length !== allMutations.length) {
      savePendingMutations(mutations);
    }
    if (mutations.length === 0) return;

    let targetAddr = serverAddress.trim() || getDefaultServerAddress();
    const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
    const isHttps = isSecureServerHost(cleanHost, targetAddr);
    const httpProto = isHttps ? 'https:' : 'http:';

    const baseUrl = getApiBaseUrl();
    const persistentDevId = getPersistentDeviceId();
    const effectiveAuthor = currentUser || 'OPERATOR';
    const effectiveUserId = currentEmployeeId ? `USR-${currentEmployeeId}` : `USR-${effectiveAuthor}`;
    const batchPayload = {
      mutations,
      reset_version: currentResetVer,
      device_id: persistentDevId,
      author: effectiveAuthor,
      employeeId: currentEmployeeId,
      user_id: effectiveUserId
    };

    try {
      const res = await fetch(`${baseUrl}/api/sync/batch`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId,
          'x-employee-id': currentEmployeeId || '',
          'x-user-permission': currentPermission || ''
        },
        body: JSON.stringify(batchPayload)
      });
      if (res.status === 409) {
        const errJson = await res.json().catch(() => ({}));
        const newVer = Number(errJson.systemResetVersion) || Date.now();
        console.warn(`[JUWEI WMS] Batch sync rejected with 409 STALE_RESET_VERSION. Purging offline queues.`);
        purgeAllLocalOfflineCachesAndQueues(newVer);
        handleManualSync();
        return;
      }
      if (res.ok) {
        localStorage.removeItem(PENDING_MUTATIONS_KEY);
        return;
      }
    } catch (e) {}

    try {
      const resFallback = await fetch(`${httpProto}//${cleanHost}/api/sync/batch`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId,
          'x-employee-id': currentEmployeeId || '',
          'x-user-permission': currentPermission || ''
        },
        body: JSON.stringify(batchPayload)
      });
      if (resFallback.status === 409) {
        const errJson = await resFallback.json().catch(() => ({}));
        const newVer = Number(errJson.systemResetVersion) || Date.now();
        purgeAllLocalOfflineCachesAndQueues(newVer);
        handleManualSync();
        return;
      }
      if (resFallback.ok) {
        localStorage.removeItem(PENDING_MUTATIONS_KEY);
      }
    } catch (err) {}
  };

  // Completely wipes all cached tables, pending queues, tombstones, and synchronizes reset version
  const purgeAllLocalOfflineCachesAndQueues = (newResetVersion: number) => {
    try {
      if (newResetVersion > 0) {
        localStorage.setItem('juwei_wms_system_reset_version', String(newResetVersion));
      }
      const collectionsToClear = [
        'stocks', 'receiving', 'returns', 'recycling', 'issuances', 
        'deliveries', 'envLogs', 'forkliftChecks', 'registries'
      ];
      collectionsToClear.forEach(col => {
        localStorage.removeItem(`juwei_wms_cache_${col}`);
      });
      localStorage.removeItem('juwei_wms_master_registries');
      localStorage.removeItem('juwei_wms_pending_sync');
      localStorage.removeItem(PENDING_MUTATIONS_KEY);
      localStorage.removeItem('juwei_wms_offline_queue_v1');
      localStorage.removeItem('juwei_wms_deleted_records_v1');
      localStorage.removeItem('juwei_wms_draft_receiving');
      localStorage.removeItem('juwei_wms_draft_receiving_return');
      localStorage.removeItem('juwei_wms_draft_issuance');
    } catch (e) {}

    deletedRecordIds.current.clear();
    recentlyMutatedRecords.current.clear();
  };

  // Directly sets in-memory state to pure authoritative central database data without merging stale leftovers
  const applyAuthoritativeResetState = (dataPayload: any, activeUsersList?: string[], activePresenceList?: ActivePresenceUser[]) => {
    if (!dataPayload || typeof dataPayload !== 'object') {
      return;
    }
    const { 
      stocks: s, 
      receiving: rc, 
      returns: rt, 
      recycling: cy, 
      issuances: is, 
      deliveries: d, 
      envLogs: e, 
      forkliftChecks: f, 
      registries: reg, 
      registeredUsers: serverUsers, 
      chatMessages: msgs 
    } = dataPayload;

    setStocks(normalizeRecords('stocks', Array.isArray(s) ? s : []));
    setReceiving(normalizeRecords('receiving', Array.isArray(rc) ? rc : []));
    setReturns(normalizeRecords('returns', Array.isArray(rt) ? rt : []));
    setRecycling(normalizeRecords('recycling', Array.isArray(cy) ? cy : []));
    setIssuances(normalizeRecords('issuances', Array.isArray(is) ? is : []));
    setDeliveries(normalizeRecords('deliveries', Array.isArray(d) ? d : []));
    setEnvLogs(normalizeRecords('envLogs', Array.isArray(e) ? e : []));
    setForkliftChecks(normalizeRecords('forkliftChecks', Array.isArray(f) ? f : []));
    setRegistries(normalizeRecords('registries', Array.isArray(reg) ? reg : []));

    if (Array.isArray(serverUsers) && serverUsers.length > 0) {
      setRegisteredUsers(reconcileUsers([], serverUsers));
    }
    if (Array.isArray(dataPayload.operationalRoles) && dataPayload.operationalRoles.length > 0) {
      const opClean = Array.from(new Set<string>(dataPayload.operationalRoles.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
      if (opClean.length > 0) {
        setOperationalRoles(opClean);
        try { localStorage.setItem('juwei_wms_operationalRoles', JSON.stringify(opClean)); } catch (e) {}
      }
    }
    if (Array.isArray(dataPayload.receivingCategories) && dataPayload.receivingCategories.length > 0) {
      const catClean = Array.from(new Set<string>(dataPayload.receivingCategories.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
      if (catClean.length > 0) {
        setReceivingCategories(catClean);
        try { localStorage.setItem('juwei_wms_receivingCategories', JSON.stringify(catClean)); } catch (e) {}
      }
    }
    if (Array.isArray(msgs)) setChatMessages(msgs);
    if (activePresenceList && Array.isArray(activePresenceList)) {
      setWsPresence(activePresenceList);
    }
  };

  // Super Admin Exclusive Global Reset: Authoritatively clears central database across all stations
  const executeSuperAdminGlobalReset = async () => {
    const isSuperAdminOperating = 
      currentEmployeeId === 'JPMP-002' || 
      (currentUser || '').toUpperCase().includes('ALDRIN') || 
      currentRole === 'SUPER ADMINISTRATOR';

    if (!isSuperAdminOperating) {
      alert("UNAUTHORIZED: Only Super Administrator (JPMP-002) is authorized to execute a complete global database reset.");
      return;
    }

    const baseUrl = getApiBaseUrl();
    const cleanAuthor = `${currentUser || 'ALDRIN BANAWA'} (${currentEmployeeId || 'JPMP-002'})`;

    let resetVer = Date.now();
    try {
      const res = await fetch(`${baseUrl}/api/reset-database`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-employee-id': currentEmployeeId || 'JPMP-002',
          'x-user-role': currentRole || 'SUPER ADMINISTRATOR',
          'x-user-permission': currentPermission || 'FULL_ACCESS',
          'x-user-pin': '0423'
        },
        body: JSON.stringify({
          employeeId: currentEmployeeId || 'JPMP-002',
          role: currentRole || 'SUPER ADMINISTRATOR',
          permission: currentPermission || 'FULL_ACCESS',
          pin: '0423',
          confirmed: true,
          author: cleanAuthor,
          keepUsers: true
        })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.systemResetVersion) {
          resetVer = Number(json.systemResetVersion);
        }
      }
    } catch (e) {
      console.warn('Server reset call error:', e);
    }

    purgeAllLocalOfflineCachesAndQueues(resetVer);

    setStocks([]);
    setReceiving([]);
    setReturns([]);
    setRecycling([]);
    setIssuances([]);
    setDeliveries([]);
    setEnvLogs([]);
    setForkliftChecks([]);
    setRegistries([]);

    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'GLOBAL_RESET',
          systemResetVersion: resetVer,
          resetBy: cleanAuthor
        });
      } catch (e) {}
    }

    setLiveSyncToast({
      id: String(Date.now()),
      author: cleanAuthor,
      action: `GLOBAL RESET COMPLETE: Central database cleared`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    setLastSyncedTime(new Date());
  };

  // Deep equivalency checker that tolerates null/undefined/empty string/empty array/empty object and numeric/boolean string formats
  const areValuesEquivalent = (valA: any, valB: any): boolean => {
    if (valA === valB) return true;
    const isBlankA = valA === null || valA === undefined || valA === '' || (Array.isArray(valA) && valA.length === 0) || (typeof valA === 'object' && valA !== null && Object.keys(valA).length === 0);
    const isBlankB = valB === null || valB === undefined || valB === '' || (Array.isArray(valB) && valB.length === 0) || (typeof valB === 'object' && valB !== null && Object.keys(valB).length === 0);
    if (isBlankA && isBlankB) return true;
    if (isBlankA !== isBlankB) return false;

    // Number vs number-string equivalency (e.g. 100 vs "100")
    if ((typeof valA === 'number' && typeof valB === 'string') || (typeof valA === 'string' && typeof valB === 'number')) {
      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA === numB;
      }
    }

    // Boolean string equivalency
    if (typeof valA === 'boolean' && typeof valB === 'string') {
      return String(valA) === valB.toLowerCase();
    }
    if (typeof valA === 'string' && typeof valB === 'boolean') {
      return valA.toLowerCase() === String(valB);
    }

    // Objects / Arrays comparison
    if (typeof valA === 'object' && valA !== null && typeof valB === 'object' && valB !== null) {
      if (Array.isArray(valA) && Array.isArray(valB)) {
        if (valA.length !== valB.length) return false;
        for (let i = 0; i < valA.length; i++) {
          if (!areValuesEquivalent(valA[i], valB[i])) return false;
        }
        return true;
      }
      if (Array.isArray(valA) !== Array.isArray(valB)) return false;
      const keysA = Object.keys(valA);
      const keysB = Object.keys(valB);
      const allKeys = Array.from(new Set([...keysA, ...keysB]));
      for (const k of allKeys) {
        if (!areValuesEquivalent(valA[k], valB[k])) return false;
      }
      return true;
    }

    return false;
  };

  // Helper to compare collections by content to avoid unnecessary state re-renders and table flickering
  const areCollectionsEqual = (a: any[], b: any[]): boolean => {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;

    for (let i = 0; i < b.length; i++) {
      const itemB = b[i];
      if (!itemB || !itemB.id) return false;
      const itemA = a[i];
      if (!itemA || itemA.id !== itemB.id) return false;

      const allKeys = new Set([...Object.keys(itemA), ...Object.keys(itemB)]);
      for (const k of allKeys) {
        if (k === 'updated_at' || k === 'updatedAt' || k === '_v' || k === 'last_ping' || k === 'connectedAt' || k === 'savedAt') continue;
        if (!areValuesEquivalent(itemA[k], itemB[k])) {
          return false;
        }
      }
    }
    return true;
  };

  // Helper to reconcile incoming remote collections with local state cleanly without data loss, disappearing records, or resurrection of reset data
  const reconcileCollection = (colName: string, currentArr: any[], incomingArr: any[], forceOverwrite = false): any[] => {
    const safeCurrent = Array.isArray(currentArr) ? currentArr : [];

    if (!Array.isArray(incomingArr)) {
      return safeCurrent;
    }

    if (forceOverwrite) {
      return incomingArr;
    }

    const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
    const deletedSet = getDeletedRecordIds();

    // Check for active unconfirmed local mutations with valid reset version
    const pendingMutations = getPendingMutations().filter(
      mut => mut && mut.collection === colName && (!mut.reset_version || mut.reset_version >= currentResetVer)
    );

    // Prevent data flickering bug: If server returned empty array and forceOverwrite is false,
    // only preserve current if it has valid data and we are in transit
    if (incomingArr.length === 0 && !forceOverwrite && safeCurrent.length > 0) {
      // If we haven't synced yet or network blip, keep current temporarily
      return safeCurrent;
    }

    // Filter incoming records from server to exclude stale reset versions
    const filteredIncoming = incomingArr.filter(item => {
      if (!item || (!item.id && !item.record_id)) return false;
      if (item.reset_version && currentResetVer > 0 && Number(item.reset_version) < currentResetVer) return false;
      return true;
    });

    // Central Server Database is the SINGLE SOURCE OF TRUTH
    const mergedMap = new Map<string, any>();

    // 1. All server records populate the authoritative state
    for (const remoteItem of filteredIncoming) {
      const recId = String(remoteItem.id || remoteItem.record_id);
      mergedMap.set(recId, remoteItem);
    }

    // 2. Overlay ONLY pending unconfirmed offline mutations created on this device
    for (const mut of pendingMutations) {
      if (mut && mut.type === 'upsert' && mut.record && (mut.record.id || mut.record.record_id)) {
        const id = String(mut.record.id || mut.record.record_id);
        if (!deletedSet.has(id)) {
          mergedMap.set(id, { ...(mergedMap.get(id) || {}), ...mut.record });
        }
      } else if (mut && mut.type === 'delete' && (mut.recordId || (mut as any).id)) {
        const id = String(mut.recordId || (mut as any).id);
        mergedMap.delete(id);
      }
    }

    const resultList = Array.from(mergedMap.values());

    // If contents and ordering are equal to currentArr, return currentArr reference (prevents re-render and flicker)
    if (areCollectionsEqual(safeCurrent, resultList)) {
      return safeCurrent;
    }

    return resultList;
  };

  // Helper to compare users by content to avoid unnecessary user state re-renders
  const areUsersEqual = (a: RegisteredAccount[], b: RegisteredAccount[]): boolean => {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    
    for (let i = 0; i < b.length; i++) {
      const uB = b[i];
      if (!uB || !uB.employeeId) return false;
      const uA = a[i];
      if (!uA || (uA.employeeId || '').toUpperCase() !== (uB.employeeId || '').toUpperCase()) return false;
      if (
        (uA.username || '').toUpperCase() !== (uB.username || '').toUpperCase() ||
        (uA.role || '').toUpperCase() !== (uB.role || '').toUpperCase() ||
        (uA.permission || '') !== (uB.permission || '') ||
        (uA.pin || '') !== (uB.pin || '') ||
        (uA.status || '') !== (uB.status || '') ||
        (uA.phoneNumber || '') !== (uB.phoneNumber || '')
      ) {
        return false;
      }
    }
    return true;
  };

  // Helper to reconcile user accounts safely without data loss, disappearing accounts, or flickering
  const reconcileUsers = (currentUsers: RegisteredAccount[], incomingUsers: any[]): RegisteredAccount[] => {
    const deletedSet = getDeletedUserIds();
    const userMap = new Map<string, RegisteredAccount>();

    const incomingList = Array.isArray(incomingUsers) ? incomingUsers : [];
    const safeCurrent = Array.isArray(currentUsers) ? currentUsers : [];

    // 1. Add all authoritative incoming users (enforcing Super Administrator registration origin)
    for (const u of incomingList) {
      if (!u || (!u.employeeId && !u.employee_id)) continue;
      const rawEmpId = String(u.employeeId || u.employee_id || '').toUpperCase().trim();
      const empId = rawEmpId.startsWith('JPMP-') ? rawEmpId : `JPMP-${rawEmpId.replace(/^EMP-/, '')}`;
      if (deletedSet.has(empId) && empId !== 'JPMP-002') continue;

      const isSuper = empId === 'JPMP-002';
      const localUser = safeCurrent.find(cu => (cu.employeeId || '').toUpperCase() === empId);
      
      // CRITICAL: Server intentionally strips PIN for non-superadmin connections.
      // u may not have pin property. We MUST preserve localUser.pin! Never fall back to '1234'.
      const cleanPin = (u?.pin && String(u.pin).trim()) || (localUser?.pin && String(localUser.pin).trim()) || (isSuper ? '0423' : '');
      const isCompromised = cleanPin === '1234' || !!u.isPinCompromised || !!localUser?.isPinCompromised;

      userMap.set(empId, {
        username: (u.username || localUser?.username || (isSuper ? 'ALDRIN BANAWA' : 'OPERATOR')).toUpperCase(),
        role: (u.role || localUser?.role || (isSuper ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE CLERK')).toUpperCase(),
        employeeId: empId,
        phoneNumber: u.phoneNumber || u.phone_number || localUser?.phoneNumber || (isSuper ? '+639669858846' : ''),
        permission: u.permission || localUser?.permission || (isSuper ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
        pin: cleanPin,
        isPinCompromised: isCompromised,
        status: u.status || localUser?.status || 'ACTIVE',
        lastActive: u.lastActive || u.last_active || localUser?.lastActive || undefined,
        registeredBy: isSuper ? 'ROOT_SUPER_ADMIN (JPMP-002)' : (u.registeredBy || localUser?.registeredBy || 'JPMP-002 (ALDRIN BANAWA)'),
        registeredBySuperAdmin: true,
        registeredAt: u.registeredAt || localUser?.registeredAt || u.created_at || undefined,
        stationId: u.stationId || localUser?.stationId || undefined
      });
    }

    // 2. Preserve all local accounts from safeCurrent that have not been explicitly deleted
    for (const cu of safeCurrent) {
      if (!cu || !cu.employeeId) continue;
      const empId = cu.employeeId.toUpperCase().trim();
      if (!userMap.has(empId) && (!deletedSet.has(empId) || empId === 'JPMP-002')) {
        const pin = (cu.pin && String(cu.pin).trim()) || (empId === 'JPMP-002' ? '0423' : '');
        const isCompromised = pin === '1234' || !!cu.isPinCompromised;
        const isSuper = empId === 'JPMP-002';
        userMap.set(empId, { 
          ...cu, 
          pin,
          isPinCompromised: isCompromised,
          registeredBy: isSuper ? 'ROOT_SUPER_ADMIN (JPMP-002)' : (cu.registeredBy || 'JPMP-002 (ALDRIN BANAWA)'),
          registeredBySuperAdmin: true
        });
      }
    }

    // 3. Guarantee Super Admin JPMP-002 is always active, full access, and protected
    const admin = userMap.get('JPMP-002') || superAdminAccount;
    const adminPin = (admin.pin && String(admin.pin).trim()) || '0423';
    userMap.set('JPMP-002', {
      ...superAdminAccount,
      ...admin,
      employeeId: 'JPMP-002',
      username: admin.username || 'ALDRIN BANAWA',
      role: 'SUPER ADMINISTRATOR',
      permission: 'FULL_ACCESS',
      pin: adminPin,
      isPinCompromised: false,
      status: 'ACTIVE',
      registeredBy: 'ROOT_SUPER_ADMIN (JPMP-002)',
      registeredBySuperAdmin: true
    });

    const orderedUsers: RegisteredAccount[] = [];
    const usedEmpIds = new Set<string>();

    for (const cu of safeCurrent) {
      if (cu && cu.employeeId) {
        const empId = cu.employeeId.toUpperCase().trim();
        if (userMap.has(empId)) {
          orderedUsers.push(userMap.get(empId)!);
          usedEmpIds.add(empId);
        }
      }
    }

    for (const [empId, u] of userMap.entries()) {
      if (!usedEmpIds.has(empId)) {
        orderedUsers.push(u);
      }
    }

    if (areUsersEqual(safeCurrent, orderedUsers)) {
      return safeCurrent;
    }

    return orderedUsers;
  };

  // Fresh install protocol: wipes local cache, fetches pure authoritative snapshot from central server,
  // and broadcasts live synchronization to all connected users and workstations across the cluster.
  const performFreshInstallAndSync = async (isUserInitiated = false) => {
    try {
      const stationId = getStationId();
      const installId = 'INS-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      localStorage.setItem('juwei_wms_install_id', installId);
      localStorage.setItem('juwei_wms_installed_at', new Date().toISOString());
      localStorage.setItem('juwei_wms_installed_flag_v1', 'true');
      localStorage.removeItem('juwei_wms_is_fresh_install');
      localStorage.removeItem('juwei_wms_pending_sync');

      // Clear stale local caches
      const staleKeys = [
        'juwei_wms_pending_sync',
        'juwei_wms_mutation_queue_v1',
        'juwei_wms_cache_stocks',
        'juwei_wms_cache_receiving',
        'juwei_wms_cache_returns',
        'juwei_wms_cache_recycling',
        'juwei_wms_cache_issuances',
        'juwei_wms_cache_deliveries',
        'juwei_wms_cache_envLogs',
        'juwei_wms_cache_forkliftChecks',
        'juwei_wms_cache_registries',
        'juwei_wms_master_registries',
        'juwei_wms_cache_registeredUsers'
      ];
      staleKeys.forEach(k => {
        try { localStorage.removeItem(k); } catch (e) {}
      });

      // Purge any legacy Cloud Run or dev server addresses to ensure zero Google/Gmail account login prompt
      try {
        const cachedServer = localStorage.getItem('juwei_wms_server_address');
        if (cachedServer && (cachedServer.includes('.run.app') || cachedServer.includes('ais-dev-') || cachedServer.includes('ais-pre-'))) {
          localStorage.setItem('juwei_wms_server_address', 'http://192.168.20.214:3000');
        }
      } catch (e) {}

      // 1. Fetch fresh authoritative state from central server
      const baseUrl = getApiBaseUrl();
      try {
        const res = await fetch(`${baseUrl}/api/terminal/fresh-install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stationId,
            installId,
            username: currentUser || 'JUWEI OPERATOR',
            employeeId: currentEmployeeId || '',
            platform: getPlatformName()
          })
        });

        if (res.ok) {
          const json = await res.json();
          if (json && json.data) {
            if (json.systemResetVersion) {
              localStorage.setItem('juwei_wms_system_reset_version', String(json.systemResetVersion));
            }
            if (json.globalResetId) {
              localStorage.setItem('juwei_wms_global_reset_id', String(json.globalResetId));
            }
            const { stocks: s, receiving: r, returns: ret, recycling: rec, issuances: iss, deliveries: del, envLogs: el, forkliftChecks: fc, registries: reg, registeredUsers: ru, chatMessages: cm } = json.data;
            if (Array.isArray(s)) setStocks(normalizeRecords('stocks', s));
            if (Array.isArray(r)) setReceiving(normalizeRecords('receiving', r));
            if (Array.isArray(ret)) setReturns(normalizeRecords('returns', ret));
            if (Array.isArray(rec)) setRecycling(normalizeRecords('recycling', rec));
            if (Array.isArray(iss)) setIssuances(normalizeRecords('issuances', iss));
            if (Array.isArray(del)) setDeliveries(normalizeRecords('deliveries', del));
            if (Array.isArray(el)) setEnvLogs(normalizeRecords('envLogs', el));
            if (Array.isArray(fc)) setForkliftChecks(normalizeRecords('forkliftChecks', fc));
            if (Array.isArray(reg)) setRegistries(normalizeRecords('registries', reg));
            if (Array.isArray(ru) && ru.length > 0) setRegisteredUsers(reconcileUsers([], ru));
            if (Array.isArray(json.data.operationalRoles) && json.data.operationalRoles.length > 0) {
              const opClean = Array.from(new Set<string>(json.data.operationalRoles.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
              if (opClean.length > 0) {
                setOperationalRoles(opClean);
                try { localStorage.setItem('juwei_wms_operationalRoles', JSON.stringify(opClean)); } catch (e) {}
              }
            }
            if (Array.isArray(json.data.receivingCategories) && json.data.receivingCategories.length > 0) {
              const catClean = Array.from(new Set<string>(json.data.receivingCategories.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
              if (catClean.length > 0) {
                setReceivingCategories(catClean);
                try { localStorage.setItem('juwei_wms_receivingCategories', JSON.stringify(catClean)); } catch (e) {}
              }
            }
            if (Array.isArray(cm) && cm.length > 0) setChatMessages(cm);
          }
        }
      } catch (err) {
        console.warn('Fresh install server sync error, falling back to database:', err);
      }

      // 2. Announce over WebSocket to all network workstations
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({
            type: 'client_installed',
            stationId,
            installId,
            username: currentUser || 'JUWEI OPERATOR',
            employeeId: currentEmployeeId || '',
            platform: getPlatformName(),
            timestamp: new Date().toISOString()
          }));
        } catch (e) {}
      }

      // 3. Announce over BroadcastChannel to other browser tabs
      if (syncChannelRef.current) {
        try {
          syncChannelRef.current.postMessage({
            type: 'client_installed',
            stationId,
            installId,
            username: currentUser || 'JUWEI OPERATOR',
            platform: getPlatformName()
          });
        } catch (e) {}
      }

      setLastSyncedTime(new Date());

      setLiveSyncToast({
        id: String(Date.now()),
        author: 'System',
        action: isUserInitiated ? 'Fresh install re-initialized • Synchronized with all cluster operators' : 'Fresh install complete • Synced with all cluster terminals',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });
    } catch (e) {
      console.warn('performFreshInstallAndSync error:', e);
    }
  };

  // Automatic fresh install initialization check on startup
  useEffect(() => {
    try {
      const isInstalled = localStorage.getItem('juwei_wms_installed_flag_v1');
      if (!isInstalled) {
        console.log('[JUWEI WMS] First-time launch / fresh install detected. Initializing clean station & syncing...');
        performFreshInstallAndSync(false);
      }
    } catch (e) {}
  }, []);

  // Helper to execute coordinated single-record upsert across local state, WebSocket, and Express server
  const upsertRecordLocallyAndRemotely = (
    collection: string, 
    record: any, 
    actionDesc?: string
  ) => {
    if (!record || !record.id || !collection) return;
    unmarkRecordAsDeletedLocally(record.id);
    markRecordMutatedLocally(record.id);
    lastMutationTimes.current[collection] = Date.now();
    setLastSyncedTime(new Date());

    // If an application update is available and user previously clicked 'Later', gently re-surface notification
    if (updateAvailableRef.current) {
      setBannerDismissed(false);
    }

    // Queue for offline resilience
    queueOfflineMutation({
      type: 'upsert',
      collection,
      record,
      author: currentUser || 'Operator',
      actionDesc
    });

    // 0. Cross-tab BroadcastChannel
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'upsert_record',
          collection,
          record,
          author: currentUser || 'Operator',
          actionDesc,
          reset_version: Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0
        });
      } catch (e) {}
    }

    const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;

    // 1. WebSocket targeted delta broadcast to central server
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'upsert_record',
          collection,
          record,
          author: currentUser || 'Operator',
          actionDesc,
          reset_version: currentResetVer,
          record_id: record.id || record.record_id
        }));
      } catch (e) {}
    }

    // 2. HTTP REST upsert endpoint
    let targetAddr = serverAddress.trim() || getDefaultServerAddress();
    const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
    const isHttps = isSecureServerHost(cleanHost, targetAddr);
    const httpProto = isHttps ? 'https:' : 'http:';
    const baseUrl = getApiBaseUrl();

    fetch(`${baseUrl}/api/records/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection,
        record,
        author: currentUser || 'Operator',
        actionDesc,
        reset_version: currentResetVer,
        record_id: record.id || record.record_id
      })
    })
    .then(async res => {
      if (res.status === 409) {
        const errJson = await res.json().catch(() => ({}));
        const serverVer = Number(errJson.serverResetVersion) || currentResetVer + 1;
        purgeAllLocalOfflineCachesAndQueues(serverVer);
        handleManualSync();
        return;
      }
      if (res.ok) flushPendingMutationsQueue();
    })
    .catch(() => {
      fetch(`${httpProto}//${cleanHost}/api/records/upsert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection,
          record,
          author: currentUser || 'Operator',
          actionDesc,
          reset_version: currentResetVer,
          record_id: record.id || record.record_id
        })
      })
      .then(async res => {
        if (res.status === 409) {
          const errJson = await res.json().catch(() => ({}));
          const serverVer = Number(errJson.serverResetVersion) || currentResetVer + 1;
          purgeAllLocalOfflineCachesAndQueues(serverVer);
          handleManualSync();
        }
      })
      .catch(() => {});
    });
  };

  // Helper to execute coordinated deletion across local state, WebSocket, and Express server
  const deleteRecordLocallyAndRemotely = (collection: string, id: string) => {
    if (!id || !collection) return;
    markRecordAsDeletedLocally(id);
    setLastSyncedTime(new Date());

    const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;

    // Queue for offline resilience
    queueOfflineMutation({
      type: 'delete',
      collection,
      recordId: id,
      author: currentUser || 'Operator',
      reset_version: currentResetVer
    });

    // 0. Cross-tab BroadcastChannel
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'delete_record',
          collection,
          id,
          reset_version: currentResetVer
        });
      } catch (e) {}
    }

    // 1. WebSocket deletion to central database
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'delete_record',
          collection,
          id,
          reset_version: currentResetVer
        }));
      } catch (e) {}
    }

    // 2. HTTP REST deletion
    let targetAddr = serverAddress.trim() || getDefaultServerAddress();
    const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
    const isHttps = isSecureServerHost(cleanHost, targetAddr);
    const httpProto = isHttps ? 'https:' : 'http:';
    const baseUrl = getApiBaseUrl();

    fetch(`${baseUrl}/api/records/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection, id, reset_version: currentResetVer })
    })
    .then(async res => {
      if (res.status === 409) {
        const errJson = await res.json().catch(() => ({}));
        const serverVer = Number(errJson.serverResetVersion) || currentResetVer + 1;
        purgeAllLocalOfflineCachesAndQueues(serverVer);
        handleManualSync();
        return;
      }
      if (res.ok) flushPendingMutationsQueue();
    })
    .catch(() => {
      fetch(`${httpProto}//${cleanHost}/api/records/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, id, reset_version: currentResetVer })
      })
      .then(async res => {
        if (res.status === 409) {
          const errJson = await res.json().catch(() => ({}));
          const serverVer = Number(errJson.serverResetVersion) || currentResetVer + 1;
          purgeAllLocalOfflineCachesAndQueues(serverVer);
          handleManualSync();
        }
      })
      .catch(() => {});
    });
  };

  // Manual Full-Sync across WebSocket, REST & Local Terminals
  const handleManualSync = async () => {
    setIsManualSyncing(true);
    try {
      // 1. Broadcast force sync over WebSocket & request latest cluster presence
      if (wsOpen(socket)) {
        try {
          socket!.send(JSON.stringify({ 
            type: 'force_sync_all',
            author: currentUser || 'SUPER ADMINISTRATOR'
          }));
          socket!.send(JSON.stringify({ 
            type: 'get_presence'
          }));
        } catch (e) {}
      }


      // 3. Broadcast force sync over local BroadcastChannel
      if (syncChannelRef.current) {
        try {
          syncChannelRef.current.postMessage({
            type: 'activity_toast',
            author: currentUser || 'Workstation',
            action: 'Requested immediate cluster data synchronization'
          });
        } catch (e) {}
      }

      let targetAddr = serverAddress.trim() || getDefaultServerAddress();
      const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
      const isHttps = isSecureServerHost(cleanHost, targetAddr);
      const httpProto = isHttps ? 'https:' : 'http:';
      const baseUrl = getApiBaseUrl();

      try {
        const res = await fetch(`${baseUrl}/api/sync`, { cache: 'no-store', headers: { 'Accept': 'application/json' } });
        if (res.ok) {
          const json = await res.json();
          if (json.systemResetVersion) {
            const serverResetVer = Number(json.systemResetVersion) || 0;
            const localResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
            if (serverResetVer > localResetVer) {
              console.log(`[JUWEI WMS] Manual sync detected hard reset (${serverResetVer} > ${localResetVer})`);
              purgeAllLocalOfflineCachesAndQueues(serverResetVer);
              applyAuthoritativeResetState(json.data, json.activeUsers, json.activePresence);
              setConnectionStatus('connected');
              return;
            } else if (serverResetVer > 0 && localResetVer === 0) {
              localStorage.setItem('juwei_wms_system_reset_version', String(serverResetVer));
            }
          }
          if (json.tombstones) {
            if (Array.isArray(json.tombstones.records)) {
              json.tombstones.records.forEach((rid: string) => markRecordAsDeletedLocally(rid));
            }
            if (Array.isArray(json.tombstones.users)) {
              json.tombstones.users.forEach((uid: string) => markUserAsDeleted(uid));
            }
          }
          if (json.data) {
            const { stocks: s, receiving: rc, returns: rt, recycling: cy, issuances: is, deliveries: d, envLogs: e, forkliftChecks: f, registries: reg, registeredUsers: ru, chatMessages: cm } = json.data;
            if (Array.isArray(s)) setStocks(prev => reconcileCollection('stocks', prev, normalizeRecords('stocks', s)));
            if (Array.isArray(rc)) setReceiving(prev => reconcileCollection('receiving', prev, normalizeRecords('receiving', rc)));
            if (Array.isArray(rt)) setReturns(prev => reconcileCollection('returns', prev, normalizeRecords('returns', rt)));
            if (Array.isArray(cy)) setRecycling(prev => reconcileCollection('recycling', prev, normalizeRecords('recycling', cy)));
            if (Array.isArray(is)) setIssuances(prev => reconcileCollection('issuances', prev, normalizeRecords('issuances', is)));
            if (Array.isArray(d)) setDeliveries(prev => reconcileCollection('deliveries', prev, normalizeRecords('deliveries', d)));
            if (Array.isArray(e)) setEnvLogs(prev => reconcileCollection('envLogs', prev, normalizeRecords('envLogs', e)));
            if (Array.isArray(f)) setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, normalizeRecords('forkliftChecks', f)));
            if (Array.isArray(reg)) setRegistries(prev => reconcileCollection('registries', prev, normalizeRecords('registries', reg)));
            if (Array.isArray(ru)) setRegisteredUsers(prev => reconcileUsers(prev, ru));
            if (Array.isArray(json.data.operationalRoles) && json.data.operationalRoles.length > 0) {
              const opClean = Array.from(new Set<string>(json.data.operationalRoles.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
              if (opClean.length > 0) {
                setOperationalRoles(opClean);
                try { localStorage.setItem('juwei_wms_operationalRoles', JSON.stringify(opClean)); } catch (e) {}
              }
            }
            if (Array.isArray(json.data.receivingCategories) && json.data.receivingCategories.length > 0) {
              const catClean = Array.from(new Set<string>(json.data.receivingCategories.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
              if (catClean.length > 0) {
                setReceivingCategories(catClean);
                try { localStorage.setItem('juwei_wms_receivingCategories', JSON.stringify(catClean)); } catch (e) {}
              }
            }
            if (Array.isArray(cm) && cm.length > 0) setChatMessages(cm);
            if (json.activePresence && Array.isArray(json.activePresence)) {
              setWsPresence(json.activePresence);
            }
            setConnectionStatus('connected');
          }
        }
      } catch (err) {
        try {
          const resFallback = await fetch(`${httpProto}//${cleanHost}/api/sync`, { cache: 'no-store', headers: { 'Accept': 'application/json' } });
          if (resFallback.ok) {
            const json = await resFallback.json();
            if (json.systemResetVersion) {
              const serverResetVer = Number(json.systemResetVersion) || 0;
              const localResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
              if (serverResetVer > localResetVer) {
                purgeAllLocalOfflineCachesAndQueues(serverResetVer);
                applyAuthoritativeResetState(json.data, json.activeUsers, json.activePresence);
                setConnectionStatus('connected');
                return;
              } else if (serverResetVer > 0 && localResetVer === 0) {
                localStorage.setItem('juwei_wms_system_reset_version', String(serverResetVer));
              }
            }
            if (json.tombstones) {
              if (Array.isArray(json.tombstones.records)) {
                json.tombstones.records.forEach((rid: string) => markRecordAsDeletedLocally(rid));
              }
              if (Array.isArray(json.tombstones.users)) {
                json.tombstones.users.forEach((uid: string) => markUserAsDeleted(uid));
              }
            }
            if (json.data) {
              const { stocks: s, receiving: rc, returns: rt, recycling: cy, issuances: is, deliveries: d, envLogs: e, forkliftChecks: f, registries: reg, registeredUsers: ru, chatMessages: cm } = json.data;
              if (Array.isArray(s)) setStocks(prev => reconcileCollection('stocks', prev, normalizeRecords('stocks', s)));
              if (Array.isArray(rc)) setReceiving(prev => reconcileCollection('receiving', prev, normalizeRecords('receiving', rc)));
              if (Array.isArray(rt)) setReturns(prev => reconcileCollection('returns', prev, normalizeRecords('returns', rt)));
              if (Array.isArray(cy)) setRecycling(prev => reconcileCollection('recycling', prev, normalizeRecords('recycling', cy)));
              if (Array.isArray(is)) setIssuances(prev => reconcileCollection('issuances', prev, normalizeRecords('issuances', is)));
              if (Array.isArray(d)) setDeliveries(prev => reconcileCollection('deliveries', prev, normalizeRecords('deliveries', d)));
              if (Array.isArray(e)) setEnvLogs(prev => reconcileCollection('envLogs', prev, normalizeRecords('envLogs', e)));
              if (Array.isArray(f)) setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, normalizeRecords('forkliftChecks', f)));
              if (Array.isArray(reg)) setRegistries(prev => reconcileCollection('registries', prev, normalizeRecords('registries', reg)));
              if (Array.isArray(ru)) setRegisteredUsers(prev => reconcileUsers(prev, ru));
              if (Array.isArray(json.data.operationalRoles) && json.data.operationalRoles.length > 0) {
                const opClean = Array.from(new Set<string>(json.data.operationalRoles.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
                if (opClean.length > 0) {
                  setOperationalRoles(opClean);
                  try { localStorage.setItem('juwei_wms_operationalRoles', JSON.stringify(opClean)); } catch (e) {}
                }
              }
              if (Array.isArray(json.data.receivingCategories) && json.data.receivingCategories.length > 0) {
                const catClean = Array.from(new Set<string>(json.data.receivingCategories.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
                if (catClean.length > 0) {
                  setReceivingCategories(catClean);
                  try { localStorage.setItem('juwei_wms_receivingCategories', JSON.stringify(catClean)); } catch (e) {}
                }
              }
              if (Array.isArray(cm) && cm.length > 0) setChatMessages(cm);
              if (json.activePresence && Array.isArray(json.activePresence)) {
                setWsPresence(json.activePresence);
              }
              setConnectionStatus('connected');
            }
          }
        } catch (e2) {}
      }

      setLastSyncedTime(new Date());
    } catch (err) {
      console.warn('Manual sync failure:', err);
    } finally {
      setTimeout(() => setIsManualSyncing(false), 500);
    }
  };

  // Connect to fullstack WebSocket & HTTP Real-Time Server with automatic failover
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let httpPollInterval: any = null;
    let pingInterval: any = null;
    let isMounted = true;
    let hasConnectedOnce = false;
    let retryDelay = 1000;
    let missedPongs = 0;

    const applyStatePayload = (dataPayload: any, activeUsersList?: string[], activePresenceList?: ActivePresenceUser[]) => {
      if (!dataPayload) return;
      const { stocks, receiving, returns, recycling, issuances, deliveries, envLogs, forkliftChecks, registries, registeredUsers: serverUsers, chatMessages: msgs } = dataPayload;

      if (Array.isArray(stocks)) {
        const norm = normalizeRecords('stocks', stocks);
        setStocks(prev => reconcileCollection('stocks', prev, norm));
      }
      if (Array.isArray(receiving)) {
        const norm = normalizeRecords('receiving', receiving);
        setReceiving(prev => reconcileCollection('receiving', prev, norm));
      }
      if (Array.isArray(returns)) {
        const norm = normalizeRecords('returns', returns);
        setReturns(prev => reconcileCollection('returns', prev, norm));
      }
      if (Array.isArray(recycling)) {
        const norm = normalizeRecords('recycling', recycling);
        setRecycling(prev => reconcileCollection('recycling', prev, norm));
      }
      if (Array.isArray(issuances)) {
        const norm = normalizeRecords('issuances', issuances);
        setIssuances(prev => reconcileCollection('issuances', prev, norm));
      }
      if (Array.isArray(deliveries)) {
        const norm = normalizeRecords('deliveries', deliveries);
        setDeliveries(prev => reconcileCollection('deliveries', prev, norm));
      }
      if (Array.isArray(envLogs)) {
        const norm = normalizeRecords('envLogs', envLogs);
        setEnvLogs(prev => reconcileCollection('envLogs', prev, norm));
      }
      if (Array.isArray(forkliftChecks)) {
        const norm = normalizeRecords('forkliftChecks', forkliftChecks);
        setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, norm));
      }
      if (Array.isArray(registries)) {
        const norm = normalizeRecords('registries', registries);
        setRegistries(prev => reconcileCollection('registries', prev, norm));
      }
      
      if (Array.isArray(serverUsers)) {
        setRegisteredUsers(prev => reconcileUsers(prev, serverUsers));
      }
      if (Array.isArray(dataPayload.operationalRoles) && dataPayload.operationalRoles.length > 0) {
        const opClean = Array.from(new Set<string>(dataPayload.operationalRoles.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
        if (opClean.length > 0) {
          setOperationalRoles(opClean);
          try { localStorage.setItem('juwei_wms_operationalRoles', JSON.stringify(opClean)); } catch (e) {}
        }
      }
      if (Array.isArray(dataPayload.receivingCategories) && dataPayload.receivingCategories.length > 0) {
        const catClean = Array.from(new Set<string>(dataPayload.receivingCategories.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
        if (catClean.length > 0) {
          setReceivingCategories(catClean);
          try { localStorage.setItem('juwei_wms_receivingCategories', JSON.stringify(catClean)); } catch (e) {}
        }
      }
      if (msgs && Array.isArray(msgs)) setChatMessages(msgs);
      if (activePresenceList && Array.isArray(activePresenceList)) {
        setWsPresence(activePresenceList);
      }
    };

    let activeSyncAbortCtrl: AbortController | null = null;
    let syncSequenceId = 0;

    const tryFetchSync = async (url: string): Promise<boolean> => {
      const thisReqId = ++syncSequenceId;
      try {
        if (activeSyncAbortCtrl) {
          try { activeSyncAbortCtrl.abort(); } catch (e) {}
        }
        activeSyncAbortCtrl = new AbortController();
        const res = await fetch(url, { 
          method: 'GET', 
          cache: 'no-store', 
          headers: { 'Accept': 'application/json' },
          signal: activeSyncAbortCtrl.signal
        });
        if (thisReqId !== syncSequenceId) return false;
        if (res.ok) {
          const json = await res.json();
          if (thisReqId !== syncSequenceId) return false;
          if (json.systemResetVersion) {
            const serverResetVer = Number(json.systemResetVersion) || 0;
            const localResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
            if (serverResetVer > localResetVer) {
              console.log(`[JUWEI WMS] Hard reset detected from tryFetchSync (${serverResetVer} > ${localResetVer}). Purging local cache.`);
              purgeAllLocalOfflineCachesAndQueues(serverResetVer);
              if (isMounted) {
                hasConnectedOnce = true;
                setConnectionStatus('connected');
                applyAuthoritativeResetState(json.data, json.activeUsers, json.activePresence);
              }
              return true;
            } else if (serverResetVer > 0 && localResetVer === 0) {
              localStorage.setItem('juwei_wms_system_reset_version', String(serverResetVer));
            }
          }
          if (json.tombstones) {
            if (Array.isArray(json.tombstones.records)) {
              json.tombstones.records.forEach((rid: string) => markRecordAsDeletedLocally(rid));
            }
            if (Array.isArray(json.tombstones.users)) {
              json.tombstones.users.forEach((uid: string) => markUserAsDeleted(uid));
            }
          }
          if (isMounted) {
            hasConnectedOnce = true;
            setConnectionStatus('connected');
            if (json.data) applyStatePayload(json.data, json.activeUsers, json.activePresence);
          }
          return true;
        }
      } catch (e: any) {
        if (e && e.name === 'AbortError') return false;
        // Fetch failed
      }
      return false;
    };

    const flushPendingSyncQueue = async () => {
      try {
        localStorage.removeItem('juwei_wms_pending_sync');
      } catch (e) {}
    };

    const checkBuildVersion = async () => {
      try {
        const centralUrl = getCentralServerUrl();
        const endpoints = [
          '/api/build-info',
          '/build-info.json',
          ...(centralUrl ? [`${centralUrl}/api/build-info`, `${centralUrl}/build-info.json`] : [])
        ];
        const uniqueEndpoints = Array.from(new Set(endpoints.filter(Boolean)));

        for (const ep of uniqueEndpoints) {
          try {
            const res = await fetch(ep, {
              method: 'GET',
              cache: 'no-store',
              headers: { 'Accept': 'application/json' }
            });
            if (res.ok) {
              const data = await res.json();
              const serverVer = data?.version ? String(data.version).replace(/^v/i, '').trim() : '';
              if (serverVer) {
                setAppVersion((prev) => (prev !== serverVer ? serverVer : prev));
                if (typeof window !== 'undefined' && window.electronAPI?.updateAppVersion) {
                  window.electronAPI.updateAppVersion(serverVer);
                }
              }

              // Determine current installed/running app version:
              // 1. Electron installed desktop version (from OS desktop installation)
              // 2. Previously acknowledged/saved version in localStorage
              // 3. Static __APP_VERSION__ defined at build time
              let currentInstalled = (installedDesktopVersion || '').replace(/^v/i, '').trim();
              if (!currentInstalled) {
                try {
                  currentInstalled = (localStorage.getItem('juwei_wms_installed_version') || '').replace(/^v/i, '').trim();
                } catch (e) {}
              }
              if (!currentInstalled && typeof __APP_VERSION__ !== 'undefined') {
                currentInstalled = String(__APP_VERSION__).replace(/^v/i, '').trim();
              }

              // =========================================================================
              // MANDATORY RULE: Once app is installed / updated to the latest version,
              // ALWAYS REMOVE THIS BANNER!
              // =========================================================================
              const isUpToDate = Boolean(
                (currentInstalled && serverVer && !isNewerVersion(serverVer, currentInstalled)) ||
                (serverVer && currentInstalled && serverVer === currentInstalled)
              );

              if (isUpToDate) {
                if (updateAvailable || updateAvailableRef.current) {
                  console.log(`[JUWEI WMS UPDATE] Installed app (${currentInstalled}) is up-to-date with server (${serverVer}). Removing banner.`);
                  updateAvailableRef.current = false;
                  setUpdateAvailable(false);
                  setNewVersionString('');
                }
                break;
              }

              // ONLY show update banner if the server version is strictly NEWER than current version
              if (serverVer && currentInstalled && isNewerVersion(serverVer, currentInstalled)) {
                if (!updateAvailableRef.current) {
                  console.log(`[JUWEI WMS UPDATE] Update available: server ${serverVer} > client ${currentInstalled}`);
                  updateAvailableRef.current = true;
                  setUpdateAvailable(true);
                  setNewVersionString(serverVer);
                }
              } else if (!isNewerVersion(serverVer, currentInstalled)) {
                // Not newer: ensure banner is removed
                updateAvailableRef.current = false;
                setUpdateAvailable(false);
                setNewVersionString('');
              }
              break;
            }
          } catch (fetchErr) {
            // Quiet fallback
          }
        }
      } catch (e) {
        // Quiet fallback
      }
    };

    const runSyncCheck = async (): Promise<boolean> => {
      // Check for newly deployed application build
      checkBuildVersion();

      // 1. Authoritative Central Server Sync: every client strictly connects to the central cloud API
      const centralUrl = getCentralServerUrl();
      const centralOk = await tryFetchSync(`${centralUrl}/api/sync`);
      if (centralOk) {
        await flushPendingMutationsQueue();
        return true;
      }

      // 2. Relative API check if loaded on remote custom domain proxy
      const baseUrl = getApiBaseUrl();
      if (baseUrl && baseUrl !== centralUrl) {
        const relOk = await tryFetchSync(`${baseUrl}/api/sync`);
        if (relOk) {
          await flushPendingMutationsQueue();
          return true;
        }
      }

      if (isMounted && !hasConnectedOnce) {
        setConnectionStatus('disconnected');
      }
      return false;
    };

    const connectWebSocket = async () => {
      if (!isMounted) return;
      if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return;
      }

      const clientAccountId = localStorage.getItem('juwei_wms_account_id') || 'ACC-JUWEI';
      const clientWarehouseId = localStorage.getItem('juwei_wms_warehouse_id') || 'WH-MAIN';
      console.log(`[JUWEI WMS] Connecting WebSocket with accountId="${clientAccountId}", warehouseId="${clientWarehouseId}"`);
      // Strictly connect to Authoritative Central Server WebSocket endpoint
      const socketUrl = getCentralWebSocketUrl(clientAccountId, clientWarehouseId);

      if (pingInterval) clearInterval(pingInterval);

      try {
        ws = new WebSocket(socketUrl);
      } catch (err) {
        reconnectTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 1.5, 6000);
          connectWebSocket();
        }, retryDelay);
        return;
      }

      ws.onopen = () => {
        if (!isMounted) return;
        hasConnectedOnce = true;
        missedPongs = 0;
        retryDelay = 1000;
        setConnectionStatus('connected');
        setSocket(ws);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            const authPayload = {
              type: 'authenticate',
              accountId: clientAccountId,
              warehouseId: clientWarehouseId,
              user_id: currentEmployeeId ? `USR-${currentEmployeeId}` : 'ANONYMOUS',
              session_id: clientSessionId.current,
              device_id: getPersistentDeviceId(),
              connection_id: clientConnectionId.current || undefined,
              stationId: getStationId(),
              username: currentUser || 'JUWEI OPERATOR',
              employeeId: currentEmployeeId || '',
              role: currentRole || (currentPermission === 'FULL_ACCESS' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE OPERATOR'),
              permission: currentPermission || (currentEmployeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
              activeView: view,
              platform: getPlatformType(),
              deviceName: `${getPlatformType()} Terminal - ${getStationId()}`,
              reset_version: Number(localStorage.getItem('juwei_wms_system_reset_version')) || 1
            };
            ws.send(JSON.stringify(authPayload));
            ws.send(JSON.stringify({ ...authPayload, type: 'join' }));

            if (localStorage.getItem('juwei_wms_is_fresh_install') === 'true') {
              ws.send(JSON.stringify({
                type: 'client_installed',
                stationId: getStationId(),
                installId: localStorage.getItem('juwei_wms_install_id') || ('INS-' + Math.random().toString(36).substring(2, 6).toUpperCase()),
                username: currentUser || 'JUWEI OPERATOR',
                employeeId: currentEmployeeId || '',
                platform: getPlatformName(),
                timestamp: new Date().toISOString()
              }));
              localStorage.removeItem('juwei_wms_is_fresh_install');
            }
          } catch (e) {
            console.warn('WS send join error:', e);
          }
        }

        // Periodic ping heartbeat to keep connection alive and measure round-trip latency
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try {
              missedPongs++;
              if (missedPongs >= 3) {
                console.warn('Missed WebSocket pongs, reconnecting...');
                try { ws.close(); } catch (e) {}
                return;
              }
              ws.send(JSON.stringify({ type: 'ping', clientPingTime: Date.now() }));
            } catch (e) {
              console.warn('WS ping error:', e);
            }
          }
        }, 8000);
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'pong') {
            missedPongs = 0;
            if (payload.clientPingTime) {
              const rtt = Math.max(1, Date.now() - payload.clientPingTime);
              setWsLatency(rtt);
            }
            setLastSyncedTime(new Date());
            return;
          }

          switch (payload.type) {
            case 'FULL_INVENTORY_SYNC': {
              const incoming = Array.isArray(payload.inventory) ? payload.inventory : (Array.isArray(payload.stocks) ? payload.stocks : []);
              setLastSyncedTime(new Date());
              if (payload.serverInstanceId) {
                console.log(`[JUWEI WMS] FULL_INVENTORY_SYNC serverInstanceId: ${payload.serverInstanceId}`);
              }
              if (incoming.length > 0 || payload.inventory !== undefined) {
                const norm = normalizeRecords('stocks', incoming);
                setStocks(norm);
                console.log(`[JUWEI WMS] Received FULL_INVENTORY_SYNC (${norm.length} items) for account: ${payload.accountId || 'ALL'}, warehouse: ${payload.warehouseId || 'ALL'}`);
              }
              break;
            }
            case 'INVENTORY_UPDATE':
            case 'STOCK_ADJUSTMENT':
            case 'LOCATION_TRANSFER':
            case 'PICK_PACK_SHIP': {
              setLastSyncedTime(new Date());
              const { record, inventory, stocks: updatedStocks, collection, actionDesc, author } = payload;
              if (author && author !== (currentUser || '')) {
                setLiveSyncToast({
                  id: String(Date.now()),
                  author,
                  action: actionDesc || `${payload.type} processed in room`,
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
              }
              if (Array.isArray(inventory)) {
                const norm = normalizeRecords('stocks', inventory);
                setStocks(norm);
              } else if (Array.isArray(updatedStocks)) {
                const norm = normalizeRecords('stocks', updatedStocks);
                setStocks(norm);
              } else if (record && record.id) {
                const targetCol = collection || 'stocks';
                const updateFn = (prev: any[]) => {
                  if (isRecordDeletedLocally(record.id)) return prev;
                  const idx = prev.findIndex(it => it.id === record.id);
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = record;
                    return next;
                  }
                  return [record, ...prev];
                };
                if (targetCol === 'stocks') setStocks(updateFn);
                else if (targetCol === 'receiving') setReceiving(updateFn);
                else if (targetCol === 'returns') setReturns(updateFn);
                else if (targetCol === 'recycling') setRecycling(updateFn);
                else if (targetCol === 'issuances') setIssuances(updateFn);
                else if (targetCol === 'deliveries') setDeliveries(updateFn);
              }
              break;
            }
            case 'init': {
              hasConnectedOnce = true;
              missedPongs = 0;
              setConnectionStatus('connected');
              setLastSyncedTime(new Date());

              if (payload.connection_id) {
                clientConnectionId.current = payload.connection_id;
              }

              const serverResetVer = Number(payload.systemResetVersion) || 0;
              const localResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;

              if (serverResetVer > localResetVer) {
                console.log(`[JUWEI WMS] Server reset version ${serverResetVer} > local ${localResetVer}. Hard purging local stale data.`);
                purgeAllLocalOfflineCachesAndQueues(serverResetVer);
                applyAuthoritativeResetState(payload.data, payload.activeUsers, payload.presenceList || payload.activePresence);
              } else {
                if (serverResetVer > 0 && localResetVer === 0) {
                  localStorage.setItem('juwei_wms_system_reset_version', String(serverResetVer));
                }
                applyStatePayload(payload.data, payload.activeUsers, payload.presenceList || payload.activePresence);
              }
              if (payload.presenceList && Array.isArray(payload.presenceList)) {
                setWsPresence(payload.presenceList);
              } else if (payload.activePresence && Array.isArray(payload.activePresence)) {
                setWsPresence(payload.activePresence);
              }
              break;
            }
            case 'auth_confirmed': {
              if (payload.connection_id) {
                clientConnectionId.current = payload.connection_id;
              }
              if (payload.presenceList && Array.isArray(payload.presenceList)) {
                setWsPresence(payload.presenceList);
              }
              break;
            }
            case 'USER_ONLINE': {
              if (payload.presenceList && Array.isArray(payload.presenceList)) {
                setWsPresence(payload.presenceList);
              }
              if (payload.connection && payload.connection.connection_id !== clientConnectionId.current) {
                setLiveSyncToast({
                  id: String(Date.now()),
                  author: payload.connection.username || 'Operator',
                  action: `Connected to cluster (${payload.connection.platform || 'Workstation'})`,
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
              }
              break;
            }
            case 'USER_OFFLINE': {
              if (payload.presenceList && Array.isArray(payload.presenceList)) {
                setWsPresence(payload.presenceList);
              }
              if (payload.connection && payload.connection.connection_id !== clientConnectionId.current) {
                setLiveSyncToast({
                  id: String(Date.now()),
                  author: payload.connection.username || 'Operator',
                  action: `Disconnected from cluster`,
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
              }
              break;
            }
            case 'PRESENCE_SYNC': {
              if (payload.presenceList && Array.isArray(payload.presenceList)) {
                setWsPresence(payload.presenceList);
              }
              break;
            }
            case 'GLOBAL_RESET': {
              const { systemResetVersion: newVer, systemResetId: newId, resetBy: author, data } = payload;
              const resetVerNum = Number(newVer) || Date.now();
              console.log(`[JUWEI WMS] Received authoritative GLOBAL_RESET (Version: ${resetVerNum}, ID: ${newId}) by ${author}`);
              
              purgeAllLocalOfflineCachesAndQueues(resetVerNum);
              applyAuthoritativeResetState(data, payload.activeUsers, payload.activePresence);
              
              if (syncChannelRef.current) {
                try {
                  syncChannelRef.current.postMessage({
                    type: 'GLOBAL_RESET',
                    systemResetVersion: resetVerNum,
                    systemResetId: newId,
                    resetBy: author
                  });
                } catch (e) {}
              }

              setLiveSyncToast({
                id: String(Date.now()),
                author: author || 'Super Administrator',
                action: `GLOBAL RESET COMPLETE: Central database cleared`,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              });
              setLastSyncedTime(new Date());
              break;
            }
            case 'SYNC_REQUIRED':
            case 'STALE_RESET_VERSION': {
              const resetVerNum = Number(payload.systemResetVersion) || Date.now();
              console.warn(`[JUWEI WMS] Received ${payload.type} from server. Purging local queues and refetching fresh state.`);
              purgeAllLocalOfflineCachesAndQueues(resetVerNum);
              handleManualSync();
              break;
            }
            case 'DATA_CREATE':
            case 'DATA_UPDATE':
            case 'RECORD_CREATED':
            case 'RECORD_UPDATED':
            case 'record_upserted': {
              const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
              if (payload.systemResetVersion && Number(payload.systemResetVersion) < currentResetVer) {
                console.warn(`[JUWEI WMS] Discarding stale upsert from reset_version ${payload.systemResetVersion}`);
                break;
              }
              const { collection, record, author, actionDesc, employeeId, device_id, stationId } = payload;
              if (record && record.id && collection) {
                setLastSyncedTime(new Date());

                const updateFn = (prev: any[]) => {
                  if (isRecordDeletedLocally(record.id)) return prev;
                  const idx = prev.findIndex(it => it.id === record.id);
                  if (idx >= 0) {
                    if (JSON.stringify(prev[idx]) === JSON.stringify(record)) return prev;
                    const next = [...prev];
                    next[idx] = record;
                    return next;
                  }
                  return [record, ...prev];
                };

                const applyChange = () => {
                  switch (collection) {
                    case 'stocks': setStocks(updateFn); break;
                    case 'receiving': setReceiving(updateFn); break;
                    case 'returns': setReturns(updateFn); break;
                    case 'recycling': setRecycling(updateFn); break;
                    case 'issuances': setIssuances(updateFn); break;
                    case 'deliveries': setDeliveries(updateFn); break;
                    case 'envLogs': setEnvLogs(updateFn); break;
                    case 'forkliftChecks': setForkliftChecks(updateFn); break;
                    case 'registries': setRegistries(updateFn); break;
                  }
                };

                // Apply state update in the background for consistency
                applyChange();

                // Auto-merged incoming record changes without requiring manual confirmation
                const isFromOtherUser = author && author.toUpperCase() !== (currentUser || '').toUpperCase();
                if (isFromOtherUser) {
                  setLiveSyncToast({
                    id: record.id,
                    author,
                    action: actionDesc || `Updated ${collection} record`,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  });
                }
              }
              break;
            }
            case 'sync_activity_pulse': {
              if (payload.username && payload.username !== (currentUser || '')) {
                setLiveSyncToast({
                  id: String(Date.now()),
                  author: payload.username,
                  action: payload.action || 'Updated data',
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
              }
              break;
            }
            case 'DATA_DELETE':
            case 'RECORD_DELETED':
            case 'record_deleted': {
              const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
              if (payload.systemResetVersion && Number(payload.systemResetVersion) < currentResetVer) {
                console.warn(`[JUWEI WMS] Discarding stale delete from reset_version ${payload.systemResetVersion}`);
                break;
              }
              const { collection, id, author, actionDesc, employeeId, device_id, stationId } = payload;
              if (id && collection) {
                markRecordAsDeletedLocally(id);
                setLastSyncedTime(new Date());
                const filterFn = (prev: any[]) => prev.filter(it => it.id !== id);
                
                const applyDelete = () => {
                  switch (collection) {
                    case 'stocks': setStocks(filterFn); break;
                    case 'receiving': setReceiving(filterFn); break;
                    case 'returns': setReturns(filterFn); break;
                    case 'recycling': setRecycling(filterFn); break;
                    case 'issuances': setIssuances(filterFn); break;
                    case 'deliveries': setDeliveries(filterFn); break;
                    case 'envLogs': setEnvLogs(filterFn); break;
                    case 'forkliftChecks': setForkliftChecks(filterFn); break;
                    case 'registries': setRegistries(filterFn); break;
                  }
                };

                applyDelete();

                // Auto-merged incoming record deletion without requiring manual confirmation
                const isFromOtherUser = author && author.toUpperCase() !== (currentUser || '').toUpperCase();
                if (isFromOtherUser) {
                  setLiveSyncToast({
                    id,
                    author,
                    action: actionDesc || `Deleted ${collection} record`,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  });
                }
              }
              break;
            }
            case 'collection_updated': {
              const { collection, data } = payload;
              if (Array.isArray(data)) {
                setLastSyncedTime(new Date());
                const norm = normalizeRecords(collection, data);
                switch (collection) {
                  case 'stocks': setStocks(prev => reconcileCollection('stocks', prev, norm)); break;
                  case 'receiving': setReceiving(prev => reconcileCollection('receiving', prev, norm)); break;
                  case 'returns': setReturns(prev => reconcileCollection('returns', prev, norm)); break;
                  case 'recycling': setRecycling(prev => reconcileCollection('recycling', prev, norm)); break;
                  case 'issuances': setIssuances(prev => reconcileCollection('issuances', prev, norm)); break;
                  case 'deliveries': setDeliveries(prev => reconcileCollection('deliveries', prev, norm)); break;
                  case 'envLogs': setEnvLogs(prev => reconcileCollection('envLogs', prev, norm)); break;
                  case 'forkliftChecks': setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, norm)); break;
                  case 'registries': setRegistries(prev => reconcileCollection('registries', prev, norm)); break;
                  case 'registeredUsers': setRegisteredUsers(prev => reconcileUsers(prev, data)); break;
                  case 'operationalRoles': {
                    const cleaned = Array.from(new Set<string>(data.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
                    if (cleaned.length > 0) {
                      setOperationalRoles(cleaned);
                      try { localStorage.setItem('juwei_wms_operationalRoles', JSON.stringify(cleaned)); } catch (e) {}
                    }
                    break;
                  }
                  case 'receivingCategories': {
                    const cleaned = Array.from(new Set<string>(data.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
                    if (cleaned.length > 0) {
                      setReceivingCategories(cleaned);
                      try { localStorage.setItem('juwei_wms_receivingCategories', JSON.stringify(cleaned)); } catch (e) {}
                    }
                    break;
                  }
                }
              }
              break;
            }
            case 'roles_updated': {
              const { roles } = payload;
              if (Array.isArray(roles)) {
                const cleaned = Array.from(new Set<string>(roles.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
                if (cleaned.length > 0) {
                  setOperationalRoles(cleaned);
                  try { localStorage.setItem('juwei_wms_operationalRoles', JSON.stringify(cleaned)); } catch (e) {}
                }
              }
              break;
            }
            case 'categories_updated': {
              const { categories } = payload;
              if (Array.isArray(categories)) {
                const cleaned = Array.from(new Set<string>(categories.map((r: any) => String(r || '').trim().toUpperCase()).filter(Boolean)));
                if (cleaned.length > 0) {
                  setReceivingCategories(cleaned);
                  try { localStorage.setItem('juwei_wms_receivingCategories', JSON.stringify(cleaned)); } catch (e) {}
                }
              }
              break;
            }
            case 'account_registered': {
              const { user, author } = payload;
              if (user && user.employeeId) {
                setRegisteredUsers(prev => upsertUserInState(prev, user));
                if (user.username && user.employeeId !== (currentEmployeeId || '')) {
                  setLiveSyncToast({
                    id: String(Date.now()),
                    author: author || 'Admin',
                    action: `Registered operator ${user.username} (${user.employeeId})`,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  });
                }
              }
              break;
            }
            case 'account_updated': {
              const { user, author } = payload;
              if (user && user.employeeId) {
                setRegisteredUsers(prev => upsertUserInState(prev, user));
                if ((currentEmployeeId || '').toUpperCase() === (user.employeeId || '').toUpperCase()) {
                  if (user.role) setCurrentRole(user.role);
                  if (user.permission) setCurrentPermission(user.permission);
                  if (user.username) setCurrentUser(user.username);
                }
                if (user.username && user.employeeId !== (currentEmployeeId || '')) {
                  setLiveSyncToast({
                    id: String(Date.now()),
                    author: author || 'Admin',
                    action: `Updated operator ${user.username} (${user.employeeId})`,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  });
                }
              }
              break;
            }
            case 'account_deleted': {
              const empId = (payload.employeeId || '').toUpperCase();
              if (empId && empId !== 'JPMP-002') {
                markUserAsDeleted(empId);
                setRegisteredUsers(prev => {
                  return prev.filter(u => u.employeeId.toUpperCase() !== empId);
                });
              }
              break;
            }
            case 'all_accounts_cleared': {
              setRegisteredUsers([superAdminAccount]);
              break;
            }
            case 'stock_movement_created': {
              if (payload.stocks) {
                setStocks(payload.stocks);
              }
              window.dispatchEvent(new CustomEvent('stock_movement_created', { detail: payload.movement }));
              window.dispatchEvent(new CustomEvent('inventory_updated'));
              break;
            }
            case 'chat_broadcast': {
              setChatMessages(prev => [...prev, payload.message]);
              break;
            }
            case 'presence_updated': {
              if (payload.activePresence && Array.isArray(payload.activePresence)) {
                setWsPresence(payload.activePresence);
              }
              break;
            }
            case 'force_sync': {
              setLastSyncedTime(new Date());
              const isFromOtherUser = payload.triggeredBy && payload.triggeredBy.toUpperCase() !== (currentUser || '').toUpperCase();
              if (isFromOtherUser) {
                setLiveSyncToast({
                  id: String(Date.now()),
                  author: payload.triggeredBy,
                  action: 'Triggered cluster-wide data refresh',
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
              }
              runSyncCheck();
              break;
            }
            case 'client_installed_broadcast': {
              const { stationId, username, platform } = payload;
              if (stationId && stationId !== getStationId()) {
                setLiveSyncToast({
                  id: String(Date.now()),
                  author: username || 'Cluster Node',
                  action: `Terminal ${stationId} (${platform || 'Device'}) completed fresh install • Live Synced`,
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
                runSyncCheck();
              }
              break;
            }
          }
        } catch (err) {
          console.error('Error parsing WS message', err);
        }
      };

      ws.onerror = () => {
        // Quiet fallback to HTTP sync
        runSyncCheck();
      };

      ws.onclose = () => {
        if (!isMounted) return;
        if (pingInterval) clearInterval(pingInterval);
        setSocket(null);
        runSyncCheck();
        reconnectTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 1.5, 6000);
          connectWebSocket();
        }, retryDelay);
      };
    };

    // Re-sync handlers when internet connection is restored or page is focused (throttled to avoid rapid background re-fetch)
    let lastFocusSyncTime = 0;
    const handleOnlineOrFocus = () => {
      if (isMounted) {
        const now = Date.now();
        if (now - lastFocusSyncTime > 15000) {
          lastFocusSyncTime = now;
          flushPendingSyncQueue().then(() => runSyncCheck());
        }
        if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) {
          connectWebSocket();
        }
      }
    };

    window.addEventListener('online', handleOnlineOrFocus);
    window.addEventListener('focus', handleOnlineOrFocus);
    document.addEventListener('visibilitychange', handleOnlineOrFocus);

    // Run immediate sync on mount
    runSyncCheck().then((ok) => {
      if (!ok && isMounted) {
        setConnectionStatus('connecting');
      }
    });

    connectWebSocket();

    // Continuous background HTTP poll fallback (fixed 5000ms interval regardless of ws.readyState)
    httpPollInterval = setInterval(() => {
      if (isMounted) {
        runSyncCheck();
      }
    }, 5000);

    return () => {
      isMounted = false;
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (httpPollInterval) clearInterval(httpPollInterval);
      if (pingInterval) clearInterval(pingInterval);
      window.removeEventListener('online', handleOnlineOrFocus);
      window.removeEventListener('focus', handleOnlineOrFocus);
      document.removeEventListener('visibilitychange', handleOnlineOrFocus);
    };
  }, [serverAddress]);

  // Keep WebSocket presence and active view module in sync dynamically across all connected operators
  useEffect(() => {
    const stationId = getStationId();
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'presence_update',
          stationId,
          username: currentUser || 'JUWEI OPERATOR',
          employeeId: currentEmployeeId || '',
          role: currentRole || (currentPermission === 'FULL_ACCESS' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE OPERATOR'),
          activeView: view
        }));
      } catch (e) {}
    }
  }, [currentUser, currentEmployeeId, currentRole, currentPermission, view, socket]);

  // Sync state helpers (supports Central Database, WebSocket, and HTTP POST REST)
  const syncCollection = (collection: string, data: any[]) => {
    lastMutationTimes.current[collection] = Date.now();
    setLastSyncedTime(new Date());

    if (Array.isArray(data)) {
      data.forEach(item => {
        if (item && item.id) markRecordMutatedLocally(item.id);
        if (item && item.employeeId) markRecordMutatedLocally(String(item.employeeId).toUpperCase());
      });
    }

    const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
    const persistentDevId = getPersistentDeviceId();
    const effectiveAuthor = currentUser || 'OPERATOR';
    const effectiveUserId = currentEmployeeId ? `USR-${currentEmployeeId}` : `USR-${effectiveAuthor}`;

    // Mark as pending before network request
    markPendingSync(collection, data);

    // 0. Cross-tab BroadcastChannel
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'sync_collection',
          collection,
          data,
          reset_version: currentResetVer,
          device_id: persistentDevId,
          user_id: effectiveUserId,
          author: effectiveAuthor
        });
      } catch (e) {}
    }

    // 1. Send via WebSocket if active
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'update_collection',
          collection,
          data,
          reset_version: currentResetVer,
          device_id: persistentDevId,
          user_id: effectiveUserId,
          author: effectiveAuthor,
          employeeId: currentEmployeeId
        }));
      } catch (e) {
        console.warn('WS send error:', e);
      }
    }
    
    // 2. Dual-send via HTTP POST REST to Central Database
    let targetAddr = serverAddress.trim() || getDefaultServerAddress();
    const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
    const isHttps = isSecureServerHost(cleanHost, targetAddr);
    const httpProto = isHttps ? 'https:' : 'http:';
    
    const baseUrl = getApiBaseUrl();
    const syncPayload = {
      collection,
      data,
      reset_version: currentResetVer,
      device_id: persistentDevId,
      author: effectiveAuthor,
      employeeId: currentEmployeeId,
      user_id: effectiveUserId
    };

    fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-device-id': persistentDevId,
        'x-employee-id': currentEmployeeId || '',
        'x-user-permission': currentPermission || ''
      },
      body: JSON.stringify(syncPayload)
    })
    .then(async res => {
      if (res.status === 409) {
        const errJson = await res.json().catch(() => ({}));
        const serverVer = Number(errJson.serverResetVersion) || currentResetVer + 1;
        purgeAllLocalOfflineCachesAndQueues(serverVer);
        handleManualSync();
        return;
      }
      if (res.ok) {
        clearPendingSync(collection);
      }
    })
    .catch(() => {
      fetch(`${httpProto}//${cleanHost}/api/sync`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId,
          'x-employee-id': currentEmployeeId || '',
          'x-user-permission': currentPermission || ''
        },
        body: JSON.stringify(syncPayload)
      })
      .then(async res => {
        if (res.status === 409) {
          const errJson = await res.json().catch(() => ({}));
          const serverVer = Number(errJson.serverResetVersion) || currentResetVer + 1;
          purgeAllLocalOfflineCachesAndQueues(serverVer);
          handleManualSync();
          return;
        }
        if (res.ok) {
          clearPendingSync(collection);
        }
      })
      .catch(err => console.warn('HTTP REST sync warning:', err));
    });
  };

  const handleRegister = (
    username: string, 
    role: string, 
    employeeId: string, 
    permission?: string, 
    phoneNumber?: string,
    customPin?: string,
    status?: 'ACTIVE' | 'PENDING' | 'INACTIVE'
  ): RegisteredAccount | null => {
    // STRICT VALIDATION: Only the accounts registered by Super Administrator in this computer will be authorized for other users and computers
    const isSuperAdminOperating = 
      currentEmployeeId === 'JPMP-002' || 
      (currentUser || '').toUpperCase().includes('ALDRIN') || 
      currentRole === 'SUPER ADMINISTRATOR';

    if (!isSuperAdminOperating) {
      alert("AUTHORIZATION RESTRICTION: Only accounts registered by Super Administrator (ALDRIN BANAWA - JPMP-002) in this computer will be authorized for use by other users and computers.");
      return null;
    }

    const cleanUsername = (username || '').trim().toUpperCase();
    let cleanEmployeeId = (employeeId || '').trim().toUpperCase();
    if (cleanEmployeeId && !cleanEmployeeId.startsWith('JPMP-')) {
      // Strip any leading EMP- if they typed EMP-XXXX
      const strippedId = cleanEmployeeId.replace(/^EMP-/, '');
      cleanEmployeeId = `JPMP-${strippedId}`;
    }
    const cleanRole = (role || '').toUpperCase();
    if (!cleanUsername || !cleanRole || !cleanEmployeeId) {
      alert("ALL FIELDS ARE REQUIRED.");
      return null;
    }
    const exists = registeredUsers.some(
      u => (u.employeeId || '').toUpperCase() === cleanEmployeeId || 
           (u.username || '').toUpperCase() === cleanUsername
    );
    if (exists) {
      alert("AN OPERATOR WITH THIS NAME OR REGISTER ID ALREADY EXISTS.");
      return null;
    }

    // Determine 4-digit PIN (custom or unique generated) - NEVER default to 1234
    let finalPin = '';
    const cleanProvidedPin = customPin ? customPin.replace(/\D/g, '').slice(0, 4) : '';
    if (cleanProvidedPin.length === 4 && cleanProvidedPin !== '1234' && !/^(\d)\1+$/.test(cleanProvidedPin)) {
      finalPin = cleanProvidedPin;
    } else {
      let attempts = 0;
      while (attempts < 100) {
        const pinCandidate = Math.floor(1000 + Math.random() * 9000).toString();
        if (pinCandidate !== '1234' && !/^(\d)\1+$/.test(pinCandidate) && !registeredUsers.some(u => u.pin === pinCandidate)) {
          finalPin = pinCandidate;
          break;
        }
        attempts++;
      }
      if (!finalPin || finalPin === '1234') {
        finalPin = '5829';
      }
    }

    const cleanPermission = permission || (cleanEmployeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS');
    const newUser: RegisteredAccount = { 
      username: cleanUsername, 
      role: cleanRole, 
      employeeId: cleanEmployeeId, 
      phoneNumber: phoneNumber ? phoneNumber.trim() : '',
      permission: cleanPermission, 
      pin: finalPin,
      status: status || 'ACTIVE',
      registeredBy: 'JPMP-002 (ALDRIN BANAWA)',
      registeredBySuperAdmin: true,
      registeredAt: new Date().toISOString(),
      stationId: getStationId()
    };

    // Remove from deleted tracking if re-registered
    unmarkUserAsDeleted(cleanEmployeeId);
    markRecordMutatedLocally(cleanEmployeeId);

    const nextUsers = [...registeredUsers.filter(u => (u.employeeId || '').toUpperCase() !== cleanEmployeeId), newUser];
    setRegisteredUsers(nextUsers);
    
    // Cross-tab BroadcastChannel
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'account_registered',
          user: newUser,
          author: currentUser || 'Super Administrator'
        });
      } catch (e) {}
    }

    // WebSocket real-time cluster broadcast
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'register_account',
          user: newUser,
          author: currentUser || 'Super Administrator (Aldrin Banawa)',
          requesterEmployeeId: currentEmployeeId || 'JPMP-002'
        }));
      } catch (e) {
        console.warn('WS send register_account error:', e);
      }
    }

    // Explicit direct registration call to server
    try {
      const baseUrl = getApiBaseUrl();
      fetch(`${baseUrl}/api/accounts/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newUser,
          requesterEmployeeId: currentEmployeeId || 'JPMP-002',
          requesterUsername: currentUser || 'ALDRIN BANAWA',
          author: currentUser || 'ALDRIN BANAWA'
        })
      }).catch(() => {});
    } catch (e) {}

    // Set state to trigger the secure PIN confirmation overlay
    setNewlyRegisteredUser(newUser);
    return newUser;
  };

  const handleRemoveUser = (employeeId: string) => {
    const cleanId = (employeeId || '').trim().toUpperCase();
    if (!cleanId) return;
    const targetUser = registeredUsers.find(u => (u.employeeId || '').toUpperCase() === cleanId);
    const isAldrin = cleanId === 'JPMP-002' || cleanId.endsWith('-002') || (targetUser && (
      (targetUser.username || '').toUpperCase().includes('ALDRIN BANAWA') ||
      (targetUser.username || '').toUpperCase() === 'SUPER ADMIN'
    ));

    if (isAldrin) {
      alert('PROTECTED ROOT ACCOUNT: ALDRIN BANAWA (JPMP-002) CANNOT BE DELETED.');
      return;
    }

    // 1. Mark in permanent deleted accounts blacklist
    markUserAsDeleted(cleanId);

    // 2. Update local state
    const nextUsers = registeredUsers.filter(u => (u.employeeId || '').toUpperCase() !== cleanId);
    setRegisteredUsers(nextUsers);

    // Cross-tab BroadcastChannel
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'delete_account',
          employeeId: cleanId
        });
      } catch (e) {}
    }

    // 3. Send deletion request to server endpoint to commit to central database and broadcast
    const baseUrl = getApiBaseUrl();
    fetch(`${baseUrl}/api/accounts/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: cleanId })
    }).catch(() => {});

    // 4. Broadcast deletion over WebSocket
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'delete_account',
          employeeId: cleanId
        }));
      } catch (e) {
        console.warn('WS send delete error:', e);
      }
    }
  };

  const handleClearAllAccountsExceptSuperAdmin = () => {
    const onlySuperAdmin = [superAdminAccount];
    setRegisteredUsers(onlySuperAdmin);

    // Cross-tab BroadcastChannel
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'all_accounts_cleared'
        });
      } catch (e) {}
    }

    // Server reset
    const baseUrl = getApiBaseUrl();
    fetch(`${baseUrl}/api/accounts/clear-all-except-super-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});

    // WebSocket broadcast
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'all_accounts_cleared',
          data: onlySuperAdmin
        }));
      } catch (e) {}
    }
  };

  const handleUpdateAccount = (oldEmpId: string, updated: RegisteredAccount) => {
    const cleanOldId = (oldEmpId || '').toUpperCase();
    let cleanNewId = (updated.employeeId || '').trim().toUpperCase();
    if (cleanNewId && !cleanNewId.startsWith('JPMP-')) {
      const strippedId = cleanNewId.replace(/^EMP-/, '');
      cleanNewId = `JPMP-${strippedId}`;
    }
    if (cleanOldId === 'JPMP-002') {
      cleanNewId = 'JPMP-002';
    }

    // Check if new ID is already taken by another account
    if (cleanNewId !== cleanOldId && registeredUsers.some(u => (u.employeeId || '').toUpperCase() === cleanNewId)) {
      alert(`An operator account with ID "${cleanNewId}" already exists.`);
      return;
    }

    const nextUsers = registeredUsers.map(u => {
      if ((u.employeeId || '').toUpperCase() === cleanOldId) {
        const effectivePin = (updated.pin && String(updated.pin).trim()) || (u.pin && String(u.pin).trim()) || (cleanNewId === 'JPMP-002' ? '0423' : '');
        const isCompromised = effectivePin === '1234' || !!updated.isPinCompromised || !!u.isPinCompromised;
        return {
          ...u,
          ...updated,
          employeeId: cleanNewId,
          username: (updated.username || '').toUpperCase(),
          role: (updated.role || '').toUpperCase(),
          phoneNumber: updated.phoneNumber !== undefined ? updated.phoneNumber : (u.phoneNumber || ''),
          permission: updated.permission || u.permission || 'LIMITED_ACCESS',
          pin: effectivePin,
          isPinCompromised: isCompromised,
          status: updated.status || u.status || 'ACTIVE',
          lastActive: updated.lastActive !== undefined ? updated.lastActive : u.lastActive
        };
      }
      return u;
    });

    const targetUpdatedUser = nextUsers.find(u => (u.employeeId || '').toUpperCase() === cleanNewId);

    if (cleanNewId !== cleanOldId) {
      unmarkUserAsDeleted(cleanNewId);
      const baseUrl = getApiBaseUrl();
      fetch(`${baseUrl}/api/accounts/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: cleanOldId })
      }).catch(() => {});
    }

    setRegisteredUsers(nextUsers);
    localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(nextUsers));

    // Cross-tab BroadcastChannel
    if (syncChannelRef.current && targetUpdatedUser) {
      try {
        syncChannelRef.current.postMessage({
          type: 'account_updated',
          user: targetUpdatedUser,
          author: currentUser || 'Admin'
        });
      } catch (e) {}
    }

    // WebSocket real-time cluster broadcast
    if (socket && socket.readyState === WebSocket.OPEN && targetUpdatedUser) {
      try {
        socket.send(JSON.stringify({
          type: 'update_account',
          user: targetUpdatedUser,
          author: currentUser || 'Admin'
        }));
      } catch (e) {
        console.warn('WS send update_account error:', e);
      }
    }

    // Direct HTTP call to /api/accounts/update
    if (targetUpdatedUser) {
      try {
        const baseUrl = getApiBaseUrl();
        fetch(`${baseUrl}/api/accounts/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(targetUpdatedUser)
        }).catch(() => {});
      } catch (e) {}
    }

    syncCollection('registeredUsers', nextUsers);
  };

  const handleDirectLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    const rawInput = (loginEmployeeId || '').trim();
    let searchId = rawInput.toUpperCase();
    if (searchId && !searchId.startsWith('JPMP-')) {
      searchId = 'JPMP-' + searchId.replace(/^EMP-/, '');
    }

    const enteredPin = (loginPin || '').trim();

    // Match by employeeId, raw employeeId, username, or phone number in local state
    let foundUser = registeredUsers.find(
      (u) => {
        const uEmpId = (u.employeeId || '').toUpperCase();
        const uUsername = (u.username || '').toUpperCase();
        const uPhone = (u.phoneNumber || '').replace(/\D/g, '');
        const inputPhone = rawInput.replace(/\D/g, '');

        const idMatches = uEmpId === searchId || uEmpId === rawInput.toUpperCase() || uUsername === rawInput.toUpperCase() || (inputPhone.length >= 10 && uPhone === inputPhone);
        const pinMatches = Boolean(u.pin && u.pin.trim() === enteredPin);

        return idMatches && pinMatches;
      }
    );

    // If not found in local memory or PIN was updated on another machine, verify live against central database
    if (!foundUser && enteredPin) {
      setIsLoggingIn(true);
      try {
        const authoritativeUser = await verifyCentralCredentials(rawInput, enteredPin);
        if (authoritativeUser) {
          foundUser = authoritativeUser;
          setRegisteredUsers(prev => upsertUserInState(prev, authoritativeUser));
        }
      } catch (authErr) {
        console.warn("Authoritative login verification error:", authErr);
      }
    }

    if (foundUser) {
      setIsLoggingIn(true);
      const empIdToRemember = (foundUser.employeeId || loginEmployeeId).trim().toUpperCase();
      if (rememberLogin) {
        try {
          localStorage.setItem('juwei_wms_rememberedEmployeeId', empIdToRemember);
        } catch (e) {}
      } else {
        try {
          localStorage.removeItem('juwei_wms_rememberedEmployeeId');
        } catch (e) {}
      }
      setTimeout(() => {
        handleLogin(foundUser!);
        const remembered = localStorage.getItem('juwei_wms_rememberedEmployeeId');
        setLoginEmployeeId(remembered || '');
        setLoginPin('');
        setLoginError('');
        setIsLoggingIn(false);
      }, 300);
    } else {
      setIsLoggingIn(false);
      setLoginError('INVALID OPERATIONAL ID NUMBER OR INCORRECT PIN CODE.');
    }
  };

  const handleQrLoginScan = (scannedText: string) => {
    let searchEmpId = '';
    let searchPin = '';

    try {
      const data = JSON.parse(scannedText);
      if (data && typeof data === 'object') {
        searchEmpId = (data.employeeId || data.username || data.id || '').toString().trim().toUpperCase();
        searchPin = (data.pin || '').toString().trim();
      }
    } catch (e) {
      const parts = scannedText.split(/[:;,]/);
      searchEmpId = parts[0]?.trim().toUpperCase() || '';
      searchPin = parts[1]?.trim() || '';
    }

    if (searchEmpId && !searchEmpId.startsWith('JPMP-')) {
      searchEmpId = 'JPMP-' + searchEmpId.replace(/^EMP-/, '');
    }

    if (!searchEmpId) {
      setLoginError('INVALID QR CODE: NO OPERATOR ID DETECTED IN SCANNED CODE.');
      return;
    }

    // Match operator account in registeredUsers
    const foundUser = registeredUsers.find(
      (u) => (u.employeeId || '').toUpperCase() === searchEmpId || 
             (u.username || '').toUpperCase() === searchEmpId ||
             (u.employeeId || '').toUpperCase() === searchEmpId.replace(/^JPMP-/, '')
    );

    if (foundUser) {
      if (!searchPin || (foundUser.pin && foundUser.pin.trim() !== searchPin)) {
        // Check central database in case PIN was updated from another terminal
        if (searchPin) {
          verifyCentralCredentials(searchEmpId, searchPin).then(verified => {
            if (verified) {
              setRegisteredUsers(prev => upsertUserInState(prev, verified));
              setShowLoginQrScanner(false);
              setLoginEmployeeId('');
              setLoginPin('');
              setLoginError('');
              setIsLoggingIn(true);
              setTimeout(() => {
                handleLogin(verified);
                setIsLoggingIn(false);
              }, 300);
              return;
            }
            setLoginError(`INCORRECT OR MISSING PIN CODE FOR OPERATOR ${foundUser.username || ''} (${foundUser.employeeId || ''}). ONLY REGISTERED PIN IS AUTHORIZED.`);
          }).catch(() => {
            setLoginError(`INCORRECT OR MISSING PIN CODE FOR OPERATOR ${foundUser.username || ''} (${foundUser.employeeId || ''}). ONLY REGISTERED PIN IS AUTHORIZED.`);
          });
          return;
        }
        setLoginError(`INCORRECT OR MISSING PIN CODE FOR OPERATOR ${foundUser.username || ''} (${foundUser.employeeId || ''}). ONLY REGISTERED PIN IS AUTHORIZED.`);
        return;
      }
      setShowLoginQrScanner(false);
      setLoginEmployeeId('');
      setLoginPin('');
      setLoginError('');
      setIsLoggingIn(true);
      setTimeout(() => {
        handleLogin(foundUser);
        setIsLoggingIn(false);
      }, 300);
    } else {
      // Not yet in local memory, check central database
      if (searchPin) {
        verifyCentralCredentials(searchEmpId, searchPin).then(verified => {
          if (verified) {
            setRegisteredUsers(prev => upsertUserInState(prev, verified));
            setShowLoginQrScanner(false);
            setLoginEmployeeId('');
            setLoginPin('');
            setLoginError('');
            setIsLoggingIn(true);
            setTimeout(() => {
              handleLogin(verified);
              setIsLoggingIn(false);
            }, 300);
            return;
          }
          setLoginError(`OPERATOR ID "${searchEmpId}" IS NOT REGISTERED IN JPMP DIRECTORY.`);
        }).catch(() => {
          setLoginError(`OPERATOR ID "${searchEmpId}" IS NOT REGISTERED IN JPMP DIRECTORY.`);
        });
        return;
      }
      setLoginError(`OPERATOR ID "${searchEmpId}" IS NOT REGISTERED IN JPMP DIRECTORY.`);
    }
  };

  const handleLogin = (user: {username: string; role: string; employeeId: string; permission?: string; status?: string; lastActive?: string}) => {
    const cleanUsername = (user.username || 'OPERATOR').toUpperCase();
    const cleanRole = (user.role || 'WAREHOUSE CLERK').toUpperCase();
    const cleanEmployeeId = (user.employeeId || '').toUpperCase();
    const cleanPermission = user.permission || (cleanEmployeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS');
    const nowIso = new Date().toISOString();

    setCurrentUser(cleanUsername);
    setCurrentRole(cleanRole);
    setCurrentEmployeeId(cleanEmployeeId);
    setCurrentPermission(cleanPermission);
    setIsLoggedIn(true);

    // Persist authenticated operator session to localStorage across window close and app restarts
    try {
      localStorage.setItem('juwei_wms_isLoggedIn', 'true');
      localStorage.setItem('juwei_wms_currentUser', cleanUsername);
      localStorage.setItem('juwei_wms_userRole', cleanRole);
      localStorage.setItem('juwei_wms_employeeId', cleanEmployeeId);
      localStorage.setItem('juwei_wms_userPermission', cleanPermission);
    } catch (e) {
      console.warn('Failed to persist user session to localStorage:', e);
    }

    // Generate new unique authenticated session for this login
    clientSessionId.current = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'authenticate',
          user_id: `USR-${cleanEmployeeId}`,
          session_id: clientSessionId.current,
          device_id: getPersistentDeviceId(),
          connection_id: clientConnectionId.current || undefined,
          stationId: getStationId(),
          username: cleanUsername,
          employeeId: cleanEmployeeId,
          role: cleanRole,
          permission: cleanPermission,
          activeView: view,
          platform: getPlatformType(),
          deviceName: `${getPlatformType()} Terminal - ${getStationId()}`,
          reset_version: Number(localStorage.getItem('juwei_wms_system_reset_version')) || 1
        }));
      } catch (e) {}
    }

    // Update lastActive timestamp on the operator's account & sync across terminals
    setRegisteredUsers(prev => {
      const updated = prev.map(u => {
        if ((u.employeeId || '').toUpperCase() === cleanEmployeeId) {
          return {
            ...u,
            lastActive: nowIso,
            status: u.status === 'PENDING' ? 'ACTIVE' : (u.status || 'ACTIVE')
          };
        }
        return u;
      });
      try {
        localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(updated));
      } catch (e) {}
      syncCollection('registeredUsers', updated);
      return updated;
    });
    
    // Broadcast dispatch note about login
    setTimeout(() => {
      sendSystemActivity(`OPERATOR ${cleanUsername} (${cleanRole}) HAS LOGGED IN.`);
    }, 500);
  };

  const handleLogout = () => {
    sendSystemActivity(`OPERATOR ${currentUser} (${currentRole}) HAS LOGGED OFF.`);
    
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'authenticate',
          user_id: 'ANONYMOUS',
          session_id: clientSessionId.current,
          device_id: getPersistentDeviceId(),
          connection_id: clientConnectionId.current || undefined,
          stationId: getStationId(),
          username: 'CONNECTING TERMINAL',
          employeeId: '',
          role: 'OPERATOR',
          permission: 'LIMITED_ACCESS',
          activeView: 'login',
          platform: getPlatformType(),
          deviceName: `${getPlatformType()} Terminal - ${getStationId()}`,
          reset_version: Number(localStorage.getItem('juwei_wms_system_reset_version')) || 1
        }));
      } catch (e) {}
    }

    setCurrentUser('');
    setCurrentRole('');
    setCurrentEmployeeId('');
    setCurrentPermission('LIMITED_ACCESS');
    setIsLoggedIn(false);
    try {
      localStorage.removeItem('juwei_wms_isLoggedIn');
      localStorage.removeItem('juwei_wms_currentUser');
      localStorage.removeItem('juwei_wms_userRole');
      localStorage.removeItem('juwei_wms_employeeId');
      localStorage.removeItem('juwei_wms_userPermission');
    } catch (e) {}

    // Pre-fill remembered Employee ID on login form if user previously enabled Remember Login
    try {
      const remembered = localStorage.getItem('juwei_wms_rememberedEmployeeId');
      if (remembered) {
        setLoginEmployeeId(remembered);
        setRememberLogin(true);
      } else {
        setLoginEmployeeId('');
        setRememberLogin(false);
      }
    } catch (e) {}
  };

  const sendSystemActivity = (text: string) => {
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'system_activity',
          text
        }));
      } catch (e) {
        console.warn('WS system activity error:', e);
      }
    } else {
      const baseUrl = getApiBaseUrl();
      fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'System Audit', text, isSystem: true })
      }).catch(() => {});
    }
  };

  const sendChatMessage = (text: string) => {
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'chat',
          username: currentUser,
          text
        }));
      } catch (e) {
        console.warn('WS chat error:', e);
      }
    } else {
      const baseUrl = getApiBaseUrl();
      fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, text, isSystem: false })
      }).catch(() => {});
    }
  };

  // State mutators with automatic procedural linking
  const handleAddReceiving = (record: ReceivingRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const nextReceiving = [record, ...receiving];
    setReceiving(nextReceiving);
    syncCollection('receiving', nextReceiving);

    const newStockItem: MaterialStockItem = {
      id: generateAuthoritativeId('STK'),
      partCode: record.partCode,
      description: record.itemDescription,
      modelName: record.modelName,
      type: record.partCode.startsWith('RM') ? 'RAW' : 
            record.partCode.startsWith('PM') ? 'PACKAGING' : 
            record.partCode.startsWith('WP') ? 'WIP' : 
            record.partCode.startsWith('FG') ? 'FG' : 'CONSUMABLE',
      location: record.location || (record.status === 'QUARANTINED' ? 'Quarantine Area' : 'Designated Storage Bin'),
      quantity: record.quantity,
      unit: record.unit,
      lotNumber: record.lotNumber,
      receivedDate: record.receivedDate || record.date,
      color: record.color,
      fifoColor: record.fifoColorCode,
      status: record.status === 'QUARANTINED' ? 'QUARANTINE' : (record.iqcStatus === 'PENDING_IQC' ? 'HOLD' : 'APPROVED'),
      bom: record.bom,
      customer: record.customer,
      reorderMin: record.reorderMin,
      remarks: record.remarks
    };

    let nextStocks = [newStockItem, ...stocks];

    const isInternal = record.source === 'INTERNAL' || record.source === 'WIP/BOM/FG(Internal)';

    if (isInternal && record.bom && record.bom.length > 0 && record.autoDeductBom) {
      record.bom.forEach(bomItem => {
        let remainingToDeduct = bomItem.quantityRequired;
        
        // Find stock items for this component that are APPROVED and have quantity > 0
        // Sort them by receivedDate ascending (FIFO!)
        const matchingStockItems = nextStocks
          .filter(s => s.partCode === bomItem.partCode && s.status === 'APPROVED' && s.quantity > 0)
          .sort((a, b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());

        matchingStockItems.forEach(stockItem => {
          if (remainingToDeduct <= 0) return;

          const deductAmount = Math.min(stockItem.quantity, remainingToDeduct);
          remainingToDeduct -= deductAmount;

          // Update the stock item's quantity in nextStocks
          const updatedStock = { ...stockItem, quantity: stockItem.quantity - deductAmount };
          nextStocks = nextStocks.map(s => s.id === stockItem.id ? updatedStock : s);
          upsertRecordLocallyAndRemotely('stocks', updatedStock, `Auto-deducted ${deductAmount} from ${stockItem.partCode}`);
        });
      });
    }

    setStocks(nextStocks);
    syncCollection('stocks', nextStocks);
    upsertRecordLocallyAndRemotely('receiving', record, `Received ${record.quantity} of ${record.partCode}`);
    upsertRecordLocallyAndRemotely('stocks', newStockItem, `Created stock item for ${record.partCode}`);

    if (isInternal && record.bom && record.bom.length > 0 && record.autoDeductBom) {
      const deductedSummary = record.bom.map(b => `${b.quantityRequired} ${(b.unit || 'PCS').toUpperCase()} of ${b.partCode}`).join(', ');
      sendSystemActivity(`${currentUser} registered internal WIP/FG ${record.partCode} (Lot: ${record.lotNumber}) and auto-deducted BOM components: ${deductedSummary}`);
    } else {
      sendSystemActivity(`${currentUser} received ${record.quantity} ${(record.unit || 'PCS').toUpperCase()} of ${record.partCode} (Lot: ${record.lotNumber}).`);
    }
  };

  const handleUpdateIqc = (id: string, iqcStatus: ReceivingRecord['iqcStatus']) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const updatedReceivingRecord = receiving.find(r => r.id === id);
    const nextReceiving: ReceivingRecord[] = receiving.map(r => r.id === id ? { ...r, iqcStatus, status: (iqcStatus === 'APPROVED_IQC' ? 'VERIFIED' : 'QUARANTINED') as ReceivingRecord['status'] } : r);
    setReceiving(nextReceiving);
    syncCollection('receiving', nextReceiving);
    if (updatedReceivingRecord) {
      upsertRecordLocallyAndRemotely('receiving', { ...updatedReceivingRecord, iqcStatus, status: (iqcStatus === 'APPROVED_IQC' ? 'VERIFIED' : 'QUARANTINED') as ReceivingRecord['status'] }, `Updated IQC status to ${iqcStatus}`);
    }

    const targetRec = receiving.find(r => r.id === id);
    if (targetRec) {
      const nextStocks: MaterialStockItem[] = stocks.map(s => {
        if (s.lotNumber === targetRec.lotNumber && s.partCode === targetRec.partCode) {
          const updatedStock = {
            ...s,
            status: (iqcStatus === 'APPROVED_IQC' ? 'APPROVED' : 'QUARANTINE') as MaterialStockItem['status'],
            location: iqcStatus === 'APPROVED_IQC' ? 'Designated Storage Bin' : 'Quarantine Area'
          };
          upsertRecordLocallyAndRemotely('stocks', updatedStock, `Updated stock status for ${targetRec.partCode}`);
          return updatedStock;
        }
        return s;
      });
      setStocks(nextStocks);
      syncCollection('stocks', nextStocks);

      sendSystemActivity(`${currentUser} updated IQC evaluation for ${targetRec.partCode} (Lot: ${targetRec.lotNumber}) to ${iqcStatus}.`);
    }
  };


  const handleAddReturn = (record: ReturnRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const nextReturns = [record, ...returns];
    setReturns(nextReturns);
    syncCollection('returns', nextReturns);
    upsertRecordLocallyAndRemotely('returns', record, `Returned ${record.quantity} of ${record.partCode}`);
    
    const catUpper = (record.category || '').toUpperCase();
    let derivedStockType: MaterialType = 'RAW';
    if (catUpper.includes('PACKAGING')) derivedStockType = 'PACKAGING';
    else if (catUpper.includes('CONSUMABLE') || catUpper.includes('OFFICE')) derivedStockType = 'CONSUMABLE';
    else if (catUpper.includes('WIP') || catUpper.includes('SUB-PART')) derivedStockType = 'WIP';
    else if (catUpper.includes('FG') || catUpper.includes('FINISHED')) derivedStockType = 'FG';
    else if ((record.partCode || '').startsWith('RM')) derivedStockType = 'RAW';

    const newStockItem: MaterialStockItem = {
      id: generateAuthoritativeId('STK'),
      partCode: record.partCode,
      description: record.materialDescription,
      type: derivedStockType,
      location: record.status === 'QUARANTINED' ? 'Quarantine Area' : 'Designated Storage Bin',
      quantity: record.quantity,
      unit: record.unit,
      lotNumber: record.lotNumber,
      receivedDate: record.date,
      fifoColor: 'Pink',
      status: record.status === 'QUARANTINED' ? 'QUARANTINE' : 'APPROVED'
    };
    const nextStocks = [newStockItem, ...stocks];
    setStocks(nextStocks);
    syncCollection('stocks', nextStocks);
    upsertRecordLocallyAndRemotely('stocks', newStockItem, `Created stock item from return for ${record.partCode}`);

    sendSystemActivity(`${currentUser} registered shop-floor return for ${record.partCode} (Lot: ${record.lotNumber}).`);
  };

  const handleUpdateReturnStatus = (id: string, status: ReturnRecord['status']) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const nextReturns: ReturnRecord[] = returns.map(r => r.id === id ? { ...r, status, iqcEvaluation: 'APPROVED_IQC' as const } : r);
    setReturns(nextReturns);
    syncCollection('returns', nextReturns);

    const targetRet = returns.find(r => r.id === id);
    if (targetRet) {
      const nextStocks: MaterialStockItem[] = stocks.map(s => {
        if (s.lotNumber === targetRet.lotNumber && s.partCode === targetRet.partCode) {
          return { ...s, status: 'APPROVED' as const, location: 'Designated Storage Bin' };
        }
        return s;
      });
      setStocks(nextStocks);
      syncCollection('stocks', nextStocks);

      sendSystemActivity(`${currentUser} approved returned item ${targetRet.partCode} back to active inventory.`);
    }
  };


  const handleAddRecycling = (record: RecyclingRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const nextRecycling = [record, ...recycling];
    setRecycling(nextRecycling);
    syncCollection('recycling', nextRecycling);
    upsertRecordLocallyAndRemotely('recycling', record, `Recycled ${record.quantity} ${record.itemType}(s)`);

    sendSystemActivity(`${currentUser} recorded recycling of ${record.quantity} ${record.itemType}(s) under Log Sheet: ${record.logSheetNumber}.`);
  };

  const handleDeleteRecycling = (id: string) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    deleteRecordLocallyAndRemotely('recycling', id);
    const nextRecycling = recycling.filter(r => r.id !== id);
    setRecycling(nextRecycling);
    syncCollection('recycling', nextRecycling);
  };

  const handleAddIssuance = (record: IssuanceRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const nextIssuances = [record, ...issuances];
    setIssuances(nextIssuances);
    syncCollection('issuances', nextIssuances);
    upsertRecordLocallyAndRemotely('issuances', record, `Issued ${record.quantityIssued} units for Requisition: ${record.requisitionNumber}`);

    sendSystemActivity(`${currentUser} logged materials issuance of ${record.quantityIssued} units for Requisition: ${record.requisitionNumber}.`);
  };

  const handleDeductStock = (partCode: string, lotNumber: string, quantity: number): boolean => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return false;
    }
    const stockIdx = stocks.findIndex(s => s.partCode === partCode && s.lotNumber === lotNumber && s.status === 'APPROVED');
    if (stockIdx === -1 || stocks[stockIdx].quantity < quantity) {
      return false;
    }
    const updatedItem = { ...stocks[stockIdx], quantity: stocks[stockIdx].quantity - quantity };
    const nextStocks = stocks.map((s, idx) => {
      if (idx === stockIdx) {
        return updatedItem;
      }
      return s;
    });
    setStocks(nextStocks);
    syncCollection('stocks', nextStocks);
    upsertRecordLocallyAndRemotely('stocks', updatedItem, `Deducted ${quantity} from stock ${partCode} (Lot: ${lotNumber})`);

    // Record atomic ledger stock movement with idempotency and database RPC
    createStockMovement({
      productId: partCode,
      warehouseId: 'wh-main',
      type: 'ADJUSTMENT_OUT',
      quantity: -quantity,
      referenceNumber: lotNumber,
      notes: `Stock deducted for part ${partCode} (Lot: ${lotNumber})`,
      userName: currentUser,
      preventNegativeStock: true
    }).catch((err) => console.warn('Stock movement async record note:', err));

    return true;
  };

  const handleAddDelivery = (record: DeliveryRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const nextDeliveries = [record, ...deliveries];
    setDeliveries(nextDeliveries);
    syncCollection('deliveries', nextDeliveries);
    upsertRecordLocallyAndRemotely('deliveries', record, `Created delivery request ${record.id}`);

    sendSystemActivity(`${currentUser} created Delivery request ${record.id} for model ${record.modelName} (Qty: ${record.quantity}).`);
  };

  const handleUpdateDeliveryStatus = (id: string, status: DeliveryRecord['status'], extDoc?: { drNumber?: string, salesInvoice?: string, wayBill?: string }) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    let updatedRecord: DeliveryRecord | null = null;
    const nextDeliveries = deliveries.map(d => {
      if (d.id === id) {
        updatedRecord = { 
          ...d, 
          status, 
          ...extDoc 
        };
        return updatedRecord;
      }
      return d;
    });
    setDeliveries(nextDeliveries);
    syncCollection('deliveries', nextDeliveries);
    if (updatedRecord) {
      upsertRecordLocallyAndRemotely('deliveries', updatedRecord, `Updated delivery status to ${status}`);
    }

    if (status === 'RELEASED') {
      const targetDel = deliveries.find(d => d.id === id);
      if (targetDel) {
        const nextStocks = stocks.map(s => {
          if (s.partCode === targetDel.partCode && s.status === 'APPROVED' && s.quantity >= targetDel.quantity) {
            const updatedStock = { ...s, quantity: s.quantity - targetDel.quantity };
            upsertRecordLocallyAndRemotely('stocks', updatedStock, `Released delivery quantity ${targetDel.quantity}`);
            return updatedStock;
          }
          return s;
        });
        setStocks(nextStocks);
        syncCollection('stocks', nextStocks);

        sendSystemActivity(`${currentUser} released Delivery Request ${id} & Gate Pass to gate guards.`);
      }
    } else {
      sendSystemActivity(`${currentUser} marked Delivery Request ${id} as ${status}.`);
    }
  };

  const handleAddEnvLog = (log: EnvironmentalLog) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const nextEnvLogs = [...envLogs, log];
    setEnvLogs(nextEnvLogs);
    syncCollection('envLogs', nextEnvLogs);
    upsertRecordLocallyAndRemotely('envLogs', log, `Logged space utilization for ${log.zone}`);

    const pct = ((log.occupiedSlots / log.totalSlots) * 100).toFixed(1);
    sendSystemActivity(`${currentUser} logged space utilization audit for ${log.zone}: ${log.occupiedSlots}/${log.totalSlots} slots occupied (${pct}%).`);
  };

  const handleClearEnvLogs = () => {
    const normRole = (currentRole || '').toUpperCase();
    const normUser = (currentUser || '').toUpperCase();
    const isSuperOrSystem = normRole.includes('SUPER') || normRole.includes('SYSTEM') || normUser.includes('SUPER') || normUser.includes('SYSTEM') || currentPermission === 'FULL_ACCESS';
    
    if (!isSuperOrSystem) {
      alert("PERMISSION DENIED: ONLY SUPER ADMIN AND SYSTEM ADMIN CAN CLEAR HISTORICAL SPACE AUDIT LOGS.");
      return;
    }
    setEnvLogs([]);
    syncCollection('envLogs', []);
    sendSystemActivity(`ADMIN ${currentUser} cleared all historical space audit sheet logs.`);
  };

  const handleDeleteEnvLog = (id: string) => {
    const normRole = (currentRole || '').toUpperCase();
    const normUser = (currentUser || '').toUpperCase();
    const isSuperOrSystem = normRole.includes('SUPER') || normRole.includes('SYSTEM') || normUser.includes('SUPER') || normUser.includes('SYSTEM') || currentPermission === 'FULL_ACCESS';

    if (!isSuperOrSystem) {
      alert("PERMISSION DENIED: ONLY SUPER ADMIN AND SYSTEM ADMIN CAN DELETE SPACE AUDIT LOG RECORDS.");
      return;
    }
    deleteRecordLocallyAndRemotely('envLogs', id);
    const next = envLogs.filter(l => l.id !== id);
    setEnvLogs(next);
    syncCollection('envLogs', next);
    sendSystemActivity(`ADMIN ${currentUser} deleted space audit log record ${id}.`);
  };

  const handleAddForkliftCheck = (check: ForkliftChecklist) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const nextForkliftChecks = [check, ...forkliftChecks];
    setForkliftChecks(nextForkliftChecks);
    syncCollection('forkliftChecks', nextForkliftChecks);

    const isForkliftOk = check.brakesOk && check.lightsOk && check.hydraulicOk && check.steeringOk && check.tiresOk && check.batteryFluidOk;
    sendSystemActivity(`${currentUser} logged Forklift ${check.forkliftId} pre-op check. Passed: ${isForkliftOk}.`);
  };

  // OPERATOR EDIT / DELETE HANDLERS
  const handleAddStock = (item: MaterialStockItem) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const next = [item, ...stocks];
    setStocks(next);
    syncCollection('stocks', next);
    upsertRecordLocallyAndRemotely('stocks', item, `Added stock batch ${item.partCode}`);
    sendSystemActivity(`${currentUser} added stock batch ${item.partCode} (${item.quantity} ${item.unit}).`);
  };

  const handleUpdateStockQty = (id: string, qty: number) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    let updatedItem: MaterialStockItem | null = null;
    const next = stocks.map(s => {
      if (s.id === id) {
        updatedItem = { ...s, quantity: qty };
        return updatedItem;
      }
      return s;
    });
    setStocks(next);
    syncCollection('stocks', next);
    if (updatedItem) {
      upsertRecordLocallyAndRemotely('stocks', updatedItem, `Updated stock ${id} quantity to ${qty}`);
    }
    sendSystemActivity(`${currentUser} updated stock ${id} quantity to ${qty}.`);
  };

  const handleUpdateStockStatus = (id: string, status: MaterialStockItem['status']) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    let updatedItem: MaterialStockItem | null = null;
    const next = stocks.map(s => {
      if (s.id === id) {
        updatedItem = { ...s, status };
        return updatedItem;
      }
      return s;
    });
    setStocks(next);
    syncCollection('stocks', next);
    if (updatedItem) {
      upsertRecordLocallyAndRemotely('stocks', updatedItem, `Updated stock ${id} status to ${status}`);
    }
    sendSystemActivity(`${currentUser} updated stock ${id} status to ${status}.`);
  };

  const handleEditStock = (item: MaterialStockItem) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT STOCK ITEMS.");
      return;
    }
    const next = stocks.map(s => s.id === item.id ? item : s);
    setStocks(next);
    syncCollection('stocks', next);
    upsertRecordLocallyAndRemotely('stocks', item, `Updated stock record ${item.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated stock record ${item.id} (${item.partCode}).`);
  };

  const handleDeleteStock = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      alert("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE STOCK TRANSACTIONS.");
      return;
    }
    deleteRecordLocallyAndRemotely('stocks', id);
    const next = stocks.filter(s => s.id !== id);
    setStocks(next);
    syncCollection('stocks', next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted stock record ${id}.`);
  };

  const handleEditReceiving = (record: ReceivingRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT RECEIVING RECORDS.");
      return;
    }
    const next = receiving.map(r => r.id === record.id ? record : r);
    setReceiving(next);
    syncCollection('receiving', next);
    upsertRecordLocallyAndRemotely('receiving', record, `Updated receiving record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated receiving record ${record.id} (${record.partCode}).`);
  };

  const handleDeleteReceiving = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      alert("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE RECEIVING TRANSACTIONS.");
      return;
    }
    deleteRecordLocallyAndRemotely('receiving', id);
    const next = receiving.filter(r => r.id !== id);
    setReceiving(next);
    syncCollection('receiving', next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted receiving record ${id}.`);
  };

  const handleEditReturn = (record: ReturnRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT RETURN RECORDS.");
      return;
    }
    const next = returns.map(r => r.id === record.id ? record : r);
    setReturns(next);
    syncCollection('returns', next);
    upsertRecordLocallyAndRemotely('returns', record, `Updated return record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated return record ${record.id} (${record.partCode}).`);
  };

  const handleDeleteReturn = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      alert("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE RETURN TRANSACTIONS.");
      return;
    }
    deleteRecordLocallyAndRemotely('returns', id);
    const next = returns.filter(r => r.id !== id);
    setReturns(next);
    syncCollection('returns', next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted return record ${id}.`);
  };

  const handleEditIssuance = (record: IssuanceRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT ISSUANCE RECORDS.");
      return;
    }
    const next = issuances.map(i => i.id === record.id ? record : i);
    setIssuances(next);
    syncCollection('issuances', next);
    upsertRecordLocallyAndRemotely('issuances', record, `Updated issuance record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated issuance record ${record.id} (${record.partCode}).`);
  };

  const handleDeleteIssuance = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      alert("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE ISSUANCE TRANSACTIONS.");
      return;
    }
    deleteRecordLocallyAndRemotely('issuances', id);
    const next = issuances.filter(i => i.id !== id);
    setIssuances(next);
    syncCollection('issuances', next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted issuance record ${id}.`);
  };

  const handleEditDelivery = (record: DeliveryRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT DELIVERY RECORDS.");
      return;
    }
    const next = deliveries.map(d => d.id === record.id ? record : d);
    setDeliveries(next);
    syncCollection('deliveries', next);
    upsertRecordLocallyAndRemotely('deliveries', record, `Updated delivery record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated delivery record ${record.id} (${record.gatePassNumber}).`);
  };

  const handleDeleteDelivery = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      alert("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE DELIVERY TRANSACTIONS.");
      return;
    }
    deleteRecordLocallyAndRemotely('deliveries', id);
    const next = deliveries.filter(d => d.id !== id);
    setDeliveries(next);
    syncCollection('deliveries', next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted delivery record ${id}.`);
  };

  // Export Full Current State JSON helper with current date in filename
  const handleExportCurrentData = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const filename = `juwei-wms-current-data-${dateStr}.json`;

    const exportPayload = {
      meta: {
        system: "JUWEI WAREHOUSE MANAGEMENT SYSTEM",
        exportDate: dateStr,
        exportedAt: now.toISOString(),
        exportedBy: `${currentUser || 'JUWEI OPERATOR'} (${currentEmployeeId || 'JPMP-002'})`,
        systemResetVersion: Number(localStorage.getItem('juwei_wms_system_reset_version')) || 1,
        totalRecords: {
          stocks: stocks.length,
          receiving: receiving.length,
          returns: returns.length,
          recycling: recycling.length,
          issuances: issuances.length,
          deliveries: deliveries.length,
          envLogs: envLogs.length,
          forkliftChecks: forkliftChecks.length,
          registries: registries.length,
          registeredUsers: registeredUsers.length
        }
      },
      stocks,
      receiving,
      returns,
      recycling,
      issuances,
      deliveries,
      envLogs,
      forkliftChecks,
      registries,
      registeredUsers
    };

    try {
      const jsonStr = JSON.stringify(exportPayload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
      const blobUrl = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = blobUrl;
      downloadAnchor.download = filename;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Failed to export current data JSON:', e);
      alert('Failed to generate export file. Please check console for details.');
    }
  };

  const handleExportBackup = handleExportCurrentData;

  // Import JSON Backup helper
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (parsed.stocks) { setStocks(parsed.stocks); syncCollection('stocks', parsed.stocks); }
          if (parsed.receiving) { setReceiving(parsed.receiving); syncCollection('receiving', parsed.receiving); }
          if (parsed.returns) { setReturns(parsed.returns); syncCollection('returns', parsed.returns); }
          if (parsed.recycling) { setRecycling(parsed.recycling); syncCollection('recycling', parsed.recycling); }
          if (parsed.issuances) { setIssuances(parsed.issuances); syncCollection('issuances', parsed.issuances); }
          if (parsed.deliveries) { setDeliveries(parsed.deliveries); syncCollection('deliveries', parsed.deliveries); }
          if (parsed.envLogs) { setEnvLogs(parsed.envLogs); syncCollection('envLogs', parsed.envLogs); }
          if (parsed.forkliftChecks) { setForkliftChecks(parsed.forkliftChecks); syncCollection('forkliftChecks', parsed.forkliftChecks); }
          alert('Backup restored and synchronized successfully across all JUWEI real-time clients!');
        } catch (err) {
          alert('Invalid backup file structure.');
        }
      };
    }
  };

  const handleRegisterMasterItem = (item: MasterRegistryItem) => {
    const next = [item, ...registries];
    setRegistries(next);
    syncCollection('registries', next);
    upsertRecordLocallyAndRemotely('registries', item, `Registered master item ${item.name} (${item.code})`);
  };

  const handleUpdateMasterItem = (item: MasterRegistryItem) => {
    const next = registries.map(r => r.id === item.id ? item : r);
    setRegistries(next);
    syncCollection('registries', next);
    upsertRecordLocallyAndRemotely('registries', item, `Updated master item ${item.name} (${item.code})`);
  };

  const handleDeleteMasterItem = (id: string) => {
    deleteRecordLocallyAndRemotely('registries', id);
    const next = registries.filter(r => r.id !== id);
    setRegistries(next);
    syncCollection('registries', next);
  };

  const handleResetMasterDefaults = () => {
    setRegistries(DEFAULT_MASTER_REGISTRIES);
    syncCollection('registries', DEFAULT_MASTER_REGISTRIES);
  };

  const getPageTitle = () => {
    switch (view) {
      case 'dashboard': return 'Operational Control Dashboard';
      case 'receiving': return 'Material Receiving & Returns';
      case 'stock': return 'Stock & FIFO Control';
      case 'stock-movements': return 'Stock Movements Ledger (Atomic Sync)';
      case 'products': return 'Products & Items Master Catalog';
      case 'inventory-matrix': return 'Multi-Warehouse Inventory Matrix';
      case 'recycling': return 'Packaging Recycling';
      case 'issuance': return 'Material Issuance';
      case 'delivery': return 'Outbound & Gate Pass';
      case 'environmental': return 'Space Utilization Control';
      case 'master-registry': return 'Master Data Register';
      case 'accounts': return 'JPMP Accounts & Authorization Directory';
      default: return 'JUWEI WAREHOUSE MANAGEMENT SYSTEM';
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex flex-col justify-center bg-slate-950 font-sans relative overflow-hidden" id="juwei-auth-container">
        {/* Soft Ambient Floating Glow Orbs for Authentic Frosted Diffusion */}
        <div className="glass-ambient-orb-1" />
        <div className="glass-ambient-orb-2" />
        <div className="glass-ambient-orb-3" />

        {/* Dismissible Version Update Notification Banner */}
        {updateAvailable && !bannerDismissed && (
          <div className="fixed top-0 left-0 right-0 z-50">
            <VersionUpdateBanner
              onReload={() => {
                if (newVersionString) {
                  try {
                    localStorage.setItem('juwei_wms_installed_version', newVersionString);
                  } catch (e) {}
                }
                setUpdateAvailable(false);
                updateAvailableRef.current = false;
                window.location.reload();
              }}
              onLater={() => {
                setBannerDismissed(true);
                if (newVersionString) {
                  try {
                    localStorage.setItem('juwei_wms_installed_version', newVersionString);
                  } catch (e) {}
                }
              }}
              newVersion={newVersionString}
            />
          </div>
        )}

        <div className="w-full flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">

        {/* NEWLY REGISTERED USER SECURE PIN DISCOVERY OVERLAY */}
        {newlyRegisteredUser && (
          <div className="fixed inset-0 bg-slate-950/80 z-[120] flex items-center justify-center p-3 sm:p-4 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.94, y: 16, filter: 'blur(8px)' }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-md w-full glass-card p-6 sm:p-8 rounded-3xl shadow-2xl text-center space-y-5 relative border border-white/80 text-slate-900 my-auto max-h-[calc(100vh-2rem)] overflow-y-auto"
            >
              <div className="flex justify-center">
                <div className="h-14 w-14 bg-emerald-50/90 border border-emerald-200/90 rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm backdrop-blur-md">
                  <UserCheck className="h-7 w-7" />
                </div>
              </div>

              <div>
                <span className="text-emerald-700 font-semibold text-[10px] tracking-wider font-mono uppercase block">
                  Registration Successful
                </span>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight mt-1">
                  Secure Operator ID Registered
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Juwei Plastic Moulding Phils. Inc.
                </p>
              </div>

              {/* Operator Details */}
              <div className="bg-slate-50/80 backdrop-blur-md p-4 rounded-2xl border border-slate-200/80 text-left space-y-2 text-xs">
                <div className="flex justify-between items-center border-b border-slate-200/80 pb-1.5">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Operator:</span>
                  <span className="font-semibold text-slate-900">{newlyRegisteredUser.username}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-200/80 pb-1.5">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Employee ID:</span>
                  <span className="font-semibold text-indigo-600 font-mono">{newlyRegisteredUser.employeeId}</span>
                </div>
                {newlyRegisteredUser.phoneNumber && (
                  <div className="flex justify-between items-center border-b border-slate-200/80 pb-1.5">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase">Verified Mobile:</span>
                    <span className="font-semibold text-emerald-600 font-mono flex items-center gap-1">
                      <Phone className="h-3 w-3 text-emerald-500" />
                      {newlyRegisteredUser.phoneNumber}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Assigned Role:</span>
                  <span className="font-semibold text-slate-800">{newlyRegisteredUser.role}</span>
                </div>
              </div>

              {/* PIN Code & Generated QR Code Pass Box */}
              <div className="bg-indigo-50/70 backdrop-blur-md p-5 rounded-2xl border border-indigo-100/80 relative space-y-3">
                <div className="text-[10px] text-indigo-700 font-mono font-semibold uppercase tracking-wider">
                  Unique Login PIN & QR Pass
                </div>
                
                <div className="flex items-center justify-center gap-2">
                  <div className="text-2xl font-mono font-bold text-emerald-700 tracking-[0.25em] pl-[0.25em] text-center select-all">
                    {showNewlyRegisteredPin ? newlyRegisteredUser.pin : '••••'}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNewlyRegisteredPin(!showNewlyRegisteredPin)}
                    className="text-slate-500 hover:text-emerald-700 p-1.5 rounded-lg transition cursor-pointer"
                    title={showNewlyRegisteredPin ? "Hide PIN" : "Reveal PIN"}
                  >
                    {showNewlyRegisteredPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* QR Code Container */}
                <div className="bg-white p-2.5 rounded-xl border border-slate-200 inline-block mx-auto shadow-sm">
                  <QRCodeSVG
                    value={JSON.stringify({
                      type: 'JPMP_WMS_LOGIN_PASS',
                      employeeId: newlyRegisteredUser.employeeId,
                      username: newlyRegisteredUser.username,
                      pin: newlyRegisteredUser.pin
                    })}
                    size={120}
                    level="H"
                    includeMargin={true}
                  />
                </div>

                <div className="text-[10px] text-slate-600 font-medium">
                  Scan QR code at WMS Gateway to log in instantly.
                </div>

                <button
                  type="button"
                  onClick={() => setQrBadgeAccount(newlyRegisteredUser)}
                  className="w-full bg-white hover:bg-slate-50 text-indigo-700 border border-indigo-200 py-2 px-3 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Printer className="h-3.5 w-3.5 text-indigo-600" /> Print / Download QR Pass Badge
                </button>
              </div>

              <button
                onClick={() => {
                  const targetUser = newlyRegisteredUser;
                  setNewlyRegisteredUser(null);
                  setAuthTab('login');
                  setLoginError('');
                  setLoginEmployeeId('');
                  setLoginPin('');
                  setIsLoggingIn(true);
                  setTimeout(() => {
                    handleLogin(targetUser);
                    setIsLoggingIn(false);
                  }, 500);
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 px-4 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 shadow-sm cursor-pointer"
              >
                <Fingerprint className="h-4 w-4" /> Proceed to Verification & Log In
              </button>
            </motion.div>
          </div>
        )}

        <motion.div 
          id="operator-login-portal" 
          className="operator-login-portal max-w-md w-full space-y-6 glass-card-darker p-8 sm:p-9 rounded-3xl shadow-2xl relative overflow-hidden z-10 text-slate-100"
          initial={{ opacity: 0, y: 16, scale: 0.98, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Central Database Status Quick Settings */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-slate-400 font-mono font-medium">SYSTEM READY</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowStartupDiagnosticsModal(true)}
                className="flex items-center justify-center p-1.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                title="Startup Diagnostics & Multi-PC Synchronization Verifier"
                aria-label="Startup Diagnostics"
                id="btn-login-diagnostics"
              >
                <Activity className="h-3.5 w-3.5 text-indigo-400" />
              </button>

              <button
                type="button"
                onClick={() => setShowCentralDatabaseModal(true)}
                className="flex items-center justify-center p-1.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                title="Central Database • Single Source of Truth"
                aria-label="Central Database Status"
                id="btn-login-central-db-settings"
              >
                <Database className="h-3.5 w-3.5 text-emerald-400" />
              </button>
            </div>
          </div>

          <div className="flex flex-col items-center text-center">
            <div className="mb-3 flex justify-center">
              <img 
                src="/juwei-logo.png" 
                alt="Juwei Logo" 
                className="h-12 w-auto" 
              />
            </div>
            <span className="inline-block bg-indigo-500/10 text-indigo-300 font-mono font-semibold text-[10px] uppercase px-2.5 py-0.5 rounded-md mb-2 border border-indigo-500/20">
              JUWEI WMS GATEWAY • v{appVersion}
            </span>
            <h2 className="text-xl font-bold tracking-tight text-white">
              Operator Sign In
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Enter your Employee ID and 4-digit PIN to begin
            </p>
          </div>

          <div className="space-y-4">
            {/* QR Code Instant Gateway Login Button */}
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/80 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5 truncate">
                  <QrCode className="h-4 w-4 text-emerald-400 shrink-0" /> Instant QR Pass Login
                </span>
                <span className="text-[11px] text-slate-400 block truncate mt-0.5">
                  Scan badge or upload pass image
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowLoginQrScanner(true)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                id="btn-gateway-scan-qr"
              >
                <ScanLine className="h-3.5 w-3.5" /> Scan QR
              </button>
            </div>

            <div className="flex items-center gap-2 my-2 text-slate-500 text-[10px] font-mono font-medium uppercase">
              <div className="h-px bg-slate-800 flex-1" />
              <span>Or enter manually</span>
              <div className="h-px bg-slate-800 flex-1" />
            </div>

            <form 
              onSubmit={handleDirectLogin} 
              autoComplete="off" 
              data-lpignore="true" 
              data-1p-ignore="true"
              className="space-y-3.5"
            >
              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Employee ID
                </label>
                <div className="relative">
                  <input
                    type="text"
                    name="operatorEmployeeId"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    required
                    value={loginEmployeeId}
                    onChange={(e) => {
                      setLoginEmployeeId(e.target.value);
                      if (loginError) setLoginError('');
                    }}
                    placeholder="e.g. JPMP-002"
                    className="w-full bg-slate-800/80 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono tracking-wide"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  4-Digit PIN Code
                </label>
                <div className="relative">
                  <input
                    type={showPin ? "text" : "password"}
                    name="operatorPinCode"
                    autoComplete="one-time-code"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    required
                    maxLength={4}
                    pattern="\d*"
                    inputMode="numeric"
                    value={loginPin}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setLoginPin(val);
                      if (loginError) setLoginError('');
                    }}
                    placeholder="••••"
                    className="w-full bg-slate-800/80 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 pr-10 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  >
                    {showPin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Remember My Login Checkbox */}
              <div className="flex items-center justify-between pt-0.5">
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300 hover:text-white text-xs">
                  <input
                    type="checkbox"
                    checked={rememberLogin}
                    onChange={(e) => setRememberLogin(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900 cursor-pointer"
                  />
                  <span>Remember my login</span>
                </label>
              </div>

              {loginError && (
                <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 px-3 py-2 rounded-lg text-xs text-center font-medium font-mono">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 px-4 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                <LogIn className="h-4 w-4" /> Sign In to WMS Session
              </button>
            </form>
          </div>
        </motion.div>

        {/* Gateway QR Code Scanner Modal */}
        {showLoginQrScanner && (
          <BarcodeScannerModal
            isOpen={showLoginQrScanner}
            onClose={() => setShowLoginQrScanner(false)}
            title="Juwei WMS Gateway QR Login Scanner"
            subtitle="Scan operator badge QR code or upload pass image containing Username & PIN"
            onScanResult={handleQrLoginScan}
          />
        )}

        {/* QR Badge Modal Overlay */}
        {qrBadgeAccount && (
          <AccountQRBadgeModal
            account={qrBadgeAccount}
            isOpen={!!qrBadgeAccount}
            onClose={() => setQrBadgeAccount(null)}
            onDirectLogin={(acc) => {
              setQrBadgeAccount(null);
              setLoginEmployeeId('');
              setLoginPin('');
              setIsLoggingIn(true);
              setTimeout(() => {
                handleLogin(acc);
                setIsLoggingIn(false);
              }, 500);
            }}
          />
        )}

        {/* Logging In Circle Loading Screen */}
        {isLoggingIn && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-200">
            <div className="bg-white border border-slate-300 rounded-3xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl text-slate-900 my-auto">
              <div className="inline-flex p-4 bg-blue-100 text-blue-700 rounded-full border border-blue-300">
                <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
              </div>
              <div className="space-y-1">
                <h3 className="font-extrabold text-slate-900 text-base tracking-wide uppercase font-mono">
                  VERIFYING CREDENTIALS
                </h3>
                <p className="text-xs text-blue-700 font-bold font-mono">
                  AUTHENTICATING OPERATOR LOG-IN...
                </p>
              </div>
              <p className="text-[11px] text-slate-600 font-sans font-medium">
                Establishing secure WMS operational session. Please wait a moment...
              </p>
            </div>
          </div>
        )}

        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-slate-100/80 font-sans relative overflow-hidden text-slate-900" id="juwei-app-container">
      {/* Soft Ambient Floating Glow Orbs for Authentic Frosted Diffusion */}
      <div className="glass-ambient-orb-1" />
      <div className="glass-ambient-orb-2" />
      <div className="glass-ambient-orb-3" />

      {/* Sidebar navigation */}
      <aside className="w-full md:w-64 h-auto md:h-screen glass-sidebar text-slate-200 flex flex-col justify-between z-20 shrink-0 relative overflow-hidden" id="sidebar-nav">
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Logged in Operator badge */}
          <div className="p-4 bg-slate-950/70 border-b border-slate-800/80 flex flex-col gap-2.5 backdrop-blur-md shrink-0">
            <img 
              src="/juwei-logo.png" 
              alt="Juwei Logo" 
              className="h-8 w-auto mb-2" 
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="bg-slate-800/90 border border-slate-700/80 p-2 rounded-xl text-indigo-400 shrink-0 shadow-sm">
                  <User className="h-4 w-4" />
                </div>
                <div className="text-left leading-tight">
                  <div className="font-bold text-white text-xs tracking-tight">
                    {currentUser}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 py-0.5">
                    ({currentEmployeeId})
                  </div>
                  <div className="text-[9px] text-indigo-400 font-semibold uppercase tracking-wider">{currentRole}</div>
                </div>
              </div>
              <button
                onClick={() => setShowLogoutConfirmModal(true)}
                title="Log Out / Switch Operator"
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/90 border border-slate-700/60 rounded-xl transition-all cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
            
            {currentPermission === 'VIEW_ONLY' ? (
              <div className="bg-amber-950/40 border border-amber-500/30 text-amber-300 px-2.5 py-1 rounded-lg text-[9px] font-semibold flex items-center justify-center gap-1 font-mono uppercase" title="VIEW ONLY MODE: ACTIONS ARE RESTRICTED">
                <Lock className="h-3 w-3 text-amber-400 shrink-0" />
                <span>VIEW ONLY ACCESS</span>
              </div>
            ) : currentPermission === 'LIMITED_ACCESS' ? (
              <div className="bg-blue-950/40 border border-blue-500/30 text-blue-300 px-2.5 py-1 rounded-lg text-[9px] font-semibold flex items-center justify-center gap-1 font-mono uppercase" title="LIMITED ACCESS MODE: CREATE & EDIT PERMITTED">
                <Edit3 className="h-3 w-3 text-blue-400 shrink-0" />
                <span>LIMITED ACCESS (EDIT ALLOWED)</span>
              </div>
            ) : (
              <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 px-2.5 py-1 rounded-lg text-[9px] font-semibold flex items-center justify-center gap-1 font-mono uppercase" title="FULL ACCESS MODE: ALL ACTIONS ENABLED">
                <Unlock className="h-3 w-3 text-emerald-400 shrink-0" />
                <span>FULL ACCESS</span>
              </div>
            )}
          </div>

          {/* Header Branding */}
          <div className="p-4 bg-slate-950/40 border-b border-slate-800/70 flex items-center justify-between backdrop-blur-md">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-mono font-bold tracking-wider text-sm">JUWEI WMS</span>
                <span className="px-1.5 py-0.5 bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[9px] font-mono font-bold rounded">
                  v{appVersion}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">Juwei Plastic Moulding Phils. Inc.</span>
            </div>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="System Live" />
          </div>

          {/* Navigation Links with Smooth Frosted Highlights */}
          <nav className="p-3 space-y-1 flex-1 overflow-y-auto no-scrollbar" id="nav-list">
            <button 
              onClick={() => setView('dashboard')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'dashboard' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" /> Dashboard Overview
            </button>

            <button 
              onClick={() => setView('receiving')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'receiving' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <ArrowLeftRight className="h-4 w-4 shrink-0" /> Receiving & Returns
            </button>

            <button 
              onClick={() => setView('stock')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'stock' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <PackageSearch className="h-4 w-4 shrink-0" /> Stock & FIFO Bins
            </button>

            <button 
              onClick={() => setView('recycling')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'recycling' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <RotateCcw className="h-4 w-4 shrink-0" /> Packaging Recycling
            </button>

            <button 
              onClick={() => setView('issuance')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'issuance' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <Briefcase className="h-4 w-4 shrink-0" /> Production Issuance
            </button>

            <button 
              onClick={() => setView('delivery')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'delivery' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <Truck className="h-4 w-4 shrink-0" /> Outbound & Gate Pass
            </button>

            <button 
              onClick={() => setView('environmental')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'environmental' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <Boxes className="h-4 w-4 shrink-0" /> Space Utilization
            </button>

            <button 
              onClick={() => setView('stock-movements')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'stock-movements' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
              id="nav-stock-movements"
            >
              <ArrowLeftRight className="h-4 w-4 shrink-0" /> Stock Movements Ledger
            </button>

            <button 
              onClick={() => setView('products')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'products' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
              id="nav-products"
            >
              <PackageSearch className="h-4 w-4 shrink-0" /> Products Catalog
            </button>

            <button 
              onClick={() => setView('inventory-matrix')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'inventory-matrix' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
              id="nav-inventory-matrix"
            >
              <Boxes className="h-4 w-4 shrink-0" /> Multi-Warehouse Matrix
            </button>

            <button 
              onClick={() => setView('master-registry')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'master-registry' 
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
              id="nav-master-registry"
            >
              <FolderPlus className="h-4 w-4 shrink-0" /> Master Data Register
            </button>

            {(currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002' || (currentUser || '').toUpperCase().includes('ALDRIN') || (currentRole || '').toUpperCase().includes('SUPER')) && (
              <button 
                onClick={() => setView('accounts')}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                  view === 'accounts' 
                    ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
                }`}
                id="nav-registered-accounts"
              >
                <Users className="h-4 w-4 shrink-0" /> JPMP Accounts
              </button>
            )}
          </nav>
        </div>

        {/* Sidebar Footer with system values */}
        <div className="p-4 border-t border-slate-800/80 space-y-2 bg-slate-950/60 backdrop-blur-md">
          <div className="space-y-1.5">
            <button 
              onClick={handleExportCurrentData}
              id="btn-sidebar-export-current-data"
              className="w-full bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white py-2 px-3 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 border border-slate-700/80 transition-colors cursor-pointer shadow-xs active:scale-95"
              title="Download full current state (stocks, receiving, returns, etc.) as formatted JSON"
            >
              <Download className="h-3.5 w-3.5 text-indigo-400" /> Export Current Data
            </button>

            {(currentEmployeeId === 'JPMP-002' || currentPermission === 'FULL_ACCESS') && (
              <>
                <button 
                  onClick={() => setShowBackupsModal(true)}
                  className="w-full bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 hover:text-emerald-100 py-2 px-3 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 border border-emerald-500/40 transition-colors cursor-pointer shadow-sm"
                  title="Super Admin: Automated 24h backups & snapshot disaster recovery"
                >
                  <Archive className="h-3.5 w-3.5 text-emerald-400" /> Automated Server Backups
                </button>
                
                <label className="w-full bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white py-2 px-3 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700/60 transition-colors">
                  <Upload className="h-3.5 w-3.5 text-indigo-400" /> Import DB Restore
                  <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
                </label>

                <button 
                  onClick={() => {
                    setConfirmActionApp({
                      title: 'Reset Default Database',
                      message: 'Are you sure you want to reset all inventory, receiving, stock, and delivery logs to initial default records?',
                      confirmLabel: 'YES, RESET DATABASE',
                      confirmVariant: 'danger',
                      onConfirm: () => resetStateToDefaults()
                    });
                  }}
                  className="w-full text-rose-400/80 hover:text-rose-300 py-1 text-[10px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <Trash2 className="h-3 w-3" /> Reset default database
                </button>

                <button 
                  onClick={() => {
                    setConfirmActionApp({
                      title: 'Wipe Operator Accounts',
                      message: "WARNING: THIS WILL REMOVE ALL OPERATOR ACCOUNTS AND LOG YOU OUT. ONLY 'SUPER ADMIN' (JPMP-002) WILL REMAIN ACTIVE. ARE YOU SURE?",
                      confirmLabel: 'YES, WIPE ACCOUNTS',
                      confirmVariant: 'danger',
                      onConfirm: () => resetAccountsToDefaults()
                    });
                  }}
                  className="w-full text-rose-400/70 hover:text-rose-300 py-1 text-[10px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <Trash2 className="h-3 w-3" /> Wipe operator accounts
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col h-full min-w-0 bg-slate-50/70 z-10 relative overflow-hidden">
        {/* Dismissible Version Update Notification Banner */}
        {updateAvailable && !bannerDismissed && (
          <VersionUpdateBanner
            onReload={() => {
              if (newVersionString) {
                try {
                  localStorage.setItem('juwei_wms_installed_version', newVersionString);
                } catch (e) {}
              }
              setUpdateAvailable(false);
              updateAvailableRef.current = false;
              window.location.reload();
            }}
            onLater={() => {
              setBannerDismissed(true);
              if (newVersionString) {
                try {
                  localStorage.setItem('juwei_wms_installed_version', newVersionString);
                } catch (e) {}
              }
            }}
            newVersion={newVersionString}
          />
        )}

        {/* Minimalist Frosted Glass Header Bar */}
        <header className="h-16 glass-header px-4 sm:px-6 lg:px-8 flex justify-between items-center shrink-0 z-20 sticky top-0">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="font-bold text-base sm:text-lg text-slate-900 tracking-tight truncate flex items-center gap-2" id="top-bar-page-title">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shadow-xs shadow-indigo-500/50 shrink-0 animate-pulse" />
              <span>{getPageTitle()}</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-2 text-xs font-medium shrink-0">
            {/* Unified Centralized Realtime & Offline Sync Engine */}
            <SyncStatus 
              onOpenSettings={() => setShowCentralDatabaseModal(true)} 
              onOpenDiagnostics={() => setShowStartupDiagnosticsModal(true)}
            />

            {/* Connected Workstations / Active Terminals Pill - Logo Only with Count */}
            <button
              type="button"
              onClick={() => setShowActiveUsersModal(true)}
              className="inline-flex items-center justify-center bg-indigo-50/90 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/90 w-8 h-8 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 shadow-xs backdrop-blur-md relative"
              title={`Active Workstations: ${Math.max(1, activePresence.length, activeUsers.length)} Online (Click to view)`}
              aria-label="Active Workstation Terminals"
            >
              <Users className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <span className="absolute -top-1.5 -right-1.5 bg-indigo-600 text-white text-[9px] font-bold rounded-full min-w-3.5 h-3.5 flex items-center justify-center px-0.5 font-mono">
                {Math.max(1, activePresence.length, activeUsers.length)}
              </span>
            </button>

            {/* Mobile APK / App Install Hub Button */}
            <button
              type="button"
              onClick={() => setShowMobileInstallModal(true)}
              className="inline-flex items-center justify-center bg-slate-100/90 hover:bg-slate-200 border border-slate-200 text-slate-700 hover:text-slate-900 w-8 h-8 rounded-xl text-xs transition-all cursor-pointer shrink-0 shadow-xs backdrop-blur-md"
              title="Download Android APK / Install Mobile Web App"
              aria-label="Download Android APK / Mobile App"
            >
              <Smartphone className="h-3.5 w-3.5 text-slate-600 shrink-0" />
            </button>

            {/* Isolated Live Date & Time Display */}
            <LiveClock />
          </div>
        </header>

        {/* VIEW ONLY MODE warning banner */}
        {currentPermission === 'VIEW_ONLY' && (
          <div className="bg-amber-500 text-white px-4 sm:px-6 lg:px-8 py-2 text-xs font-semibold flex items-center justify-between gap-4 border-b border-amber-600 font-mono uppercase shrink-0">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              <span>[READ-ONLY PRIVILEGES ACTIVE]: OPERATOR IS RESTRICTED FROM CREATION, DELETION, OR MODIFICATION OF ANY DATA.</span>
            </div>
            <span className="bg-amber-600 text-amber-50 px-2 py-0.5 rounded text-[10px] tracking-wider shrink-0">VIEW ONLY</span>
          </div>
        )}

        {/* View screen renderer with silky smooth frosted glass transitions */}
        <div className="p-4 sm:p-6 lg:p-7 overflow-y-auto flex-1 w-full z-10 relative" id="main-content-viewport">
          <AnimatePresence mode="wait">
            <motion.div 
              key={view} 
              initial={{ opacity: 0, y: 12, scale: 0.992, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, scale: 0.992, filter: 'blur(8px)' }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="w-full"
            >
              {view === 'dashboard' && (
                <DashboardOverview 
                  stocks={stocks}
                  receiving={receiving}
                  issuances={issuances}
                  deliveries={deliveries}
                  recycling={recycling}
                  envLogs={envLogs}
                  forkliftChecks={forkliftChecks}
                  setView={setView}
                  activeUsers={activeUsers}
                  chatMessages={chatMessages}
                  currentUser={currentUser}
                  sendChatMessage={sendChatMessage}
                  registeredUsers={registeredUsers}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002'}
                  canEdit={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                  registries={registries}
                />
              )}

              {view === 'receiving' && (
                <ReceivingModule 
                  receiving={receiving}
                  onAddReceiving={handleAddReceiving}
                  onUpdateIqc={handleUpdateIqc}
                  onEditReceiving={handleEditReceiving}
                  onDeleteReceiving={handleDeleteReceiving}
                  returns={returns}
                  onAddReturn={handleAddReturn}
                  onUpdateReturnStatus={handleUpdateReturnStatus}
                  onEditReturn={handleEditReturn}
                  onDeleteReturn={handleDeleteReturn}
                  stocks={stocks}
                  registries={registries}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002'}
                  canEdit={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                  onOpenRegisterModal={() => setView('master-registry')}
                  receivingCategories={receivingCategories}
                  onUpdateReceivingCategories={handleUpdateReceivingCategories}
                />
              )}

              {view === 'stock' && (
                <StockFIFOControl 
                  stocks={stocks}
                  onAddStock={handleAddStock}
                  onUpdateStockQty={handleUpdateStockQty}
                  onUpdateStockStatus={handleUpdateStockStatus}
                  onEditStock={handleEditStock}
                  onDeleteStock={handleDeleteStock}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002'}
                  canEdit={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                  receiving={receiving}
                  issuances={issuances}
                  returns={returns}
                  registries={registries}
                />
              )}

              {view === 'recycling' && (
                <RecyclingModule 
                  recycling={recycling}
                  onAddRecycling={handleAddRecycling}
                  onDeleteRecycling={handleDeleteRecycling}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002'}
                  canEdit={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                />
              )}

              {view === 'issuance' && (
                <IssuanceModule 
                  stocks={stocks}
                  issuances={issuances}
                  onAddIssuance={handleAddIssuance}
                  onDeductStock={handleDeductStock}
                  onEditIssuance={handleEditIssuance}
                  onDeleteIssuance={handleDeleteIssuance}
                  registries={registries}
                  currentUser={currentUser}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002'}
                  canEdit={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                />
              )}

              {view === 'delivery' && (
                <DeliveryModule 
                  deliveries={deliveries}
                  forkliftChecks={forkliftChecks}
                  onAddDelivery={handleAddDelivery}
                  onAddForkliftCheck={handleAddForkliftCheck}
                  onUpdateDeliveryStatus={handleUpdateDeliveryStatus}
                  onEditDelivery={handleEditDelivery}
                  onDeleteDelivery={handleDeleteDelivery}
                  stocks={stocks}
                  registries={registries}
                  currentUser={currentUser}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002'}
                  canEdit={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                />
              )}

              {view === 'environmental' && (
                <EnvironmentalModule 
                  envLogs={envLogs}
                  onAddEnvLog={handleAddEnvLog}
                  onClearEnvLogs={handleClearEnvLogs}
                  onDeleteEnvLog={handleDeleteEnvLog}
                  registries={registries}
                  onRegisterLocation={handleRegisterMasterItem}
                  onUpdateLocation={(id, data) => {
                    const existing = registries.find(r => r.id === id);
                    if (existing) {
                      handleUpdateMasterItem({ ...existing, ...data });
                    }
                  }}
                  onDeleteLocation={handleDeleteMasterItem}
                  currentUserRole={currentRole}
                  currentUser={currentUser}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentRole?.toUpperCase().includes('SUPER') || currentRole?.toUpperCase().includes('SYSTEM')}
                  canEdit={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                />
              )}

              {view === 'stock-movements' && (
                <StockMovementView 
                  stocks={stocks}
                  currentUser={{ id: currentEmployeeId, name: currentUser, username: currentUser }}
                  onStockUpdated={() => handleManualSync()}
                />
              )}

              {view === 'products' && (
                <ProductList />
              )}

              {view === 'inventory-matrix' && (
                <InventoryTable />
              )}

              {view === 'master-registry' && (
                <MasterRegistryModule 
                  registries={registries}
                  onRegisterItem={handleRegisterMasterItem}
                  onUpdateItem={handleUpdateMasterItem}
                  onDeleteItem={handleDeleteMasterItem}
                  onResetDefaults={handleResetMasterDefaults}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002'}
                  canEdit={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                  defaultType="ALL"
                />
              )}

              {view === 'accounts' && (currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002' || (currentUser || '').toUpperCase().includes('ALDRIN') || (currentRole || '').toUpperCase().includes('SUPER')) && (
                <RegisteredAccountsModule 
                  accounts={registeredUsers}
                  operationalRoles={operationalRoles}
                  onUpdateOperationalRoles={handleUpdateOperationalRoles}
                  onAddAccount={handleRegister}
                  onUpdateAccount={handleUpdateAccount}
                  onRemoveAccount={handleRemoveUser}
                  onClearAllAccounts={handleClearAllAccountsExceptSuperAdmin}
                  onOpenBackups={() => setShowBackupsModal(true)}
                  currentUser={currentUser}
                  currentEmployeeId={currentEmployeeId}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002'}
                  canEdit={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Global QR Badge Modal Overlay in Logged In Session */}
      {qrBadgeAccount && (
        <AccountQRBadgeModal
          account={qrBadgeAccount}
          isOpen={!!qrBadgeAccount}
          onClose={() => setQrBadgeAccount(null)}
        />
      )}

      {/* Global Application Confirmation Modal with YES / NO options */}
      <ConfirmModal config={confirmActionApp} onClose={() => setConfirmActionApp(null)} />

      {/* Mobile APK / App Installer Modal */}
      {showMobileInstallModal && (
        <MobileAppDownloadModal
          isOpen={showMobileInstallModal}
          onClose={() => setShowMobileInstallModal(false)}
          serverAddress={serverAddress}
          onFreshInstallSync={() => performFreshInstallAndSync(true)}
          appVersion={appVersion}
        />
      )}

      {/* Desktop Application Installer Modal */}
      {showDesktopInstallModal && (
        <DesktopInstallModal
          isOpen={showDesktopInstallModal}
          onClose={() => setShowDesktopInstallModal(false)}
        />
      )}

      {/* Central Database & Realtime Diagnostics Modal */}
      <CentralDatabaseModal
        isOpen={showCentralDatabaseModal}
        onClose={() => setShowCentralDatabaseModal(false)}
        connectionStatus={connectionStatus}
        systemResetVersion={Number(localStorage.getItem('juwei_wms_system_reset_version')) || 1}
        systemResetId={localStorage.getItem('juwei_wms_system_reset_id') || 'CENTRAL-COMMITTED'}
        onForceSync={handleManualSync}
        isManualSyncing={isManualSyncing}
        totalRecordsCount={stocks.length + receiving.length + returns.length + recycling.length + issuances.length + deliveries.length}
        totalUsersCount={registeredUsers.length}
      />

      {/* Super Admin Automated Server Backups & Recovery Modal */}
      <ServerBackupsModal
        isOpen={showBackupsModal}
        onClose={() => setShowBackupsModal(false)}
        currentUser={currentUser}
        currentEmployeeId={currentEmployeeId}
      />

      {/* Logout Confirmation Dialog Modal */}
      {showLogoutConfirmModal && (
        <div 
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowLogoutConfirmModal(false)}
        >
          <div 
            className="bg-slate-900 border border-slate-700/90 rounded-2xl w-full max-w-sm p-5 shadow-2xl text-slate-100 flex flex-col gap-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <LogOut className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">Confirm Sign Out</h3>
                  <p className="text-xs text-slate-400">Are you sure you want to log out?</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLogoutConfirmModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="bg-slate-950/70 rounded-xl p-3 border border-slate-800 text-xs flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Active Operator Session:</span>
              <span className="font-bold text-white text-xs">{currentUser || 'OPERATOR'}</span>
              <span className="text-[11px] text-indigo-400 font-mono">({currentEmployeeId || 'JPMP-002'}) • {currentRole || 'WAREHOUSE CLERK'}</span>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowLogoutConfirmModal(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700 transition cursor-pointer"
              >
                No / Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutConfirmModal(false);
                  handleLogout();
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <LogOut className="h-3.5 w-3.5" /> Yes, Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Central Startup Diagnostics & Multi-PC Synchronization Verifier Modal */}
      {showStartupDiagnosticsModal && (
        <StartupDiagnosticsModal
          isOpen={showStartupDiagnosticsModal}
          onClose={() => setShowStartupDiagnosticsModal(false)}
          currentUser={
            registeredUsers.find((u) => u.employeeId === currentEmployeeId) || {
              employeeId: currentEmployeeId || 'JPMP-002',
              name: currentUser || 'SUPER ADMIN',
              role: currentPermission || 'SUPER_ADMIN'
            }
          }
          currentWarehouseId={localStorage.getItem('juwei_wms_warehouse_id') || 'WH-MAIN'}
          currentAccountId={localStorage.getItem('juwei_wms_account_id') || 'ACC-JUWEI'}
          wsConnected={connectionStatus === 'connected'}
          systemResetVersion={Number(localStorage.getItem('juwei_wms_system_reset_version')) || 1}
          onForceSync={handleManualSync}
          onReconnectWs={() => {
            if (socket) {
              try { socket.close(); } catch {}
            }
          }}
        />
      )}

      {/* Active Workstation Terminals Modal */}
      {showActiveUsersModal && (
        <ActiveUsersModal
          isOpen={showActiveUsersModal}
          onClose={() => setShowActiveUsersModal(false)}
          activeUsers={activeUsers}
          activePresence={activePresence}
          registeredUsers={registeredUsers}
          connectionStatus={connectionStatus}
          databaseStatus={connectionStatus}
          wsLatency={wsLatency}
          lastSyncedTime={lastSyncedTime}
          onForceSync={handleManualSync}
          isManualSyncing={isManualSyncing}
        />
      )}

      {/* Live Remote Activity Sync Toast (Minimized, Non-Interfering) */}
      {liveSyncToast && (
        <div className="fixed bottom-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-none select-none">
          <div className="bg-slate-900/85 hover:bg-slate-900/95 text-slate-200 border border-emerald-500/30 rounded-full px-3 py-1.5 shadow-lg flex items-center gap-2 backdrop-blur-md text-[11px] max-w-[360px] sm:max-w-md transition-all">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <RefreshCw className="h-3 w-3 animate-spin text-emerald-400 shrink-0" />
            <div className="truncate font-sans leading-tight">
              <span className="font-semibold text-emerald-400">{liveSyncToast.author}</span>
              <span className="text-slate-300 ml-1.5">{liveSyncToast.action}</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400 shrink-0 border-l border-slate-700/80 pl-2">
              {liveSyncToast.time}
            </span>
            <button
              type="button"
              onClick={() => setLiveSyncToast(null)}
              className="pointer-events-auto text-slate-400 hover:text-white ml-0.5 p-0.5 rounded-full hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              title="Dismiss notification"
              aria-label="Dismiss notification"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

