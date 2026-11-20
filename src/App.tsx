/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  LayoutDashboard, 
  ArrowLeftRight, 
  PackageSearch, 
  RotateCcw, 
  Trash2, 
  Truck, 
  Download, 
  Upload, 
  RefreshCw,
  Clock,
  Briefcase,
  LogIn,
  LogOut,
  UserCheck,
  Fingerprint,
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
  Loader2,
  X,
  Database,
  Archive,
  Phone,
  Smartphone,
  Activity,
  AlertTriangle,
  Ban,
  FileClock
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import AccountQRBadgeModal from './components/AccountQRBadgeModal';
import DesktopInstallModal from './components/DesktopInstallModal';
import MobileAppDownloadModal from './components/MobileAppDownloadModal';
import { ConfirmModal, ConfirmActionConfig } from './components/ConfirmModal';
import BarcodeScannerModal from './components/BarcodeScannerModal';
import QuickRecordLookupModal from './components/QuickRecordLookupModal';
import CentralDatabaseModal from './components/CentralDatabaseModal';
import { ServerBackupsModal } from './components/ServerBackupsModal';
import ActiveUsersModal from './components/ActiveUsersModal';
import { SyncStatus } from './components/SyncStatus';
import { StockMovementView } from './components/StockMovement';
import { ProductList } from './components/ProductList';
import { InventoryTable } from './components/InventoryTable';
import { createStockMovement } from './database/movements';
import {
  syncManager,
  FORCE_FLUSH_MUTATIONS_EVENT,
  DEVICE_REVOKED_EVENT,
  calculateRetryBackoffMs,
  getMutationQueue,
  saveMutationQueue,
  enqueueMutation,
  removeConfirmedMutations
} from './sync/syncManager';

import { 
  verifyCentralCredentials,
  updateCentralPin
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
  QueuedMutation,
  SyncConflictItem,
  FifoColorsMap,
  FifoMonthColor,
  ChatMessage
} from './types';
import { generateAuthoritativeId } from './lib/idGenerator';

