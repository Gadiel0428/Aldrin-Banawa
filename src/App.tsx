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
  Phone,
  Smartphone,
  Radio,
  Activity,
  Server
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import AccountQRBadgeModal from './components/AccountQRBadgeModal';
import DesktopInstallModal from './components/DesktopInstallModal';
import MobileAppDownloadModal from './components/MobileAppDownloadModal';
import { ConfirmModal, ConfirmActionConfig } from './components/ConfirmModal';
import BarcodeScannerModal from './components/BarcodeScannerModal';
import SupabaseSettingsModal from './components/SupabaseSettingsModal';
import ActiveUsersModal from './components/ActiveUsersModal';

import { 
  getStoredSupabaseConfig, 
  saveStoredSupabaseConfig,
  isSupabaseConfigured, 
  getSupabase,
  fetchCollectionFromSupabase, 
  fetchFullSupabaseSnapshot,
  syncCollectionToSupabase, 
  setupSupabaseRealtimeSubscriptions,
  processPendingSupabaseMutations,
  deleteAccountFromSupabase,
  deleteRecordFromSupabase
} from './lib/supabase';

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
import ReceivingModule from './components/ReceivingModule';
import StockFIFOControl from './components/StockFIFOControl';
import RecyclingModule from './components/RecyclingModule';
import IssuanceModule from './components/IssuanceModule';
import DeliveryModule from './components/DeliveryModule';
import EnvironmentalModule from './components/EnvironmentalModule';
import RegisteredAccountsModule from './components/RegisteredAccountsModule';
import MasterRegistryModule, { DEFAULT_MASTER_REGISTRIES } from './components/MasterRegistryModule';

const DEFAULT_ONLINE_CLOUD_HOST = 'ais-dev-vmhtsbs5lyqg4e3o5qf35l-327128958892.asia-southeast1.run.app';

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

