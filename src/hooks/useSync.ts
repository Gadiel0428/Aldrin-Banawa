/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  syncManager,
  FORCE_FLUSH_MUTATIONS_EVENT,
  DEVICE_REVOKED_EVENT,
  calculateRetryBackoffMs,
  getMutationQueue,
  saveMutationQueue,
  enqueueMutation,
  removeConfirmedMutations
} from '../sync/syncManager';
import {
  MaterialStockItem,
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
  ChatMessage,
  StockMovement
} from '../types';
import {
  DEFAULT_FIFO_COLORS_BY_MONTH,
  normalizeFifoColor
} from '../data';
import { DEFAULT_OPERATIONAL_ROLES } from '../components/RegisteredAccountsModule';
import {
  getCentralServerUrl,
  getCentralServerHost,
  getApiBaseUrl,
  getCentralWebSocketUrl,
  getAuthHeaders,
  getStoredSessionToken,
  sanitizeServerHost,
  isSecureHost as isSecureServerHost
} from '../config/serverConfig';
import { showPrintToast } from '../utils/printDocument';
import logger from '../lib/logger';
import { normalizeUnitCode, resolveMasterDataUnit } from '../../shared/units';
import { translate, localizeValidationMessage } from '../i18n';

export function getDefaultServerAddress(): string {
  return getCentralServerHost();
}

export function wsOpen(ws: WebSocket | null): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function getPersistentDeviceId(): string {
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
}

export function getPlatformType(): string {
  if (typeof window === 'undefined') return 'Desktop';
  const ua = window.navigator.userAgent || '';
  if (/android/i.test(ua)) return 'Android';
  if (/ipad|iphone|ipod/i.test(ua)) return 'iOS';
  if (/windows/i.test(ua)) return 'Windows';
  return 'Desktop';
}

export function getStationId(): string {
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
}

export function getPlatformName(): string {
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
}

// Accurate semver comparator: returns true ONLY if candidate is strictly newer than current
export function isNewerVersion(candidateVer?: string, currentVer?: string): boolean {
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
}

export const SUPER_ADMIN_ACCOUNT: RegisteredAccount = {
  username: 'ALDRIN BANAWA',
  role: 'SUPER ADMINISTRATOR',
  employeeId: 'JPMP-002',
  phoneNumber: '+639669858846',
  permission: 'FULL_ACCESS',
  maxDevices: 2,
  hasPin: true,
  status: 'ACTIVE'
};

export interface UseSyncParams {
  currentUser: string;
  currentRole: string;
  currentEmployeeId: string;
  currentPermission: string;
  isLoggedIn: boolean;
  view: string;
  setCurrentUser: React.Dispatch<React.SetStateAction<string>>;
  setCurrentRole: React.Dispatch<React.SetStateAction<string>>;
  setCurrentPermission: React.Dispatch<React.SetStateAction<string>>;
  onLogoutRef: React.MutableRefObject<() => void>;
}