import { 
  DEFAULT_FIFO_COLORS_BY_MONTH,
  getFifoColorForDate,
  normalizeFifoColor
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
import AuditViewerModule from './components/AuditViewerModule';
import VersionUpdateBanner from './components/VersionUpdateBanner';

import {
  getCentralServerUrl,
  getCentralServerHost,
  getApiBaseUrl,
  getCentralWebSocketUrl,
  getAuthHeaders,
  getStoredSessionToken,
  sanitizeServerHost,
  isSecureHost as isSecureServerHost
} from './config/serverConfig';
import StartupDiagnosticsModal from './components/StartupDiagnosticsModal';
import { showPrintToast } from './utils/printDocument';
import { computeStockAlerts } from './utils/stockAlerts';
import logger from './lib/logger';

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

function getDefaultServerAddress(): string {
  return getCentralServerHost();
}

function wsOpen(ws: WebSocket | null): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export default function App() {
  const [view, setView] = useState<string>('dashboard');
  const [showDesktopInstallModal, setShowDesktopInstallModal] = useState<boolean>(false);
  const [showMobileInstallModal, setShowMobileInstallModal] = useState<boolean>(false);

  // Quick Record Lookup via Header Barcode / QR Scanner
  const [showQuickLookupScanner, setShowQuickLookupScanner] = useState<boolean>(false);
  const [showQuickLookupResults, setShowQuickLookupResults] = useState<boolean>(false);
  const [quickLookupTerm, setQuickLookupTerm] = useState<string>('');

  const handleQuickLookupScan = (scannedCode: string) => {
    const clean = scannedCode.trim();
    if (!clean) return;
    setQuickLookupTerm(clean);
    setShowQuickLookupScanner(false);
    setShowQuickLookupResults(true);
  };

  const handleNavigateFromLookup = (moduleView: string, _filterQuery?: string) => {
    setView(moduleView);
    setShowQuickLookupResults(false);
  };

  // Keyboard shortcut (Alt+S or Ctrl+B) to trigger barcode scanner
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcut if typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (!(e.altKey && e.key.toLowerCase() === 's')) {
          return;
        }
      }
      if ((e.altKey && e.key.toLowerCase() === 's') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b')) {
        e.preventDefault();
        setShowQuickLookupScanner(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // Live snapshot ref & last-known server versions map for expectedVersion optimistic concurrency
  const collectionsRef = useRef<Record<string, any[]>>({
    stocks: [],
    receiving: [],
    returns: [],
    recycling: [],
    issuances: [],
    deliveries: [],
    envLogs: [],
    forkliftChecks: [],
    registries: []
  });
  collectionsRef.current = {
    stocks,
    receiving,
    returns,
    recycling,
    issuances,
    deliveries,
    envLogs,
    forkliftChecks,
    registries
  };
  const lastKnownVersionsRef = useRef<Map<string, number>>(new Map());
  const inFlightWsMutationsRef = useRef<Map<string, { mutation: QueuedMutation; timer: any }>>(new Map());
  const isFlushingMutationsRef = useRef<boolean>(false);

  const recordKnownVersions = (colName: string, items: any[]) => {
    if (!colName || !Array.isArray(items)) return;
    for (const item of items) {
      if (!item) continue;
      const id = String(item.id || item.record_id || '').trim();
      if (id && item.version !== undefined && item.version !== null && !Number.isNaN(Number(item.version))) {
        lastKnownVersionsRef.current.set(`${colName}:${id}`, Number(item.version));
      }
    }
  };

  const getExpectedVersionForRecord = (colName: string, recordId: string, fallbackRecord?: any): number => {
    const mapVer = lastKnownVersionsRef.current.get(`${colName}:${recordId}`);
    if (mapVer !== undefined) return mapVer;
    const list = collectionsRef.current[colName] || [];
    const existing = list.find((item: any) => item && String(item.id || item.record_id) === String(recordId));
    if (existing && existing.version !== undefined && existing.version !== null) {
      return Number(existing.version);
    }
    if (fallbackRecord && fallbackRecord.version !== undefined && fallbackRecord.version !== null) {
      return Number(fallbackRecord.version);
    }
    return 0;
  };

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
        logger.debug(`[AUTH STARTUP] Restoring persistent login session for user: ${user} (${empId || 'NO_ID'}), role: ${role || 'NO_ROLE'}`);
      } else {
        logger.debug(`[AUTH STARTUP] Landing on login screen (storedLoggedIn=${stored}, storedUser=${user || 'NONE'})`);
      }
      return shouldRestore;
    } catch (e) {
      console.warn('[AUTH STARTUP] Error reading stored session from localStorage:', e);
      return false;
    }
  });

  // Central Database modal state
  const [showCentralDatabaseModal, setShowCentralDatabaseModal] = useState<boolean>(false);
  // Super Admin Server Automated Backups modal state
  const [showBackupsModal, setShowBackupsModal] = useState<boolean>(false);
  // Startup Diagnostics and Multi-PC Real-Time Sync Verifier modal state
  const [showStartupDiagnosticsModal, setShowStartupDiagnosticsModal] = useState<boolean>(false);
  // User Logout Confirmation modal state
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState<boolean>(false);
  // Signal to open Dashboard Overview unified low-stock & shelf-life alerts popup
  const [openDashboardAlertsSignal, setOpenDashboardAlertsSignal] = useState<number>(0);
  const dashboardAlertCount = useMemo(() => computeStockAlerts(stocks).totalCount, [stocks]);

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
  const socketRef = useRef<WebSocket | null>(null);
  const [isDeviceRevoked, setIsDeviceRevoked] = useState<boolean>(false);
  const isDeviceRevokedRef = useRef<boolean>(false);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflictItem[]>(() => {
    try {
      return getMutationQueue()
        .filter((m) => m.status === 'CONFLICT')
        .map((m) => ({
          id: m.id,
          collection: m.collection,
          recordId: String(m.recordId || m.record?.id || ''),
          type: m.type === 'delete' ? 'delete' : 'upsert',
          localRecord: m.record,
          currentServerRecord: m.currentServerRecord,
          expectedVersion: m.expectedVersion,
          serverVersion: m.currentServerRecord?.version !== undefined ? Number(m.currentServerRecord.version) : undefined,
          author: m.author,
          actionDesc: m.actionDesc,
          error: m.lastError || 'VERSION_CONFLICT: Newer revision exists on server.',
          timestamp: m.timestamp
        }));
    } catch {
      return [];
    }
  });
  const [showConflictsModal, setShowConflictsModal] = useState<boolean>(false);
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [activePresence, setActivePresence] = useState<ActivePresenceUser[]>([]);
  const [wsPresence, setWsPresence] = useState<ActivePresenceUser[]>([]);
  const [localTabsPresence, setLocalTabsPresence] = useState<ActivePresenceUser[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isManualSyncing, setIsManualSyncing] = useState<boolean>(false);
  const serverAddress = getCentralServerHost();
  const [wsLatency, setWsLatency] = useState<number | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<Date>(new Date());
  const [liveSyncToast, setLiveSyncToast] = useState<{ id: string; author: string; action: string; time: string } | null>(null);
  const [showActiveUsersModal, setShowActiveUsersModal] = useState<boolean>(false);
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false);
  const [newVersionString, setNewVersionString] = useState<string>('');
  const [installedDesktopVersion, setInstalledDesktopVersion] = useState<string>(() => {
    try {
      const electronLocalVer = typeof window !== 'undefined' && window.electronAPI?.localVersion
        ? String(window.electronAPI.localVersion).replace(/^v/i, '').trim()
        : '';
      if (electronLocalVer) return electronLocalVer;
      return localStorage.getItem('juwei_wms_installed_version') || '';
    } catch (e) {
      return '';
    }
  });
  const installedDesktopVersionRef = useRef<string>(installedDesktopVersion);
  useEffect(() => {
    installedDesktopVersionRef.current = installedDesktopVersion;
  }, [installedDesktopVersion]);

  const [appVersion, setAppVersion] = useState<string>(() => {
    const electronLocalVer = typeof window !== 'undefined' && window.electronAPI?.localVersion
      ? String(window.electronAPI.localVersion).replace(/^v/i, '').trim()
      : '';
    const buildVer = typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__
      ? String(__APP_VERSION__).replace(/^v/i, '').trim()
      : '';
    if (electronLocalVer && buildVer) {
      const eParts = electronLocalVer.split('.').map(n => parseInt(n, 10) || 0);
      const bParts = buildVer.split('.').map(n => parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(eParts.length, bParts.length); i++) {
        if ((eParts[i] || 0) > (bParts[i] || 0)) return electronLocalVer;
        if ((eParts[i] || 0) < (bParts[i] || 0)) return buildVer;
      }
      return electronLocalVer;
    }
    return electronLocalVer || buildVer;
  });
  const updateAvailableRef = useRef<boolean>(false);

  // Accurate semver comparator: returns true ONLY if candidate is strictly newer than current
  const isNewerVersion = (candidateVer?: string, currentVer?: string): boolean => {
    if (!candidateVer || !currentVer) return false;
    const s = String(candidateVer).replace(/^v/i, '').trim();
    const c = String(currentVer).replace(/^v/i, '').trim();
    if (!s || !c || s === c) return false;

    const sParts = s.split(/[.-]/).map(n => parseInt(n, 10) || 0);
    const cParts = c.split(/[.-]/).map(n => parseInt(n, 10) || 0);
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
    
    const isCompromised = !!user?.isPinCompromised || !!existing?.isPinCompromised;

    const formattedUser: RegisteredAccount = {
      username: (user.username || existing?.username || (empId === 'JPMP-002' ? 'ALDRIN BANAWA' : 'OPERATOR')).toUpperCase(),
      role: (user.role || existing?.role || (empId === 'JPMP-002' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE CLERK')).toUpperCase(),
      employeeId: empId,
      phoneNumber: user.phoneNumber || user.phone_number || existing?.phoneNumber || (empId === 'JPMP-002' ? '+639669858846' : ''),
      permission: user.permission || existing?.permission || (empId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
      hasPin: Boolean(user?.hasPin ?? existing?.hasPin ?? true),
      mustChangePin: Boolean(user?.mustChangePin ?? existing?.mustChangePin),
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
        Boolean(existing.hasPin) === Boolean(formattedUser.hasPin) &&
        Boolean(existing.mustChangePin) === Boolean(formattedUser.mustChangePin) &&
        Boolean(existing.isPinCompromised) === Boolean(formattedUser.isPinCompromised) &&
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
                case 'fifoColorsByMonth': {
                  if (data && typeof data === 'object') {
                    const merged = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...data };
                    setFifoColorsByMonth(merged);
                    try { localStorage.setItem('juwei_wms_fifoColorsByMonth', JSON.stringify(merged)); } catch (e) {}
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
              recordKnownVersions(collection, [record]);
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

  const initialBuildIdRef = useRef<number | string | null>(
    typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null
  );
  const lastBuildInfoCheckRef = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;
    const BUILD_INFO_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
    const isFileOrigin = typeof window !== 'undefined' && window.location?.protocol === 'file:';
    const isElectronEnv = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

    // Query installed desktop version from Electron immediately if running inside Electron wrapper
    if (isElectronEnv && window.electronAPI?.localVersion) {
      const syncLocal = String(window.electronAPI.localVersion).replace(/^v/i, '').trim();
      if (syncLocal) {
        installedDesktopVersionRef.current = syncLocal;
        setInstalledDesktopVersion(syncLocal);
        setAppVersion((prev) => (isNewerVersion(syncLocal, prev) || !prev ? syncLocal : prev));
        try {
          localStorage.setItem('juwei_wms_installed_version', syncLocal);
        } catch (e) {}
      }
    }

    if (isElectronEnv && window.electronAPI?.getAppVersion) {
      try {
        Promise.resolve(window.electronAPI.getAppVersion()).then((ver) => {
          if (!isMounted) return;
          if (ver) {
            const cleanVer = String(ver).replace(/^v/i, '').trim();
            if (!cleanVer) return;
            logger.debug('[JUWEI WMS] Installed Electron Desktop version:', cleanVer);
            installedDesktopVersionRef.current = cleanVer;
            setInstalledDesktopVersion(cleanVer);
            if (isFileOrigin) {
              setAppVersion(cleanVer);
            }
            try {
              localStorage.setItem('juwei_wms_installed_version', cleanVer);
            } catch (e) {}
          }
        }).catch(() => {});
      } catch (e) {}
    }

    // Periodic background 'build-info.json' check (runs on mount and every 60 minutes)
    const fetchBuildInfo = async () => {
      if (!isMounted) return;
      lastBuildInfoCheckRef.current = Date.now();
      try {
        const centralUrl = getCentralServerUrl();
        const endpoints = (isElectronEnv || isFileOrigin)
          ? [
              ...(centralUrl ? [`${centralUrl}/build-info.json`, `${centralUrl}/api/build-info`] : []),
              './build-info.json'
            ]
          : [
              '/build-info.json',
              '/api/build-info',
              ...(centralUrl ? [`${centralUrl}/build-info.json`, `${centralUrl}/api/build-info`] : [])
            ];
        const uniqueEndpoints = Array.from(new Set(endpoints.filter(Boolean)));
        for (const ep of uniqueEndpoints) {
          try {
            const res = await fetch(ep, { cache: 'no-store', headers: { Accept: 'application/json' } });
            if (res.ok) {
              const data = await res.json();
              if (!isMounted) return;

              const bundleVer = data?.bundleVersion ? String(data.bundleVersion).replace(/^v/i, '').trim() : '';
              const latestVer = (data?.latestGitHubVersion || data?.version)
                ? String(data.latestGitHubVersion || data.version).replace(/^v/i, '').trim()
                : '';
              const buildTimeVer = typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__
                ? String(__APP_VERSION__).replace(/^v/i, '').trim()
                : '';
              const desktopVer = (installedDesktopVersionRef.current || '').replace(/^v/i, '').trim();

              // Display version:
              // - In Electron local bundle (file://): show the installed EXE's version
              // - In Google AI Studio / Web browser: sync directly to latest GitHub release version (latestVer)
              const displayVer = isFileOrigin
                ? (desktopVer || buildTimeVer || bundleVer || latestVer)
                : (latestVer || bundleVer || buildTimeVer || desktopVer);

              const comparisonInstalledVer = isElectronEnv
                ? (desktopVer || buildTimeVer)
                : (() => {
                    try {
                      return (localStorage.getItem('juwei_wms_web_acknowledged_version') || '').replace(/^v/i, '').trim() || buildTimeVer;
                    } catch {
                      return buildTimeVer;
                    }
                  })();

              if (displayVer) {
                setAppVersion((prev) => (prev !== displayVer ? displayVer : prev));
                if (typeof window !== 'undefined' && window.electronAPI?.updateAppVersion) {
                  window.electronAPI.updateAppVersion(displayVer);
                }
                if (isElectronEnv && desktopVer) {
                  try {
                    localStorage.setItem('juwei_wms_installed_version', desktopVer);
                  } catch (e) {}
                }
              }

              const remoteBuildId = data?.buildId ? Number(data.buildId) : 0;
              if (remoteBuildId && !initialBuildIdRef.current) {
                initialBuildIdRef.current = remoteBuildId;
              }
              const hasNewBuildId = Boolean(
                !isFileOrigin &&
                remoteBuildId &&
                initialBuildIdRef.current &&
                remoteBuildId > Number(initialBuildIdRef.current)
              );

              const hasNewerSemver = Boolean(
                latestVer && comparisonInstalledVer && isNewerVersion(latestVer, comparisonInstalledVer)
              );

              if (hasNewerSemver || hasNewBuildId) {
                const targetBannerVer = latestVer || bundleVer || buildTimeVer;
                let dismissedVer = '';
                try {
                  dismissedVer = (localStorage.getItem('juwei_wms_dismissed_version') || '').replace(/^v/i, '').trim();
                } catch (e) {}
                if (!targetBannerVer || dismissedVer !== targetBannerVer) {
                  updateAvailableRef.current = true;
                  setUpdateAvailable(true);
                  if (targetBannerVer) {
                    setNewVersionString(targetBannerVer);
                  }
                }
              } else if (comparisonInstalledVer && latestVer && !isNewerVersion(latestVer, comparisonInstalledVer)) {
                try {
                  localStorage.removeItem('juwei_wms_dismissed_version');
                } catch (e) {}
                if (updateAvailableRef.current) {
                  updateAvailableRef.current = false;
                  setUpdateAvailable(false);
                  setNewVersionString('');
                }
              }
              break;
            }
          } catch (e) {}
        }
      } catch (e) {}
    };

    fetchBuildInfo();
    const buildInfoTimer = setInterval(fetchBuildInfo, BUILD_INFO_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(buildInfoTimer);
    };
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
  const [newlyRegisteredUser, setNewlyRegisteredUser] = useState<RegisteredAccount | null>(null);
  const [showNewlyRegisteredPin, setShowNewlyRegisteredPin] = useState<boolean>(false);
  const [confirmActionApp, setConfirmActionApp] = useState<ConfirmActionConfig | null>(null);
  const [oneTimeSetupPinNotice, setOneTimeSetupPinNotice] = useState<{ employeeId: string; initialPin: string } | null>(null);
  const [pendingFirstLoginPinChange, setPendingFirstLoginPinChange] = useState<{ user: any; currentPin: string } | null>(null);
  const [firstLoginNewPin, setFirstLoginNewPin] = useState<string>('');
  const [firstLoginConfirmPin, setFirstLoginConfirmPin] = useState<string>('');
  const [firstLoginPinError, setFirstLoginPinError] = useState<string>('');
  const [isSavingFirstLoginPin, setIsSavingFirstLoginPin] = useState<boolean>(false);
  
  const superAdminAccount: RegisteredAccount = { 
    username: 'ALDRIN BANAWA', 
    role: 'SUPER ADMINISTRATOR', 
    employeeId: 'JPMP-002', 
    phoneNumber: '+639669858846',
    permission: 'FULL_ACCESS', 
    hasPin: true,
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
      const persistentDevId = getPersistentDeviceId();
      const res = await fetch(`${baseUrl}/api/roles`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId,
          'x-employee-id': currentEmployeeId || ''
        }),
        body: JSON.stringify({
          roles: cleaned,
          device_id: persistentDevId,
          author: currentUser
        })
      });
      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson?.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
        }
      }
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
      const persistentDevId = getPersistentDeviceId();
      const res = await fetch(`${baseUrl}/api/categories`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId,
          'x-employee-id': currentEmployeeId || ''
        }),
        body: JSON.stringify({
          action: renameData ? 'rename' : 'set',
          categories: cleaned,
          oldCat: renameData?.oldCat,
          newCat: renameData?.newCat,
          device_id: persistentDevId,
          author: currentUser
        })
      });
      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson?.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
        }
      }
    } catch (e) {
      console.warn('Failed to sync categories via REST fallback:', e);
    }
  };

  // FIFO Color Coding Calendar (12 Months) centrally managed and synced
  const [fifoColorsByMonth, setFifoColorsByMonth] = useState<FifoColorsMap>(() => {
    try {
      const saved = localStorage.getItem('juwei_wms_fifoColorsByMonth');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...parsed };
        }
      }
    } catch (e) {}
    return { ...DEFAULT_FIFO_COLORS_BY_MONTH };
  });

  const handleUpdateFifoColors = async (
    updated: FifoColorsMap | { month: number; color: FifoMonthColor }
  ) => {
    let nextMap: FifoColorsMap;
    if ('month' in updated && 'color' in updated) {
      nextMap = {
        ...fifoColorsByMonth,
        [updated.month]: updated.color
      };
    } else {
      nextMap = {
        ...DEFAULT_FIFO_COLORS_BY_MONTH,
        ...(updated as FifoColorsMap)
      };
    }

    setFifoColorsByMonth(nextMap);
    try {
      localStorage.setItem('juwei_wms_fifoColorsByMonth', JSON.stringify(nextMap));
    } catch (e) {}

    // Broadcast cross-tab immediately
    try {
      syncChannelRef.current?.postMessage({
        type: 'collection_updated',
        collection: 'fifoColorsByMonth',
        data: nextMap
      });
    } catch (e) {}

    // Send WebSocket notification to central server
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'update_fifo_colors',
          fifoColorsByMonth: nextMap,
          author: currentUser || 'Super Admin',
          permission: currentPermission,
          timestamp: new Date().toISOString()
        }));
      } catch (e) {}
    }

    // REST API persistence fallback
    try {
      const baseUrl = getApiBaseUrl();
      const persistentDevId = getPersistentDeviceId();
      const res = await fetch(`${baseUrl}/api/fifo-colors`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId,
          'x-employee-id': currentEmployeeId || ''
        }),
        body: JSON.stringify({
          fifoColorsByMonth: nextMap,
          device_id: persistentDevId,
          author: currentUser,
          employeeId: currentEmployeeId
        })
      });
      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson?.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
        }
      }
    } catch (e) {
      console.warn('Failed to sync FIFO colors via REST fallback:', e);
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
      showPrintToast("UNAUTHORIZED: Only Super Administrator (JPMP-002) is authorized to wipe operator accounts.", 'error');
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
    const persistentDevId = getPersistentDeviceId();
    fetch(`${baseUrl}/api/reset-database`, {
      method: 'POST',
      headers: getAuthHeaders({
        'Content-Type': 'application/json',
        'x-device-id': persistentDevId,
        'x-user-employee-id': currentEmployeeId || 'JPMP-002',
        'x-user-role': currentRole || 'SUPER ADMINISTRATOR'
      }),
      body: JSON.stringify({
        employeeId: currentEmployeeId || 'JPMP-002',
        role: currentRole || 'SUPER ADMINISTRATOR',
        device_id: persistentDevId,
        confirmed: true,
        author: `${currentUser || 'ALDRIN BANAWA'} (${currentEmployeeId || 'JPMP-002'})`,
        wipeUsers: true
      })
    }).then(async (res) => {
      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson?.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
        }
      }
    }).catch(() => {});
    // Also log out any active session if we reset the accounts
    handleLogout();
  };

  // Normalizer helper for records coming from central database, REST, and WebSocket
  const normalizeRecords = (colName: string, items: any[]): any[] => {
    if (!Array.isArray(items)) return [];
    const normalized = items.map((r: any) => {
      if (!r || typeof r !== 'object') return r;
      const versionMeta = {
        ...(r.version !== undefined && r.version !== null ? { version: Number(r.version) } : {}),
        ...(r.updated_at ? { updated_at: r.updated_at } : {}),
        ...(r.reset_version !== undefined && r.reset_version !== null ? { reset_version: Number(r.reset_version) } : {})
      };
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
            fifoColor: normalizeFifoColor(r.fifoColor || r.fifo_color, r.receivedDate || r.received_date, fifoColorsByMonth),
            status: r.status || 'APPROVED',
            resinSackRisk: Boolean(r.resinSackRisk || r.resin_sack_risk),
            shelfLifeDays: r.shelfLifeDays || r.shelf_life_days ? Number(r.shelfLifeDays || r.shelf_life_days) : undefined,
            customer: r.customer,
            reorderMin: r.reorderMin || r.reorder_min ? Number(r.reorderMin || r.reorder_min) : undefined,
            remarks: r.remarks,
            bom: r.bom || [],
            ...versionMeta
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
            fifoColorCode: normalizeFifoColor(r.fifoColorCode || r.fifo_color_code || r.fifoColor, r.receivedDate || r.received_date || r.date, fifoColorsByMonth),
            bom: r.bom || [],
            autoDeductBom: Boolean(r.autoDeductBom || r.auto_deduct_bom),
            customer: r.customer,
            ...versionMeta
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
            returnSlipFormNumber: r.returnSlipFormNumber || r.return_slip_form_number || '',
            ...versionMeta
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
            logSheetNumber: r.logSheetNumber || r.log_sheet_number || '',
            ...versionMeta
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
            receivedBy: r.receivedBy || r.received_by || 'Line Operator',
            ...versionMeta
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
            loadedBy: r.loadedBy || r.loaded_by,
            ...versionMeta
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
            recordedBy: r.recordedBy || r.recorded_by || 'Inspector',
            ...versionMeta
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
            remarks: r.remarks,
            ...versionMeta
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
            location: r.location,
            ...versionMeta
          };
        default:
          return r;
      }
    });
    recordKnownVersions(colName, normalized);
    return normalized;
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

  // Offline Mutations Queue Storage & Processor (single queue: juwei_wms_mutation_queue_v1)
  const getPendingMutations = (): QueuedMutation[] => {
    return getMutationQueue();
  };

  const savePendingMutations = (mutations: QueuedMutation[]) => {
    saveMutationQueue(mutations);
  };

  const applyConfirmedRecordToState = (collection: string, confirmedRecord: any) => {
    if (!collection || !confirmedRecord || !confirmedRecord.id) return;
    recordKnownVersions(collection, [confirmedRecord]);
    const normalized = normalizeRecords(collection, [confirmedRecord])[0] || confirmedRecord;
    const upsertFn = (prev: any[]) => {
      const idx = prev.findIndex(it => it.id === normalized.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = normalized;
        return next;
      }
      return [normalized, ...prev];
    };
    switch (collection) {
      case 'stocks': setStocks(upsertFn); break;
      case 'receiving': setReceiving(upsertFn); break;
      case 'returns': setReturns(upsertFn); break;
      case 'recycling': setRecycling(upsertFn); break;
      case 'issuances': setIssuances(upsertFn); break;
      case 'deliveries': setDeliveries(upsertFn); break;
      case 'envLogs': setEnvLogs(upsertFn); break;
      case 'forkliftChecks': setForkliftChecks(upsertFn); break;
      case 'registries': setRegistries(upsertFn); break;
    }
  };

  const removeRecordFromState = (collection: string, id: string) => {
    if (!collection || !id) return;
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
  };

  const handleDeviceRevoked = (targetDeviceId?: string) => {
    const myDevId = getPersistentDeviceId();
    if (targetDeviceId && targetDeviceId.trim() !== '' && targetDeviceId.trim() !== myDevId) {
      return;
    }
    if (!isDeviceRevokedRef.current) {
      isDeviceRevokedRef.current = true;
      setIsDeviceRevoked(true);
      setConnectionStatus('disconnected');
      syncManager.markDeviceRevoked();
      for (const [, entry] of inFlightWsMutationsRef.current.entries()) {
        clearTimeout(entry.timer);
      }
      inFlightWsMutationsRef.current.clear();
      if (socketRef.current) {
        try { socketRef.current.close(); } catch {}
        socketRef.current = null;
      }
      setSocket(null);
      showPrintToast('This computer was removed from the system', 'error');
    }
  };

  const recordSyncConflict = (conflictInput: {
    id?: string;
    collection: string;
    recordId: string;
    type: 'upsert' | 'delete';
    localRecord?: any;
    currentServerRecord?: any;
    expectedVersion?: number;
    author?: string;
    actionDesc?: string;
    error: string;
  }) => {
    const mutationId = conflictInput.id || `MUT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const serverRec = conflictInput.currentServerRecord;
    const serverVersion = serverRec?.version !== undefined ? Number(serverRec.version) : undefined;
    if (serverRec && serverRec.id) {
      recordKnownVersions(conflictInput.collection, [serverRec]);
    }

    const queue = getPendingMutations();
    const existingIdx = queue.findIndex((m) => m.id === mutationId);
    const queuedConflict: QueuedMutation = {
      ...(existingIdx >= 0 ? queue[existingIdx] : {}),
      id: mutationId,
      type: conflictInput.type,
      collection: conflictInput.collection,
      record: conflictInput.localRecord ?? (existingIdx >= 0 ? queue[existingIdx].record : undefined),
      recordId: conflictInput.recordId,
      expectedVersion: conflictInput.expectedVersion ?? (existingIdx >= 0 ? queue[existingIdx].expectedVersion : undefined),
      author: conflictInput.author || currentUser || 'Operator',
      actionDesc: conflictInput.actionDesc,
      timestamp: existingIdx >= 0 ? queue[existingIdx].timestamp : Date.now(),
      reset_version: Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0,
      status: 'CONFLICT',
      lastError: conflictInput.error,
      currentServerRecord: serverRec
    };
    if (existingIdx >= 0) {
      queue[existingIdx] = queuedConflict;
    } else {
      queue.push(queuedConflict);
    }
    savePendingMutations(queue);

    const conflictObj: SyncConflictItem = {
      id: mutationId,
      collection: conflictInput.collection,
      recordId: conflictInput.recordId,
      type: conflictInput.type,
      localRecord: queuedConflict.record,
      currentServerRecord: serverRec,
      expectedVersion: queuedConflict.expectedVersion,
      serverVersion,
      author: queuedConflict.author,
      actionDesc: queuedConflict.actionDesc,
      error: conflictInput.error,
      timestamp: queuedConflict.timestamp
    };

    setSyncConflicts((prev) => {
      const idx = prev.findIndex((c) => c.id === mutationId || (c.collection === conflictInput.collection && c.recordId === conflictInput.recordId));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = conflictObj;
        return next;
      }
      return [conflictObj, ...prev];
    });
    showPrintToast(`Sync conflict on ${conflictInput.collection} (${conflictInput.recordId}). Open Conflicts to review.`, 'warning');
  };

  const flushPendingMutationsQueue = async (forceRetry = false) => {
    if (isDeviceRevokedRef.current || isFlushingMutationsRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
    const allMutations = getPendingMutations();
    const now = Date.now();
    const mutationsToSend = allMutations.filter(
      (m) =>
        (m.type === 'upsert' || m.type === 'delete') &&
        m.status !== 'CONFLICT' &&
        (forceRetry || !m.nextRetryAt || m.nextRetryAt <= now)
    );
    if (mutationsToSend.length === 0) return;

    isFlushingMutationsRef.current = true;
    const baseUrl = getApiBaseUrl();
    const persistentDevId = getPersistentDeviceId();
    const effectiveAuthor = currentUser || 'OPERATOR';
    const effectiveUserId = currentEmployeeId ? `USR-${currentEmployeeId}` : `USR-${effectiveAuthor}`;
    const batchPayload = {
      mutations: mutationsToSend,
      reset_version: currentResetVer,
      device_id: persistentDevId,
      author: effectiveAuthor,
      employeeId: currentEmployeeId,
      user_id: effectiveUserId
    };

    try {
      const res = await fetch(`${baseUrl}/api/sync/batch`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId,
          'x-employee-id': currentEmployeeId || ''
        }),
        body: JSON.stringify(batchPayload)
      });

      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
        }
        return;
      }

      if (res.status === 409) {
        const errJson = await res.json().catch(() => ({}));
        const nextQueue = getPendingMutations().map((q) => {
          if (!mutationsToSend.some((m) => m.id === q.id)) return q;
          const nextRetry = (q.retryCount || 0) + 1;
          return {
            ...q,
            status: 'FAILED' as const,
            retryCount: nextRetry,
            nextRetryAt: Date.now() + calculateRetryBackoffMs(nextRetry),
            lastError: errJson.error || 'Batch sync rejected with 409'
          };
        });
        savePendingMutations(nextQueue);
        return;
      }

      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        const results: any[] = Array.isArray(json.results) ? json.results : [];
        if (results.length > 0) {
          const confirmedIds: string[] = [];
          const resultById = new Map<string, any>();
          for (const r of results) {
            const key = String(r.mutationId || r.id || '');
            if (key) resultById.set(key, r);
          }

          let currentQueue = getPendingMutations();
          let queueModified = false;

          for (const mut of mutationsToSend) {
            const r = resultById.get(mut.id);
            if (!r) continue;
            if (r.success) {
              confirmedIds.push(mut.id);
              if (r.record && r.collection) {
                applyConfirmedRecordToState(r.collection, r.record);
              } else if (mut.type === 'delete' && mut.collection) {
                const delId = String(mut.recordId || r.recordId || '');
                if (delId) lastKnownVersionsRef.current.delete(`${mut.collection}:${delId}`);
              }
            } else if (r.status === 403 && r.error === 'DEVICE_REVOKED') {
              handleDeviceRevoked(persistentDevId);
              return;
            } else if (r.status === 409) {
              recordSyncConflict({
                id: mut.id,
                collection: mut.collection,
                recordId: String(mut.recordId || mut.record?.id || r.recordId || ''),
                type: mut.type === 'delete' ? 'delete' : 'upsert',
                localRecord: mut.record,
                currentServerRecord: r.currentRecord,
                expectedVersion: mut.expectedVersion,
                author: mut.author,
                actionDesc: mut.actionDesc,
                error: r.error || 'VERSION_CONFLICT: Newer revision exists on server.'
              });
              currentQueue = getPendingMutations();
            } else {
              const nextRetry = (mut.retryCount || 0) + 1;
              currentQueue = currentQueue.map((q) =>
                q.id === mut.id
                  ? {
                      ...q,
                      status: 'FAILED' as const,
                      retryCount: nextRetry,
                      nextRetryAt: Date.now() + calculateRetryBackoffMs(nextRetry),
                      lastError: r.error || `Server status ${r.status}`
                    }
                  : q
              );
              queueModified = true;
            }
          }

          if (queueModified) {
            savePendingMutations(currentQueue);
          }
          if (confirmedIds.length > 0) {
            removeConfirmedMutations(confirmedIds);
          }
        }
        return;
      }

      // Non-OK response: keep in queue and apply exponential backoff retry
      const nextQueue = getPendingMutations().map((q) => {
        if (!mutationsToSend.some((m) => m.id === q.id)) return q;
        const nextRetry = (q.retryCount || 0) + 1;
        return {
          ...q,
          status: 'FAILED' as const,
          retryCount: nextRetry,
          nextRetryAt: Date.now() + calculateRetryBackoffMs(nextRetry),
          lastError: `Server returned status ${res.status}`
        };
      });
      savePendingMutations(nextQueue);
    } catch (e: any) {
      const nextQueue = getPendingMutations().map((q) => {
        if (!mutationsToSend.some((m) => m.id === q.id)) return q;
        const nextRetry = (q.retryCount || 0) + 1;
        return {
          ...q,
          status: 'FAILED' as const,
          retryCount: nextRetry,
          nextRetryAt: Date.now() + calculateRetryBackoffMs(nextRetry),
          lastError: e?.message || 'Network failure'
        };
      });
      savePendingMutations(nextQueue);
    } finally {
      isFlushingMutationsRef.current = false;
    }
  };

  // Clears stale local read caches on reset without silently wiping unconfirmed offline mutations
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
      localStorage.removeItem('juwei_wms_deleted_records_v1');
      localStorage.removeItem('juwei_wms_draft_receiving');
      localStorage.removeItem('juwei_wms_draft_receiving_return');
      localStorage.removeItem('juwei_wms_draft_issuance');
    } catch (e) {}

    deletedRecordIds.current.clear();
    recentlyMutatedRecords.current.clear();
    lastKnownVersionsRef.current.clear();
  };

  // Directly sets in-memory state to pure authoritative central database data without merging stale leftovers
  const applyAuthoritativeResetState = (dataPayload: any, _activeUsersList?: string[], activePresenceList?: ActivePresenceUser[]) => {
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

    setStocks(prev => reconcileCollection('stocks', prev, normalizeRecords('stocks', Array.isArray(s) ? s : [])));
    setReceiving(prev => reconcileCollection('receiving', prev, normalizeRecords('receiving', Array.isArray(rc) ? rc : [])));
    setReturns(prev => reconcileCollection('returns', prev, normalizeRecords('returns', Array.isArray(rt) ? rt : [])));
    setRecycling(prev => reconcileCollection('recycling', prev, normalizeRecords('recycling', Array.isArray(cy) ? cy : [])));
    setIssuances(prev => reconcileCollection('issuances', prev, normalizeRecords('issuances', Array.isArray(is) ? is : [])));
    setDeliveries(prev => reconcileCollection('deliveries', prev, normalizeRecords('deliveries', Array.isArray(d) ? d : [])));
    setEnvLogs(prev => reconcileCollection('envLogs', prev, normalizeRecords('envLogs', Array.isArray(e) ? e : [])));
    setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, normalizeRecords('forkliftChecks', Array.isArray(f) ? f : [])));
    setRegistries(prev => reconcileCollection('registries', prev, normalizeRecords('registries', Array.isArray(reg) ? reg : [])));

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
    if (dataPayload.fifoColorsByMonth && typeof dataPayload.fifoColorsByMonth === 'object') {
      const merged = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...dataPayload.fifoColorsByMonth };
      setFifoColorsByMonth(merged);
      try { localStorage.setItem('juwei_wms_fifoColorsByMonth', JSON.stringify(merged)); } catch (e) {}
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
      showPrintToast("UNAUTHORIZED: Only Super Administrator (JPMP-002) is authorized to execute a complete global database reset.", 'error');
      return;
    }

    const baseUrl = getApiBaseUrl();
    const cleanAuthor = `${currentUser || 'ALDRIN BANAWA'} (${currentEmployeeId || 'JPMP-002'})`;

    let resetVer = Date.now();
    try {
      const persistentDevId = getPersistentDeviceId();
      const res = await fetch(`${baseUrl}/api/reset-database`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId,
          'x-user-employee-id': currentEmployeeId || 'JPMP-002',
          'x-user-role': currentRole || 'SUPER ADMINISTRATOR'
        }),
        body: JSON.stringify({
          employeeId: currentEmployeeId || 'JPMP-002',
          role: currentRole || 'SUPER ADMINISTRATOR',
          device_id: persistentDevId,
          confirmed: true,
          author: cleanAuthor,
          keepUsers: true
        })
      });
      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson?.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
          return;
        }
      }
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

  // Helper to reconcile incoming remote collections with local state cleanly without data loss or resurrection of stale mutations
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

    // Check for active unconfirmed local mutations (including in-flight WS writes) deduplicated by id
    const mutationMap = new Map<string, QueuedMutation>();
    for (const mut of getPendingMutations()) {
      if (mut && mut.collection === colName && mut.status !== 'CONFLICT') {
        mutationMap.set(mut.id, mut);
      }
    }
    for (const entry of inFlightWsMutationsRef.current.values()) {
      const mut = entry.mutation;
      if (mut && mut.collection === colName && !mutationMap.has(mut.id)) {
        mutationMap.set(mut.id, mut);
      }
    }
    const pendingMutations = Array.from(mutationMap.values());

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

    // 2. Overlay ONLY unconfirmed offline mutations whose base version is not older than the server's version
    for (const mut of pendingMutations) {
      const id = String(mut?.record?.id || mut?.record?.record_id || mut?.recordId || (mut as any)?.id || '');
      if (!id) continue;

      const serverRec = mergedMap.get(id);
      const serverVer = serverRec && serverRec.version !== undefined && serverRec.version !== null
        ? Number(serverRec.version)
        : undefined;
      const mutVer = mut.expectedVersion !== undefined && mut.expectedVersion !== null
        ? Number(mut.expectedVersion)
        : (mut.record?.version !== undefined && mut.record?.version !== null ? Number(mut.record.version) : undefined);

      // Never overlay a queued change that is older than the server's version of that record
      if (serverVer !== undefined && mutVer !== undefined && mutVer < serverVer) {
        continue;
      }

      if (mut.type === 'upsert' && mut.record && (mut.record.id || mut.record.record_id)) {
        if (!deletedSet.has(id)) {
          mergedMap.set(id, { ...(serverRec || {}), ...mut.record });
        }
      } else if (mut.type === 'delete') {
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
        Boolean(uA.hasPin) !== Boolean(uB.hasPin) ||
        Boolean(uA.mustChangePin) !== Boolean(uB.mustChangePin) ||
        Boolean(uA.isPinCompromised) !== Boolean(uB.isPinCompromised) ||
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

    // 1. Add all authoritative incoming users (server intentionally omits plain-text PINs)
    for (const u of incomingList) {
      if (!u || (!u.employeeId && !u.employee_id)) continue;
      const rawEmpId = String(u.employeeId || u.employee_id || '').toUpperCase().trim();
      const empId = rawEmpId.startsWith('JPMP-') ? rawEmpId : `JPMP-${rawEmpId.replace(/^EMP-/, '')}`;
      if (deletedSet.has(empId) && empId !== 'JPMP-002') continue;

      const isSuper = empId === 'JPMP-002';
      const localUser = safeCurrent.find(cu => (cu.employeeId || '').toUpperCase() === empId);
      const isCompromised = !!u.isPinCompromised;

      userMap.set(empId, {
        username: (u.username || localUser?.username || (isSuper ? 'ALDRIN BANAWA' : 'OPERATOR')).toUpperCase(),
        role: (u.role || localUser?.role || (isSuper ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE CLERK')).toUpperCase(),
        employeeId: empId,
        phoneNumber: u.phoneNumber || u.phone_number || localUser?.phoneNumber || (isSuper ? '+639669858846' : ''),
        permission: u.permission || localUser?.permission || (isSuper ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
        hasPin: Boolean(u?.hasPin ?? localUser?.hasPin ?? true),
        mustChangePin: Boolean(u?.mustChangePin ?? localUser?.mustChangePin),
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
        const isSuper = empId === 'JPMP-002';
        const { pin: _strippedPin, ...restCu } = cu;
        userMap.set(empId, { 
          ...restCu,
          hasPin: Boolean(cu.hasPin ?? true),
          isPinCompromised: !!cu.isPinCompromised,
          registeredBy: isSuper ? 'ROOT_SUPER_ADMIN (JPMP-002)' : (cu.registeredBy || 'JPMP-002 (ALDRIN BANAWA)'),
          registeredBySuperAdmin: true
        });
      }
    }

    // 3. Guarantee Super Admin JPMP-002 is always active, full access, and protected
    const admin = userMap.get('JPMP-002') || superAdminAccount;
    const { pin: _strippedAdminPin, ...restAdmin } = admin;
    userMap.set('JPMP-002', {
      ...superAdminAccount,
      ...restAdmin,
      employeeId: 'JPMP-002',
      username: admin.username || 'ALDRIN BANAWA',
      role: 'SUPER ADMINISTRATOR',
      permission: 'FULL_ACCESS',
      hasPin: true,
      isPinCompromised: Boolean(admin.isPinCompromised),
      mustChangePin: Boolean(admin.mustChangePin),
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
    if (isDeviceRevokedRef.current) return;
    try {
      const stationId = getStationId();
      const persistentDevId = getPersistentDeviceId();
      const installId = 'INS-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      localStorage.setItem('juwei_wms_install_id', installId);
      localStorage.setItem('juwei_wms_installed_at', new Date().toISOString());
      localStorage.setItem('juwei_wms_installed_flag_v1', 'true');
      localStorage.removeItem('juwei_wms_is_fresh_install');

      // Clear stale local read caches (never silently purge juwei_wms_mutation_queue_v1)
      const staleKeys = [
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
      lastKnownVersionsRef.current.clear();

      // 1. Fetch fresh authoritative state from central server
      const baseUrl = getApiBaseUrl();
      try {
        const res = await fetch(`${baseUrl}/api/terminal/fresh-install`, {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json', 'x-device-id': persistentDevId }),
          body: JSON.stringify({
            stationId,
            installId,
            deviceId: persistentDevId,
            username: currentUser || 'JUWEI OPERATOR',
            employeeId: currentEmployeeId || '',
            platform: getPlatformName()
          })
        });
        if (res.status === 403) {
          const errJson = await res.json().catch(() => ({}));
          if (errJson.error === 'DEVICE_REVOKED') {
            handleDeviceRevoked(persistentDevId);
            return;
          }
        }

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
            if (json.data.fifoColorsByMonth && typeof json.data.fifoColorsByMonth === 'object') {
              const merged = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...json.data.fifoColorsByMonth };
              setFifoColorsByMonth(merged);
              try { localStorage.setItem('juwei_wms_fifoColorsByMonth', JSON.stringify(merged)); } catch (e) {}
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
        logger.info('[JUWEI WMS] First-time launch / fresh install detected. Initializing clean station & syncing...');
        performFreshInstallAndSync(false);
      }
    } catch (e) {}
  }, []);

  // Helper to execute coordinated single-record upsert across ONE active transport path (WS if open, else HTTP, else Queue)
  const upsertRecordLocallyAndRemotely = (
    collection: string,
    record: any,
    actionDesc?: string,
    options?: { overrideExpectedVersion?: number; existingMutationId?: string }
  ) => {
    if (!record || !record.id || !collection) return;
    if (isDeviceRevokedRef.current) {
      showPrintToast('This computer was removed from the system', 'error');
      return;
    }

    unmarkRecordAsDeletedLocally(record.id);
    markRecordMutatedLocally(record.id);
    lastMutationTimes.current[collection] = Date.now();
    setLastSyncedTime(new Date());

    if (updateAvailableRef.current) {
      setBannerDismissed(false);
    }

    const persistentDevId = getPersistentDeviceId();
    const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
    const expectedVersion = options?.overrideExpectedVersion !== undefined
      ? options.overrideExpectedVersion
      : getExpectedVersionForRecord(collection, record.id, record);
    const effectiveAuthor = currentUser || 'Operator';
    const effectiveUserId = currentEmployeeId ? `USR-${currentEmployeeId}` : `USR-${effectiveAuthor}`;
    const clientMutationId = options?.existingMutationId || `MUT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // 0. Cross-tab BroadcastChannel (local browser tab sync only)
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'upsert_record',
          collection,
          record,
          author: effectiveAuthor,
          actionDesc,
          reset_version: currentResetVer
        });
      } catch (e) {}
    }

    const mutationRecord: QueuedMutation = {
      id: clientMutationId,
      type: 'upsert',
      collection,
      record,
      recordId: record.id,
      expectedVersion,
      author: effectiveAuthor,
      actionDesc,
      deviceId: persistentDevId,
      timestamp: Date.now(),
      reset_version: currentResetVer,
      status: 'PENDING',
      retryCount: 0
    };

    const wsPayload = {
      type: 'upsert_record',
      clientMutationId,
      collection,
      record,
      expectedVersion,
      author: effectiveAuthor,
      employeeId: currentEmployeeId,
      user_id: effectiveUserId,
      device_id: persistentDevId,
      actionDesc,
      reset_version: currentResetVer,
      record_id: record.id || record.record_id
    };

    // ONE WRITE PATH: 1) WebSocket if open
    const activeSocket = socketRef.current || socket;
    if (wsOpen(activeSocket)) {
      try {
        const ackTimeout = setTimeout(() => {
          const entry = inFlightWsMutationsRef.current.get(clientMutationId);
          if (!entry) return;
          inFlightWsMutationsRef.current.delete(clientMutationId);
          enqueueMutation({
            ...entry.mutation,
            status: 'FAILED',
            retryCount: 1,
            nextRetryAt: Date.now() + calculateRetryBackoffMs(1),
            lastError: 'WebSocket acknowledgment timeout'
          });
        }, 8000);
        inFlightWsMutationsRef.current.set(clientMutationId, { mutation: mutationRecord, timer: ackTimeout });
        activeSocket!.send(JSON.stringify(wsPayload));
        return;
      } catch (e) {
        const entry = inFlightWsMutationsRef.current.get(clientMutationId);
        if (entry) {
          clearTimeout(entry.timer);
          inFlightWsMutationsRef.current.delete(clientMutationId);
        }
        enqueueMutation({
          ...mutationRecord,
          status: 'FAILED',
          retryCount: 1,
          nextRetryAt: Date.now() + calculateRetryBackoffMs(1),
          lastError: 'WebSocket send failed'
        });
        return;
      }
    }

    // ONE WRITE PATH: 2) HTTP POST if online
    const isBrowserOnline = typeof navigator === 'undefined' || navigator.onLine;
    if (isBrowserOnline) {
      const baseUrl = getApiBaseUrl();
      fetch(`${baseUrl}/api/records/upsert`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId,
          'x-employee-id': currentEmployeeId || ''
        }),
        body: JSON.stringify({
          collection,
          record,
          expectedVersion,
          author: effectiveAuthor,
          employeeId: currentEmployeeId,
          user_id: effectiveUserId,
          device_id: persistentDevId,
          actionDesc,
          reset_version: currentResetVer,
          record_id: record.id || record.record_id
        })
      })
      .then(async (res) => {
        if (res.status === 403) {
          const errJson = await res.json().catch(() => ({}));
          if (errJson.error === 'DEVICE_REVOKED') {
            handleDeviceRevoked(persistentDevId);
            return;
          }
          showPrintToast(errJson.error || 'Permission denied', 'error');
          return;
        }
        if (res.status === 409) {
          const errJson = await res.json().catch(() => ({}));
          recordSyncConflict({
            id: clientMutationId,
            collection,
            recordId: String(record.id || record.record_id),
            type: 'upsert',
            localRecord: record,
            currentServerRecord: errJson.currentRecord || errJson.confirmedRecord,
            expectedVersion,
            author: effectiveAuthor,
            actionDesc,
            error: errJson.error || 'VERSION_CONFLICT: Newer revision exists on server.'
          });
          return;
        }
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          if (json.record) {
            applyConfirmedRecordToState(collection, json.record);
          }
          removeConfirmedMutations([clientMutationId]);
          return;
        }
        enqueueMutation({
          ...mutationRecord,
          status: 'FAILED',
          retryCount: 1,
          nextRetryAt: Date.now() + calculateRetryBackoffMs(1),
          lastError: `Server returned status ${res.status}`
        });
      })
      .catch((err) => {
        enqueueMutation({
          ...mutationRecord,
          status: 'FAILED',
          retryCount: 1,
          nextRetryAt: Date.now() + calculateRetryBackoffMs(1),
          lastError: err?.message || 'HTTP upsert failed'
        });
      });
      return;
    }

    // ONE WRITE PATH: 3) Offline Queue (juwei_wms_mutation_queue_v1)
    enqueueMutation(mutationRecord);
  };

  // Helper to execute coordinated deletion across ONE active transport path (WS if open, else HTTP, else Queue)
  const deleteRecordLocallyAndRemotely = (
    collection: string,
    id: string,
    options?: { overrideExpectedVersion?: number; existingMutationId?: string }
  ) => {
    if (!id || !collection) return;
    if (isDeviceRevokedRef.current) {
      showPrintToast('This computer was removed from the system', 'error');
      return;
    }

    markRecordAsDeletedLocally(id);
    setLastSyncedTime(new Date());

    const currentResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
    const persistentDevId = getPersistentDeviceId();
    const effectiveAuthor = currentUser || 'Operator';
    const effectiveUserId = currentEmployeeId ? `USR-${currentEmployeeId}` : `USR-${effectiveAuthor}`;
    const expectedVersion = options?.overrideExpectedVersion !== undefined
      ? options.overrideExpectedVersion
      : getExpectedVersionForRecord(collection, id);
    const clientMutationId = options?.existingMutationId || `MUT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

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

    const mutationRecord: QueuedMutation = {
      id: clientMutationId,
      type: 'delete',
      collection,
      recordId: id,
      expectedVersion,
      author: effectiveAuthor,
      deviceId: persistentDevId,
      timestamp: Date.now(),
      reset_version: currentResetVer,
      status: 'PENDING',
      retryCount: 0
    };

    // ONE WRITE PATH: 1) WebSocket if open
    const activeSocket = socketRef.current || socket;
    if (wsOpen(activeSocket)) {
      try {
        const ackTimeout = setTimeout(() => {
          const entry = inFlightWsMutationsRef.current.get(clientMutationId);
          if (!entry) return;
          inFlightWsMutationsRef.current.delete(clientMutationId);
          enqueueMutation({
            ...entry.mutation,
            status: 'FAILED',
            retryCount: 1,
            nextRetryAt: Date.now() + calculateRetryBackoffMs(1),
            lastError: 'WebSocket delete acknowledgment timeout'
          });
        }, 8000);
        inFlightWsMutationsRef.current.set(clientMutationId, { mutation: mutationRecord, timer: ackTimeout });
        activeSocket!.send(JSON.stringify({
          type: 'delete_record',
          clientMutationId,
          collection,
          id,
          expectedVersion,
          author: effectiveAuthor,
          employeeId: currentEmployeeId,
          user_id: effectiveUserId,
          device_id: persistentDevId,
          reset_version: currentResetVer
        }));
        return;
      } catch (e) {
        const entry = inFlightWsMutationsRef.current.get(clientMutationId);
        if (entry) {
          clearTimeout(entry.timer);
          inFlightWsMutationsRef.current.delete(clientMutationId);
        }
        enqueueMutation({
          ...mutationRecord,
          status: 'FAILED',
          retryCount: 1,
          nextRetryAt: Date.now() + calculateRetryBackoffMs(1),
          lastError: 'WebSocket delete send failed'
        });
        return;
      }
    }

    // ONE WRITE PATH: 2) HTTP POST if online
    const isBrowserOnline = typeof navigator === 'undefined' || navigator.onLine;
    if (isBrowserOnline) {
      const baseUrl = getApiBaseUrl();
      fetch(`${baseUrl}/api/records/delete`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId,
          'x-employee-id': currentEmployeeId || ''
        }),
        body: JSON.stringify({
          collection,
          id,
          expectedVersion,
          author: effectiveAuthor,
          employeeId: currentEmployeeId,
          user_id: effectiveUserId,
          device_id: persistentDevId,
          reset_version: currentResetVer
        })
      })
      .then(async (res) => {
        if (res.status === 403) {
          const errJson = await res.json().catch(() => ({}));
          if (errJson.error === 'DEVICE_REVOKED') {
            handleDeviceRevoked(persistentDevId);
            return;
          }
          showPrintToast(errJson.error || 'Permission denied', 'error');
          return;
        }
        if (res.status === 409) {
          const errJson = await res.json().catch(() => ({}));
          recordSyncConflict({
            id: clientMutationId,
            collection,
            recordId: id,
            type: 'delete',
            currentServerRecord: errJson.currentRecord || errJson.confirmedRecord,
            expectedVersion,
            author: effectiveAuthor,
            error: errJson.error || 'VERSION_CONFLICT: Newer revision exists on server.'
          });
          return;
        }
        if (res.ok) {
          lastKnownVersionsRef.current.delete(`${collection}:${id}`);
          removeConfirmedMutations([clientMutationId]);
          return;
        }
        enqueueMutation({
          ...mutationRecord,
          status: 'FAILED',
          retryCount: 1,
          nextRetryAt: Date.now() + calculateRetryBackoffMs(1),
          lastError: `Server returned status ${res.status}`
        });
      })
      .catch((err) => {
        enqueueMutation({
          ...mutationRecord,
          status: 'FAILED',
          retryCount: 1,
          nextRetryAt: Date.now() + calculateRetryBackoffMs(1),
          lastError: err?.message || 'HTTP delete failed'
        });
      });
      return;
    }

    // ONE WRITE PATH: 3) Offline Queue
    enqueueMutation(mutationRecord);
  };

  // Manual Full-Sync across WebSocket, REST & Local Terminals
  const handleManualSync = async () => {
    if (isDeviceRevokedRef.current) return;
    setIsManualSyncing(true);
    try {
      // 1. Broadcast force sync over WebSocket & request latest cluster presence
      const activeSocket = socketRef.current || socket;
      if (wsOpen(activeSocket)) {
        try {
          activeSocket!.send(JSON.stringify({
            type: 'force_sync_all',
            author: currentUser || 'SUPER ADMINISTRATOR'
          }));
          activeSocket!.send(JSON.stringify({
            type: 'get_presence'
          }));
        } catch (e) {}
      }

      // 2. Broadcast force sync over local BroadcastChannel
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
      const cleanHost = sanitizeServerHost(targetAddr);
      const isHttps = isSecureServerHost(cleanHost, targetAddr);
      const httpProto = isHttps ? 'https:' : 'http:';
      const baseUrl = getApiBaseUrl();

      const persistentDevId = getPersistentDeviceId();
      try {
        const res = await fetch(`${baseUrl}/api/sync`, {
          cache: 'no-store',
          headers: getAuthHeaders({ 'Accept': 'application/json', 'x-device-id': persistentDevId })
        });
        if (res.status === 403) {
          const errJson = await res.json().catch(() => ({}));
          if (errJson.error === 'DEVICE_REVOKED') {
            handleDeviceRevoked(persistentDevId);
            return;
          }
        }
        if (res.ok) {
          const json = await res.json();
          if (json.systemResetVersion) {
            const serverResetVer = Number(json.systemResetVersion) || 0;
            const localResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
            if (serverResetVer > localResetVer) {
              logger.info(`[JUWEI WMS] Manual sync detected hard reset (${serverResetVer} > ${localResetVer})`);
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
            if (json.data.fifoColorsByMonth && typeof json.data.fifoColorsByMonth === 'object') {
              const merged = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...json.data.fifoColorsByMonth };
              setFifoColorsByMonth(merged);
              try { localStorage.setItem('juwei_wms_fifoColorsByMonth', JSON.stringify(merged)); } catch (e) {}
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
          const resFallback = await fetch(`${httpProto}//${cleanHost}/api/sync`, { cache: 'no-store', headers: getAuthHeaders({ 'Accept': 'application/json', 'x-device-id': persistentDevId }) });
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
              if (json.data.fifoColorsByMonth && typeof json.data.fifoColorsByMonth === 'object') {
                const merged = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...json.data.fifoColorsByMonth };
                setFifoColorsByMonth(merged);
                try { localStorage.setItem('juwei_wms_fifoColorsByMonth', JSON.stringify(merged)); } catch (e) {}
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

    const applyStatePayload = (dataPayload: any, _activeUsersList?: string[], activePresenceList?: ActivePresenceUser[]) => {
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
      if (dataPayload.fifoColorsByMonth && typeof dataPayload.fifoColorsByMonth === 'object') {
        const merged = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...dataPayload.fifoColorsByMonth };
        setFifoColorsByMonth(merged);
        try { localStorage.setItem('juwei_wms_fifoColorsByMonth', JSON.stringify(merged)); } catch (e) {}
      }
      if (msgs && Array.isArray(msgs)) setChatMessages(msgs);
      if (activePresenceList && Array.isArray(activePresenceList)) {
        setWsPresence(activePresenceList);
      }
    };

    let activeSyncAbortCtrl: AbortController | null = null;
    let syncSequenceId = 0;

    const tryFetchSync = async (url: string): Promise<boolean> => {
      if (isDeviceRevokedRef.current) return false;
      const thisReqId = ++syncSequenceId;
      const persistentDevId = getPersistentDeviceId();
      try {
        if (activeSyncAbortCtrl) {
          try { activeSyncAbortCtrl.abort(); } catch (e) {}
        }
        activeSyncAbortCtrl = new AbortController();
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          headers: getAuthHeaders({ 'Accept': 'application/json', 'x-device-id': persistentDevId }),
          signal: activeSyncAbortCtrl.signal
        });
        if (thisReqId !== syncSequenceId) return false;
        if (res.status === 403) {
          const errJson = await res.json().catch(() => ({}));
          if (errJson.error === 'DEVICE_REVOKED') {
            handleDeviceRevoked(persistentDevId);
          }
          return false;
        }
        if (res.ok) {
          const json = await res.json();
          if (thisReqId !== syncSequenceId) return false;
          if (json.systemResetVersion) {
            const serverResetVer = Number(json.systemResetVersion) || 0;
            const localResetVer = Number(localStorage.getItem('juwei_wms_system_reset_version')) || 0;
            if (serverResetVer > localResetVer) {
              logger.info(`[JUWEI WMS] Hard reset detected from tryFetchSync (${serverResetVer} > ${localResetVer}). Purging local cache.`);
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
      }
      return false;
    };

    const checkBuildVersion = async () => {
      const now = Date.now();
      if (now - lastBuildInfoCheckRef.current < 60 * 60 * 1000) {
        return;
      }
      lastBuildInfoCheckRef.current = now;
      try {
        const centralUrl = getCentralServerUrl();
        const isFileOrigin = typeof window !== 'undefined' && window.location?.protocol === 'file:';
        const isElectronEnv = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

        const endpoints = (isElectronEnv || isFileOrigin)
          ? [
              ...(centralUrl ? [`${centralUrl}/build-info.json`, `${centralUrl}/api/build-info`] : []),
              './build-info.json'
            ]
          : [
              '/build-info.json',
              '/api/build-info',
              ...(centralUrl ? [`${centralUrl}/build-info.json`, `${centralUrl}/api/build-info`] : [])
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
              const bundleVer = data?.bundleVersion ? String(data.bundleVersion).replace(/^v/i, '').trim() : '';
              const latestRemoteVer = (data?.latestGitHubVersion || data?.version)
                ? String(data.latestGitHubVersion || data.version).replace(/^v/i, '').trim()
                : '';

              const desktopVer = (
                installedDesktopVersionRef.current ||
                (typeof window !== 'undefined' && window.electronAPI?.localVersion ? String(window.electronAPI.localVersion) : '')
              ).replace(/^v/i, '').trim();

              const buildTimeVer = typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__
                ? String(__APP_VERSION__).replace(/^v/i, '').trim()
                : '';

              let storedAck = '';
              try {
                storedAck = (localStorage.getItem('juwei_wms_web_acknowledged_version') || '').replace(/^v/i, '').trim();
              } catch (e) {}

              // Displayed version:
              // - In Electron local bundle (file://): show installed EXE's version
              // - In Google AI Studio / Web browser: sync directly to latest GitHub release version
              const displayVer = isFileOrigin
                ? (desktopVer || buildTimeVer || bundleVer || latestRemoteVer)
                : (latestRemoteVer || bundleVer || buildTimeVer || desktopVer);

              const comparisonInstalledVer = isElectronEnv
                ? (desktopVer || buildTimeVer)
                : (storedAck || buildTimeVer);

              if (displayVer) {
                setAppVersion((prev) => (prev !== displayVer ? displayVer : prev));
                if (typeof window !== 'undefined' && window.electronAPI?.updateAppVersion) {
                  window.electronAPI.updateAppVersion(displayVer);
                }
                if (isElectronEnv && desktopVer) {
                  try {
                    localStorage.setItem('juwei_wms_installed_version', desktopVer);
                  } catch (e) {}
                }
              }

              // Compare latest available GitHub release against installed/acknowledged version
              const isUpToDate = Boolean(
                comparisonInstalledVer && latestRemoteVer && !isNewerVersion(latestRemoteVer, comparisonInstalledVer)
              );

              if (isUpToDate) {
                try {
                  localStorage.removeItem('juwei_wms_dismissed_version');
                } catch (e) {}
                if (updateAvailableRef.current) {
                  logger.debug(`[JUWEI WMS UPDATE] App (${comparisonInstalledVer}) is up-to-date with latest (${latestRemoteVer}). Removing banner.`);
                  updateAvailableRef.current = false;
                  setUpdateAvailable(false);
                  setNewVersionString('');
                }
                break;
              }

              if (latestRemoteVer && comparisonInstalledVer && isNewerVersion(latestRemoteVer, comparisonInstalledVer)) {
                let dismissedVer = '';
                try {
                  dismissedVer = (localStorage.getItem('juwei_wms_dismissed_version') || '').replace(/^v/i, '').trim();
                } catch (e) {}
                if (!updateAvailableRef.current && dismissedVer !== latestRemoteVer) {
                  logger.debug(`[JUWEI WMS UPDATE] Update available: latest ${latestRemoteVer} > running ${comparisonInstalledVer}`);
                  updateAvailableRef.current = true;
                  setUpdateAvailable(true);
                  setNewVersionString(latestRemoteVer);
                }
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
      if (isDeviceRevokedRef.current) return false;

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

      if (isMounted && !hasConnectedOnce && !isDeviceRevokedRef.current) {
        setConnectionStatus('disconnected');
      }
      return false;
    };

    const connectWebSocket = async () => {
      if (!isMounted || isDeviceRevokedRef.current) return;
      if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return;
      }

      const clientAccountId = localStorage.getItem('juwei_wms_account_id') || 'ACC-JUWEI';
      const clientWarehouseId = localStorage.getItem('juwei_wms_warehouse_id') || 'WH-MAIN';
      logger.debug(`[JUWEI WMS] Connecting WebSocket with accountId="${clientAccountId}", warehouseId="${clientWarehouseId}"`);
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
        if (!isMounted || isDeviceRevokedRef.current) {
          try { ws?.close(); } catch {}
          return;
        }
        hasConnectedOnce = true;
        missedPongs = 0;
        retryDelay = 1000;
        setConnectionStatus('connected');
        socketRef.current = ws;
        setSocket(ws);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            const authPayload = {
              type: 'authenticate',
              accountId: clientAccountId,
              warehouseId: clientWarehouseId,
              user_id: currentEmployeeId ? `USR-${currentEmployeeId}` : 'ANONYMOUS',
              session_id: clientSessionId.current,
              sessionToken: getStoredSessionToken() || undefined,
              device_id: getPersistentDeviceId(),
              connection_id: clientConnectionId.current || undefined,
              stationId: getStationId(),
              username: currentUser || 'JUWEI OPERATOR',
              employeeId: currentEmployeeId || '',
              role: currentRole || (currentPermission === 'FULL_ACCESS' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE OPERATOR'),
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
                logger.debug(`[JUWEI WMS] FULL_INVENTORY_SYNC serverInstanceId: ${payload.serverInstanceId}`);
              }
              if (incoming.length > 0 || payload.inventory !== undefined) {
                const norm = normalizeRecords('stocks', incoming);
                setStocks(norm);
                logger.debug(`[JUWEI WMS] Received FULL_INVENTORY_SYNC (${norm.length} items) for account: ${payload.accountId || 'ALL'}, warehouse: ${payload.warehouseId || 'ALL'}`);
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
                recordKnownVersions(targetCol, [record]);
                const incomingVer = record.version !== undefined && record.version !== null ? Number(record.version) : undefined;
                const hasQueuedOverride = getPendingMutations().some((m) => {
                  if (m.collection !== targetCol || m.status === 'CONFLICT') return false;
                  if (String(m.recordId || m.record?.id) !== String(record.id)) return false;
                  const mutVer = m.expectedVersion !== undefined && m.expectedVersion !== null
                    ? Number(m.expectedVersion)
                    : (m.record?.version !== undefined && m.record?.version !== null ? Number(m.record.version) : undefined);
                  if (incomingVer !== undefined && mutVer !== undefined && mutVer < incomingVer) return false;
                  return true;
                });
                const hasInFlightOverride = Array.from(inFlightWsMutationsRef.current.values()).some((entry) => {
                  const m = entry.mutation;
                  if (m.collection !== targetCol || String(m.recordId || m.record?.id) !== String(record.id)) return false;
                  const mutVer = m.expectedVersion !== undefined && m.expectedVersion !== null ? Number(m.expectedVersion) : undefined;
                  if (incomingVer !== undefined && mutVer !== undefined && mutVer < incomingVer) return false;
                  return true;
                });
                if (!hasQueuedOverride && !hasInFlightOverride) {
                  applyConfirmedRecordToState(targetCol, record);
                }
              }
              break;
            }
            case 'UPSERT_CONFIRMED': {
              const clientMutationId = payload.clientMutationId;
              if (clientMutationId) {
                const entry = inFlightWsMutationsRef.current.get(clientMutationId);
                if (entry) {
                  clearTimeout(entry.timer);
                  inFlightWsMutationsRef.current.delete(clientMutationId);
                }
                removeConfirmedMutations([clientMutationId]);
              }
              if (payload.record && payload.collection) {
                applyConfirmedRecordToState(payload.collection, payload.record);
              }
              setLastSyncedTime(new Date());
              break;
            }
            case 'DELETE_CONFIRMED': {
              const clientMutationId = payload.clientMutationId;
              if (clientMutationId) {
                const entry = inFlightWsMutationsRef.current.get(clientMutationId);
                if (entry) {
                  clearTimeout(entry.timer);
                  inFlightWsMutationsRef.current.delete(clientMutationId);
                }
                removeConfirmedMutations([clientMutationId]);
              }
              if (payload.collection && payload.id) {
                lastKnownVersionsRef.current.delete(`${payload.collection}:${payload.id}`);
              }
              setLastSyncedTime(new Date());
              break;
            }
            case 'BATCH_SYNC_CONFIRMED': {
              const results: any[] = Array.isArray(payload.results) ? payload.results : [];
              const confirmedIds: string[] = [];
              let currentQueue = getPendingMutations();
              let queueModified = false;
              for (const r of results) {
                const mutId = String(r.mutationId || r.id || '');
                if (!mutId) continue;
                const entry = inFlightWsMutationsRef.current.get(mutId);
                if (entry) {
                  clearTimeout(entry.timer);
                  inFlightWsMutationsRef.current.delete(mutId);
                }
                if (r.success) {
                  confirmedIds.push(mutId);
                  if (r.record && r.collection) {
                    applyConfirmedRecordToState(r.collection, r.record);
                  } else if (r.type === 'delete' && r.collection && r.recordId) {
                    lastKnownVersionsRef.current.delete(`${r.collection}:${r.recordId}`);
                  }
                } else if (r.status === 409) {
                  const qMut = currentQueue.find((q) => q.id === mutId) || entry?.mutation;
                  recordSyncConflict({
                    id: mutId,
                    collection: r.collection || qMut?.collection || 'stocks',
                    recordId: String(r.recordId || qMut?.recordId || qMut?.record?.id || ''),
                    type: qMut?.type === 'delete' ? 'delete' : 'upsert',
                    localRecord: qMut?.record,
                    currentServerRecord: r.currentRecord,
                    expectedVersion: qMut?.expectedVersion,
                    author: qMut?.author,
                    actionDesc: qMut?.actionDesc,
                    error: r.error || 'VERSION_CONFLICT: Newer revision exists on server.'
                  });
                  currentQueue = getPendingMutations();
                } else {
                  const prevMut = currentQueue.find((q) => q.id === mutId) || entry?.mutation;
                  if (prevMut) {
                    const nextRetry = (prevMut.retryCount || 0) + 1;
                    const updatedMut: QueuedMutation = {
                      ...prevMut,
                      status: 'FAILED',
                      retryCount: nextRetry,
                      nextRetryAt: Date.now() + calculateRetryBackoffMs(nextRetry),
                      lastError: r.error || `Server status ${r.status}`
                    };
                    if (currentQueue.some((q) => q.id === mutId)) {
                      currentQueue = currentQueue.map((q) => (q.id === mutId ? updatedMut : q));
                    } else {
                      currentQueue.push(updatedMut);
                    }
                    queueModified = true;
                  }
                }
              }
              if (queueModified) savePendingMutations(currentQueue);
              if (confirmedIds.length > 0) removeConfirmedMutations(confirmedIds);
              setLastSyncedTime(new Date());
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
                logger.info(`[JUWEI WMS] Server reset version ${serverResetVer} > local ${localResetVer}. Hard purging local stale data.`);
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
              logger.info(`[JUWEI WMS] Received authoritative GLOBAL_RESET (Version: ${resetVerNum}, ID: ${newId}) by ${author}`);
              
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
            case 'SYNC_REQUIRED': {
              handleManualSync();
              break;
            }
            case 'DATA_CREATE':
            case 'DATA_UPDATE':
            case 'RECORD_CREATED':
            case 'RECORD_UPDATED':
            case 'record_upserted': {
              const { collection, record, author, actionDesc } = payload;
              if (record && record.id && collection) {
                setLastSyncedTime(new Date());
                recordKnownVersions(collection, [record]);

                // Do not overwrite active non-stale local edits; never let an older queued mutation block newer server state
                const incomingVer = record.version !== undefined && record.version !== null ? Number(record.version) : undefined;
                const hasQueuedOverride = getPendingMutations().some((m) => {
                  if (m.collection !== collection || m.status === 'CONFLICT') return false;
                  if (String(m.recordId || m.record?.id) !== String(record.id)) return false;
                  const mutVer = m.expectedVersion !== undefined && m.expectedVersion !== null
                    ? Number(m.expectedVersion)
                    : (m.record?.version !== undefined && m.record?.version !== null ? Number(m.record.version) : undefined);
                  if (incomingVer !== undefined && mutVer !== undefined && mutVer < incomingVer) {
                    return false;
                  }
                  return true;
                });
                const hasInFlightOverride = Array.from(inFlightWsMutationsRef.current.values()).some((entry) => {
                  const m = entry.mutation;
                  if (m.collection !== collection || String(m.recordId || m.record?.id) !== String(record.id)) return false;
                  const mutVer = m.expectedVersion !== undefined && m.expectedVersion !== null ? Number(m.expectedVersion) : undefined;
                  if (incomingVer !== undefined && mutVer !== undefined && mutVer < incomingVer) {
                    return false;
                  }
                  return true;
                });
                if (!hasQueuedOverride && !hasInFlightOverride) {
                  applyConfirmedRecordToState(collection, record);
                }

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
              const { collection, id, author, actionDesc } = payload;
              if (id && collection) {
                markRecordAsDeletedLocally(id);
                lastKnownVersionsRef.current.delete(`${collection}:${id}`);
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
                  case 'fifoColorsByMonth': {
                    if (data && typeof data === 'object') {
                      const merged = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...data };
                      setFifoColorsByMonth(merged);
                      try { localStorage.setItem('juwei_wms_fifoColorsByMonth', JSON.stringify(merged)); } catch (e) {}
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
            case 'fifo_colors_updated': {
              const { fifoColorsByMonth: newColors } = payload;
              if (newColors && typeof newColors === 'object') {
                const merged = { ...DEFAULT_FIFO_COLORS_BY_MONTH, ...newColors };
                setFifoColorsByMonth(merged);
                try { localStorage.setItem('juwei_wms_fifoColorsByMonth', JSON.stringify(merged)); } catch (e) {}
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
            case 'DEVICE_REVOKED': {
              handleDeviceRevoked(payload.deviceId);
              if (httpPollInterval) clearInterval(httpPollInterval);
              break;
            }
            case 'ERROR': {
              const clientMutationId = payload.clientMutationId;
              const inFlightEntry = clientMutationId
                ? inFlightWsMutationsRef.current.get(clientMutationId)
                : undefined;
              if (inFlightEntry && clientMutationId) {
                clearTimeout(inFlightEntry.timer);
                inFlightWsMutationsRef.current.delete(clientMutationId);
              }

              if (payload.error === 'DEVICE_REVOKED') {
                handleDeviceRevoked(payload.deviceId);
                if (httpPollInterval) clearInterval(httpPollInterval);
                break;
              }

              if (payload.status === 409) {
                const mut = inFlightEntry?.mutation;
                recordSyncConflict({
                  id: clientMutationId,
                  collection: payload.collection || mut?.collection || 'stocks',
                  recordId: String(payload.recordId || mut?.recordId || mut?.record?.id || ''),
                  type: mut?.type === 'delete' ? 'delete' : 'upsert',
                  localRecord: mut?.record,
                  currentServerRecord: payload.currentRecord || payload.confirmedRecord,
                  expectedVersion: mut?.expectedVersion,
                  author: mut?.author,
                  actionDesc: mut?.actionDesc,
                  error: payload.error || 'VERSION_CONFLICT: Newer revision exists on server.'
                });
                break;
              }

              if (payload.status === 403) {
                showPrintToast(payload.error || 'Permission denied', 'error');
                break;
              }

              if (inFlightEntry) {
                const nextRetry = (inFlightEntry.mutation.retryCount || 0) + 1;
                enqueueMutation({
                  ...inFlightEntry.mutation,
                  status: 'FAILED',
                  retryCount: nextRetry,
                  nextRetryAt: Date.now() + calculateRetryBackoffMs(nextRetry),
                  lastError: payload.error || `Server error (${payload.status || 500})`
                });
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

      ws.onclose = (event: CloseEvent) => {
        if (!isMounted) return;
        if (pingInterval) clearInterval(pingInterval);
        socketRef.current = null;
        setSocket(null);

        // Move any unconfirmed in-flight WS writes to the single offline queue with backoff
        if (inFlightWsMutationsRef.current.size > 0) {
          for (const [, entry] of inFlightWsMutationsRef.current.entries()) {
            clearTimeout(entry.timer);
            enqueueMutation({
              ...entry.mutation,
              status: 'FAILED',
              retryCount: (entry.mutation.retryCount || 0) + 1,
              nextRetryAt: Date.now() + calculateRetryBackoffMs((entry.mutation.retryCount || 0) + 1),
              lastError: 'WebSocket connection closed before acknowledgment'
            });
          }
          inFlightWsMutationsRef.current.clear();
        }

        if (event?.code === 4003 || event?.reason === 'DEVICE_REVOKED' || isDeviceRevokedRef.current) {
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          if (httpPollInterval) clearInterval(httpPollInterval);
          handleDeviceRevoked();
          return;
        }

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
      if (isMounted && !isDeviceRevokedRef.current) {
        const now = Date.now();
        if (now - lastFocusSyncTime > 15000) {
          lastFocusSyncTime = now;
          runSyncCheck();
        }
        if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) {
          connectWebSocket();
        }
      }
    };

    const handleForceFlushEvent = () => {
      if (isMounted && !isDeviceRevokedRef.current) {
        flushPendingMutationsQueue(true);
      }
    };

    const handleDeviceRevokedEvent = (ev: any) => {
      handleDeviceRevoked(ev?.detail?.deviceId);
    };

    window.addEventListener('online', handleOnlineOrFocus);
    window.addEventListener('focus', handleOnlineOrFocus);
    document.addEventListener('visibilitychange', handleOnlineOrFocus);
    window.addEventListener(FORCE_FLUSH_MUTATIONS_EVENT, handleForceFlushEvent);
    window.addEventListener(DEVICE_REVOKED_EVENT, handleDeviceRevokedEvent);

    // Run immediate sync on mount
    runSyncCheck().then((ok) => {
      if (!ok && isMounted && !isDeviceRevokedRef.current) {
        setConnectionStatus('connecting');
      }
    });

    connectWebSocket();

    // Continuous background HTTP poll fallback (fixed 5000ms interval)
    httpPollInterval = setInterval(() => {
      if (isMounted && !isDeviceRevokedRef.current) {
        runSyncCheck();
      }
    }, 5000);

    return () => {
      isMounted = false;
      for (const [, entry] of inFlightWsMutationsRef.current.entries()) {
        clearTimeout(entry.timer);
      }
      inFlightWsMutationsRef.current.clear();
      socketRef.current = null;
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (httpPollInterval) clearInterval(httpPollInterval);
      if (pingInterval) clearInterval(pingInterval);
      window.removeEventListener('online', handleOnlineOrFocus);
      window.removeEventListener('focus', handleOnlineOrFocus);
      document.removeEventListener('visibilitychange', handleOnlineOrFocus);
      window.removeEventListener(FORCE_FLUSH_MUTATIONS_EVENT, handleForceFlushEvent);
      window.removeEventListener(DEVICE_REVOKED_EVENT, handleDeviceRevokedEvent);
    };
  }, []);

  // Fetch one-time initial Super Admin setup PIN on fresh install (before first login)
  useEffect(() => {
    if (isLoggedIn) {
      setOneTimeSetupPinNotice(null);
      return;
    }
    let cancelled = false;
    const baseUrl = getApiBaseUrl();
    const persistentDevId = getPersistentDeviceId();
    fetch(`${baseUrl}/api/setup/initial-pin`, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        ...(persistentDevId ? { 'x-device-id': persistentDevId } : {})
      }
    })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const json = await res.json().catch(() => null);
        if (!cancelled && json?.hasInitialPin && json?.initialPin) {
          setOneTimeSetupPinNotice({
            employeeId: json.employeeId || 'JPMP-002',
            initialPin: String(json.initialPin)
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

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

  // Sync state helpers for bulk collection sync (ONE write path: WebSocket if open, else HTTP)
  const syncCollection = (collection: string, data: any[]) => {
    if (isDeviceRevokedRef.current) {
      showPrintToast('This computer was removed from the system', 'error');
      return;
    }

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

    // ONE WRITE PATH: 1. Send via WebSocket if open
    const activeSocket = socketRef.current || socket;
    if (wsOpen(activeSocket)) {
      try {
        activeSocket!.send(JSON.stringify({
          type: 'update_collection',
          collection,
          data,
          reset_version: currentResetVer,
          device_id: persistentDevId,
          user_id: effectiveUserId,
          author: effectiveAuthor,
          employeeId: currentEmployeeId
        }));
        return;
      } catch (e) {
        console.warn('WS send error, falling back to HTTP:', e);
      }
    }

    // ONE WRITE PATH: 2. HTTP POST REST when WebSocket is not open
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
      headers: getAuthHeaders({
        'Content-Type': 'application/json',
        'x-device-id': persistentDevId,
        'x-employee-id': currentEmployeeId || ''
      }),
      body: JSON.stringify(syncPayload)
    })
    .then(async res => {
      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
          return;
        }
      }
      if (res.status === 409) {
        return;
      }
    })
    .catch(err => console.warn('HTTP REST sync warning:', err));
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
      showPrintToast("AUTHORIZATION RESTRICTION: Only accounts registered by Super Administrator (ALDRIN BANAWA - JPMP-002) in this computer will be authorized for use by other users and computers.", 'error');
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
      showPrintToast("ALL FIELDS ARE REQUIRED.", 'warning');
      return null;
    }
    const exists = registeredUsers.some(
      u => (u.employeeId || '').toUpperCase() === cleanEmployeeId || 
           (u.username || '').toUpperCase() === cleanUsername
    );
    if (exists) {
      showPrintToast("AN OPERATOR WITH THIS NAME OR REGISTER ID ALREADY EXISTS.", 'warning');
      return null;
    }

    // Determine 4-digit PIN (custom or CSPRNG generated) - NEVER use predictable fallbacks
    let finalPin = '';
    const cleanProvidedPin = customPin ? customPin.replace(/\D/g, '').slice(0, 4) : '';
    if (cleanProvidedPin.length === 4 && cleanProvidedPin !== '1234' && !/^(\d)\1+$/.test(cleanProvidedPin)) {
      finalPin = cleanProvidedPin;
    } else {
      let attempts = 0;
      while (attempts < 200) {
        let num = 1000 + Math.floor(Math.random() * 9000);
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
          const arr = new Uint32Array(1);
          crypto.getRandomValues(arr);
          num = 1000 + (arr[0] % 9000);
        }
        const pinCandidate = String(num);
        if (pinCandidate !== '1234' && !/^(\d)\1+$/.test(pinCandidate)) {
          finalPin = pinCandidate;
          break;
        }
        attempts++;
      }
      if (!finalPin) {
        finalPin = '4917';
      }
    }

    const cleanPermission = permission || (cleanEmployeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS');
    const newUserWithOneTimePin: RegisteredAccount = { 
      username: cleanUsername, 
      role: cleanRole, 
      employeeId: cleanEmployeeId, 
      phoneNumber: phoneNumber ? phoneNumber.trim() : '',
      permission: cleanPermission, 
      pin: finalPin,
      hasPin: true,
      status: status || 'ACTIVE',
      registeredBy: 'JPMP-002 (ALDRIN BANAWA)',
      registeredBySuperAdmin: true,
      registeredAt: new Date().toISOString(),
      stationId: getStationId()
    };
    const { pin: _omittedPin, ...sanitizedNewUser } = newUserWithOneTimePin;

    // Remove from deleted tracking if re-registered
    unmarkUserAsDeleted(cleanEmployeeId);
    markRecordMutatedLocally(cleanEmployeeId);

    const nextUsers = [...registeredUsers.filter(u => (u.employeeId || '').toUpperCase() !== cleanEmployeeId), sanitizedNewUser];
    setRegisteredUsers(nextUsers);
    
    // Cross-tab BroadcastChannel
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'account_registered',
          user: sanitizedNewUser,
          author: currentUser || 'Super Administrator'
        });
      } catch (e) {}
    }

    // WebSocket real-time cluster broadcast (server hashes pin into pinHash/pinSalt)
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'register_account',
          user: newUserWithOneTimePin,
          device_id: getPersistentDeviceId(),
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
      const persistentDevId = getPersistentDeviceId();
      fetch(`${baseUrl}/api/accounts/register`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId
        }),
        body: JSON.stringify({
          ...newUserWithOneTimePin,
          device_id: persistentDevId,
          requesterEmployeeId: currentEmployeeId || 'JPMP-002',
          requesterUsername: currentUser || 'ALDRIN BANAWA',
          author: currentUser || 'ALDRIN BANAWA'
        })
      }).then(async (res) => {
        if (res.status === 403) {
          const errJson = await res.json().catch(() => ({}));
          if (errJson?.error === 'DEVICE_REVOKED') {
            handleDeviceRevoked(persistentDevId);
          }
        }
      }).catch(() => {});
    } catch (e) {}

    // Set state to trigger the one-time secure PIN discovery overlay
    setNewlyRegisteredUser(newUserWithOneTimePin);
    return newUserWithOneTimePin;
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
      showPrintToast('PROTECTED ROOT ACCOUNT: ALDRIN BANAWA (JPMP-002) CANNOT BE DELETED.', 'error');
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
    const persistentDevId = getPersistentDeviceId();
    fetch(`${baseUrl}/api/accounts/delete`, {
      method: 'POST',
      headers: getAuthHeaders({
        'Content-Type': 'application/json',
        'x-device-id': persistentDevId
      }),
      body: JSON.stringify({ employeeId: cleanId, device_id: persistentDevId })
    }).then(async (res) => {
      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson?.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
        }
      }
    }).catch(() => {});

    // 4. Broadcast deletion over WebSocket
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'delete_account',
          employeeId: cleanId,
          device_id: persistentDevId
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
    const persistentDevId = getPersistentDeviceId();
    fetch(`${baseUrl}/api/accounts/clear-all-except-super-admin`, {
      method: 'POST',
      headers: getAuthHeaders({
        'Content-Type': 'application/json',
        'x-device-id': persistentDevId
      }),
      body: JSON.stringify({ device_id: persistentDevId })
    }).then(async (res) => {
      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson?.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
        }
      }
    }).catch(() => {});

    // WebSocket broadcast
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'all_accounts_cleared',
          device_id: persistentDevId,
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
      showPrintToast(`An operator account with ID "${cleanNewId}" already exists.`, 'warning');
      return;
    }

    const nextUsers = registeredUsers.map(u => {
      if ((u.employeeId || '').toUpperCase() === cleanOldId) {
        const { pin: _dropIncomingPin, ...restUpdated } = updated;
        const { pin: _dropExistingPin, ...restExisting } = u;
        return {
          ...restExisting,
          ...restUpdated,
          employeeId: cleanNewId,
          username: (updated.username || '').toUpperCase(),
          role: (updated.role || '').toUpperCase(),
          phoneNumber: updated.phoneNumber !== undefined ? updated.phoneNumber : (u.phoneNumber || ''),
          permission: updated.permission || u.permission || 'LIMITED_ACCESS',
          hasPin: Boolean(updated.hasPin ?? u.hasPin ?? true),
          mustChangePin: updated.mustChangePin !== undefined ? updated.mustChangePin : u.mustChangePin,
          isPinCompromised: updated.isPinCompromised !== undefined ? updated.isPinCompromised : u.isPinCompromised,
          status: updated.status || u.status || 'ACTIVE',
          lastActive: updated.lastActive !== undefined ? updated.lastActive : u.lastActive
        };
      }
      return u;
    });

    const targetUpdatedUser = nextUsers.find(u => (u.employeeId || '').toUpperCase() === cleanNewId);
    const persistentDevId = getPersistentDeviceId();

    if (cleanNewId !== cleanOldId) {
      unmarkUserAsDeleted(cleanNewId);
      const baseUrl = getApiBaseUrl();
      fetch(`${baseUrl}/api/accounts/delete`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId
        }),
        body: JSON.stringify({ employeeId: cleanOldId, device_id: persistentDevId })
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
          oldEmployeeId: cleanOldId,
          user: targetUpdatedUser,
          device_id: persistentDevId,
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
          headers: getAuthHeaders({
            'Content-Type': 'application/json',
            'x-device-id': persistentDevId
          }),
          body: JSON.stringify({
            oldEmployeeId: cleanOldId,
            updatedUser: targetUpdatedUser,
            device_id: persistentDevId
          })
        }).then(async (res) => {
          if (res.status === 403) {
            const errJson = await res.json().catch(() => ({}));
            if (errJson?.error === 'DEVICE_REVOKED') {
              handleDeviceRevoked(persistentDevId);
            }
          }
        }).catch(() => {});
      } catch (e) {}
    }

    syncCollection('registeredUsers', nextUsers);
  };

  const completeAuthenticatedLogin = (verifiedUser: any, enteredPin?: string) => {
    const empIdToRemember = (verifiedUser.employeeId || loginEmployeeId).trim().toUpperCase();
    if (rememberLogin && empIdToRemember) {
      try {
        localStorage.setItem('juwei_wms_rememberedEmployeeId', empIdToRemember);
      } catch (e) {}
    } else {
      try {
        localStorage.removeItem('juwei_wms_rememberedEmployeeId');
      } catch (e) {}
    }

    if (verifiedUser.mustChangePin) {
      setIsLoggingIn(false);
      setFirstLoginNewPin('');
      setFirstLoginConfirmPin('');
      setFirstLoginPinError('');
      setPendingFirstLoginPinChange({
        user: verifiedUser,
        currentPin: enteredPin || ''
      });
      return;
    }

    setOneTimeSetupPinNotice(null);
    setTimeout(() => {
      handleLogin(verifiedUser);
      const remembered = localStorage.getItem('juwei_wms_rememberedEmployeeId');
      setLoginEmployeeId(remembered || '');
      setLoginPin('');
      setLoginError('');
      setIsLoggingIn(false);
    }, 300);
  };

  const handleSubmitFirstLoginPinChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingFirstLoginPinChange) return;
    setFirstLoginPinError('');

    const cleanNew = firstLoginNewPin.replace(/\D/g, '').slice(0, 4);
    const cleanConfirm = firstLoginConfirmPin.replace(/\D/g, '').slice(0, 4);
    if (cleanNew.length !== 4) {
      setFirstLoginPinError('New PIN must be exactly 4 numeric digits.');
      return;
    }
    if (cleanNew !== cleanConfirm) {
      setFirstLoginPinError('Confirmation PIN does not match new PIN.');
      return;
    }
    if (cleanNew === pendingFirstLoginPinChange.currentPin) {
      setFirstLoginPinError('New PIN must be different from the initial setup PIN.');
      return;
    }
    if (cleanNew === '1234' || /^(\d)\1+$/.test(cleanNew)) {
      setFirstLoginPinError('SECURITY REJECTED: Weak or repetitive PINs are not allowed.');
      return;
    }

    setIsSavingFirstLoginPin(true);
    try {
      const targetUser = pendingFirstLoginPinChange.user;
      const res = await updateCentralPin(
        targetUser.employeeId,
        pendingFirstLoginPinChange.currentPin,
        cleanNew,
        targetUser.employeeId,
        {
          author: `${targetUser.username} (${targetUser.employeeId})`,
          reason: 'Mandatory first-login PIN change'
        }
      );
      if (!res.success) {
        setFirstLoginPinError(res.error || 'Failed to update PIN. Please try again.');
        setIsSavingFirstLoginPin(false);
        return;
      }
      const updatedUser = res.user ? { ...targetUser, ...res.user, mustChangePin: false } : { ...targetUser, mustChangePin: false };
      setRegisteredUsers(prev => upsertUserInState(prev, updatedUser));
      setPendingFirstLoginPinChange(null);
      setOneTimeSetupPinNotice(null);
      setIsSavingFirstLoginPin(false);
      setIsLoggingIn(true);
      completeAuthenticatedLogin(updatedUser);
    } catch (err: any) {
      setFirstLoginPinError(err?.message || 'Network error updating PIN.');
      setIsSavingFirstLoginPin(false);
    }
  };

  const handleDirectLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (isDeviceRevokedRef.current) {
      setLoginError('This computer was removed from the system');
      return;
    }

    const rawInput = (loginEmployeeId || '').trim();
    const enteredPin = (loginPin || '').trim();
    if (!rawInput || !enteredPin) {
      setLoginError('PLEASE ENTER YOUR EMPLOYEE ID AND 4-DIGIT PIN CODE.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const authoritativeUser = await verifyCentralCredentials(rawInput, enteredPin);
      if (authoritativeUser) {
        setRegisteredUsers(prev => upsertUserInState(prev, authoritativeUser));
        completeAuthenticatedLogin(authoritativeUser, enteredPin);
        return;
      }
    } catch (authErr: any) {
      if (authErr?.message === 'DEVICE_REVOKED') {
        handleDeviceRevoked(getPersistentDeviceId());
        setIsLoggingIn(false);
        setLoginError('This computer was removed from the system');
        return;
      }
      console.warn("Authoritative login verification error:", authErr);
    }

    setIsLoggingIn(false);
    setLoginError('INVALID OPERATIONAL ID NUMBER OR INCORRECT PIN CODE.');
  };

  const handleQrLoginScan = async (scannedText: string) => {
    if (isDeviceRevokedRef.current) {
      setLoginError('This computer was removed from the system');
      return;
    }

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

    if (!searchPin) {
      setLoginError(`MISSING PIN IN QR CODE FOR OPERATOR ${searchEmpId}. ENTER PIN MANUALLY TO SIGN IN.`);
      return;
    }

    setIsLoggingIn(true);
    try {
      const verified = await verifyCentralCredentials(searchEmpId, searchPin);
      if (verified) {
        setRegisteredUsers(prev => upsertUserInState(prev, verified));
        setShowLoginQrScanner(false);
        setLoginEmployeeId('');
        setLoginPin('');
        setLoginError('');
        completeAuthenticatedLogin(verified, searchPin);
        return;
      }
    } catch (err: any) {
      if (err?.message === 'DEVICE_REVOKED') {
        handleDeviceRevoked(getPersistentDeviceId());
        setShowLoginQrScanner(false);
        setIsLoggingIn(false);
        setLoginError('This computer was removed from the system');
        return;
      }
    }
    setIsLoggingIn(false);
    setLoginError(`INCORRECT OR MISSING PIN CODE FOR OPERATOR "${searchEmpId}". ONLY REGISTERED PIN IS AUTHORIZED.`);
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
          sessionToken: getStoredSessionToken() || undefined,
          device_id: getPersistentDeviceId(),
          connection_id: clientConnectionId.current || undefined,
          stationId: getStationId(),
          username: cleanUsername,
          employeeId: cleanEmployeeId,
          role: cleanRole,
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
      localStorage.removeItem('juwei_wms_sessionToken');
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

  // State mutators with automatic procedural linking (ONE write path per mutation via upsertRecordLocallyAndRemotely / deleteRecordLocallyAndRemotely)
  const handleAddReceiving = (record: ReceivingRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const nextReceiving = [record, ...receiving];
    setReceiving(nextReceiving);

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
      fifoColor: normalizeFifoColor(record.fifoColorCode || (record as any).fifoColor, record.receivedDate || record.date, fifoColorsByMonth),
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
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const updatedReceivingRecord = receiving.find(r => r.id === id);
    const nextReceiving: ReceivingRecord[] = receiving.map(r => r.id === id ? { ...r, iqcStatus, status: (iqcStatus === 'APPROVED_IQC' ? 'VERIFIED' : 'QUARANTINED') as ReceivingRecord['status'] } : r);
    setReceiving(nextReceiving);
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

      sendSystemActivity(`${currentUser} updated IQC evaluation for ${targetRec.partCode} (Lot: ${targetRec.lotNumber}) to ${iqcStatus}.`);
    }
  };


  const handleAddReturn = (record: ReturnRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const nextReturns = [record, ...returns];
    setReturns(nextReturns);
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
      fifoColor: getFifoColorForDate(record.date, fifoColorsByMonth),
      status: record.status === 'QUARANTINED' ? 'QUARANTINE' : 'APPROVED'
    };
    const nextStocks = [newStockItem, ...stocks];
    setStocks(nextStocks);
    upsertRecordLocallyAndRemotely('stocks', newStockItem, `Created stock item from return for ${record.partCode}`);

    sendSystemActivity(`${currentUser} registered shop-floor return for ${record.partCode} (Lot: ${record.lotNumber}).`);
  };

  const handleUpdateReturnStatus = (id: string, status: ReturnRecord['status']) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const existingRet = returns.find(r => r.id === id);
    const nextReturns: ReturnRecord[] = returns.map(r => r.id === id ? { ...r, status, iqcEvaluation: 'APPROVED_IQC' as const } : r);
    setReturns(nextReturns);
    if (existingRet) {
      upsertRecordLocallyAndRemotely('returns', { ...existingRet, status, iqcEvaluation: 'APPROVED_IQC' as const }, `Updated return status to ${status}`);
    }

    const targetRet = existingRet;
    if (targetRet) {
      const nextStocks: MaterialStockItem[] = stocks.map(s => {
        if (s.lotNumber === targetRet.lotNumber && s.partCode === targetRet.partCode) {
          const updatedStock = { ...s, status: 'APPROVED' as const, location: 'Designated Storage Bin' };
          upsertRecordLocallyAndRemotely('stocks', updatedStock, `Approved returned stock for ${targetRet.partCode}`);
          return updatedStock;
        }
        return s;
      });
      setStocks(nextStocks);

      sendSystemActivity(`${currentUser} approved returned item ${targetRet.partCode} back to active inventory.`);
    }
  };


  const handleAddRecycling = (record: RecyclingRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const nextRecycling = [record, ...recycling];
    setRecycling(nextRecycling);
    upsertRecordLocallyAndRemotely('recycling', record, `Recycled ${record.quantity} ${record.itemType}(s)`);

    sendSystemActivity(`${currentUser} recorded recycling of ${record.quantity} ${record.itemType}(s) under Log Sheet: ${record.logSheetNumber}.`);
  };

  const handleDeleteRecycling = (id: string) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('recycling', id);
    const nextRecycling = recycling.filter(r => r.id !== id);
    setRecycling(nextRecycling);
  };

  const handleAddIssuance = (record: IssuanceRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const nextIssuances = [record, ...issuances];
    setIssuances(nextIssuances);
    upsertRecordLocallyAndRemotely('issuances', record, `Issued ${record.quantityIssued} units for Requisition: ${record.requisitionNumber}`);

    sendSystemActivity(`${currentUser} logged materials issuance of ${record.quantityIssued} units for Requisition: ${record.requisitionNumber}.`);
  };

  const handleDeductStock = (partCode: string, lotNumber: string, quantity: number): boolean => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
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
    upsertRecordLocallyAndRemotely('stocks', updatedItem, `Deducted ${quantity} from stock ${partCode} (Lot: ${lotNumber})`);

    // Record atomic ledger stock movement using delta (not newQuantity)
    createStockMovement({
      productId: partCode,
      warehouseId: 'wh-main',
      type: 'ADJUSTMENT_OUT',
      quantity,
      delta: -Math.abs(quantity),
      referenceNumber: lotNumber,
      notes: `Stock deducted for part ${partCode} (Lot: ${lotNumber})`,
      userName: currentUser,
      preventNegativeStock: true
    }).catch((err) => console.warn('Stock movement async record note:', err));

    return true;
  };

  const handleAddDelivery = (record: DeliveryRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const nextDeliveries = [record, ...deliveries];
    setDeliveries(nextDeliveries);
    upsertRecordLocallyAndRemotely('deliveries', record, `Created delivery request ${record.id}`);

    sendSystemActivity(`${currentUser} created Delivery request ${record.id} for model ${record.modelName} (Qty: ${record.quantity}).`);
  };

  const handleUpdateDeliveryStatus = (id: string, status: DeliveryRecord['status'], extDoc?: { drNumber?: string, salesInvoice?: string, wayBill?: string }) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
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

        sendSystemActivity(`${currentUser} released Delivery Request ${id} & Gate Pass to gate guards.`);
      }
    } else {
      sendSystemActivity(`${currentUser} marked Delivery Request ${id} as ${status}.`);
    }
  };

  const handleAddEnvLog = (log: EnvironmentalLog) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const nextEnvLogs = [...envLogs, log];
    setEnvLogs(nextEnvLogs);
    upsertRecordLocallyAndRemotely('envLogs', log, `Logged space utilization for ${log.zone}`);

    const pct = ((log.occupiedSlots / log.totalSlots) * 100).toFixed(1);
    sendSystemActivity(`${currentUser} logged space utilization audit for ${log.zone}: ${log.occupiedSlots}/${log.totalSlots} slots occupied (${pct}%).`);
  };

  const handleClearEnvLogs = () => {
    const normRole = (currentRole || '').toUpperCase();
    const normUser = (currentUser || '').toUpperCase();
    const isSuperOrSystem = normRole.includes('SUPER') || normRole.includes('SYSTEM') || normUser.includes('SUPER') || normUser.includes('SYSTEM') || currentPermission === 'FULL_ACCESS';
    
    if (!isSuperOrSystem) {
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN AND SYSTEM ADMIN CAN CLEAR HISTORICAL SPACE AUDIT LOGS.", 'error');
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
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN AND SYSTEM ADMIN CAN DELETE SPACE AUDIT LOG RECORDS.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('envLogs', id);
    const next = envLogs.filter(l => l.id !== id);
    setEnvLogs(next);
    sendSystemActivity(`ADMIN ${currentUser} deleted space audit log record ${id}.`);
  };

  const handleAddForkliftCheck = (check: ForkliftChecklist) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const nextForkliftChecks = [check, ...forkliftChecks];
    setForkliftChecks(nextForkliftChecks);
    upsertRecordLocallyAndRemotely('forkliftChecks', check, `Logged Forklift ${check.forkliftId} pre-op inspection`);

    const isForkliftOk = check.brakesOk && check.lightsOk && check.hydraulicOk && check.steeringOk && check.tiresOk && check.batteryFluidOk;
    sendSystemActivity(`${currentUser} logged Forklift ${check.forkliftId} pre-op check. Passed: ${isForkliftOk}.`);
  };

  // OPERATOR EDIT / DELETE HANDLERS
  const handleAddStock = (item: MaterialStockItem) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const next = [item, ...stocks];
    setStocks(next);
    upsertRecordLocallyAndRemotely('stocks', item, `Added stock batch ${item.partCode}`);
    sendSystemActivity(`${currentUser} added stock batch ${item.partCode} (${item.quantity} ${item.unit}).`);
  };

  const handleUpdateStockQty = (id: string, qty: number) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
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
    if (updatedItem) {
      upsertRecordLocallyAndRemotely('stocks', updatedItem, `Updated stock ${id} quantity to ${qty}`);
    }
    sendSystemActivity(`${currentUser} updated stock ${id} quantity to ${qty}.`);
  };

  const handleUpdateStockStatus = (id: string, status: MaterialStockItem['status']) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
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
    if (updatedItem) {
      upsertRecordLocallyAndRemotely('stocks', updatedItem, `Updated stock ${id} status to ${status}`);
    }
    sendSystemActivity(`${currentUser} updated stock ${id} status to ${status}.`);
  };

  const handleEditStock = (item: MaterialStockItem) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT STOCK ITEMS.", 'error');
      return;
    }
    const next = stocks.map(s => s.id === item.id ? item : s);
    setStocks(next);
    upsertRecordLocallyAndRemotely('stocks', item, `Updated stock record ${item.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated stock record ${item.id} (${item.partCode}).`);
  };

  const handleDeleteStock = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE STOCK TRANSACTIONS.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('stocks', id);
    const next = stocks.filter(s => s.id !== id);
    setStocks(next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted stock record ${id}.`);
  };

  const handleEditReceiving = (record: ReceivingRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT RECEIVING RECORDS.", 'error');
      return;
    }
    const next = receiving.map(r => r.id === record.id ? record : r);
    setReceiving(next);
    upsertRecordLocallyAndRemotely('receiving', record, `Updated receiving record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated receiving record ${record.id} (${record.partCode}).`);
  };

  const handleDeleteReceiving = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE RECEIVING TRANSACTIONS.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('receiving', id);
    const next = receiving.filter(r => r.id !== id);
    setReceiving(next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted receiving record ${id}.`);
  };

  const handleEditReturn = (record: ReturnRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT RETURN RECORDS.", 'error');
      return;
    }
    const next = returns.map(r => r.id === record.id ? record : r);
    setReturns(next);
    upsertRecordLocallyAndRemotely('returns', record, `Updated return record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated return record ${record.id} (${record.partCode}).`);
  };

  const handleDeleteReturn = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE RETURN TRANSACTIONS.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('returns', id);
    const next = returns.filter(r => r.id !== id);
    setReturns(next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted return record ${id}.`);
  };

  const handleEditIssuance = (record: IssuanceRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT ISSUANCE RECORDS.", 'error');
      return;
    }
    const next = issuances.map(i => i.id === record.id ? record : i);
    setIssuances(next);
    upsertRecordLocallyAndRemotely('issuances', record, `Updated issuance record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated issuance record ${record.id} (${record.partCode}).`);
  };

  const handleDeleteIssuance = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE ISSUANCE TRANSACTIONS.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('issuances', id);
    const next = issuances.filter(i => i.id !== id);
    setIssuances(next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted issuance record ${id}.`);
  };

  const handleEditDelivery = (record: DeliveryRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT DELIVERY RECORDS.", 'error');
      return;
    }
    const next = deliveries.map(d => d.id === record.id ? record : d);
    setDeliveries(next);
    upsertRecordLocallyAndRemotely('deliveries', record, `Updated delivery record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated delivery record ${record.id} (${record.gatePassNumber}).`);
  };

  const handleDeleteDelivery = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE DELIVERY TRANSACTIONS.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('deliveries', id);
    const next = deliveries.filter(d => d.id !== id);
    setDeliveries(next);
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
      registeredUsers: registeredUsers.map(({ pin: _p, ...safeUser }) => safeUser)
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
      showPrintToast('Failed to generate export file. Please check console for details.', 'error');
    }
  };

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
          showPrintToast('Backup restored and synchronized successfully across all JUWEI real-time clients!', 'info');
        } catch (err) {
          showPrintToast('Invalid backup file structure.', 'error');
        }
      };
    }
  };

  const handleRegisterMasterItem = (item: MasterRegistryItem) => {
    const next = [item, ...registries];
    setRegistries(next);
    upsertRecordLocallyAndRemotely('registries', item, `Registered master item ${item.name} (${item.code})`);
  };

  const handleUpdateMasterItem = (item: MasterRegistryItem) => {
    const next = registries.map(r => r.id === item.id ? item : r);
    setRegistries(next);
    upsertRecordLocallyAndRemotely('registries', item, `Updated master item ${item.name} (${item.code})`);
  };

  const handleDeleteMasterItem = (id: string) => {
    deleteRecordLocallyAndRemotely('registries', id);
    const next = registries.filter(r => r.id !== id);
    setRegistries(next);
  };

  const handleResetMasterDefaults = () => {
    setRegistries(DEFAULT_MASTER_REGISTRIES);
    syncCollection('registries', DEFAULT_MASTER_REGISTRIES);
  };

  const handleResolveConflictKeepMine = (conflict: SyncConflictItem) => {
    setSyncConflicts((prev) => prev.filter((c) => c.id !== conflict.id));
    const latestServerVer = Number(
      conflict.currentServerRecord?.version ??
      conflict.serverVersion ??
      getExpectedVersionForRecord(conflict.collection, conflict.recordId)
    ) || 0;

    if (conflict.type === 'upsert' && conflict.localRecord) {
      const mergedRecord = {
        ...(conflict.currentServerRecord || {}),
        ...conflict.localRecord,
        version: latestServerVer
      };
      upsertRecordLocallyAndRemotely(
        conflict.collection,
        mergedRecord,
        conflict.actionDesc || `Resolved conflict for ${conflict.recordId}`,
        { overrideExpectedVersion: latestServerVer, existingMutationId: conflict.id }
      );
    } else if (conflict.type === 'delete') {
      deleteRecordLocallyAndRemotely(conflict.collection, conflict.recordId, {
        overrideExpectedVersion: latestServerVer,
        existingMutationId: conflict.id
      });
    }
  };

  const handleResolveConflictAcceptServer = (conflict: SyncConflictItem) => {
    removeConfirmedMutations([conflict.id]);
    setSyncConflicts((prev) => prev.filter((c) => c.id !== conflict.id));
    if (conflict.currentServerRecord) {
      unmarkRecordAsDeletedLocally(conflict.recordId);
      applyConfirmedRecordToState(conflict.collection, conflict.currentServerRecord);
    } else {
      removeRecordFromState(conflict.collection, conflict.recordId);
      markRecordAsDeletedLocally(conflict.recordId);
    }
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
      case 'audit': return 'Super Admin Audit Trail';
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
                if (newVersionString && !window.electronAPI?.isElectron) {
                  try {
                    localStorage.setItem('juwei_wms_web_acknowledged_version', newVersionString);
                  } catch (e) {}
                }
                setUpdateAvailable(false);
                updateAvailableRef.current = false;
                window.location.reload();
              }}
              onLater={() => {
                setBannerDismissed(true);
                updateAvailableRef.current = false;
                setUpdateAvailable(false);
                if (newVersionString) {
                  try {
                    localStorage.setItem('juwei_wms_dismissed_version', newVersionString);
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
          {isDeviceRevoked && (
            <div className="bg-rose-950/90 border border-rose-500/60 text-rose-200 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 font-mono uppercase">
              <Ban className="h-4 w-4 text-rose-400 shrink-0" />
              <span>This computer was removed from the system</span>
            </div>
          )}
          {oneTimeSetupPinNotice && (
            <div className="bg-amber-950/85 border border-amber-500/60 text-amber-100 px-3.5 py-3 rounded-xl text-xs space-y-1.5" id="one-time-initial-pin-banner">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold uppercase text-amber-300 text-[10px] tracking-wider">
                  Fresh Install • One-Time Super Admin PIN
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setLoginEmployeeId(oneTimeSetupPinNotice.employeeId);
                    setLoginPin(oneTimeSetupPinNotice.initialPin);
                  }}
                  className="text-[10px] font-mono font-bold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 px-2 py-0.5 rounded cursor-pointer"
                >
                  Use PIN
                </button>
              </div>
              <div className="flex items-center justify-between font-mono">
                <span className="text-[11px] text-amber-200">ID: <strong>{oneTimeSetupPinNotice.employeeId}</strong></span>
                <span className="text-base font-extrabold tracking-[0.25em] text-white bg-amber-900/80 border border-amber-500/40 px-2.5 py-0.5 rounded select-all">
                  {oneTimeSetupPinNotice.initialPin}
                </span>
              </div>
              <p className="text-[10px] text-amber-200/90">
                Shown once on first setup. You will be required to set a new 4-digit PIN immediately upon first login.
              </p>
            </div>
          )}
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
                src="./juwei-logo.png" 
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

        {/* Mandatory First-Login PIN Change Modal */}
        {pendingFirstLoginPinChange && (
          <div className="fixed inset-0 z-[135] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
            <div className="bg-white border border-slate-300 rounded-2xl p-6 max-w-sm w-full shadow-2xl text-slate-900 space-y-4 my-auto">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0">
                  <Lock className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase font-mono">PIN Change Required</h3>
                  <p className="text-[11px] text-slate-500">
                    Set a new 4-digit PIN for {pendingFirstLoginPinChange.user.username} ({pendingFirstLoginPinChange.user.employeeId}) before continuing.
                  </p>
                </div>
              </div>

              {firstLoginPinError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold px-3 py-2 rounded-lg">
                  {firstLoginPinError}
                </div>
              )}

              <form onSubmit={handleSubmitFirstLoginPinChange} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase font-mono mb-1">
                    New 4-Digit PIN
                  </label>
                  <input
                    type="password"
                    maxLength={4}
                    required
                    autoFocus
                    inputMode="numeric"
                    placeholder="••••"
                    value={firstLoginNewPin}
                    onChange={(e) => setFirstLoginNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono font-bold tracking-widest text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase font-mono mb-1">
                    Confirm New 4-Digit PIN
                  </label>
                  <input
                    type="password"
                    maxLength={4}
                    required
                    inputMode="numeric"
                    placeholder="••••"
                    value={firstLoginConfirmPin}
                    onChange={(e) => setFirstLoginConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono font-bold tracking-widest text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={isSavingFirstLoginPin}
                    onClick={() => {
                      setPendingFirstLoginPinChange(null);
                      setFirstLoginPinError('');
                    }}
                    className="px-3.5 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingFirstLoginPin}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold uppercase cursor-pointer disabled:opacity-50"
                  >
                    {isSavingFirstLoginPin ? 'Saving...' : 'Save PIN & Sign In'}
                  </button>
                </div>
              </form>
            </div>
          </div>
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
              src="./juwei-logo.png" 
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
            <div className="relative flex items-center">
              <button 
                onClick={() => setView('dashboard')}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                  dashboardAlertCount > 0 ? 'pr-12' : ''
                } ${
                  view === 'dashboard' 
                    ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
                }`}
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" /> Dashboard Overview
              </button>
              {dashboardAlertCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setView('dashboard');
                    setOpenDashboardAlertsSignal(n => n + 1);
                  }}
                  id="nav-dashboard-alerts-badge"
                  title="View low-stock and shelf-life alerts"
                  className="absolute right-2.5 px-1.5 py-0.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-mono font-extrabold tabular-nums leading-none shadow-xs cursor-pointer transition"
                >
                  {dashboardAlertCount}
                </button>
              )}
            </div>

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
              <>
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
                <button 
                  onClick={() => setView('audit')}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                    view === 'audit' 
                      ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md' 
                      : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
                  }`}
                  id="nav-audit-viewer"
                >
                  <FileClock className="h-4 w-4 shrink-0" /> Audit Trail
                </button>
              </>
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
              if (newVersionString && !window.electronAPI?.isElectron) {
                try {
                  localStorage.setItem('juwei_wms_web_acknowledged_version', newVersionString);
                } catch (e) {}
              }
              setUpdateAvailable(false);
              updateAvailableRef.current = false;
              window.location.reload();
            }}
            onLater={() => {
              setBannerDismissed(true);
              updateAvailableRef.current = false;
              setUpdateAvailable(false);
              if (newVersionString) {
                try {
                  localStorage.setItem('juwei_wms_dismissed_version', newVersionString);
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
              onOpenConflicts={() => setShowConflictsModal(true)}
            />

            {/* Quick Record Lookup Barcode / QR Scanner Button */}
            <button
              type="button"
              onClick={() => {
                setQuickLookupTerm('');
                setShowQuickLookupScanner(true);
              }}
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white px-2.5 sm:px-3 h-8 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 shadow-xs shadow-indigo-500/25 border border-indigo-500/40"
              title="Quick Record Lookup: Scan lot number, part barcode, or QR tag (Alt+S or Ctrl+B)"
              aria-label="Quick Record Lookup Barcode / QR Scanner"
              id="header-barcode-scanner-button"
            >
              <Barcode className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline font-medium">Quick Scan</span>
            </button>

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

        {/* REVOKED DEVICE HARD STOP BANNER */}
        {isDeviceRevoked && (
          <div className="bg-rose-600 text-white px-4 sm:px-6 lg:px-8 py-2.5 text-xs font-semibold flex items-center justify-between gap-4 border-b border-rose-700 font-mono uppercase shrink-0" id="device-revoked-banner">
            <div className="flex items-center gap-2">
              <Ban className="h-4 w-4 shrink-0" />
              <span>This computer was removed from the system — Synchronization suspended</span>
            </div>
            <span className="bg-rose-800 text-rose-50 px-2 py-0.5 rounded text-[10px] tracking-wider shrink-0">DEVICE REVOKED</span>
          </div>
        )}

        {/* VERSION CONFLICT ALERT BANNER */}
        {syncConflicts.length > 0 && (
          <div className="bg-amber-600 text-white px-4 sm:px-6 lg:px-8 py-2 text-xs font-semibold flex items-center justify-between gap-4 border-b border-amber-700 shrink-0" id="sync-conflicts-banner">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {syncConflicts.length} {syncConflicts.length === 1 ? 'record has' : 'records have'} conflicting edits with the central server. Your changes were kept safely for review.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowConflictsModal(true)}
              className="bg-white text-amber-800 hover:bg-amber-50 px-3 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer shrink-0 shadow-xs"
              id="btn-review-sync-conflicts"
            >
              Review Conflicts ({syncConflicts.length})
            </button>
          </div>
        )}

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
        <div
          className={
            view === 'dashboard'
              ? 'p-3 overflow-y-auto lg:overflow-hidden flex-1 min-h-0 w-full z-10 relative'
              : 'p-4 sm:p-6 lg:p-7 overflow-y-auto flex-1 w-full z-10 relative'
          }
          id="main-content-viewport"
        >
          <AnimatePresence mode="wait">
            <motion.div 
              key={view} 
              initial={{ opacity: 0, y: 12, scale: 0.992, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, scale: 0.992, filter: 'blur(8px)' }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className={view === 'dashboard' ? 'w-full lg:h-full lg:min-h-0' : 'w-full'}
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
                  openAlertsSignal={openDashboardAlertsSignal}
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
                  fifoColorsByMonth={fifoColorsByMonth}
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
                  fifoColorsByMonth={fifoColorsByMonth}
                  onUpdateFifoColors={handleUpdateFifoColors}
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
                  categories={receivingCategories}
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

              {view === 'audit' && (currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002' || (currentUser || '').toUpperCase().includes('ALDRIN') || (currentRole || '').toUpperCase().includes('SUPER')) && (
                <AuditViewerModule
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002' || (currentUser || '').toUpperCase().includes('ALDRIN') || (currentRole || '').toUpperCase().includes('SUPER')}
                  currentUser={currentUser}
                  currentEmployeeId={currentEmployeeId}
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

      {/* Quick Record Lookup Barcode / QR Scanner Modal */}
      {showQuickLookupScanner && (
        <BarcodeScannerModal
          isOpen={showQuickLookupScanner}
          onClose={() => setShowQuickLookupScanner(false)}
          title="Quick Record Lookup Barcode & QR Scanner"
          subtitle="Scan material tag, roll barcode, lot label, or requisition QR code"
          onScanResult={handleQuickLookupScan}
        />
      )}

      {/* Quick Record Lookup Results Modal */}
      {showQuickLookupResults && (
        <QuickRecordLookupModal
          isOpen={showQuickLookupResults}
          onClose={() => setShowQuickLookupResults(false)}
          onOpenScanner={() => {
            setShowQuickLookupResults(false);
            setShowQuickLookupScanner(true);
          }}
          searchTerm={quickLookupTerm}
          onSearchTermChange={setQuickLookupTerm}
          stocks={stocks}
          receiving={receiving}
          issuances={issuances}
          deliveries={deliveries}
          returns={returns}
          recycling={recycling}
          registries={registries}
          onNavigateToModule={handleNavigateFromLookup}
        />
      )}

      {/* Sync Conflict Resolution Review Modal */}
      {showConflictsModal && (
        <div
          className="fixed inset-0 z-[135] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowConflictsModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl text-slate-900 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-amber-50/70">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Sync Conflicts Review ({syncConflicts.length})</h3>
                  <p className="text-xs text-slate-600">
                    Another workstation updated these records before your change reached the server.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConflictsModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                aria-label="Close conflict review"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 flex-1 bg-slate-50/50">
              {syncConflicts.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  No remaining sync conflicts.
                </div>
              ) : (
                syncConflicts.map((conflict) => (
                  <div key={conflict.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono text-[10px] font-bold uppercase">
                          {conflict.collection}
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-800">{conflict.recordId}</span>
                        <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 font-mono text-[10px] uppercase">
                          {conflict.type}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        Expected v{conflict.expectedVersion ?? '?'} vs Server v{conflict.serverVersion ?? conflict.currentServerRecord?.version ?? '?'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                      <div className="bg-amber-50/50 border border-amber-200/70 rounded-lg p-2.5 overflow-x-auto">
                        <div className="font-bold text-amber-900 uppercase font-mono text-[10px] mb-1">Your Local Change</div>
                        {conflict.type === 'delete' ? (
                          <div className="text-rose-700 font-mono">Requested Deletion of {conflict.recordId}</div>
                        ) : (
                          <pre className="text-[10px] font-mono text-slate-700 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                            {JSON.stringify(conflict.localRecord || {}, null, 2)}
                          </pre>
                        )}
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 overflow-x-auto">
                        <div className="font-bold text-slate-800 uppercase font-mono text-[10px] mb-1">Current Server Record</div>
                        {conflict.currentServerRecord ? (
                          <pre className="text-[10px] font-mono text-slate-700 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                            {JSON.stringify(conflict.currentServerRecord, null, 2)}
                          </pre>
                        ) : (
                          <div className="text-slate-500 font-mono">Record removed on server</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleResolveConflictAcceptServer(conflict)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition cursor-pointer"
                      >
                        Accept Server Version
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolveConflictKeepMine(conflict)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white transition cursor-pointer"
                      >
                        Keep My Change & Retry
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-white flex justify-end">
              <button
                type="button"
                onClick={() => setShowConflictsModal(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
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