export function sanitizeServerHost(raw: string): string {
  if (!raw) return '';
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^https?:\/\//i, '');
  cleaned = cleaned.replace(/^wss?:\/\//i, '');
  cleaned = (cleaned.split('/')[0] || '').trim().toLowerCase();
  return cleaned;
}

export function isSecureServerHost(cleanHost: string, rawInput: string = ''): boolean {
  if (!cleanHost) return false;
  if (/^https:\/\//i.test(rawInput) || /^wss:\/\//i.test(rawInput)) return true;
  if (cleanHost.includes('.run.app') || cleanHost.includes('cloud') || cleanHost.includes('appspot')) return true;
  const isLocal = cleanHost.includes('localhost') || cleanHost.includes('127.0.0.1') || cleanHost.startsWith('192.168.') || cleanHost.startsWith('10.');
  if (isLocal) {
    return window.location.protocol === 'https:';
  }
  return true;
}

function getDefaultServerAddress(): string {
  if (typeof window !== 'undefined' && window.location && window.location.host) {
    const cleanHost = sanitizeServerHost(window.location.host);
    if (cleanHost) {
      const cached = localStorage.getItem('juwei_wms_server_address');
      if (cached) {
        const cleanCached = sanitizeServerHost(cached);
        // Only prioritize cached if it is valid and not an obsolete localhost cache when the window is on a remote host
        if (cleanCached && !(cleanCached.includes('localhost') && !cleanHost.includes('localhost'))) {
          return cleanCached;
        }
      }
      return cleanHost;
    }
  }
  const cached = localStorage.getItem('juwei_wms_server_address');
  if (cached) {
    const clean = sanitizeServerHost(cached);
    if (clean) return clean;
  }
  return DEFAULT_ONLINE_CLOUD_HOST;
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
  const q = getPendingSyncQueue();
  q[collection] = data;
  savePendingSyncQueue(q);
}

function clearPendingSync(collection: string) {
  const q = getPendingSyncQueue();
  delete q[collection];
  savePendingSyncQueue(q);
}

export default function App() {
  const [view, setView] = useState<string>('dashboard');
  const [showDesktopInstallModal, setShowDesktopInstallModal] = useState<boolean>(false);
  const [showMobileInstallModal, setShowMobileInstallModal] = useState<boolean>(false);

  // Optimistic local mutation timestamp tracker to prevent in-flight clobbering / race conditions
  const lastMutationTimes = useRef<{ [col: string]: number }>({});

  // Core state arrays - initialize from local storage cache for instant, zero-flicker UI
  const [stocks, setStocks] = useState<MaterialStockItem[]>(() => {
    try {
      const c = localStorage.getItem('juwei_wms_cache_stocks');
      if (c) {
        const p = JSON.parse(c);
        if (Array.isArray(p)) return p;
      }
    } catch (e) {}
    return [];
  });
  const [receiving, setReceiving] = useState<ReceivingRecord[]>(() => {
    try {
      const c = localStorage.getItem('juwei_wms_cache_receiving');
      if (c) {
        const p = JSON.parse(c);
        if (Array.isArray(p)) return p;
      }
    } catch (e) {}
    return [];
  });
  const [returns, setReturns] = useState<ReturnRecord[]>(() => {
    try {
      const c = localStorage.getItem('juwei_wms_cache_returns');
      if (c) {
        const p = JSON.parse(c);
        if (Array.isArray(p)) return p;
      }
    } catch (e) {}
    return [];
  });
  const [recycling, setRecycling] = useState<RecyclingRecord[]>(() => {
    try {
      const c = localStorage.getItem('juwei_wms_cache_recycling');
      if (c) {
        const p = JSON.parse(c);
        if (Array.isArray(p)) return p;
      }
    } catch (e) {}
    return [];
  });
  const [issuances, setIssuances] = useState<IssuanceRecord[]>(() => {
    try {
      const c = localStorage.getItem('juwei_wms_cache_issuances');
      if (c) {
        const p = JSON.parse(c);
        if (Array.isArray(p)) return p;
      }
    } catch (e) {}
    return [];
  });
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>(() => {
    try {
      const c = localStorage.getItem('juwei_wms_cache_deliveries');
      if (c) {
        const p = JSON.parse(c);
        if (Array.isArray(p)) return p;
      }
    } catch (e) {}
    return [];
  });
  const [envLogs, setEnvLogs] = useState<EnvironmentalLog[]>(() => {
    try {
      const c = localStorage.getItem('juwei_wms_cache_envLogs');
      if (c) {
        const p = JSON.parse(c);
        if (Array.isArray(p)) return p;
      }
    } catch (e) {}
    return [];
  });
  const [forkliftChecks, setForkliftChecks] = useState<ForkliftChecklist[]>(() => {
    try {
      const c = localStorage.getItem('juwei_wms_cache_forkliftChecks');
      if (c) {
        const p = JSON.parse(c);
        if (Array.isArray(p)) return p;
      }
    } catch (e) {}
    return [];
  });
  const [registries, setRegistries] = useState<MasterRegistryItem[]>(() => {
    try {
      const c = localStorage.getItem('juwei_wms_cache_registries') || localStorage.getItem('juwei_wms_master_registries');
      if (c) {
        const p = JSON.parse(c);
        if (Array.isArray(p)) return p;
      }
    } catch (e) {}
    return [];
  });

  // Automatically keep local storage offline caches synchronized whenever active state updates
  useEffect(() => {
    try { localStorage.setItem('juwei_wms_cache_stocks', JSON.stringify(stocks)); } catch (e) {}
  }, [stocks]);

  useEffect(() => {
    try { localStorage.setItem('juwei_wms_cache_receiving', JSON.stringify(receiving)); } catch (e) {}
  }, [receiving]);

  useEffect(() => {
    try { localStorage.setItem('juwei_wms_cache_returns', JSON.stringify(returns)); } catch (e) {}
  }, [returns]);

  useEffect(() => {
    try { localStorage.setItem('juwei_wms_cache_recycling', JSON.stringify(recycling)); } catch (e) {}
  }, [recycling]);

  useEffect(() => {
    try { localStorage.setItem('juwei_wms_cache_issuances', JSON.stringify(issuances)); } catch (e) {}
  }, [issuances]);

  useEffect(() => {
    try { localStorage.setItem('juwei_wms_cache_deliveries', JSON.stringify(deliveries)); } catch (e) {}
  }, [deliveries]);

  useEffect(() => {
    try { localStorage.setItem('juwei_wms_cache_envLogs', JSON.stringify(envLogs)); } catch (e) {}
  }, [envLogs]);

  useEffect(() => {
    try { localStorage.setItem('juwei_wms_cache_forkliftChecks', JSON.stringify(forkliftChecks)); } catch (e) {}
  }, [forkliftChecks]);

  useEffect(() => {
    try {
      localStorage.setItem('juwei_wms_cache_registries', JSON.stringify(registries));
      localStorage.setItem('juwei_wms_master_registries', JSON.stringify(registries));
    } catch (e) {}
  }, [registries]);

  // Real-time states
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [activePresence, setActivePresence] = useState<ActivePresenceUser[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isManualSyncing, setIsManualSyncing] = useState<boolean>(false);
  const [serverAddress, setServerAddress] = useState<string>(() => getDefaultServerAddress());
  const [wsLatency, setWsLatency] = useState<number | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<Date>(new Date());
  const [liveSyncToast, setLiveSyncToast] = useState<{ id: string; author: string; action: string; time: string } | null>(null);
  const [showActiveUsersModal, setShowActiveUsersModal] = useState<boolean>(false);

  // Cross-tab zero-latency synchronization channel
  const syncChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const channel = new BroadcastChannel('juwei_wms_live_sync_v1');
        syncChannelRef.current = channel;

        channel.onmessage = (event) => {
          const payload = event.data;
          if (!payload || !payload.type) return;

          if (payload.type === 'sync_collection') {
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
          } else if (payload.type === 'delete_account') {
            const { employeeId } = payload;
            if (employeeId && employeeId !== 'JPMP-002') {
              markUserAsDeleted(employeeId);
              setRegisteredUsers(prev => prev.filter(u => u.employeeId.toUpperCase() !== employeeId.toUpperCase()));
            }
          } else if (payload.type === 'all_accounts_cleared') {
            setRegisteredUsers([superAdminAccount]);
            try {
              localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify([superAdminAccount]));
            } catch (e) {}
          } else if (payload.type === 'activity_toast') {
            setLiveSyncToast({
              id: String(Date.now()),
              author: payload.author || 'Workstation',
              action: payload.action || 'Updated data',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            });
          }
        };

        return () => {
          try { channel.close(); } catch (e) {}
        };
      } catch (e) {}
    }
  }, []);

  // Auto-dismiss live sync toast notifications after 3.5 seconds
  useEffect(() => {
    if (liveSyncToast) {
      const timer = setTimeout(() => {
        setLiveSyncToast(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [liveSyncToast]);

  // Supabase PostgreSQL Realtime state
  const [showSupabaseSettingsModal, setShowSupabaseSettingsModal] = useState<boolean>(false);
  const [supabaseStatus, setSupabaseStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [supabaseRefreshTrigger, setSupabaseRefreshTrigger] = useState<number>(0);

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
      return stored === 'true' && Boolean(user);
    } catch (e) {
      return false;
    }
  });
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');

  useEffect(() => {
    // Enforce custom JUWEI WMS branding and remove any Google default favicon
    try {
      document.title = 'JUWEI WAREHOUSE MANAGEMENT SYSTEM';
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
  }, []);
  
  // Direct employee ID and PIN login form states
  const [loginEmployeeId, setLoginEmployeeId] = useState<string>('');
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
      const raw = localStorage.getItem('juwei_wms_deletedAccounts');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          return new Set(arr.map((id: string) => String(id).toUpperCase()));
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
        localStorage.setItem('juwei_wms_deletedAccounts', JSON.stringify(Array.from(set)));
      }
    } catch (e) {}
  };

  const sanitizeUsersList = (incomingList?: any[]): RegisteredAccount[] => {
    const userMap = new Map<string, RegisteredAccount>();
    userMap.set('JPMP-002', { ...superAdminAccount });

    const source = Array.isArray(incomingList) ? incomingList : (() => {
      try {
        const cached = localStorage.getItem('juwei_wms_registeredUsers');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (e) {}
      return [superAdminAccount];
    })();

    const deletedSet = getDeletedUserIds();

    source.forEach((u: any) => {
      if (!u || (!u.employeeId && !u.employee_id)) return;
      const rawEmpId = String(u.employeeId || u.employee_id || '').toUpperCase();
      const empId = rawEmpId.startsWith('JPMP-') ? rawEmpId : `JPMP-${rawEmpId.replace(/^EMP-/, '')}`;
      if (deletedSet.has(empId) && empId !== 'JPMP-002') return;

      const cleanPin = u.pin ? String(u.pin).trim() : (u.pin_hash ? String(u.pin_hash).trim() : (empId === 'JPMP-002' ? '0423' : '1234'));
      userMap.set(empId, {
        username: (u.username || 'OPERATOR').toUpperCase(),
        role: (u.role || 'WAREHOUSE CLERK').toUpperCase(),
        employeeId: empId,
        phoneNumber: u.phoneNumber || u.phone_number || '',
        permission: u.permission || (empId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
        pin: cleanPin,
        status: u.status || 'ACTIVE',
        lastActive: u.lastActive || u.last_active || undefined
      });
    });

    // Guarantee Super Admin
    userMap.set('JPMP-002', { ...superAdminAccount });

    const result = Array.from(userMap.values());
    try {
      localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(result));
    } catch (e) {}
    return result;
  };

  const [registeredUsers, setRegisteredUsers] = useState<RegisteredAccount[]>(() => {
    return sanitizeUsersList();
  });

  useEffect(() => {
    try {
      localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(registeredUsers));
    } catch (e) {}
  }, [registeredUsers]);

  // Keep active logged-in user's role, permissions, and status in sync with live registered accounts directory
  useEffect(() => {
    if (!isLoggedIn || !currentEmployeeId) return;
    const cleanId = currentEmployeeId.toUpperCase();
    const currentRecord = registeredUsers.find(u => (u.employeeId || '').toUpperCase() === cleanId);
    
    if (currentRecord) {
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
    }
  }, [registeredUsers, isLoggedIn, currentEmployeeId, currentPermission, currentRole, currentUser]);

  // Clipboard feedback state
  const [linkCopied, setLinkCopied] = useState<boolean>(false);

  // Initialize standard fallback state
  const resetStateToDefaults = () => {
    setStocks([]);
    setReceiving([]);
    setReturns([]);
    setRecycling([]);
    setIssuances([]);
    setDeliveries([]);
    setEnvLogs([]);
    setForkliftChecks([]);
    setRegistries([]);

    // Clear local storage cache
    const collectionsToClear = [
      'stocks', 'receiving', 'returns', 'recycling', 'issuances', 
      'deliveries', 'envLogs', 'forkliftChecks', 'registries'
    ];
    collectionsToClear.forEach(col => {
      try {
        localStorage.removeItem(`juwei_wms_cache_${col}`);
      } catch (e) {}
    });
    try {
      localStorage.removeItem('juwei_wms_master_registries');
    } catch (e) {}

    // Call server reset endpoint
    fetch('/api/reset-database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});

    // Sync clean empty collections across peers and Supabase
    collectionsToClear.forEach(col => {
      syncCollection(col, []);
    });
  };

  const resetAccountsToDefaults = () => {
    const defaultAccounts = [
      superAdminAccount
    ];
    setRegisteredUsers(defaultAccounts);
    try {
      localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(defaultAccounts));
      localStorage.removeItem('juwei_wms_deleted_accounts');
    } catch (e) {}
    syncCollection('registeredUsers', defaultAccounts);
    fetch('/api/reset-database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});
    // Also log out any active session if we reset the accounts
    handleLogout();
  };

  // Normalizer helper for records coming from any source (REST, WebSocket, Supabase, Cache)
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

  // Track deleted record IDs locally to avoid resurrecting deleted items from stale snapshots
  const deletedRecordIds = useRef<Set<string>>(new Set());

  const markRecordAsDeletedLocally = (id: string) => {
    if (!id) return;
    deletedRecordIds.current.add(id);
    if (deletedRecordIds.current.size > 1000) {
      const first = deletedRecordIds.current.values().next().value;
      if (first) deletedRecordIds.current.delete(first);
    }
  };

  const unmarkRecordAsDeletedLocally = (id: string) => {
    if (!id) return;
    deletedRecordIds.current.delete(id);
  };

  const isRecordDeletedLocally = (id: string) => {
    return Boolean(id && deletedRecordIds.current.has(id));
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
    const item: QueuedMutation = {
      ...mutation,
      id: `MUT-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: Date.now()
    };
    const list = getPendingMutations();
    list.push(item);
    savePendingMutations(list);
  };

  const flushPendingMutationsQueue = async () => {
    const mutations = getPendingMutations();
    if (mutations.length === 0) return;

    let targetAddr = serverAddress.trim() || getDefaultServerAddress();
    const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
    const isHttps = isSecureServerHost(cleanHost, targetAddr);
    const httpProto = isHttps ? 'https:' : 'http:';

    try {
      const res = await fetch('/api/sync/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mutations })
      });
      if (res.ok) {
        localStorage.removeItem(PENDING_MUTATIONS_KEY);
        return;
      }
    } catch (e) {}

    try {
      const resFallback = await fetch(`${httpProto}//${cleanHost}/api/sync/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mutations })
      });
      if (resFallback.ok) {
        localStorage.removeItem(PENDING_MUTATIONS_KEY);
      }
    } catch (err) {}
  };

  // Helper to compare collections by content to avoid unnecessary state re-renders
  const areCollectionsEqual = (a: any[], b: any[]): boolean => {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const itemA = a[i];
      const itemB = b[i];
      if (!itemA || !itemB) return false;
      if (itemA.id !== itemB.id) return false;
      if (itemA.quantity !== itemB.quantity ||
          itemA.status !== itemB.status ||
          itemA.date !== itemB.date ||
          itemA.iqcStatus !== itemB.iqcStatus ||
          itemA.quantityIssued !== itemB.quantityIssued ||
          itemA.partCode !== itemB.partCode ||
          itemA.location !== itemB.location ||
          itemA.remarks !== itemB.remarks) {
        return false;
      }
    }
    return true;
  };

  // Helper to reconcile incoming remote collections with local state cleanly without data overlapping or resurrection
  const reconcileCollection = (colName: string, currentArr: any[], incomingArr: any[]): any[] => {
    if (!Array.isArray(incomingArr)) {
      return Array.isArray(currentArr) ? currentArr : [];
    }
    // Cleanly accept authoritative incoming collection, excluding any locally deleted record IDs
    const filtered = incomingArr.filter(item => item && item.id && !deletedRecordIds.current.has(item.id));
    if (Array.isArray(currentArr) && areCollectionsEqual(currentArr, filtered)) {
      return currentArr;
    }
    return filtered;
  };

  // Helper to compare users by content to avoid unnecessary user state re-renders
  const areUsersEqual = (a: RegisteredAccount[], b: RegisteredAccount[]): boolean => {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const uA = a[i];
      const uB = b[i];
      if (!uA || !uB) return false;
      if (uA.employeeId !== uB.employeeId ||
          uA.username !== uB.username ||
          uA.role !== uB.role ||
          uA.permission !== uB.permission ||
          uA.pin !== uB.pin ||
          uA.status !== uB.status) {
        return false;
      }
    }
    return true;
  };

  // Helper to reconcile user accounts safely without resurrecting deleted accounts or overlapping stale records
  const reconcileUsers = (currentUsers: RegisteredAccount[], incomingUsers: any[]): RegisteredAccount[] => {
    const deletedSet = getDeletedUserIds();
    const userMap = new Map<string, RegisteredAccount>();
    userMap.set('JPMP-002', { ...superAdminAccount });

    const sourceList = Array.isArray(incomingUsers) ? incomingUsers : (Array.isArray(currentUsers) ? currentUsers : []);

    for (const u of sourceList) {
      if (!u || (!u.employeeId && !u.employee_id)) continue;
      const rawEmpId = String(u.employeeId || u.employee_id || '').toUpperCase();
      const empId = rawEmpId.startsWith('JPMP-') ? rawEmpId : `JPMP-${rawEmpId.replace(/^EMP-/, '')}`;
      if (deletedSet.has(empId) && empId !== 'JPMP-002') continue;

      const cleanPin = u.pin ? String(u.pin).trim() : (u.pin_hash ? String(u.pin_hash).trim() : (empId === 'JPMP-002' ? '0423' : '1234'));
      userMap.set(empId, {
        username: (u.username || 'OPERATOR').toUpperCase(),
        role: (u.role || 'WAREHOUSE CLERK').toUpperCase(),
        employeeId: empId,
        phoneNumber: u.phoneNumber || u.phone_number || '',
        permission: u.permission || (empId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
        pin: cleanPin,
        status: u.status || 'ACTIVE',
        lastActive: u.lastActive || u.last_active || undefined
      });
    }

    // Guarantee Super Admin JPMP-002 is always present and protected
    const admin = userMap.get('JPMP-002') || superAdminAccount;
    userMap.set('JPMP-002', {
      ...superAdminAccount,
      ...admin,
      employeeId: 'JPMP-002',
      username: admin.username || 'ALDRIN BANAWA',
      role: 'SUPER ADMINISTRATOR',
      permission: 'FULL_ACCESS',
      pin: admin.pin || '0423'
    });

    const result = Array.from(userMap.values());
    if (Array.isArray(currentUsers) && areUsersEqual(currentUsers, result)) {
      return currentUsers;
    }
    try {
      localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(result));
    } catch (e) {}
    return result;
  };

  // Helper to execute coordinated single-record upsert across local state, Supabase, WebSocket, and Express server
  const upsertRecordLocallyAndRemotely = (
    collection: string, 
    record: any, 
    actionDesc?: string
  ) => {
    if (!record || !record.id || !collection) return;
    unmarkRecordAsDeletedLocally(record.id);
    setLastSyncedTime(new Date());

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
          actionDesc
        });
      } catch (e) {}
    }

    // 1. Supabase direct write
    if (isSupabaseConfigured()) {
      syncCollectionToSupabase(collection, [record]);
    }

    // 2. WebSocket targeted delta broadcast
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'upsert_record',
          collection,
          record,
          author: currentUser || 'Operator',
          actionDesc
        }));
      } catch (e) {}
    }

    // 3. HTTP REST upsert endpoint
    let targetAddr = serverAddress.trim() || getDefaultServerAddress();
    const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
    const isHttps = isSecureServerHost(cleanHost, targetAddr);
    const httpProto = isHttps ? 'https:' : 'http:';

    fetch('/api/records/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection,
        record,
        author: currentUser || 'Operator',
        actionDesc
      })
    })
    .then(res => {
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
          actionDesc
        })
      }).catch(() => {});
    });
  };

  // Helper to execute coordinated deletion across local state, Supabase, WebSocket, and Express server
  const deleteRecordLocallyAndRemotely = (collection: string, id: string) => {
    if (!id || !collection) return;
    markRecordAsDeletedLocally(id);
    setLastSyncedTime(new Date());

    // Queue for offline resilience
    queueOfflineMutation({
      type: 'delete',
      collection,
      recordId: id,
      author: currentUser || 'Operator'
    });

    // 0. Cross-tab BroadcastChannel
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'delete_record',
          collection,
          id
        });
      } catch (e) {}
    }
    
    // 1. Supabase deletion
    if (isSupabaseConfigured()) {
      deleteRecordFromSupabase(collection, id);
    }

    // 2. WebSocket deletion
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'delete_record',
          collection,
          id
        }));
      } catch (e) {}
    }

    // 3. HTTP REST deletion
    let targetAddr = serverAddress.trim() || getDefaultServerAddress();
    const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
    const isHttps = isSecureServerHost(cleanHost, targetAddr);
    const httpProto = isHttps ? 'https:' : 'http:';

    fetch('/api/records/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection, id })
    })
    .then(res => {
      if (res.ok) flushPendingMutationsQueue();
    })
    .catch(() => {
      fetch(`${httpProto}//${cleanHost}/api/records/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, id })
      }).catch(() => {});
    });
  };

  // Manual Full-Sync across WebSocket, REST & Supabase
  const handleManualSync = async () => {
    setIsManualSyncing(true);
    try {
      let targetAddr = serverAddress.trim() || getDefaultServerAddress();
      const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
      const isHttps = isSecureServerHost(cleanHost, targetAddr);
      const httpProto = isHttps ? 'https:' : 'http:';

      try {
        const res = await fetch('/api/sync', { cache: 'no-store', headers: { 'Accept': 'application/json' } });
        if (res.ok) {
          const json = await res.json();
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
            if (Array.isArray(cm) && cm.length > 0) setChatMessages(cm);
            setConnectionStatus('connected');
          }
        }
      } catch (err) {
        try {
          const resFallback = await fetch(`${httpProto}//${cleanHost}/api/sync`, { cache: 'no-store', headers: { 'Accept': 'application/json' } });
          if (resFallback.ok) {
            const json = await resFallback.json();
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
              if (Array.isArray(cm) && cm.length > 0) setChatMessages(cm);
              setConnectionStatus('connected');
            }
          }
        } catch (e2) {}
      }

      if (isSupabaseConfigured()) {
        const snap = await fetchFullSupabaseSnapshot();
        if (snap) {
          if (Array.isArray(snap.stocks)) setStocks(prev => reconcileCollection('stocks', prev, normalizeRecords('stocks', snap.stocks!)));
          if (Array.isArray(snap.receiving)) setReceiving(prev => reconcileCollection('receiving', prev, normalizeRecords('receiving', snap.receiving!)));
          if (Array.isArray(snap.returns)) setReturns(prev => reconcileCollection('returns', prev, normalizeRecords('returns', snap.returns!)));
          if (Array.isArray(snap.recycling)) setRecycling(prev => reconcileCollection('recycling', prev, normalizeRecords('recycling', snap.recycling!)));
          if (Array.isArray(snap.issuances)) setIssuances(prev => reconcileCollection('issuances', prev, normalizeRecords('issuances', snap.issuances!)));
          if (Array.isArray(snap.deliveries)) setDeliveries(prev => reconcileCollection('deliveries', prev, normalizeRecords('deliveries', snap.deliveries!)));
          if (Array.isArray(snap.envLogs)) setEnvLogs(prev => reconcileCollection('envLogs', prev, normalizeRecords('envLogs', snap.envLogs!)));
          if (Array.isArray(snap.forkliftChecks)) setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, normalizeRecords('forkliftChecks', snap.forkliftChecks!)));
          if (Array.isArray(snap.registries)) setRegistries(prev => reconcileCollection('registries', prev, normalizeRecords('registries', snap.registries!)));
          if (Array.isArray(snap.registeredUsers)) {
            setRegisteredUsers(prev => reconcileUsers(prev, snap.registeredUsers!));
          }
          if (Array.isArray(snap.chatMessages) && snap.chatMessages.length > 0) {
            setChatMessages(snap.chatMessages);
          }
          setSupabaseStatus('connected');
        }
      }

      if (wsOpen(socket)) {
        try {
          socket!.send(JSON.stringify({ type: 'ping' }));
          socket!.send(JSON.stringify({ type: 'join', username: currentUser || 'JUWEI OPERATOR' }));
        } catch (e) {}
      }
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
      if (msgs && Array.isArray(msgs)) setChatMessages(msgs);
      if (activeUsersList && Array.isArray(activeUsersList)) setActiveUsers(activeUsersList);
      if (activePresenceList && Array.isArray(activePresenceList)) setActivePresence(activePresenceList);
    };

    const tryFetchSync = async (url: string): Promise<boolean> => {
      try {
        const res = await fetch(url, { method: 'GET', cache: 'no-store', headers: { 'Accept': 'application/json' } });
        if (res.ok) {
          const json = await res.json();
          if (isMounted) {
            hasConnectedOnce = true;
            setConnectionStatus('connected');
            if (json.data) applyStatePayload(json.data, json.activeUsers, json.activePresence);
          }
          return true;
        }
      } catch (e) {
        // Fetch failed
      }
      return false;
    };

    const flushPendingSyncQueue = async () => {
      const q = getPendingSyncQueue();
      const collections = Object.keys(q);
      if (collections.length === 0) return;

      let targetAddr = serverAddress.trim() || getDefaultServerAddress();
      const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
      const isHttps = isSecureServerHost(cleanHost, targetAddr);
      const httpProto = isHttps ? 'https:' : 'http:';

      for (const collection of collections) {
        const data = q[collection];
        if (data && Array.isArray(data)) {
          try {
            const res = await fetch('/api/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collection, data })
            });
            if (res.ok) {
              clearPendingSync(collection);
            }
          } catch (e) {
            try {
              const resFallback = await fetch(`${httpProto}//${cleanHost}/api/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collection, data })
              });
              if (resFallback.ok) {
                clearPendingSync(collection);
              }
            } catch (err) {
              // Still offline
            }
          }
        }
      }
    };

    const runSyncCheck = async (): Promise<boolean> => {
      // 0. Flush any pending offline mutations and collections first
      await flushPendingMutationsQueue();
      await flushPendingSyncQueue();

      // 1. Try relative URL /api/sync first (fastest, guaranteed on same origin)
      const relOk = await tryFetchSync('/api/sync');
      if (relOk) return true;

      // 2. Try window host if available
      if (window.location.host) {
        const localProto = window.location.protocol === 'https:' ? 'https:' : 'http:';
        const localOk = await tryFetchSync(`${localProto}//${window.location.host}/api/sync`);
        if (localOk) return true;
      }

      // 3. Try configured server host address
      let targetAddr = serverAddress.trim();
      const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
      const isHttps = isSecureServerHost(cleanHost, targetAddr);
      const httpProto = isHttps ? 'https:' : 'http:';
      const httpUrl = `${httpProto}//${cleanHost}/api/sync`;

      const hostOk = await tryFetchSync(httpUrl);
      if (hostOk) return true;

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

      let targetAddr = serverAddress.trim();
      const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
      const isHttps = isSecureServerHost(cleanHost, targetAddr);
      const wsProto = isHttps ? 'wss:' : 'ws:';
      const socketUrl = `${wsProto}//${cleanHost}/ws`;

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
            ws.send(JSON.stringify({
              type: 'join',
              username: currentUser || 'JUWEI OPERATOR',
              employeeId: currentEmployeeId || '',
              role: currentRole || (currentPermission === 'FULL_ACCESS' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE OPERATOR'),
              activeView: view
            }));
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
            case 'init': {
              hasConnectedOnce = true;
              missedPongs = 0;
              setConnectionStatus('connected');
              setLastSyncedTime(new Date());
              applyStatePayload(payload.data, payload.activeUsers, payload.activePresence);
              if (payload.activePresence && Array.isArray(payload.activePresence)) {
                setActivePresence(payload.activePresence);
              }
              break;
            }
            case 'record_upserted': {
              const { collection, record, author, actionDesc } = payload;
              if (record && record.id && collection) {
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
                  if (isRecordDeletedLocally(record.id)) return prev;
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
            case 'record_deleted': {
              const { collection, id } = payload;
              if (id && collection) {
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
                }
              }
              break;
            }
            case 'account_deleted': {
              const empId = (payload.employeeId || '').toUpperCase();
              if (empId && empId !== 'JPMP-002') {
                markUserAsDeleted(empId);
                setRegisteredUsers(prev => {
                  const next = prev.filter(u => u.employeeId.toUpperCase() !== empId);
                  localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(next));
                  return next;
                });
              }
              break;
            }
            case 'all_accounts_cleared': {
              setRegisteredUsers([superAdminAccount]);
              try {
                localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify([superAdminAccount]));
              } catch (e) {}
              break;
            }
            case 'chat_broadcast': {
              setChatMessages(prev => [...prev, payload.message]);
              break;
            }
            case 'presence_updated': {
              setActiveUsers(payload.activeUsers || []);
              if (payload.activePresence && Array.isArray(payload.activePresence)) {
                setActivePresence(payload.activePresence);
              }
              break;
            }
            case 'supabase_config_updated': {
              if (payload.url && payload.anonKey) {
                saveStoredSupabaseConfig({ url: payload.url, anonKey: payload.anonKey });
                setSupabaseStatus('connecting');
                setSupabaseRefreshTrigger(prev => prev + 1);
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

    // Re-sync handlers when internet connection is restored or page is focused
    const handleOnlineOrFocus = () => {
      if (isMounted) {
        flushPendingSyncQueue().then(() => runSyncCheck());
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

    // Gentle background HTTP poll fallback (10s if connected, 5s if disconnected)
    httpPollInterval = setInterval(() => {
      if (isMounted) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          runSyncCheck();
        }
      }
    }, 7000);

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
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'presence_update',
          username: currentUser || 'JUWEI OPERATOR',
          employeeId: currentEmployeeId || '',
          role: currentRole || (currentPermission === 'FULL_ACCESS' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE OPERATOR'),
          activeView: view
        }));
      } catch (e) {}
    }
  }, [currentUser, currentEmployeeId, currentRole, currentPermission, view, socket]);

  // Supabase PostgreSQL Realtime Subscription, Auto-Config & Cloud Sync Engine
  useEffect(() => {
    let channel: any = null;
    let isMounted = true;
    let pollInterval: any = null;

    const loadAllSupabaseData = async () => {
      if (!isMounted) return;
      if (!isSupabaseConfigured()) {
        setSupabaseStatus('disconnected');
        return;
      }

      const snapshot = await fetchFullSupabaseSnapshot();
      if (!isMounted || !snapshot) return;

      let hasSuccess = false;
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
        registeredUsers: ru, 
        chatMessages: cm 
      } = snapshot;

      if (Array.isArray(s)) { 
        hasSuccess = true; 
        const norm = normalizeRecords('stocks', s);
        setStocks(prev => reconcileCollection('stocks', prev, norm)); 
      }
      if (Array.isArray(rc)) { 
        hasSuccess = true; 
        const norm = normalizeRecords('receiving', rc);
        setReceiving(prev => reconcileCollection('receiving', prev, norm)); 
      }
      if (Array.isArray(rt)) { 
        hasSuccess = true; 
        const norm = normalizeRecords('returns', rt);
        setReturns(prev => reconcileCollection('returns', prev, norm)); 
      }
      if (Array.isArray(cy)) { 
        hasSuccess = true; 
        const norm = normalizeRecords('recycling', cy);
        setRecycling(prev => reconcileCollection('recycling', prev, norm)); 
      }
      if (Array.isArray(is)) { 
        hasSuccess = true; 
        const norm = normalizeRecords('issuances', is);
        setIssuances(prev => reconcileCollection('issuances', prev, norm)); 
      }
      if (Array.isArray(d)) { 
        hasSuccess = true; 
        const norm = normalizeRecords('deliveries', d);
        setDeliveries(prev => reconcileCollection('deliveries', prev, norm)); 
      }
      if (Array.isArray(e)) { 
        hasSuccess = true; 
        const norm = normalizeRecords('envLogs', e);
        setEnvLogs(prev => reconcileCollection('envLogs', prev, norm)); 
      }
      if (Array.isArray(f)) { 
        hasSuccess = true; 
        const norm = normalizeRecords('forkliftChecks', f);
        setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, norm)); 
      }
      if (Array.isArray(reg)) { 
        hasSuccess = true; 
        const norm = normalizeRecords('registries', reg);
        setRegistries(prev => reconcileCollection('registries', prev, norm)); 
      }
      if (Array.isArray(ru) && ru.length > 0) {
        hasSuccess = true;
        setRegisteredUsers(prev => reconcileUsers(prev, ru));
      }
      if (Array.isArray(cm) && cm.length > 0) {
        hasSuccess = true;
        setChatMessages(cm);
      }

      if (isMounted) {
        if (hasSuccess) {
          setSupabaseStatus('connected');
        } else if (!isSupabaseConfigured()) {
          setSupabaseStatus('disconnected');
        }
      }
    };

    const startSupabaseSync = () => {
      if (!isMounted) return;

      loadAllSupabaseData();

      // Setup Realtime subscription for PostgreSQL events with granular delta sync
      channel = setupSupabaseRealtimeSubscriptions(
        async (col) => {
          if (!isMounted) return;
          const updatedItems = await fetchCollectionFromSupabase(col);
          if (Array.isArray(updatedItems)) {
            setSupabaseStatus('connected');
            const norm = normalizeRecords(col, updatedItems);
            if (col === 'stocks') setStocks(prev => reconcileCollection('stocks', prev, norm));
            else if (col === 'receiving') setReceiving(prev => reconcileCollection('receiving', prev, norm));
            else if (col === 'returns') setReturns(prev => reconcileCollection('returns', prev, norm));
            else if (col === 'recycling') setRecycling(prev => reconcileCollection('recycling', prev, norm));
            else if (col === 'issuances') setIssuances(prev => reconcileCollection('issuances', prev, norm));
            else if (col === 'deliveries') setDeliveries(prev => reconcileCollection('deliveries', prev, norm));
            else if (col === 'envLogs') setEnvLogs(prev => reconcileCollection('envLogs', prev, norm));
            else if (col === 'forkliftChecks') setForkliftChecks(prev => reconcileCollection('forkliftChecks', prev, norm));
            else if (col === 'registries') setRegistries(prev => reconcileCollection('registries', prev, norm));
            else if (col === 'registeredUsers') {
              setRegisteredUsers(prev => reconcileUsers(prev, updatedItems));
            }
          }
        },
        (msg) => {
          if (!isMounted) return;
          setChatMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        },
        (status) => {
          if (isMounted) {
            setSupabaseStatus(status);
          }
        },
        (col, action, record, id) => {
          if (!isMounted) return;
          setLastSyncedTime(new Date());
          setSupabaseStatus('connected');

          if (action === 'upsert' && record && record.id) {
            if (isRecordDeletedLocally(record.id)) return;
            const updateFn = (prev: any[]) => {
              const idx = prev.findIndex(it => it.id === record.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = record;
                return next;
              }
              return [record, ...prev];
            };

            switch (col) {
              case 'stocks': setStocks(updateFn); break;
              case 'receiving': setReceiving(updateFn); break;
              case 'returns': setReturns(updateFn); break;
              case 'recycling': setRecycling(updateFn); break;
              case 'issuances': setIssuances(updateFn); break;
              case 'deliveries': setDeliveries(updateFn); break;
              case 'envLogs': setEnvLogs(updateFn); break;
              case 'forkliftChecks': setForkliftChecks(updateFn); break;
              case 'registries': setRegistries(updateFn); break;
              case 'registeredUsers': {
                setRegisteredUsers(prev => reconcileUsers(prev, [record]));
                break;
              }
            }
          } else if (action === 'delete' && id) {
            markRecordAsDeletedLocally(id);
            const filterFn = (prev: any[]) => prev.filter(it => it.id !== id);
            switch (col) {
              case 'stocks': setStocks(filterFn); break;
              case 'receiving': setReceiving(filterFn); break;
              case 'returns': setReturns(filterFn); break;
              case 'recycling': setRecycling(filterFn); break;
              case 'issuances': setIssuances(filterFn); break;
              case 'deliveries': setDeliveries(filterFn); break;
              case 'envLogs': setEnvLogs(filterFn); break;
              case 'forkliftChecks': setForkliftChecks(filterFn); break;
              case 'registries': setRegistries(filterFn); break;
              case 'registeredUsers': {
                const cleanId = id.toUpperCase();
                if (cleanId !== 'JPMP-002') {
                  markUserAsDeleted(cleanId);
                  setRegisteredUsers(prev => prev.filter(u => u.employeeId.toUpperCase() !== cleanId));
                }
                break;
              }
            }
          }
        }
      );

      // Periodic cloud refresh (every 10s) to keep multi-PC data synchronized
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        if (isMounted && isSupabaseConfigured()) {
          loadAllSupabaseData();
        }
      }, 10000);
    };

    // Auto-discover shared Supabase config from server
    let targetAddr = serverAddress.trim() || getDefaultServerAddress();
    const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
    const isHttps = isSecureServerHost(cleanHost, targetAddr);
    const httpProto = isHttps ? 'https:' : 'http:';

    const checkConfig = async () => {
      try {
        let res = await fetch('/api/supabase-config');
        if (!res.ok) {
          res = await fetch(`${httpProto}//${cleanHost}/api/supabase-config`);
        }
        if (res.ok) {
          const cfg = await res.json();
          if (cfg && cfg.configured && cfg.url && cfg.anonKey) {
            const current = getStoredSupabaseConfig();
            if (current.url !== cfg.url || current.anonKey !== cfg.anonKey) {
              saveStoredSupabaseConfig({ url: cfg.url, anonKey: cfg.anonKey });
            }
          }
        }
      } catch (e) {}

      if (isSupabaseConfigured()) {
        startSupabaseSync();
      } else {
        if (isMounted) setSupabaseStatus('disconnected');
      }
    };

    checkConfig();

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
      if (channel && typeof channel.unsubscribe === 'function') {
        channel.unsubscribe();
      }
    };
  }, [supabaseRefreshTrigger, serverAddress]);

  // Sync state helpers (supports Supabase PostgreSQL, WebSocket, and HTTP POST REST)
  const syncCollection = (collection: string, data: any[]) => {
    lastMutationTimes.current[collection] = Date.now();
    setLastSyncedTime(new Date());

    // Save to local cache
    try {
      localStorage.setItem(`juwei_wms_cache_${collection}`, JSON.stringify(data));
    } catch (e) {}

    // Mark as pending before network request
    markPendingSync(collection, data);

    // 0. Cross-tab BroadcastChannel
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'sync_collection',
          collection,
          data
        });
      } catch (e) {}
    }

    // 1. Direct Supabase Cloud PostgreSQL Sync
    if (isSupabaseConfigured()) {
      syncCollectionToSupabase(collection, data).then((ok) => {
        if (ok) clearPendingSync(collection);
      });
    }

    // 2. Send via WebSocket if active
    if (wsOpen(socket)) {
      try {
        socket!.send(JSON.stringify({
          type: 'update_collection',
          collection,
          data
        }));
      } catch (e) {
        console.warn('WS send error:', e);
      }
    }
    
    // 3. Dual-send via HTTP POST REST to guarantee server disk persistence & update
    let targetAddr = serverAddress.trim() || getDefaultServerAddress();
    const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
    const isHttps = isSecureServerHost(cleanHost, targetAddr);
    const httpProto = isHttps ? 'https:' : 'http:';
    
    fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection, data })
    })
    .then(res => {
      if (res.ok) {
        clearPendingSync(collection);
      }
    })
    .catch(() => {
      fetch(`${httpProto}//${cleanHost}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, data })
      })
      .then(res => {
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

    // Determine 4-digit PIN (custom or unique generated)
    let finalPin = '';
    const cleanProvidedPin = customPin ? customPin.replace(/\D/g, '').slice(0, 4) : '';
    if (cleanProvidedPin.length === 4) {
      finalPin = cleanProvidedPin;
    } else {
      let attempts = 0;
      while (attempts < 100) {
        const pinCandidate = Math.floor(1000 + Math.random() * 9000).toString();
        if (!registeredUsers.some(u => u.pin === pinCandidate)) {
          finalPin = pinCandidate;
          break;
        }
        attempts++;
      }
      if (!finalPin) {
        finalPin = Math.floor(1000 + Math.random() * 9000).toString();
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
      status: status || 'ACTIVE'
    };

    // Remove from deleted tracking if re-registered
    unmarkUserAsDeleted(cleanEmployeeId);

    const nextUsers = [...registeredUsers.filter(u => (u.employeeId || '').toUpperCase() !== cleanEmployeeId), newUser];
    setRegisteredUsers(nextUsers);
    localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(nextUsers));
    syncCollection('registeredUsers', nextUsers);
    
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

    // 2. Update local state and cache
    const nextUsers = registeredUsers.filter(u => (u.employeeId || '').toUpperCase() !== cleanId);
    setRegisteredUsers(nextUsers);
    localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(nextUsers));

    // 3. Purge from cloud PostgreSQL (Supabase) immediately
    deleteAccountFromSupabase(cleanId).catch(() => {});

    // 4. Send deletion request to server endpoint to purge memory, disk, and Supabase
    fetch('/api/accounts/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: cleanId })
    }).catch(() => {});

    // 5. Broadcast deletion over WebSocket
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

    // 6. Sync updated collection
    syncCollection('registeredUsers', nextUsers);
  };

  const handleClearAllAccountsExceptSuperAdmin = () => {
    const onlySuperAdmin = [superAdminAccount];
    setRegisteredUsers(onlySuperAdmin);
    try {
      localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(onlySuperAdmin));
    } catch (e) {}

    // 1. Supabase deletion
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabase();
        if (client) {
          Promise.resolve(client.from('registered_users').delete().neq('employee_id', 'JPMP-002'))
            .then(() => {
              syncCollectionToSupabase('registeredUsers', onlySuperAdmin);
            })
            .catch(() => {});
        }
      } catch (e) {}
    }

    // 2. Server reset
    fetch('/api/accounts/clear-all-except-super-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});

    // 3. Broadcast channel
    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'all_accounts_cleared',
          data: onlySuperAdmin
        });
      } catch (e) {}
    }

    // 4. WebSocket broadcast
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'all_accounts_cleared',
          data: onlySuperAdmin
        }));
      } catch (e) {}
    }

    // 5. Sync collection
    syncCollection('registeredUsers', onlySuperAdmin);
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
        return {
          ...u,
          ...updated,
          employeeId: cleanNewId,
          username: (updated.username || '').toUpperCase(),
          role: (updated.role || '').toUpperCase(),
          phoneNumber: updated.phoneNumber !== undefined ? updated.phoneNumber : (u.phoneNumber || ''),
          permission: updated.permission || u.permission || 'LIMITED_ACCESS',
          pin: (updated.pin || u.pin || '1234').slice(0, 4),
          status: updated.status || u.status || 'ACTIVE',
          lastActive: updated.lastActive !== undefined ? updated.lastActive : u.lastActive
        };
      }
      return u;
    });

    if (cleanNewId !== cleanOldId) {
      unmarkUserAsDeleted(cleanNewId);
      deleteAccountFromSupabase(cleanOldId).catch(() => {});
      fetch('/api/accounts/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: cleanOldId })
      }).catch(() => {});
    }

    setRegisteredUsers(nextUsers);
    localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(nextUsers));
    syncCollection('registeredUsers', nextUsers);
  };

  const handleDirectLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    const rawInput = (loginEmployeeId || '').trim();
    let searchId = rawInput.toUpperCase();
    if (searchId && !searchId.startsWith('JPMP-')) {
      searchId = 'JPMP-' + searchId.replace(/^EMP-/, '');
    }

    const enteredPin = (loginPin || '').trim();

    // Match by employeeId, raw employeeId, username, or phone number
    const foundUser = registeredUsers.find(
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

    if (foundUser) {
      setIsLoggingIn(true);
      setTimeout(() => {
        handleLogin(foundUser);
        setLoginEmployeeId('');
        setLoginPin('');
        setLoginError('');
        setIsLoggingIn(false);
      }, 500);
    } else {
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
      }, 500);
    } else {
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
    
    setCurrentUser('');
    setCurrentRole('');
    setCurrentEmployeeId('');
    setCurrentPermission('LIMITED_ACCESS');
    setIsLoggedIn(false);
    try {
      localStorage.removeItem('juwei_wms_isLoggedIn');
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
      fetch('/api/chat', {
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
      fetch('/api/chat', {
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
      id: `STK-${Date.now().toString().slice(-4)}`,
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
          nextStocks = nextStocks.map(s => s.id === stockItem.id ? { ...s, quantity: s.quantity - deductAmount } : s);
        });
      });
    }

    setStocks(nextStocks);
    syncCollection('stocks', nextStocks);

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
    const nextReceiving: ReceivingRecord[] = receiving.map(r => r.id === id ? { ...r, iqcStatus, status: (iqcStatus === 'APPROVED_IQC' ? 'VERIFIED' : 'QUARANTINED') as ReceivingRecord['status'] } : r);
    setReceiving(nextReceiving);
    syncCollection('receiving', nextReceiving);

    const targetRec = receiving.find(r => r.id === id);
    if (targetRec) {
      const nextStocks: MaterialStockItem[] = stocks.map(s => {
        if (s.lotNumber === targetRec.lotNumber && s.partCode === targetRec.partCode) {
          return {
            ...s,
            status: (iqcStatus === 'APPROVED_IQC' ? 'APPROVED' : 'QUARANTINE') as MaterialStockItem['status'],
            location: iqcStatus === 'APPROVED_IQC' ? 'Designated Storage Bin' : 'Quarantine Area'
          };
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
    
    const catUpper = (record.category || '').toUpperCase();
    let derivedStockType: MaterialType = 'RAW';
    if (catUpper.includes('PACKAGING')) derivedStockType = 'PACKAGING';
    else if (catUpper.includes('CONSUMABLE') || catUpper.includes('OFFICE')) derivedStockType = 'CONSUMABLE';
    else if (catUpper.includes('WIP') || catUpper.includes('SUB-PART')) derivedStockType = 'WIP';
    else if (catUpper.includes('FG') || catUpper.includes('FINISHED')) derivedStockType = 'FG';
    else if ((record.partCode || '').startsWith('RM')) derivedStockType = 'RAW';

    const newStockItem: MaterialStockItem = {
      id: `STK-${Date.now().toString().slice(-4)}`,
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
    const nextStocks = stocks.map((s, idx) => {
      if (idx === stockIdx) {
        return { ...s, quantity: s.quantity - quantity };
      }
      return s;
    });
    setStocks(nextStocks);
    syncCollection('stocks', nextStocks);
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

    sendSystemActivity(`${currentUser} created Delivery request ${record.id} for model ${record.modelName} (Qty: ${record.quantity}).`);
  };

  const handleUpdateDeliveryStatus = (id: string, status: DeliveryRecord['status'], extDoc?: { drNumber?: string, salesInvoice?: string, wayBill?: string }) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const nextDeliveries = deliveries.map(d => {
      if (d.id === id) {
        return { 
          ...d, 
          status, 
          ...extDoc 
        };
      }
      return d;
    });
    setDeliveries(nextDeliveries);
    syncCollection('deliveries', nextDeliveries);

    if (status === 'RELEASED') {
      const targetDel = deliveries.find(d => d.id === id);
      if (targetDel) {
        const nextStocks = stocks.map(s => {
          if (s.partCode === targetDel.partCode && s.status === 'APPROVED' && s.quantity >= targetDel.quantity) {
            return { ...s, quantity: s.quantity - targetDel.quantity };
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
    sendSystemActivity(`${currentUser} added stock batch ${item.partCode} (${item.quantity} ${item.unit}).`);
  };

  const handleUpdateStockQty = (id: string, qty: number) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const next = stocks.map(s => s.id === id ? { ...s, quantity: qty } : s);
    setStocks(next);
    syncCollection('stocks', next);
    sendSystemActivity(`${currentUser} updated stock ${id} quantity to ${qty}.`);
  };

  const handleUpdateStockStatus = (id: string, status: MaterialStockItem['status']) => {
    if (currentPermission === 'VIEW_ONLY') {
      alert("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.");
      return;
    }
    const next = stocks.map(s => s.id === id ? { ...s, status } : s);
    setStocks(next);
    syncCollection('stocks', next);
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

  // Export JSON Backup helper
  const handleExportBackup = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
      stocks, receiving, returns, recycling, issuances, deliveries, envLogs, forkliftChecks
    }, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "juwei_wms_iso_backup.json");
    dlAnchorElem.click();
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
  };

  const handleUpdateMasterItem = (item: MasterRegistryItem) => {
    const next = registries.map(r => r.id === item.id ? item : r);
    setRegistries(next);
    syncCollection('registries', next);
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
      <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4 py-12 sm:px-6 lg:px-8 font-sans relative overflow-hidden" id="juwei-auth-container">
        {/* NEWLY REGISTERED USER SECURE PIN DISCOVERY OVERLAY */}
        {newlyRegisteredUser && (
          <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200">
            <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-2xl text-center space-y-6 relative overflow-hidden border border-slate-200 text-slate-900">
              <div className="flex justify-center">
                <div className="h-14 w-14 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-center text-emerald-600 shadow-xs">
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
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-left space-y-2 text-xs">
                <div className="flex justify-between items-center border-b border-slate-200 pb-1.5">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Operator:</span>
                  <span className="font-semibold text-slate-900">{newlyRegisteredUser.username}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-200 pb-1.5">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Employee ID:</span>
                  <span className="font-semibold text-indigo-600 font-mono">{newlyRegisteredUser.employeeId}</span>
                </div>
                {newlyRegisteredUser.phoneNumber && (
                  <div className="flex justify-between items-center border-b border-slate-200 pb-1.5">
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
              <div className="bg-indigo-50/60 p-5 rounded-xl border border-indigo-100 relative space-y-3">
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
                    className="text-slate-500 hover:text-emerald-700 p-1.5 rounded transition cursor-pointer"
                    title={showNewlyRegisteredPin ? "Hide PIN" : "Reveal PIN"}
                  >
                    {showNewlyRegisteredPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* QR Code Container */}
                <div className="bg-white p-2.5 rounded-xl border border-slate-200 inline-block mx-auto shadow-xs">
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
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 px-4 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <Fingerprint className="h-4 w-4" /> Proceed to Verification & Log In
              </button>
            </div>
          </div>
        )}

        <motion.div 
          id="operator-login-portal" 
          className="operator-login-portal max-w-md w-full space-y-6 bg-slate-900 border border-slate-800 p-8 sm:p-9 rounded-2xl shadow-2xl relative overflow-hidden z-10 text-slate-100"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {/* Supabase Cloud Database Quick Settings */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-slate-400 font-mono font-medium">SYSTEM READY</span>
            </div>

            <button
              type="button"
              onClick={() => setShowSupabaseSettingsModal(true)}
              className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer text-xs"
              title="Click to edit Supabase Cloud Database Configuration"
              aria-label="Edit Supabase Cloud Database Configuration"
              id="btn-login-supabase-settings"
            >
              <Database className={`h-3.5 w-3.5 ${isSupabaseConfigured() ? 'text-emerald-400' : 'text-amber-400'}`} />
              <span className="text-[11px] font-mono">DB Config</span>
            </button>
          </div>

          <div className="flex flex-col items-center text-center">
            <span className="inline-block bg-indigo-500/10 text-indigo-300 font-mono font-semibold text-[10px] uppercase px-2.5 py-0.5 rounded-md mb-2 border border-indigo-500/20">
              JUWEI WMS GATEWAY
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

            <form onSubmit={handleDirectLogin} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Employee ID
                </label>
                <div className="relative">
                  <input
                    type="text"
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

          <div className="pt-4 border-t border-slate-800 flex flex-col items-center gap-2.5 text-center">
            <p className="text-[10px] text-slate-500 font-mono">
              JUWEI PLASTIC MOULDING PHILS. INC.
            </p>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <button
                type="button"
                onClick={() => setShowMobileInstallModal(true)}
                className="text-[11px] text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer font-mono"
              >
                <Smartphone className="h-3 w-3 text-emerald-400" />
                <span>Mobile App</span>
              </button>
              <button
                type="button"
                onClick={() => setShowDesktopInstallModal(true)}
                className="text-[11px] text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer font-mono"
              >
                <Monitor className="h-3 w-3 text-indigo-400" />
                <span>Desktop App</span>
              </button>
            </div>
          </div>
        </motion.div>

        {/* Mobile APK / App Installer Modal */}
        {showMobileInstallModal && (
          <MobileAppDownloadModal
            isOpen={showMobileInstallModal}
            onClose={() => setShowMobileInstallModal(false)}
            serverAddress={serverAddress}
          />
        )}

        {/* Desktop Application Installer Modal */}
        {showDesktopInstallModal && (
          <DesktopInstallModal
            isOpen={showDesktopInstallModal}
            onClose={() => setShowDesktopInstallModal(false)}
          />
        )}

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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="bg-white border border-slate-300 rounded-3xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl text-slate-900">
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
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 font-sans relative overflow-x-hidden text-slate-900" id="juwei-app-container">
      {/* Sidebar navigation */}
      <aside className="w-full md:w-64 bg-slate-900 border-r border-slate-800 text-slate-200 flex flex-col justify-between z-20 shrink-0" id="sidebar-nav">
        <div>
          {/* Logged in Operator badge */}
          <div className="p-4 bg-slate-950/70 border-b border-slate-800 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="bg-slate-800 border border-slate-700 p-2 rounded-xl text-indigo-400 shrink-0">
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
                onClick={handleLogout}
                title="Log Out / Switch Operator"
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700/60 rounded-xl transition-colors cursor-pointer"
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
          <div className="p-4 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-mono font-bold tracking-wider text-sm">JUWEI WMS</span>
                <span className="px-1.5 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[9px] font-mono font-bold rounded">
                  v1.0
                </span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">Juwei Plastic Moulding Phils. Inc.</span>
            </div>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="System Live" />
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1" id="nav-list">
            <button 
              onClick={() => setView('dashboard')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all cursor-pointer ${
                view === 'dashboard' 
                  ? 'bg-indigo-600 text-white font-semibold shadow-xs' 
                  : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100 font-medium'
              }`}
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" /> Dashboard Overview
            </button>

            <button 
              onClick={() => setView('receiving')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all cursor-pointer ${
                view === 'receiving' 
                  ? 'bg-indigo-600 text-white font-semibold shadow-xs' 
                  : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100 font-medium'
              }`}
            >
              <ArrowLeftRight className="h-4 w-4 shrink-0" /> Receiving & Returns
            </button>

            <button 
              onClick={() => setView('stock')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all cursor-pointer ${
                view === 'stock' 
                  ? 'bg-indigo-600 text-white font-semibold shadow-xs' 
                  : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100 font-medium'
              }`}
            >
              <PackageSearch className="h-4 w-4 shrink-0" /> Stock & FIFO Bins
            </button>

            <button 
              onClick={() => setView('recycling')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all cursor-pointer ${
                view === 'recycling' 
                  ? 'bg-indigo-600 text-white font-semibold shadow-xs' 
                  : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100 font-medium'
              }`}
            >
              <RotateCcw className="h-4 w-4 shrink-0" /> Packaging Recycling
            </button>

            <button 
              onClick={() => setView('issuance')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all cursor-pointer ${
                view === 'issuance' 
                  ? 'bg-indigo-600 text-white font-semibold shadow-xs' 
                  : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100 font-medium'
              }`}
            >
              <Briefcase className="h-4 w-4 shrink-0" /> Production Issuance
            </button>

            <button 
              onClick={() => setView('delivery')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all cursor-pointer ${
                view === 'delivery' 
                  ? 'bg-indigo-600 text-white font-semibold shadow-xs' 
                  : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100 font-medium'
              }`}
            >
              <Truck className="h-4 w-4 shrink-0" /> Outbound & Gate Pass
            </button>

            <button 
              onClick={() => setView('environmental')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all cursor-pointer ${
                view === 'environmental' 
                  ? 'bg-indigo-600 text-white font-semibold shadow-xs' 
                  : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100 font-medium'
              }`}
            >
              <Boxes className="h-4 w-4 shrink-0" /> Space Utilization
            </button>

            <button 
              onClick={() => setView('master-registry')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all cursor-pointer ${
                view === 'master-registry' 
                  ? 'bg-indigo-600 text-white font-semibold shadow-xs' 
                  : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100 font-medium'
              }`}
              id="nav-master-registry"
            >
              <FolderPlus className="h-4 w-4 shrink-0" /> Master Data Register
            </button>

            {(currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002' || (currentUser || '').toUpperCase().includes('ALDRIN') || (currentRole || '').toUpperCase().includes('SUPER')) && (
              <button 
                onClick={() => setView('accounts')}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all cursor-pointer ${
                  view === 'accounts' 
                    ? 'bg-indigo-600 text-white font-semibold shadow-xs' 
                    : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100 font-medium'
                }`}
                id="nav-registered-accounts"
              >
                <Users className="h-4 w-4 shrink-0" /> JPMP Accounts
              </button>
            )}
          </nav>
        </div>

        {/* Sidebar Footer with system values */}
        <div className="p-4 border-t border-slate-800 space-y-2 bg-slate-950/60">
          <div className="space-y-1.5">
            {currentEmployeeId === 'JPMP-002' ? (
              <>
                <button 
                  onClick={handleExportBackup}
                  className="w-full bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white py-2 px-3 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 border border-slate-700/60 transition-colors cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-indigo-400" /> Export DB Backup
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
            ) : (
              <div className="text-center py-2 text-[10px] text-slate-500 font-mono">
                Operator Session Active
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 z-10">
        {/* Minimalist Header Bar */}
        <header className="h-16 bg-white/90 backdrop-blur-md border-b border-slate-200/90 px-4 sm:px-6 lg:px-8 flex justify-between items-center shrink-0 z-20 sticky top-0">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="font-bold text-base sm:text-lg text-slate-900 tracking-tight truncate flex items-center gap-2" id="top-bar-page-title">
              <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />
              <span>{getPageTitle()}</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-2 text-xs font-medium shrink-0">
            {/* Live Real-time Status Pill */}
            <div 
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border font-mono text-[11px] font-semibold ${
                connectionStatus === 'connected' 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
              title={`WebSocket Server: ${connectionStatus.toUpperCase()} ${wsLatency !== null ? `(${wsLatency}ms round-trip latency)` : ''}`}
            >
              <Radio className={`h-3.5 w-3.5 shrink-0 ${connectionStatus === 'connected' ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`} />
              <span>{connectionStatus === 'connected' ? (wsLatency !== null ? `${wsLatency}ms` : 'LIVE') : 'CONNECTING'}</span>
            </div>

            {/* Connected Workstations / Active Terminals Pill */}
            <button
              type="button"
              onClick={() => setShowActiveUsersModal(true)}
              className="inline-flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 px-2.5 h-8 rounded-lg text-xs font-semibold font-mono transition-colors cursor-pointer shrink-0"
              title="Click to view all active connected workstations in this session"
              aria-label="Active Workstation Terminals"
            >
              <Users className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <span>{activeUsers.length} ONLINE</span>
            </button>

            {/* Quick Force Sync Button */}
            <button
              type="button"
              onClick={handleManualSync}
              disabled={isManualSyncing}
              className="inline-flex items-center justify-center bg-white hover:bg-slate-100 text-slate-700 w-8 h-8 rounded-lg text-xs transition-colors cursor-pointer shrink-0 disabled:opacity-50 border border-slate-200"
              title={isManualSyncing ? "Syncing data across all workstations..." : `Force Instant Sync (Last synced ${lastSyncedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
              aria-label="Force Instant Sync"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-slate-600 ${isManualSyncing ? 'animate-spin text-indigo-600' : ''}`} />
            </button>

            {/* Supabase PostgreSQL Cloud Sync Badge Button */}
            <button
              type="button"
              onClick={() => setShowSupabaseSettingsModal(true)}
              className="inline-flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500 text-slate-200 hover:text-white px-2.5 h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0"
              title={`Supabase PostgreSQL Sync: ${supabaseStatus.toUpperCase()} (Click to configure Cloud Database)`}
              aria-label="Supabase Cloud Database Settings"
            >
              <Database className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span className={`w-1.5 h-1.5 rounded-full ${supabaseStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : supabaseStatus === 'connecting' ? 'bg-amber-400 animate-bounce' : 'bg-slate-500'}`} />
            </button>

            {/* Mobile APK / App Install Hub Button */}
            <button
              type="button"
              onClick={() => setShowMobileInstallModal(true)}
              className="inline-flex items-center justify-center bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 hover:text-slate-900 w-8 h-8 rounded-lg text-xs transition-colors cursor-pointer shrink-0"
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

        {/* View screen renderer with stable zero-flicker container */}
        <div className="p-4 sm:p-6 lg:p-7 overflow-y-auto flex-1 w-full z-10" id="main-content-viewport">
          <div key={view} className="w-full">
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
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                  onOpenRegisterModal={() => setView('master-registry')}
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
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                  receiving={receiving}
                  issuances={issuances}
                  returns={returns}
                />
              )}

              {view === 'recycling' && (
                <RecyclingModule 
                  recycling={recycling}
                  onAddRecycling={handleAddRecycling}
                  onDeleteRecycling={handleDeleteRecycling}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
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
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
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
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
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
                />
              )}

              {view === 'master-registry' && (
                <MasterRegistryModule 
                  registries={registries}
                  onRegisterItem={handleRegisterMasterItem}
                  onUpdateItem={handleUpdateMasterItem}
                  onDeleteItem={handleDeleteMasterItem}
                  onResetDefaults={handleResetMasterDefaults}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS'}
                  defaultType="ALL"
                />
              )}

              {view === 'accounts' && (currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002' || (currentUser || '').toUpperCase().includes('ALDRIN') || (currentRole || '').toUpperCase().includes('SUPER')) && (
                <RegisteredAccountsModule 
                  accounts={registeredUsers}
                  onAddAccount={handleRegister}
                  onUpdateAccount={handleUpdateAccount}
                  onRemoveAccount={handleRemoveUser}
                  onClearAllAccounts={handleClearAllAccountsExceptSuperAdmin}
                  currentUser={currentUser}
                  currentEmployeeId={currentEmployeeId}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002'}
                />
              )}
          </div>
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
        />
      )}

      {/* Desktop Application Installer Modal */}
      {showDesktopInstallModal && (
        <DesktopInstallModal
          isOpen={showDesktopInstallModal}
          onClose={() => setShowDesktopInstallModal(false)}
        />
      )}

      {/* Supabase PostgreSQL Database & Realtime Settings Modal */}
      <SupabaseSettingsModal
        isOpen={showSupabaseSettingsModal}
        onClose={() => setShowSupabaseSettingsModal(false)}
        connectionStatus={supabaseStatus}
        onForceSync={() => {
          const collections = ['stocks', 'receiving', 'returns', 'recycling', 'issuances', 'deliveries', 'envLogs', 'forkliftChecks', 'registries', 'registeredUsers'];
          Promise.all(collections.map(async (col) => {
            const cached = localStorage.getItem(`juwei_wms_cache_${col}`) || (col === 'registeredUsers' ? localStorage.getItem('juwei_wms_registeredUsers') : null);
            if (cached) {
              try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  await syncCollectionToSupabase(col, parsed);
                }
              } catch (e) {}
            }
          })).then(() => {
            setSupabaseRefreshTrigger(prev => prev + 1);
          });
        }}
      />

      {/* Active Workstation Terminals Modal */}
      {showActiveUsersModal && (
        <ActiveUsersModal
          isOpen={showActiveUsersModal}
          onClose={() => setShowActiveUsersModal(false)}
          activeUsers={activeUsers}
          activePresence={activePresence}
          registeredUsers={registeredUsers}
          connectionStatus={connectionStatus}
          supabaseStatus={supabaseStatus}
          wsLatency={wsLatency}
          lastSyncedTime={lastSyncedTime}
          onForceSync={handleManualSync}
          isManualSyncing={isManualSyncing}
        />
      )}

      {/* Live Remote Activity Sync Toast */}
      {liveSyncToast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3 duration-300 pointer-events-auto">
          <div className="bg-slate-900/95 text-white border border-emerald-500/40 rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3 backdrop-blur-md">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg shrink-0">
              <RefreshCw className="h-4 w-4 animate-spin text-emerald-400" />
            </div>
            <div className="text-xs">
              <div className="font-bold text-white flex items-center gap-1.5 font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>LIVE REALTIME SYNC</span>
                <span className="text-[10px] text-slate-400 font-mono">({liveSyncToast.time})</span>
              </div>
              <div className="text-slate-300 text-[11px] mt-0.5">
                <span className="text-emerald-300 font-bold">{liveSyncToast.author}</span> {liveSyncToast.action}
              </div>
            </div>
            <button
              onClick={() => setLiveSyncToast(null)}
              className="text-slate-400 hover:text-white ml-2 text-xs font-bold p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