export function useSync({
  currentUser,
  currentRole,
  currentEmployeeId,
  currentPermission,
  isLoggedIn,
  view,
  setCurrentUser,
  setCurrentRole,
  setCurrentPermission,
  onLogoutRef
}: UseSyncParams) {
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
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);

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
    registries: [],
    stockMovements: []
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
    registries,
    stockMovements
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

  const mergeStockMovementEntry = (prev: StockMovement[], incoming: StockMovement): StockMovement[] => {
    if (!incoming) return prev;
    const key = String(incoming.idempotency_key || '').trim();
    const existsIdx = prev.findIndex(
      (m) =>
        (key && String(m.idempotency_key || '').trim() === key) ||
        (incoming.id && String(m.id) === String(incoming.id))
    );
    if (existsIdx >= 0) {
      const next = [...prev];
      next[existsIdx] = incoming;
      return next;
    }
    return [incoming, ...prev];
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onLocalMovement = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      const result = detail?.result;
      const input = detail?.input;
      if (!result || !result.success) return;

      const movRecord: StockMovement = {
        id: result.movementId || `mov-${Date.now()}`,
        product_id: result.productId || input?.productId || '',
        warehouse_id: result.warehouseId || input?.warehouseId || 'wh-main',
        type: input?.type || 'ADJUSTMENT_IN',
        quantity: Number(result.delta ?? detail?.delta ?? 0),
        previous_quantity: Number(result.previousQuantity) || 0,
        new_quantity: result.newQuantity !== undefined ? Number(result.newQuantity) : undefined,
        reference_id: input?.referenceId ?? null,
        reference_number: input?.referenceNumber ?? null,
        notes: input?.notes ?? null,
        user_id: input?.userId ?? null,
        user_name: input?.userName,
        device_id: input?.deviceId,
        idempotency_key: detail?.idempotencyKey || input?.idempotencyKey || null,
        created_at: result.timestamp || new Date().toISOString(),
        unit: normalizeUnitCode(input?.unit) || undefined,
        lot_number: input?.lotNumber,
        location: input?.location,
      };
      setStockMovements((prev) => mergeStockMovementEntry(prev, movRecord));
      if (typeof result.newQuantity === 'number' && !Number.isNaN(result.newQuantity)) {
        const targetProdId = String(result.productId || input?.productId || '');
        if (targetProdId) {
          setStocks((prev) =>
            prev.map((s) =>
              String(s.id) === targetProdId || String(s.partCode) === targetProdId
                ? { ...s, quantity: result.newQuantity }
                : s
            )
          );
        }
      }
    };
    window.addEventListener('juwei_stock_movement_executed', onLocalMovement);
    return () => window.removeEventListener('juwei_stock_movement_executed', onLocalMovement);
  }, []);

  // Unique session and connection IDs for this client tab
  const clientSessionId = useRef<string>(`sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
  const clientConnectionId = useRef<string>('');

  // Real-time states
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const runSyncCheckRef = useRef<(() => Promise<boolean>) | null>(null);
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

  // Cross-tab zero-latency synchronization channel
  const syncChannelRef = useRef<BroadcastChannel | null>(null);

  const superAdminAccount = SUPER_ADMIN_ACCOUNT;

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

  const [registeredUsers, setRegisteredUsers] = useState<RegisteredAccount[]>([superAdminAccount]);

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

      if (connId && connId === myConnId && item.source !== 'self') {
        continue;
      }
      if (!connId && item.stationId === myStationId && item.source !== 'self') {
        continue;
      }

      if (item.source === 'local' && item.lastPing && (now - item.lastPing > 30000)) {
        continue;
      }

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
    return [];
  });

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

  // Normalizer helper for records coming from central database, REST, and WebSocket
  const normalizeRecords = (
    colName: string,
    items: any[],
    overrideRegistries?: MasterRegistryItem[],
    overrideStocks?: MaterialStockItem[]
  ): any[] => {
    if (!Array.isArray(items)) return [];
    const activeRegistries = overrideRegistries ?? (collectionsRef.current.registries as MasterRegistryItem[]) ?? [];
    const activeStocks = overrideStocks ?? (collectionsRef.current.stocks as MaterialStockItem[]) ?? [];
    const normalized = items.map((r: any) => {
      if (!r || typeof r !== 'object') return r;
      const versionMeta = {
        ...(r.version !== undefined && r.version !== null ? { version: Number(r.version) } : {}),
        ...(r.updated_at ? { updated_at: r.updated_at } : {}),
        ...(r.reset_version !== undefined && r.reset_version !== null ? { reset_version: Number(r.reset_version) } : {})
      };
      switch (colName) {
        case 'stocks': {
          const partCode = r.partCode || r.part_code || '';
          const description = r.description || '';
          const lotNumber = r.lotNumber || r.lot_number || '';
          const resolvedUnit = resolveMasterDataUnit(
            { unit: r.unit, partCode, description, lotNumber, stockId: r.id },
            activeRegistries,
            activeStocks
          );
          return {
            id: r.id || `STK-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            partCode,
            description,
            type: r.type || 'RAW',
            location: r.location || 'Zone A',
            quantity: Number(r.quantity) || 0,
            unit: resolvedUnit.unit,
            ...(resolvedUnit.isMissing ? { unitMissing: true } : { unitMissing: false }),
            lotNumber,
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
            bom: Array.isArray(r.bom)
              ? r.bom.map((b: any) => b && typeof b === 'object' ? { ...b, unit: resolveMasterDataUnit(b, activeRegistries, activeStocks).unit } : b)
              : [],
            ...versionMeta
          };
        }
        case 'receiving': {
          const partCode = r.partCode || r.part_code || '';
          const itemDescription = r.itemDescription || r.item_description || '';
          const lotNumber = r.lotNumber || r.lot_number || '';
          const resolvedUnit = resolveMasterDataUnit(
            { unit: r.unit, partCode, itemDescription, lotNumber, stockId: r.stockId || r.stock_id },
            activeRegistries,
            activeStocks
          );
          return {
            id: r.id || `RCV-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            receivedDate: r.receivedDate || r.received_date || r.date,
            expirationDate: r.expirationDate || r.expiration_date || undefined,
            location: r.location,
            vendorSupplier: r.vendorSupplier || r.vendor_supplier,
            reorderMin: r.reorderMin || r.reorder_min ? Number(r.reorderMin || r.reorder_min) : undefined,
            remarks: r.remarks,
            source: r.source || 'Resin(External)',
            itemDescription,
            partCode,
            modelName: r.modelName || r.model_name,
            color: r.color,
            quantity: Number(r.quantity) || 0,
            unit: resolvedUnit.unit,
            ...(resolvedUnit.isMissing ? { unitMissing: true } : { unitMissing: false }),
            lotNumber,
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
            bom: Array.isArray(r.bom)
              ? r.bom.map((b: any) => b && typeof b === 'object' ? { ...b, unit: resolveMasterDataUnit(b, activeRegistries, activeStocks).unit } : b)
              : [],
            autoDeductBom: Boolean(r.autoDeductBom || r.auto_deduct_bom),
            customer: r.customer,
            ...(r.stockId || r.stock_id ? { stockId: r.stockId || r.stock_id } : {}),
            ...(r.movementIdempotencyKey || r.movement_idempotency_key ? { movementIdempotencyKey: r.movementIdempotencyKey || r.movement_idempotency_key } : {}),
            ...versionMeta
          };
        }
        case 'returns': {
          const partCode = r.partCode || r.part_code || '';
          const materialDescription = r.materialDescription || r.material_description || '';
          const lotNumber = r.lotNumber || r.lot_number || '';
          const resolvedUnit = resolveMasterDataUnit(
            { unit: r.unit, partCode, materialDescription, lotNumber, stockId: r.stockId || r.stock_id },
            activeRegistries,
            activeStocks
          );
          return {
            id: r.id || `RET-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            category: r.category,
            materialDescription,
            partCode,
            quantity: Number(r.quantity) || 0,
            unit: resolvedUnit.unit,
            ...(resolvedUnit.isMissing ? { unitMissing: true } : { unitMissing: false }),
            lotNumber,
            department: r.department || 'Production',
            reason: r.reason || 'Excess Material',
            condition: r.condition || 'Good',
            iqcEvaluation: r.iqcEvaluation || r.iqc_evaluation || 'PENDING_IQC',
            status: r.status || 'PENDING',
            returnSlipFormNumber: r.returnSlipFormNumber || r.return_slip_form_number || '',
            ...(r.stockId || r.stock_id ? { stockId: r.stockId || r.stock_id } : {}),
            ...(r.movementIdempotencyKey || r.movement_idempotency_key ? { movementIdempotencyKey: r.movementIdempotencyKey || r.movement_idempotency_key } : {}),
            ...versionMeta
          };
        }
        case 'recycling': {
          const itemType = r.itemType || r.item_type || 'Carton Box';
          const resolvedUnit = resolveMasterDataUnit(
            { unit: r.unit, itemType, description: itemType, stockId: r.stockId || r.stock_id },
            activeRegistries,
            activeStocks
          );
          return {
            id: r.id || `CYC-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            itemType,
            quantity: Number(r.quantity) || 0,
            unit: resolvedUnit.unit,
            ...(resolvedUnit.isMissing ? { unitMissing: true } : { unitMissing: false }),
            condition: r.condition || 'Reusable',
            reuseCycleCount: Number(r.reuseCycleCount || r.reuse_cycle_count) || 1,
            disposition: r.disposition || 'Re-used',
            logSheetNumber: r.logSheetNumber || r.log_sheet_number || '',
            ...(r.stockId || r.stock_id ? { stockId: r.stockId || r.stock_id } : {}),
            ...(r.movementIdempotencyKey || r.movement_idempotency_key ? { movementIdempotencyKey: r.movementIdempotencyKey || r.movement_idempotency_key } : {}),
            ...versionMeta
          };
        }
        case 'issuances': {
          const partCode = r.partCode || r.part_code || '';
          const description = r.description || '';
          const lotNumber = r.lotNumber || r.lot_number || '';
          const resolvedUnit = resolveMasterDataUnit(
            { unit: r.unit, partCode, description, lotNumber, stockId: r.stockId || r.stock_id },
            activeRegistries,
            activeStocks
          );
          return {
            id: r.id || `ISS-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            requisitionNumber: r.requisitionNumber || r.requisition_number || '',
            department: r.department || 'Assembly',
            partCode,
            description,
            quantityRequested: Number(r.quantityRequested || r.quantity_requested) || 0,
            quantityIssued: Number(r.quantityIssued || r.quantity_issued) || 0,
            unit: resolvedUnit.unit,
            ...(resolvedUnit.isMissing ? { unitMissing: true } : { unitMissing: false }),
            lotNumber,
            fifoVerified: Boolean(r.fifoVerified || r.fifo_verified),
            issuedBy: r.issuedBy || r.issued_by || 'Storekeeper',
            receivedBy: r.receivedBy || r.received_by || 'Line Operator',
            ...(r.stockId || r.stock_id ? { stockId: r.stockId || r.stock_id } : {}),
            ...(r.movementIdempotencyKey || r.movement_idempotency_key ? { movementIdempotencyKey: r.movementIdempotencyKey || r.movement_idempotency_key } : {}),
            ...versionMeta
          };
        }
        case 'deliveries': {
          const partCode = r.partCode || r.part_code || '';
          const modelName = r.modelName || r.model_name || '';
          const resolvedUnit = resolveMasterDataUnit(
            { unit: r.unit, partCode, modelName, stockId: r.stockId || r.stock_id },
            activeRegistries,
            activeStocks
          );
          return {
            id: r.id || `DEL-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            date: r.date || new Date().toISOString().split('T')[0],
            pickingListNumber: r.pickingListNumber || r.picking_list_number || '',
            poNumber: r.poNumber || r.po_number || '',
            modelName,
            partCode,
            quantity: Number(r.quantity) || 0,
            unit: resolvedUnit.unit,
            ...(resolvedUnit.isMissing ? { unitMissing: true } : { unitMissing: false }),
            packagingConditionOk: Boolean(r.packagingConditionOk ?? r.packaging_condition_ok ?? true),
            fifoVerified: Boolean(r.fifoVerified ?? r.fifo_verified ?? false),
            forkliftChecklistSigned: Boolean(r.forkliftChecklistSigned ?? r.forklift_checklist_signed ?? false),
            gatePassNumber: r.gatePassNumber || r.gate_pass_number || '',
            drNumber: r.drNumber || r.dr_number,
            salesInvoice: r.salesInvoice || r.sales_invoice,
            wayBill: r.wayBill || r.way_bill,
            status: r.status || 'PREPARING',
            preparedBy: r.preparedBy || r.prepared_by || 'Dispatch Supervisor',
            loadedBy: r.loadedBy || r.loaded_by,
            ...(r.stockId || r.stock_id ? { stockId: r.stockId || r.stock_id } : {}),
            ...(r.movementIdempotencyKey || r.movement_idempotency_key ? { movementIdempotencyKey: r.movementIdempotencyKey || r.movement_idempotency_key } : {}),
            ...versionMeta
          };
        }
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
        case 'registries': {
          const normUnit = normalizeUnitCode(r.unit);
          const regType = r.type || 'PART_CODE';
          return {
            id: r.id || `REG-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            type: regType,
            code: r.code || '',
            name: r.name || '',
            description: r.description,
            status: r.status || 'ACTIVE',
            dateRegistered: r.dateRegistered || r.date_registered || new Date().toISOString().split('T')[0],
            presetSource: r.presetSource || r.preset_source,
            category: r.category,
            vendorSupplier: r.vendorSupplier || r.vendor_supplier,
            unit: normUnit,
            ...(regType === 'BARCODE_PRESET' && !normUnit ? { unitMissing: true } : {}),
            location: r.location,
            ...versionMeta
          };
        }
        case 'stockMovements': {
          const resolvedUnit = resolveMasterDataUnit(
            {
              unit: r.unit,
              partCode: r.product_sku,
              description: r.product_name,
              lotNumber: r.lot_number,
              stockId: r.product_id,
            },
            activeRegistries,
            activeStocks
          );
          return {
            ...r,
            unit: resolvedUnit.unit,
            ...(resolvedUnit.isMissing ? { unitMissing: true } : { unitMissing: false }),
          };
        }
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

  const deletedRecordIds = useRef<Set<string>>(getDeletedRecordIds());
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
      showPrintToast(translate('toasts.deviceRemoved'), 'error');
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
    showPrintToast(translate('toasts.syncConflict', { collection: conflictInput.collection, recordId: conflictInput.recordId }), 'warning');
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

  const areValuesEquivalent = (valA: any, valB: any): boolean => {
    if (valA === valB) return true;
    const isBlankA = valA === null || valA === undefined || valA === '' || (Array.isArray(valA) && valA.length === 0) || (typeof valA === 'object' && valA !== null && Object.keys(valA).length === 0);
    const isBlankB = valB === null || valB === undefined || valB === '' || (Array.isArray(valB) && valB.length === 0) || (typeof valB === 'object' && valB !== null && Object.keys(valB).length === 0);
    if (isBlankA && isBlankB) return true;
    if (isBlankA !== isBlankB) return false;

    if ((typeof valA === 'number' && typeof valB === 'string') || (typeof valA === 'string' && typeof valB === 'number')) {
      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA === numB;
      }
    }

    if (typeof valA === 'boolean' && typeof valB === 'string') {
      return String(valA) === valB.toLowerCase();
    }
    if (typeof valA === 'string' && typeof valB === 'boolean') {
      return valA.toLowerCase() === String(valB);
    }

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

    const filteredIncoming = incomingArr.filter(item => {
      if (!item || (!item.id && !item.record_id)) return false;
      if (item.reset_version && currentResetVer > 0 && Number(item.reset_version) < currentResetVer) return false;
      return true;
    });

    const mergedMap = new Map<string, any>();

    for (const remoteItem of filteredIncoming) {
      const recId = String(remoteItem.id || remoteItem.record_id);
      mergedMap.set(recId, remoteItem);
    }

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

    if (areCollectionsEqual(safeCurrent, resultList)) {
      return safeCurrent;
    }

    return resultList;
  };

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

  const reconcileUsers = (currentUsers: RegisteredAccount[], incomingUsers: any[]): RegisteredAccount[] => {
    const deletedSet = getDeletedUserIds();
    const userMap = new Map<string, RegisteredAccount>();

    const incomingList = Array.isArray(incomingUsers) ? incomingUsers : [];
    const safeCurrent = Array.isArray(currentUsers) ? currentUsers : [];

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
      stockMovements: sm,
      registeredUsers: serverUsers,
      chatMessages: msgs
    } = dataPayload;

    const normReg = normalizeRecords('registries', Array.isArray(reg) ? reg : []) as MasterRegistryItem[];
    collectionsRef.current.registries = normReg;
    const normStocks = normalizeRecords('stocks', Array.isArray(s) ? s : [], normReg) as MaterialStockItem[];
    collectionsRef.current.stocks = normStocks;

    setRegistries(prev => reconcileCollection('registries', prev, normReg));
    setStocks(prev => reconcileCollection('stocks', prev, normStocks));
    setReceiving(prev => reconcileCollection('receiving', prev, normalizeRecords('receiving', Array.isArray(rc) ? rc : [], normReg, normStocks)));
    setReturns(prev => reconcileCollection('returns', prev, normalizeRecords('returns', Array.isArray(rt) ? rt : [], normReg, normStocks)));
    setRecycling(prev => reconcileCollection('recycling', prev, normalizeRecords('recycling', Array.isArray(cy) ? cy : [], normReg, normStocks)));
    setIssuances(prev => reconcileCollection('issuances', prev, normalizeRecords('issuances', Array.isArray(is) ? is : [], normReg, normStocks)));
    setDeliveries(prev => reconcileCollection('deliveries', prev, normalizeRecords('deliveries', Array.isArray(d) ? d : [], normReg, normStocks)));
    setEnvLogs(prev => reconcileCollection('envLogs', prev, normalizeRecords('envLogs', Array.isArray(e) ? e : [])));
    setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, normalizeRecords('forkliftChecks', Array.isArray(f) ? f : [])));
    setStockMovements(Array.isArray(sm) ? normalizeRecords('stockMovements', sm, normReg, normStocks) : []);

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

  // Auto-dismiss live sync toast notifications after 2.8 seconds
  useEffect(() => {
    if (liveSyncToast) {
      const timer = setTimeout(() => {
        setLiveSyncToast(null);
      }, 2800);
      return () => clearTimeout(timer);
    }
  }, [liveSyncToast]);

  // Keep active logged-in user's role, permissions, and status in sync with live registered accounts directory
  useEffect(() => {
    if (!isLoggedIn || !currentEmployeeId) return;
    const cleanId = currentEmployeeId.toUpperCase();
    const currentRecord = registeredUsers.find(u => (u.employeeId || '').toUpperCase() === cleanId);

    if (!currentRecord) {
      return;
    }

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

  // Cross-tab BroadcastChannel listener & heartbeat
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
                  action: actionDesc || translate('toasts.updatedRecord', { collection }),
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
                  action: translate('toasts.registeredOperator', { username: user.username || user.employeeId, employeeId: user.employeeId }),
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
                  action: translate('toasts.updatedOperator', { username: user.username || user.employeeId, employeeId: user.employeeId }),
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
              action: translate('toasts.globalResetComplete'),
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
                action: translate('toasts.terminalInstalled', { stationId: payload.stationId, platform: payload.platform || 'Device' }),
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              });
            }
          } else if (payload.type === 'activity_toast') {
            setLiveSyncToast({
              id: String(Date.now()),
              author: payload.author || 'Workstation',
              action: payload.action || translate('toasts.updatedData'),
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            });
          }
        };

        channel.postMessage({
          type: 'presence_request',
          fromStationId: getStationId()
        });

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

  // Enforce document title and favicon with live appVersion
  useEffect(() => {
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
    const BUILD_INFO_INTERVAL_MS = 60 * 60 * 1000;
    const isFileOrigin = typeof window !== 'undefined' && window.location?.protocol === 'file:';
    const isElectronEnv = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

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
            const { stocks: s, receiving: r, returns: ret, recycling: rec, issuances: iss, deliveries: del, envLogs: el, forkliftChecks: fc, registries: reg, stockMovements: sm, registeredUsers: ru, chatMessages: cm } = json.data;
            const normReg = Array.isArray(reg) ? normalizeRecords('registries', reg) as MasterRegistryItem[] : collectionsRef.current.registries;
            if (Array.isArray(reg)) {
              collectionsRef.current.registries = normReg;
              setRegistries(normReg);
            }
            const normStocks = Array.isArray(s) ? normalizeRecords('stocks', s, normReg) as MaterialStockItem[] : collectionsRef.current.stocks;
            if (Array.isArray(s)) {
              collectionsRef.current.stocks = normStocks;
              setStocks(normStocks);
            }
            if (Array.isArray(r)) setReceiving(normalizeRecords('receiving', r, normReg, normStocks));
            if (Array.isArray(ret)) setReturns(normalizeRecords('returns', ret, normReg, normStocks));
            if (Array.isArray(rec)) setRecycling(normalizeRecords('recycling', rec, normReg, normStocks));
            if (Array.isArray(iss)) setIssuances(normalizeRecords('issuances', iss, normReg, normStocks));
            if (Array.isArray(del)) setDeliveries(normalizeRecords('deliveries', del, normReg, normStocks));
            if (Array.isArray(el)) setEnvLogs(normalizeRecords('envLogs', el));
            if (Array.isArray(fc)) setForkliftChecks(normalizeRecords('forkliftChecks', fc));
            if (Array.isArray(sm)) setStockMovements(normalizeRecords('stockMovements', sm, normReg, normStocks));
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
        action: isUserInitiated ? translate('toasts.freshInstallResynced') : translate('toasts.freshInstallSynced'),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });
    } catch (e) {
      console.warn('performFreshInstallAndSync error:', e);
    }
  };

  useEffect(() => {
    try {
      const isInstalled = localStorage.getItem('juwei_wms_installed_flag_v1');
      if (!isInstalled) {
        logger.info('[JUWEI WMS] First-time launch / fresh install detected. Initializing clean station & syncing...');
        performFreshInstallAndSync(false);
      }
    } catch (e) {}
  }, []);

  const upsertRecordLocallyAndRemotely = (
    collection: string,
    record: any,
    actionDesc?: string,
    options?: { overrideExpectedVersion?: number; existingMutationId?: string }
  ) => {
    if (!record || !record.id || !collection) return;
    if (isDeviceRevokedRef.current) {
      showPrintToast(translate('toasts.deviceRemoved'), 'error');
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
          showPrintToast(errJson.error ? localizeValidationMessage(errJson.error) : translate('toasts.serverPermissionDenied'), 'error');
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
        if (res.status === 400) {
          const errJson = await res.json().catch(() => ({}));
          removeConfirmedMutations([clientMutationId]);
          showPrintToast(errJson.error ? localizeValidationMessage(errJson.error) : translate('toasts.serverValidationError'), 'error');
          runSyncCheckRef.current?.();
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

    enqueueMutation(mutationRecord);
  };

  const deleteRecordLocallyAndRemotely = (
    collection: string,
    id: string,
    options?: { overrideExpectedVersion?: number; existingMutationId?: string }
  ) => {
    if (!id || !collection) return;
    if (isDeviceRevokedRef.current) {
      showPrintToast(translate('toasts.deviceRemoved'), 'error');
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
          showPrintToast(errJson.error ? localizeValidationMessage(errJson.error) : translate('toasts.serverPermissionDenied'), 'error');
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

    enqueueMutation(mutationRecord);
  };

  const handleManualSync = async () => {
    if (isDeviceRevokedRef.current) return;
    setIsManualSyncing(true);
    try {
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

      if (syncChannelRef.current) {
        try {
          syncChannelRef.current.postMessage({
            type: 'activity_toast',
            author: currentUser || 'Workstation',
            action: 'Requested immediate cluster data synchronization'
          });
        } catch (e) {}
      }

      const targetAddr = serverAddress.trim() || getDefaultServerAddress();
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
            const { stocks: s, receiving: rc, returns: rt, recycling: cy, issuances: is, deliveries: d, envLogs: e, forkliftChecks: f, registries: reg, stockMovements: sm, registeredUsers: ru, chatMessages: cm } = json.data;
            const normReg = Array.isArray(reg) ? normalizeRecords('registries', reg) as MasterRegistryItem[] : collectionsRef.current.registries;
            if (Array.isArray(reg)) {
              collectionsRef.current.registries = normReg;
              setRegistries(prev => reconcileCollection('registries', prev, normReg));
            }
            const normStocks = Array.isArray(s) ? normalizeRecords('stocks', s, normReg) as MaterialStockItem[] : collectionsRef.current.stocks;
            if (Array.isArray(s)) {
              collectionsRef.current.stocks = normStocks;
              setStocks(prev => reconcileCollection('stocks', prev, normStocks));
            }
            if (Array.isArray(rc)) setReceiving(prev => reconcileCollection('receiving', prev, normalizeRecords('receiving', rc, normReg, normStocks)));
            if (Array.isArray(rt)) setReturns(prev => reconcileCollection('returns', prev, normalizeRecords('returns', rt, normReg, normStocks)));
            if (Array.isArray(cy)) setRecycling(prev => reconcileCollection('recycling', prev, normalizeRecords('recycling', cy, normReg, normStocks)));
            if (Array.isArray(is)) setIssuances(prev => reconcileCollection('issuances', prev, normalizeRecords('issuances', is, normReg, normStocks)));
            if (Array.isArray(d)) setDeliveries(prev => reconcileCollection('deliveries', prev, normalizeRecords('deliveries', d, normReg, normStocks)));
            if (Array.isArray(e)) setEnvLogs(prev => reconcileCollection('envLogs', prev, normalizeRecords('envLogs', e)));
            if (Array.isArray(f)) setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, normalizeRecords('forkliftChecks', f)));
            if (Array.isArray(sm)) setStockMovements(normalizeRecords('stockMovements', sm, normReg, normStocks));
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
              const { stocks: s, receiving: rc, returns: rt, recycling: cy, issuances: is, deliveries: d, envLogs: e, forkliftChecks: f, registries: reg, stockMovements: sm, registeredUsers: ru, chatMessages: cm } = json.data;
              const normReg = Array.isArray(reg) ? normalizeRecords('registries', reg) as MasterRegistryItem[] : collectionsRef.current.registries;
              if (Array.isArray(reg)) {
                collectionsRef.current.registries = normReg;
                setRegistries(prev => reconcileCollection('registries', prev, normReg));
              }
              const normStocks = Array.isArray(s) ? normalizeRecords('stocks', s, normReg) as MaterialStockItem[] : collectionsRef.current.stocks;
              if (Array.isArray(s)) {
                collectionsRef.current.stocks = normStocks;
                setStocks(prev => reconcileCollection('stocks', prev, normStocks));
              }
              if (Array.isArray(rc)) setReceiving(prev => reconcileCollection('receiving', prev, normalizeRecords('receiving', rc, normReg, normStocks)));
              if (Array.isArray(rt)) setReturns(prev => reconcileCollection('returns', prev, normalizeRecords('returns', rt, normReg, normStocks)));
              if (Array.isArray(cy)) setRecycling(prev => reconcileCollection('recycling', prev, normalizeRecords('recycling', cy, normReg, normStocks)));
              if (Array.isArray(is)) setIssuances(prev => reconcileCollection('issuances', prev, normalizeRecords('issuances', is, normReg, normStocks)));
              if (Array.isArray(d)) setDeliveries(prev => reconcileCollection('deliveries', prev, normalizeRecords('deliveries', d, normReg, normStocks)));
              if (Array.isArray(e)) setEnvLogs(prev => reconcileCollection('envLogs', prev, normalizeRecords('envLogs', e)));
              if (Array.isArray(f)) setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, normalizeRecords('forkliftChecks', f)));
              if (Array.isArray(sm)) setStockMovements(normalizeRecords('stockMovements', sm, normReg, normStocks));
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
      const { stocks, receiving, returns, recycling, issuances, deliveries, envLogs, forkliftChecks, registries, stockMovements: serverMovements, registeredUsers: serverUsers, chatMessages: msgs } = dataPayload;

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
      if (Array.isArray(serverMovements)) {
        setStockMovements(serverMovements);
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

      checkBuildVersion();

      const centralUrl = getCentralServerUrl();
      const centralOk = await tryFetchSync(`${centralUrl}/api/sync`);
      if (centralOk) {
        await flushPendingMutationsQueue();
        return true;
      }

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
    runSyncCheckRef.current = runSyncCheck;

    const connectWebSocket = async () => {
      if (!isMounted || isDeviceRevokedRef.current) return;
      if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return;
      }

      const clientAccountId = localStorage.getItem('juwei_wms_account_id') || 'ACC-JUWEI';
      const clientWarehouseId = localStorage.getItem('juwei_wms_warehouse_id') || 'WH-MAIN';
      logger.debug(`[JUWEI WMS] Connecting WebSocket with accountId="${clientAccountId}", warehouseId="${clientWarehouseId}"`);
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
                  action: actionDesc || translate('toasts.processedInRoom', { type: payload.type }),
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
                } else if (r.status === 400) {
                  confirmedIds.push(mutId);
                  showPrintToast(r.error ? localizeValidationMessage(r.error) : translate('toasts.serverValidationError'), 'error');
                  runSyncCheck();
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
                  action: translate('toasts.connectedCluster', { platform: payload.connection.platform || 'Workstation' }),
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
                  action: translate('toasts.disconnectedCluster'),
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
                action: translate('toasts.globalResetComplete'),
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

                const isFromOtherUser = author && author.toUpperCase() !== (currentUser || '').toUpperCase();
                if (isFromOtherUser) {
                  setLiveSyncToast({
                    id: record.id,
                    author,
                    action: actionDesc || translate('toasts.updatedRecord', { collection }),
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
                  action: payload.action || translate('toasts.updatedData'),
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

                const isFromOtherUser = author && author.toUpperCase() !== (currentUser || '').toUpperCase();
                if (isFromOtherUser) {
                  setLiveSyncToast({
                    id,
                    author,
                    action: actionDesc || translate('toasts.deletedRecord', { collection }),
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
                  case 'stockMovements': setStockMovements(data); break;
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
                    action: translate('toasts.registeredOperator', { username: user.username, employeeId: user.employeeId }),
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
                    action: translate('toasts.updatedOperator', { username: user.username, employeeId: user.employeeId }),
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
              if (payload.movement) {
                setStockMovements(prev => mergeStockMovementEntry(prev, payload.movement));
              }
              if (Array.isArray(payload.stocks)) {
                const norm = normalizeRecords('stocks', payload.stocks);
                setStocks(prev => reconcileCollection('stocks', prev, norm));
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
                  action: translate('toasts.clusterRefreshTriggered'),
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
                  action: translate('toasts.terminalInstalled', { stationId, platform: platform || 'Device' }),
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
                runSyncCheck();
              }
              break;
            }
            case 'DEVICE_AUTHORIZATION_UPDATED':
            case 'DEVICE_UNBOUND': {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('authorized_devices_updated', { detail: payload }));
              }
              break;
            }
            case 'DEVICE_REVOKED': {
              handleDeviceRevoked(payload.deviceId);
              if (httpPollInterval) clearInterval(httpPollInterval);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('authorized_devices_updated', { detail: payload }));
              }
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
                showPrintToast(payload.error ? localizeValidationMessage(payload.error) : translate('toasts.serverPermissionDenied'), 'error');
                break;
              }

              if (payload.status === 400) {
                if (clientMutationId) removeConfirmedMutations([clientMutationId]);
                showPrintToast(payload.error ? localizeValidationMessage(payload.error) : translate('toasts.serverValidationError'), 'error');
                runSyncCheck();
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
        runSyncCheck();
      };

      ws.onclose = (event: CloseEvent) => {
        if (!isMounted) return;
        if (pingInterval) clearInterval(pingInterval);
        socketRef.current = null;
        setSocket(null);

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

    runSyncCheck().then((ok) => {
      if (!ok && isMounted && !isDeviceRevokedRef.current) {
        setConnectionStatus('connecting');
      }
    });

    connectWebSocket();

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

  const syncCollection = (collection: string, data: any[]) => {
    if (isDeviceRevokedRef.current) {
      showPrintToast(translate('toasts.deviceRemoved'), 'error');
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

  const executeSuperAdminGlobalReset = async () => {
    const isSuperAdminOperating =
      currentEmployeeId === 'JPMP-002' ||
      (currentUser || '').toUpperCase().includes('ALDRIN') ||
      currentRole === 'SUPER ADMINISTRATOR';

    if (!isSuperAdminOperating) {
      showPrintToast(translate('toasts.superAdminGlobalResetDenied'), 'error');
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
      action: translate('toasts.globalResetComplete'),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    setLastSyncedTime(new Date());
  };

  const resetStateToDefaults = () => {
    executeSuperAdminGlobalReset();
  };

  const resetAccountsToDefaults = () => {
    const isSuperAdminOperating =
      currentEmployeeId === 'JPMP-002' ||
      (currentUser || '').toUpperCase().includes('ALDRIN') ||
      currentRole === 'SUPER ADMINISTRATOR';

    if (!isSuperAdminOperating) {
      showPrintToast(translate('toasts.superAdminWipeAccountsDenied'), 'error');
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
    onLogoutRef.current();
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

  const handleUpdateOperationalRoles = async (newRoles: string[]) => {
    const cleaned = Array.from(new Set<string>(newRoles.map(r => String(r || '').trim().toUpperCase()).filter(Boolean)));
    if (cleaned.length === 0) return;
    setOperationalRoles(cleaned);
    try {
      localStorage.setItem('juwei_wms_operationalRoles', JSON.stringify(cleaned));
    } catch (e) {}

    try {
      syncChannelRef.current?.postMessage({
        type: 'collection_updated',
        collection: 'operationalRoles',
        data: cleaned
      });
    } catch (e) {}

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

  const handleUpdateReceivingCategories = async (newCategories: string[], renameData?: { oldCat: string; newCat: string }) => {
    const cleaned = Array.from(new Set<string>(newCategories.map(r => String(r || '').trim().toUpperCase()).filter(Boolean)));
    if (cleaned.length === 0) return;
    setReceivingCategories(cleaned);
    try {
      localStorage.setItem('juwei_wms_receivingCategories', JSON.stringify(cleaned));
    } catch (e) {}

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

    try {
      syncChannelRef.current?.postMessage({
        type: 'collection_updated',
        collection: 'receivingCategories',
        data: cleaned
      });
    } catch (e) {}

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

    try {
      syncChannelRef.current?.postMessage({
        type: 'collection_updated',
        collection: 'fifoColorsByMonth',
        data: nextMap
      });
    } catch (e) {}

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

  const acknowledgeUpdateReload = () => {
    if (newVersionString && !window.electronAPI?.isElectron) {
      try {
        localStorage.setItem('juwei_wms_web_acknowledged_version', newVersionString);
      } catch (e) {}
    }
    setUpdateAvailable(false);
    updateAvailableRef.current = false;
    window.location.reload();
  };

  const dismissUpdateBanner = () => {
    setBannerDismissed(true);
    updateAvailableRef.current = false;
    setUpdateAvailable(false);
    if (newVersionString) {
      try {
        localStorage.setItem('juwei_wms_dismissed_version', newVersionString);
      } catch (e) {}
    }
  };

  return {
    // Collections & state setters
    stocks,
    setStocks,
    receiving,
    setReceiving,
    returns,
    setReturns,
    recycling,
    setRecycling,
    issuances,
    setIssuances,
    deliveries,
    setDeliveries,
    envLogs,
    setEnvLogs,
    forkliftChecks,
    setForkliftChecks,
    registries,
    setRegistries,
    stockMovements,
    setStockMovements,
    registeredUsers,
    setRegisteredUsers,
    operationalRoles,
    setOperationalRoles,
    receivingCategories,
    setReceivingCategories,
    fifoColorsByMonth,
    setFifoColorsByMonth,
    chatMessages,
    setChatMessages,
    superAdminAccount,

    // Real-time connection & refs
    socket,
    socketRef,
    syncChannelRef,
    clientSessionId,
    clientConnectionId,
    isDeviceRevoked,
    isDeviceRevokedRef,
    syncConflicts,
    setSyncConflicts,
    showConflictsModal,
    setShowConflictsModal,
    activeUsers,
    activePresence,
    connectionStatus,
    isManualSyncing,
    serverAddress,
    wsLatency,
    lastSyncedTime,
    liveSyncToast,
    setLiveSyncToast,
    updateAvailable,
    bannerDismissed,
    newVersionString,
    appVersion,

    // Version & tombstone helpers
    markRecordMutatedLocally,
    markRecordAsDeletedLocally,
    unmarkRecordAsDeletedLocally,
    isRecordDeletedLocally,
    markUserAsDeleted,
    unmarkUserAsDeleted,
    upsertUserInState,

    // Core sync actions
    syncCollection,
    upsertRecordLocallyAndRemotely,
    deleteRecordLocallyAndRemotely,
    handleManualSync,
    performFreshInstallAndSync,
    executeSuperAdminGlobalReset,
    resetStateToDefaults,
    resetAccountsToDefaults,
    handleDeviceRevoked,
    sendSystemActivity,
    sendChatMessage,
    handleResolveConflictKeepMine,
    handleResolveConflictAcceptServer,
    handleUpdateOperationalRoles,
    handleUpdateReceivingCategories,
    handleUpdateFifoColors,
    acknowledgeUpdateReload,
    dismissUpdateBanner
  };
}
