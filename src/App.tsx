/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  Database
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import AccountQRBadgeModal from './components/AccountQRBadgeModal';
import DesktopInstallModal from './components/DesktopInstallModal';
import { ConfirmModal, ConfirmActionConfig } from './components/ConfirmModal';
import BarcodeScannerModal from './components/BarcodeScannerModal';
import SupabaseSettingsModal from './components/SupabaseSettingsModal';

import { 
  getStoredSupabaseConfig, 
  isSupabaseConfigured, 
  fetchCollectionFromSupabase, 
  syncCollectionToSupabase, 
  setupSupabaseRealtimeSubscriptions,
  processPendingSupabaseMutations
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
  MasterRegistryItem
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
import RegisteredAccountsModule, { RegisteredAccount } from './components/RegisteredAccountsModule';
import MasterRegistryModule, { DEFAULT_MASTER_REGISTRIES } from './components/MasterRegistryModule';

const DEFAULT_ONLINE_CLOUD_HOST = 'ais-dev-vmhtsbs5lyqg4e3o5qf35l-327128958892.asia-southeast1.run.app';

export function sanitizeServerHost(raw: string): string {
  if (!raw) return '';
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^https?:\/\//i, '');
  cleaned = cleaned.replace(/^wss?:\/\//i, '');
  cleaned = cleaned.split('/')[0].trim().toLowerCase();
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

  // Core state arrays - initialize immediately with default data so the app is instantly functional
  const [stocks, setStocks] = useState<MaterialStockItem[]>(INITIAL_STOCK);
  const [receiving, setReceiving] = useState<ReceivingRecord[]>(INITIAL_RECEIVING);
  const [returns, setReturns] = useState<ReturnRecord[]>(INITIAL_RETURNS);
  const [recycling, setRecycling] = useState<RecyclingRecord[]>(INITIAL_RECYCLING);
  const [issuances, setIssuances] = useState<IssuanceRecord[]>(INITIAL_ISSUANCE);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>(INITIAL_DELIVERIES);
  const [envLogs, setEnvLogs] = useState<EnvironmentalLog[]>(INITIAL_ENV_LOGS);
  const [forkliftChecks, setForkliftChecks] = useState<ForkliftChecklist[]>(INITIAL_FORKLIFT_CHECKS);
  const [registries, setRegistries] = useState<MasterRegistryItem[]>(() => {
    const isReset = localStorage.getItem('juwei_wms_reset_zero_v2');
    if (!isReset) {
      localStorage.setItem('juwei_wms_reset_zero_v2', 'true');
      localStorage.setItem('juwei_wms_master_registries', JSON.stringify([]));
      return [];
    }
    const cached = localStorage.getItem('juwei_wms_master_registries');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        // Fallback
      }
    }
    localStorage.setItem('juwei_wms_master_registries', JSON.stringify([]));
    return [];
  });

  useEffect(() => {
    localStorage.setItem('juwei_wms_master_registries', JSON.stringify(registries));
  }, [registries]);

  // Real-time states
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [serverAddress, setServerAddress] = useState<string>(() => getDefaultServerAddress());
  const [showServerSettingsModal, setShowServerSettingsModal] = useState<boolean>(false);
  const [tempServerAddress, setTempServerAddress] = useState<string>('');

  // Supabase PostgreSQL Realtime state
  const [showSupabaseSettingsModal, setShowSupabaseSettingsModal] = useState<boolean>(false);
  const [supabaseStatus, setSupabaseStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  // User Authentication / Registration states
  const [currentUser, setCurrentUser] = useState<string>(() => {
    return localStorage.getItem('juwei_wms_currentUser') || '';
  });
  const [currentRole, setCurrentRole] = useState<string>(() => {
    return localStorage.getItem('juwei_wms_currentRole') || '';
  });
  const [currentEmployeeId, setCurrentEmployeeId] = useState<string>(() => {
    let empId = localStorage.getItem('juwei_wms_currentEmployeeId') || '';
    if (empId && !empId.startsWith('JPMP-')) {
      empId = 'JPMP-' + empId.replace(/^EMP-/, '');
      localStorage.setItem('juwei_wms_currentEmployeeId', empId);
    }
    return empId;
  });
  const [currentPermission, setCurrentPermission] = useState<string>(() => {
    const cached = localStorage.getItem('juwei_wms_currentPermission');
    if (cached) return cached;
    const empId = localStorage.getItem('juwei_wms_currentEmployeeId') || '';
    if (empId) {
      return empId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS';
    }
    return 'LIMITED_ACCESS';
  });
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    return localStorage.getItem('juwei_wms_isLoggedIn') === 'true';
  });
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  
  // Direct employee ID and PIN login form states
  const [loginEmployeeId, setLoginEmployeeId] = useState<string>('');
  const [loginPin, setLoginPin] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [showPin, setShowPin] = useState<boolean>(false);
  const [showLoginQrScanner, setShowLoginQrScanner] = useState<boolean>(false);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [qrBadgeAccount, setQrBadgeAccount] = useState<RegisteredAccount | null>(null);
  
  // PIN code security flow states
  const [pinPromptUser, setPinPromptUser] = useState<{username: string; role: string; employeeId: string; permission?: string; pin?: string} | null>(null);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [newlyRegisteredUser, setNewlyRegisteredUser] = useState<{username: string; role: string; employeeId: string; permission?: string; pin: string} | null>(null);
  const [showNewlyRegisteredPin, setShowNewlyRegisteredPin] = useState<boolean>(false);
  const [confirmActionApp, setConfirmActionApp] = useState<ConfirmActionConfig | null>(null);
  
  const superAdminAccount = { username: 'ALDRIN BANAWA', role: 'SUPER ADMINISTRATOR', employeeId: 'JPMP-002', permission: 'FULL_ACCESS', pin: '0423' };

  const [registeredUsers, setRegisteredUsers] = useState<{username: string; role: string; employeeId: string; permission?: string; pin?: string}[]>(() => {
    const cached = localStorage.getItem('juwei_wms_registeredUsers');
    if (cached) {
      try {
        const list = JSON.parse(cached);
        if (Array.isArray(list) && list.length > 0) {
          const updatedList = list.map(u => {
            if (u.employeeId === 'JPMP-002' || u.username === 'SUPER ADMIN' || u.username === 'ALDRIN BANAWA') {
              return superAdminAccount;
            }
            return u;
          });
          if (!updatedList.some(u => u.employeeId === 'JPMP-002')) {
            updatedList.unshift(superAdminAccount);
          }
          localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(updatedList));
          return updatedList;
        }
      } catch (e) {
        // Fallback
      }
    }
    localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify([superAdminAccount]));
    return [superAdminAccount];
  });

  // Live real-time system clock
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [linkCopied, setLinkCopied] = useState<boolean>(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
    localStorage.removeItem('juwei_wms_master_registries');
    syncCollection('stocks', []);
    syncCollection('receiving', []);
    syncCollection('returns', []);
    syncCollection('recycling', []);
    syncCollection('issuances', []);
    syncCollection('deliveries', []);
    syncCollection('envLogs', []);
    syncCollection('forkliftChecks', []);
  };

  const resetAccountsToDefaults = () => {
    const defaultAccounts = [
      { username: 'SUPER ADMIN', role: 'SUPER ADMINISTRATOR', employeeId: 'JPMP-002', permission: 'FULL_ACCESS', pin: '0002' }
    ];
    setRegisteredUsers(defaultAccounts);
    localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(defaultAccounts));
    // Also log out any active session if we reset the accounts
    handleLogout();
  };

  // Connect to fullstack WebSocket & HTTP Real-Time Server with automatic failover
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let httpPollInterval: any = null;
    let isMounted = true;
    let hasConnectedOnce = false;

    const applyStatePayload = (dataPayload: any, activeUsersList?: string[]) => {
      if (!dataPayload) return;
      const { stocks, receiving, returns, recycling, issuances, deliveries, envLogs, forkliftChecks, registries, registeredUsers: serverUsers, chatMessages: msgs } = dataPayload;

      if (Array.isArray(stocks)) {
        if (stocks.length > 0) {
          setStocks(stocks);
        } else if (stocks.length === 0 && INITIAL_STOCK.length > 0) {
          syncCollection('stocks', INITIAL_STOCK);
        }
      }

      if (Array.isArray(receiving)) {
        if (receiving.length > 0) setReceiving(receiving);
        else if (INITIAL_RECEIVING.length > 0) syncCollection('receiving', INITIAL_RECEIVING);
      }

      if (Array.isArray(returns)) {
        if (returns.length > 0) setReturns(returns);
        else if (INITIAL_RETURNS.length > 0) syncCollection('returns', INITIAL_RETURNS);
      }

      if (Array.isArray(recycling)) {
        if (recycling.length > 0) setRecycling(recycling);
        else if (INITIAL_RECYCLING.length > 0) syncCollection('recycling', INITIAL_RECYCLING);
      }

      if (Array.isArray(issuances)) {
        if (issuances.length > 0) setIssuances(issuances);
        else if (INITIAL_ISSUANCE.length > 0) syncCollection('issuances', INITIAL_ISSUANCE);
      }

      if (Array.isArray(deliveries)) {
        if (deliveries.length > 0) setDeliveries(deliveries);
        else if (INITIAL_DELIVERIES.length > 0) syncCollection('deliveries', INITIAL_DELIVERIES);
      }

      if (Array.isArray(envLogs)) {
        if (envLogs.length > 0) setEnvLogs(envLogs);
        else if (INITIAL_ENV_LOGS.length > 0) syncCollection('envLogs', INITIAL_ENV_LOGS);
      }

      if (Array.isArray(forkliftChecks)) {
        if (forkliftChecks.length > 0) setForkliftChecks(forkliftChecks);
        else if (INITIAL_FORKLIFT_CHECKS.length > 0) syncCollection('forkliftChecks', INITIAL_FORKLIFT_CHECKS);
      }

      if (Array.isArray(registries)) {
        if (registries.length > 0) {
          setRegistries(registries);
        } else {
          const cachedReg = localStorage.getItem('juwei_wms_master_registries');
          if (cachedReg) {
            try {
              const parsed = JSON.parse(cachedReg);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setRegistries(parsed);
                syncCollection('registries', parsed);
              }
            } catch (e) {}
          }
        }
      }
      
      if (Array.isArray(serverUsers)) {
        const sanitized = serverUsers.map((u: any) => 
          (u.employeeId === 'JPMP-002' || u.username === 'SUPER ADMIN' || u.username === 'ALDRIN BANAWA') ? superAdminAccount : u
        );
        if (!sanitized.some((u: any) => u.employeeId === 'JPMP-002')) sanitized.unshift(superAdminAccount);

        // Merge local accounts from localStorage if user registered locally
        const cachedLocalUsers = localStorage.getItem('juwei_wms_registeredUsers');
        let finalUsers = sanitized;
        if (cachedLocalUsers) {
          try {
            const parsedLocal = JSON.parse(cachedLocalUsers);
            if (Array.isArray(parsedLocal)) {
              let hasNewLocal = false;
              const merged = [...sanitized];
              parsedLocal.forEach((localU: any) => {
                if (localU && localU.employeeId && !merged.some(m => m.employeeId.toUpperCase() === localU.employeeId.toUpperCase())) {
                  merged.push(localU);
                  hasNewLocal = true;
                }
              });
              if (hasNewLocal) {
                finalUsers = merged;
                syncCollection('registeredUsers', finalUsers);
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }

        setRegisteredUsers(finalUsers);
        localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(finalUsers));
      }
      if (msgs && Array.isArray(msgs)) setChatMessages(msgs);
      if (activeUsersList && Array.isArray(activeUsersList)) setActiveUsers(activeUsersList);
    };

    const tryFetchSync = async (url: string): Promise<boolean> => {
      try {
        const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (res.ok) {
          const json = await res.json();
          if (isMounted) {
            hasConnectedOnce = true;
            setConnectionStatus('connected');
            if (json.data) applyStatePayload(json.data, json.activeUsers);
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
      // 0. Flush any pending offline mutations first
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

      let pingInterval: any = null;
      
      try {
        ws = new WebSocket(socketUrl);
      } catch (err) {
        reconnectTimeout = setTimeout(connectWebSocket, 5000);
        return;
      }

      ws.onopen = () => {
        if (!isMounted) return;
        hasConnectedOnce = true;
        setConnectionStatus('connected');
        setSocket(ws);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({
              type: 'join',
              username: currentUser || 'JUWEI OPERATOR'
            }));
          } catch (e) {
            console.warn('WS send join error:', e);
          }
        }

        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch (e) {
              console.warn('WS ping error:', e);
            }
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'pong') return;

          switch (payload.type) {
            case 'init': {
              hasConnectedOnce = true;
              setConnectionStatus('connected');
              applyStatePayload(payload.data, payload.activeUsers);
              break;
            }
            case 'collection_updated': {
              const { collection, data } = payload;
              switch (collection) {
                case 'stocks': setStocks(data); break;
                case 'receiving': setReceiving(data); break;
                case 'returns': setReturns(data); break;
                case 'recycling': setRecycling(data); break;
                case 'issuances': setIssuances(data); break;
                case 'deliveries': setDeliveries(data); break;
                case 'envLogs': setEnvLogs(data); break;
                case 'forkliftChecks': setForkliftChecks(data); break;
                case 'registries': setRegistries(data); break;
                case 'registeredUsers': {
                  const sanitized = (data || []).map((u: any) => 
                    (u.employeeId === 'JPMP-002' || u.username === 'SUPER ADMIN' || u.username === 'ALDRIN BANAWA') ? superAdminAccount : u
                  );
                  if (!sanitized.some((u: any) => u.employeeId === 'JPMP-002')) sanitized.unshift(superAdminAccount);
                  setRegisteredUsers(sanitized);
                  localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(sanitized));
                  break;
                }
              }
              break;
            }
            case 'chat_broadcast': {
              setChatMessages(prev => [...prev, payload.message]);
              break;
            }
            case 'presence_updated': {
              setActiveUsers(payload.activeUsers || []);
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
        reconnectTimeout = setTimeout(connectWebSocket, 5000);
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

    // Continuous HTTP background polling every 3 seconds
    httpPollInterval = setInterval(() => {
      if (isMounted) {
        runSyncCheck();
      }
    }, 3000);

    return () => {
      isMounted = false;
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (httpPollInterval) clearInterval(httpPollInterval);
      window.removeEventListener('online', handleOnlineOrFocus);
      window.removeEventListener('focus', handleOnlineOrFocus);
      document.removeEventListener('visibilitychange', handleOnlineOrFocus);
    };
  }, [currentUser, isLoggedIn, serverAddress]);

  // Supabase PostgreSQL Realtime Subscription & Initial Fetch Engine
  useEffect(() => {
    let channel: any = null;

    if (isSupabaseConfigured()) {
      // 1. Fetch initial state from Supabase Cloud
      const loadSupabaseData = async () => {
        const collections = ['stocks', 'receiving', 'returns', 'recycling', 'issuances', 'deliveries', 'envLogs', 'forkliftChecks', 'registries', 'registeredUsers', 'chatMessages'];
        for (const col of collections) {
          const items = await fetchCollectionFromSupabase(col);
          if (Array.isArray(items) && items.length > 0) {
            if (col === 'stocks') setStocks(items);
            else if (col === 'receiving') setReceiving(items);
            else if (col === 'returns') setReturns(items);
            else if (col === 'recycling') setRecycling(items);
            else if (col === 'issuances') setIssuances(items);
            else if (col === 'deliveries') setDeliveries(items);
            else if (col === 'envLogs') setEnvLogs(items);
            else if (col === 'forkliftChecks') setForkliftChecks(items);
            else if (col === 'registries') setRegistries(items);
            else if (col === 'registeredUsers') setRegisteredUsers(items);
            else if (col === 'chatMessages') setChatMessages(items);
          }
        }
      };
      loadSupabaseData();

      // 2. Setup Realtime subscription
      channel = setupSupabaseRealtimeSubscriptions(
        async (col) => {
          const updatedItems = await fetchCollectionFromSupabase(col);
          if (Array.isArray(updatedItems)) {
            if (col === 'stocks') setStocks(updatedItems);
            else if (col === 'receiving') setReceiving(updatedItems);
            else if (col === 'returns') setReturns(updatedItems);
            else if (col === 'recycling') setRecycling(updatedItems);
            else if (col === 'issuances') setIssuances(updatedItems);
            else if (col === 'deliveries') setDeliveries(updatedItems);
            else if (col === 'envLogs') setEnvLogs(updatedItems);
            else if (col === 'forkliftChecks') setForkliftChecks(updatedItems);
            else if (col === 'registries') setRegistries(updatedItems);
            else if (col === 'registeredUsers') setRegisteredUsers(updatedItems);
          }
        },
        (msg) => {
          setChatMessages(prev => [...prev, msg]);
        },
        (status) => {
          setSupabaseStatus(status);
        }
      );
    } else {
      setSupabaseStatus('disconnected');
    }

    return () => {
      if (channel && typeof channel.unsubscribe === 'function') {
        channel.unsubscribe();
      }
    };
  }, []);

  // Sync state helpers (supports Supabase PostgreSQL, WebSocket, and HTTP POST REST)
  const syncCollection = (collection: string, data: any[]) => {
    // Save to local cache
    try {
      localStorage.setItem(`juwei_wms_cache_${collection}`, JSON.stringify(data));
    } catch (e) {}

    // Mark as pending before network request
    markPendingSync(collection, data);

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

  const handleRegister = (username: string, role: string, employeeId: string, permission?: string) => {
    const cleanUsername = username.trim().toUpperCase();
    let cleanEmployeeId = employeeId.trim().toUpperCase();
    if (cleanEmployeeId && !cleanEmployeeId.startsWith('JPMP-')) {
      // Strip any leading EMP- if they typed EMP-XXXX
      const strippedId = cleanEmployeeId.replace(/^EMP-/, '');
      cleanEmployeeId = `JPMP-${strippedId}`;
    }
    const cleanRole = role.toUpperCase();
    if (!cleanUsername || !role || !cleanEmployeeId) {
      alert("ALL FIELDS ARE REQUIRED.");
      return false;
    }
    const exists = registeredUsers.some(
      u => u.employeeId.toUpperCase() === cleanEmployeeId || 
           u.username.toUpperCase() === cleanUsername
    );
    if (exists) {
      alert("AN OPERATOR WITH THIS NAME OR REGISTER ID ALREADY EXISTS.");
      return false;
    }

    // Generate unique 4-digit PIN
    let uniquePin = '';
    let attempts = 0;
    while (attempts < 100) {
      const pinCandidate = Math.floor(1000 + Math.random() * 9000).toString();
      if (!registeredUsers.some(u => u.pin === pinCandidate)) {
        uniquePin = pinCandidate;
        break;
      }
      attempts++;
    }
    if (!uniquePin) {
      uniquePin = Math.floor(1000 + Math.random() * 9000).toString();
    }

    const cleanPermission = permission || (cleanEmployeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS');
    const newUser = { 
      username: cleanUsername, 
      role: cleanRole, 
      employeeId: cleanEmployeeId, 
      permission: cleanPermission, 
      pin: uniquePin 
    };
    const nextUsers = [...registeredUsers, newUser];
    setRegisteredUsers(nextUsers);
    localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(nextUsers));
    syncCollection('registeredUsers', nextUsers);
    
    // Set state to trigger the secure PIN confirmation overlay
    setNewlyRegisteredUser(newUser);
    return true;
  };

  const handleRemoveUser = (employeeId: string) => {
    const nextUsers = registeredUsers.filter(u => u.employeeId !== employeeId);
    setRegisteredUsers(nextUsers);
    localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(nextUsers));
    syncCollection('registeredUsers', nextUsers);
  };

  const handleUpdateAccount = (oldEmpId: string, updated: RegisteredAccount) => {
    const nextUsers = registeredUsers.map(u => u.employeeId === oldEmpId ? updated : u);
    setRegisteredUsers(nextUsers);
    localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(nextUsers));
    syncCollection('registeredUsers', nextUsers);
  };

  const handleDirectLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    let searchId = loginEmployeeId.trim().toUpperCase();
    if (searchId && !searchId.startsWith('JPMP-')) {
      searchId = 'JPMP-' + searchId;
    }

    const foundUser = registeredUsers.find(
      (u) => u.employeeId.toUpperCase() === searchId && u.pin === loginPin.trim()
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
      searchEmpId = 'JPMP-' + searchEmpId;
    }

    if (!searchEmpId) {
      setLoginError('INVALID QR CODE: NO OPERATOR ID DETECTED IN SCANNED CODE.');
      return;
    }

    // Match operator account in registeredUsers
    const foundUser = registeredUsers.find(
      (u) => u.employeeId.toUpperCase() === searchEmpId || u.username.toUpperCase() === searchEmpId
    );

    if (foundUser) {
      if (searchPin && foundUser.pin && foundUser.pin !== searchPin) {
        setLoginError(`INCORRECT PIN CODE FOR OPERATOR ${foundUser.username} (${foundUser.employeeId}).`);
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

  const handleLogin = (user: {username: string; role: string; employeeId: string; permission?: string}) => {
    const cleanUsername = user.username.toUpperCase();
    const cleanRole = user.role.toUpperCase();
    const cleanEmployeeId = user.employeeId.toUpperCase();
    const cleanPermission = user.permission || (cleanEmployeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS');
    setCurrentUser(cleanUsername);
    setCurrentRole(cleanRole);
    setCurrentEmployeeId(cleanEmployeeId);
    setCurrentPermission(cleanPermission);
    setIsLoggedIn(true);
    localStorage.setItem('juwei_wms_currentUser', cleanUsername);
    localStorage.setItem('juwei_wms_currentRole', cleanRole);
    localStorage.setItem('juwei_wms_currentEmployeeId', cleanEmployeeId);
    localStorage.setItem('juwei_wms_currentPermission', cleanPermission);
    localStorage.setItem('juwei_wms_isLoggedIn', 'true');
    
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
    setCurrentPermission('FULL_ACCESS');
    setIsLoggedIn(false);
    localStorage.removeItem('juwei_wms_currentUser');
    localStorage.removeItem('juwei_wms_currentRole');
    localStorage.removeItem('juwei_wms_currentEmployeeId');
    localStorage.removeItem('juwei_wms_currentPermission');
    localStorage.removeItem('juwei_wms_isLoggedIn');
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

  function wsOpen(s: WebSocket | null): boolean {
    return !!s && s.readyState === WebSocket.OPEN;
  }

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
      const deductedSummary = record.bom.map(b => `${b.quantityRequired} ${b.unit.toUpperCase()} of ${b.partCode}`).join(', ');
      sendSystemActivity(`${currentUser} registered internal WIP/FG ${record.partCode} (Lot: ${record.lotNumber}) and auto-deducted BOM components: ${deductedSummary}`);
    } else {
      sendSystemActivity(`${currentUser} received ${record.quantity} ${record.unit.toUpperCase()} of ${record.partCode} (Lot: ${record.lotNumber}).`);
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
    else if (record.partCode.startsWith('RM')) derivedStockType = 'RAW';

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
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 py-12 sm:px-6 lg:px-8 font-sans uppercase relative" id="juwei-auth-container">
        {/* NEWLY REGISTERED USER SECURE PIN DISCOVERY OVERLAY */}
        {newlyRegisteredUser && (
          <div className="fixed inset-0 bg-slate-950/95 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
            <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl text-center space-y-6 relative overflow-hidden">
              <div className="absolute top-0 left-1/4 w-1/2 h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent animate-pulse" />
              
              <div className="flex justify-center">
                <div className="h-16 w-16 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400">
                  <UserCheck className="h-8 w-8 animate-bounce" />
                </div>
              </div>

              <div>
                <span className="text-emerald-400 font-bold text-[10px] tracking-widest font-mono block">
                  REGISTRATION SUCCESSFUL
                </span>
                <h3 className="text-xl font-bold text-white uppercase tracking-tight mt-1">
                  SECURE OPERATOR ID REGISTERED
                </h3>
                <p className="text-[10px] text-slate-500 font-bold mt-1 font-mono">
                  JUWEI PLASTIC MOULDING PHILS. INC.
                </p>
              </div>

              {/* Operator Details */}
              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 text-left space-y-2">
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
                  <span className="text-[10px] text-slate-500 font-bold font-mono">OPERATOR:</span>
                  <span className="text-xs font-bold text-slate-200">{newlyRegisteredUser.username}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
                  <span className="text-[10px] text-slate-500 font-bold font-mono">EMPLOYEE ID:</span>
                  <span className="text-xs font-bold text-indigo-400 font-mono">{newlyRegisteredUser.employeeId}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-500 font-bold font-mono">ASSIGNED ROLE:</span>
                  <span className="text-xs font-bold text-slate-200">{newlyRegisteredUser.role}</span>
                </div>
              </div>

              {/* PIN Code & Generated QR Code Pass Box */}
              <div className="bg-gradient-to-br from-indigo-950/40 to-slate-950 p-5 rounded-2xl border border-indigo-500/30 relative space-y-4">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-900 border border-indigo-500/40 text-indigo-400 text-[9px] font-mono font-bold tracking-wider px-3 py-1 rounded-full uppercase">
                  YOUR UNIQUE LOGIN PIN & QR PASS
                </div>
                
                <div className="flex items-center justify-center gap-2 mt-2">
                  <div className="text-3xl font-mono font-bold text-emerald-400 tracking-[0.25em] pl-[0.25em] text-center select-all">
                    {showNewlyRegisteredPin ? newlyRegisteredUser.pin : '••••'}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNewlyRegisteredPin(!showNewlyRegisteredPin)}
                    className="text-slate-400 hover:text-emerald-400 p-1.5 rounded transition cursor-pointer"
                    title={showNewlyRegisteredPin ? "Hide PIN" : "Reveal PIN"}
                  >
                    {showNewlyRegisteredPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* QR Code Container */}
                <div className="bg-white p-3 rounded-xl border border-slate-700 inline-block mx-auto shadow-md">
                  <QRCodeSVG
                    value={JSON.stringify({
                      type: 'JPMP_WMS_LOGIN_PASS',
                      employeeId: newlyRegisteredUser.employeeId,
                      username: newlyRegisteredUser.username,
                      pin: newlyRegisteredUser.pin
                    })}
                    size={130}
                    level="H"
                    includeMargin={true}
                  />
                </div>

                <div className="text-[9px] text-indigo-300 font-semibold uppercase tracking-wide">
                  ⚠️ RECORD PIN OR SAVE THIS QR CODE BADGE SECURELY.
                  <span className="block text-slate-400 mt-0.5">SCAN QR CODE AT WMS GATEWAY TO AUTOMATICALLY LOG IN.</span>
                </div>

                <button
                  type="button"
                  onClick={() => setQrBadgeAccount(newlyRegisteredUser)}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 uppercase cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5 text-indigo-400" /> PRINT / DOWNLOAD QR PASS BADGE
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
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg uppercase cursor-pointer"
              >
                <Fingerprint className="h-4 w-4" /> PROCEED TO VERIFICATION & LOG IN
              </button>
            </div>
          </div>
        )}

        <div id="operator-login-portal" className="operator-login-portal max-w-md w-full space-y-6 bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-xl relative overflow-hidden">
          {/* Accent Glow */}
          <div className="absolute top-0 left-1/4 w-1/2 h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent animate-pulse" />
          
          {/* Central Server Connection Status Bar */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-center gap-2 font-mono text-xs">
            <div className="flex items-center gap-2.5">
              {connectionStatus === 'connected' ? (
                <>
                  <Wifi className="h-4 w-4 text-emerald-400 shrink-0 animate-pulse" />
                  <span className="text-xs text-emerald-400 font-bold uppercase tracking-wider">REAL-TIME CONNECTED</span>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <Loader2 className="h-4 w-4 text-amber-400 animate-spin shrink-0" />
                  <span className="text-xs text-amber-300 font-bold uppercase tracking-wider">CONNECTING TO SERVER...</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 text-rose-400 shrink-0" />
                  <span className="text-xs text-rose-300 font-bold uppercase tracking-wider">DISCONNECTED</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center text-center">
            <span className="inline-block bg-indigo-500/20 text-indigo-200 font-bold text-[10px] tracking-wider uppercase px-2.5 py-1 rounded-full mb-1 border border-indigo-400/40 font-mono shadow-xs">
              OFFICIAL WMS OPERATOR PORTAL
            </span>
            <h2 className="text-xl font-extrabold tracking-tight text-white font-mono mt-1">
              JUWEI WMS GATEWAY
            </h2>
            <p className="mt-0.5 text-[10px] text-slate-200 font-bold uppercase tracking-wide">
              OPERATOR LOG-IN PORTAL
            </p>
          </div>

          <div className="space-y-4">
            {/* QR Code Instant Gateway Login Button */}
              <div className="bg-gradient-to-r from-indigo-950/90 via-slate-900 to-slate-950 p-3.5 rounded-xl border border-indigo-500/50 flex items-center justify-between gap-3 shadow-md">
                <div className="min-w-0">
                  <span className="text-xs font-extrabold text-white block font-mono flex items-center gap-1.5 truncate">
                    <QrCode className="h-4 w-4 text-emerald-400 shrink-0" /> INSTANT QR PASS LOG IN
                  </span>
                  <span className="text-[10px] text-slate-200 block font-sans uppercase truncate mt-0.5 font-medium">
                    Scan badge or upload pass image
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLoginQrScanner(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-md uppercase shrink-0 cursor-pointer font-mono"
                  id="btn-gateway-scan-qr"
                >
                  <ScanLine className="h-3.5 w-3.5" /> SCAN QR
                </button>
              </div>

              <div className="flex items-center gap-2 my-2 text-slate-300 text-[10px] font-mono font-bold uppercase">
                <div className="h-px bg-slate-700 flex-1" />
                <span>OR ENTER ID & PIN MANUALLY</span>
                <div className="h-px bg-slate-700 flex-1" />
              </div>

              <form onSubmit={handleDirectLogin} className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-white mb-1 font-mono">
                    OPERATOR ID NUMBER
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-300 font-mono text-xs font-bold">
                      ID
                    </span>
                    <input
                      type="text"
                      required
                      value={loginEmployeeId}
                      onChange={(e) => {
                        setLoginEmployeeId(e.target.value);
                        if (loginError) setLoginError('');
                      }}
                      placeholder="E.G. JPMP-002"
                      style={{ color: '#ffffff' }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white !text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 uppercase font-mono font-bold tracking-wide"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-white mb-1 font-mono">
                    4-DIGIT SECURE PIN CODE
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-300">
                      <Lock className="h-3.5 w-3.5 text-slate-300" />
                    </span>
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
                      style={{ color: '#ffffff' }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-10 py-2 text-xs text-white !text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 font-mono font-bold tracking-widest"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-300 hover:text-white transition"
                    >
                      {showPin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {loginError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 px-3 py-2 rounded-lg text-[10px] text-center font-bold tracking-wide uppercase font-mono animate-shake">
                    ⚠️ {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg uppercase cursor-pointer"
                >
                  <LogIn className="h-4 w-4" /> LOG IN TO WMS SESSION
                </button>
              </form>
            </div>

          <div className="pt-4 border-t border-slate-800 text-center">
            <p className="text-[9px] text-slate-300 uppercase tracking-widest font-mono font-bold">
              SECURE LOG-IN SESSION • JUWEI PLASTIC MOULDING WMS
            </p>
          </div>
        </div>

        {/* Gateway QR Code Scanner Modal */}
        {showLoginQrScanner && (
          <BarcodeScannerModal
            isOpen={showLoginQrScanner}
            onClose={() => setShowLoginQrScanner(false)}
            title="Juwei WMS Gateway QR Login Scanner"
            subtitle="Scan operator badge QR code or upload pass image containing Username & PIN"
            sampleCodes={registeredUsers.map(u => ({
              code: JSON.stringify({ type: 'JPMP_WMS_LOGIN_PASS', employeeId: u.employeeId, username: u.username, pin: u.pin || '1234' }),
              label: `${u.username} (${u.employeeId})`,
              name: `${u.username} [${u.employeeId}]`,
              description: `PIN: ${u.pin || '1234'} • ${u.role}`
            }))}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-indigo-500/40 rounded-2xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl">
              <div className="inline-flex p-4 bg-indigo-500/10 text-indigo-400 rounded-full border border-indigo-500/20">
                <Loader2 className="h-10 w-10 animate-spin text-indigo-400" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-white text-base tracking-wide uppercase font-mono">
                  VERIFYING CREDENTIALS
                </h3>
                <p className="text-xs text-indigo-300 font-semibold font-mono">
                  AUTHENTICATING OPERATOR LOG-IN...
                </p>
              </div>
              <p className="text-[11px] text-slate-400 font-sans">
                Establishing secure WMS operational session. Please wait a moment...
              </p>
            </div>
          </div>
        )}

      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-blue-50 font-sans" id="juwei-app-container">
      {/* Sidebar navigation */}
      <aside className="w-full md:w-64 bg-blue-950 text-white flex flex-col justify-between border-r border-blue-900" id="sidebar-nav">
        <div>
          {/* Logged in Operator badge */}
          <div className="p-4 bg-blue-900 border-b border-blue-800 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="bg-blue-950 border border-blue-800 p-1.5 rounded-lg text-blue-200 shrink-0">
                  <User className="h-4 w-4" />
                </div>
                <div className="text-left leading-tight">
                  <div className="font-bold text-white text-xs">
                    {currentUser}
                  </div>
                  <div className="text-[10px] font-mono text-blue-200 py-0.5">
                    ({currentEmployeeId})
                  </div>
                  <div className="text-[9px] text-blue-300 font-bold uppercase tracking-wider">{currentRole}</div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                title="Log Out / Switch Operator"
                className="p-1.5 text-blue-200 hover:text-white hover:bg-blue-800 border border-blue-800 rounded-lg transition"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
            
            {currentPermission === 'VIEW_ONLY' ? (
              <div className="bg-blue-950 border border-blue-800 text-blue-200 px-2.5 py-1 rounded text-[9px] font-bold flex items-center justify-center gap-1 font-mono uppercase" title="VIEW ONLY MODE: ACTIONS ARE RESTRICTED">
                <Lock className="h-3 w-3 text-blue-300 shrink-0" />
                <span>VIEW ONLY ACCESS</span>
              </div>
            ) : currentPermission === 'LIMITED_ACCESS' ? (
              <div className="bg-blue-950 border border-blue-800 text-blue-200 px-2.5 py-1 rounded text-[9px] font-bold flex items-center justify-center gap-1 font-mono uppercase" title="LIMITED ACCESS MODE: CREATE & EDIT PERMITTED">
                <Edit3 className="h-3 w-3 text-blue-300 shrink-0" />
                <span>LIMITED ACCESS (EDIT ALLOWED)</span>
              </div>
            ) : (
              <div className="bg-blue-950 border border-blue-800 text-blue-200 px-2.5 py-1 rounded text-[9px] font-bold flex items-center justify-center gap-1 font-mono uppercase" title="FULL ACCESS MODE: ALL ACTIONS ENABLED">
                <Unlock className="h-3 w-3 text-blue-300 shrink-0" />
                <span>FULL ACCESS</span>
              </div>
            )}
          </div>

          {/* Header Branding */}
          <div className="p-4 bg-blue-950 border-b border-blue-900 flex items-center justify-between">
            <div>
              <span className="text-white font-mono font-bold tracking-wider text-sm block">JUWEI WMS</span>
              <span className="text-[9px] text-blue-200 font-bold uppercase tracking-wider block">Juwei Plastic Moulding Phils. Inc.</span>
              <span className="text-[10px] font-mono font-bold text-blue-300 tracking-wider block mt-0.5">WMS v1.0</span>
            </div>
            <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" title="System Live" />
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5" id="nav-list">
            <button 
              onClick={() => setView('dashboard')}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 transition-colors ${
                view === 'dashboard' ? 'bg-blue-600 text-white shadow-md font-bold' : 'text-blue-100 hover:bg-blue-900 hover:text-white'
              }`}
            >
              <LayoutDashboard className="h-4 w-4" /> Dashboard Overview
            </button>

            <button 
              onClick={() => setView('receiving')}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 transition-colors ${
                view === 'receiving' ? 'bg-blue-600 text-white shadow-md font-bold' : 'text-blue-100 hover:bg-blue-900 hover:text-white'
              }`}
            >
              <ArrowLeftRight className="h-4 w-4" /> Receiving & Returns
            </button>

            <button 
              onClick={() => setView('stock')}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 transition-colors ${
                view === 'stock' ? 'bg-blue-600 text-white shadow-md font-bold' : 'text-blue-100 hover:bg-blue-900 hover:text-white'
              }`}
            >
              <PackageSearch className="h-4 w-4" /> Stock & FIFO Bins
            </button>

            <button 
              onClick={() => setView('recycling')}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 transition-colors ${
                view === 'recycling' ? 'bg-blue-600 text-white shadow-md font-bold' : 'text-blue-100 hover:bg-blue-900 hover:text-white'
              }`}
            >
              <RotateCcw className="h-4 w-4" /> Packaging Recycling
            </button>

            <button 
              onClick={() => setView('issuance')}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 transition-colors ${
                view === 'issuance' ? 'bg-blue-600 text-white shadow-md font-bold' : 'text-blue-100 hover:bg-blue-900 hover:text-white'
              }`}
            >
              <Briefcase className="h-4 w-4" /> Production Issuance
            </button>

            <button 
              onClick={() => setView('delivery')}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 transition-colors ${
                view === 'delivery' ? 'bg-blue-600 text-white shadow-md font-bold' : 'text-blue-100 hover:bg-blue-900 hover:text-white'
              }`}
            >
              <Truck className="h-4 w-4" /> Outbound & Gate Pass
            </button>

            <button 
              onClick={() => setView('environmental')}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 transition-colors ${
                view === 'environmental' ? 'bg-blue-600 text-white shadow-md font-bold' : 'text-blue-100 hover:bg-blue-900 hover:text-white'
              }`}
            >
              <Boxes className="h-4 w-4" /> Space Utilization
            </button>

            <button 
              onClick={() => setView('master-registry')}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 transition-colors ${
                view === 'master-registry' ? 'bg-blue-600 text-white shadow-md font-bold' : 'text-blue-100 hover:bg-blue-900 hover:text-white'
              }`}
              id="nav-master-registry"
            >
              <FolderPlus className="h-4 w-4" /> Master Data Register
            </button>

            <button 
              onClick={() => setView('accounts')}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 transition-colors ${
                view === 'accounts' ? 'bg-blue-600 text-white shadow-md font-bold' : 'text-blue-100 hover:bg-blue-900 hover:text-white'
              }`}
              id="nav-registered-accounts"
            >
              <Users className="h-4 w-4" /> JPMP Accounts
            </button>
          </nav>
        </div>

        {/* Sidebar Footer with system values */}
        <div className="p-4 border-t border-slate-800 space-y-4">
          <div className="space-y-1.5">
            {currentEmployeeId === 'JPMP-002' ? (
              <>
                <button 
                  onClick={handleExportBackup}
                  className="w-full bg-slate-800 hover:bg-slate-700 hover:text-white py-1.5 px-3 rounded text-[10px] font-bold flex items-center justify-center gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" /> Export DB Backup
                </button>
                
                <label className="w-full bg-slate-800 hover:bg-slate-700 hover:text-white py-1.5 px-3 rounded text-[10px] font-bold flex items-center justify-center gap-1.5 cursor-pointer">
                  <Upload className="h-3.5 w-3.5" /> Import DB Restore
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
                  className="w-full text-rose-400 hover:text-rose-300 py-1 text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer"
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
                  className="w-full text-rose-500 hover:text-rose-400 py-1 text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" /> Wipe operator accounts
                </button>
              </>
            ) : (
              <div className="text-center py-2 text-[9px] text-slate-500 italic uppercase font-mono">
                Operator Mode Active
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 sm:px-8 flex justify-between items-center shrink-0 shadow-xs">
          <div className="flex items-center gap-4">
            <h1 className="font-bold text-base sm:text-lg text-slate-800 tracking-tight">{getPageTitle()}</h1>
          </div>
          
          <div className="flex items-center gap-2.5 text-xs font-semibold">
            {/* Supabase PostgreSQL Cloud Sync Badge Button */}
            <button
              type="button"
              onClick={() => setShowSupabaseSettingsModal(true)}
              className="flex items-center gap-2 bg-slate-900 border border-slate-700 hover:border-emerald-500 text-slate-200 hover:text-white px-3 h-8 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer shrink-0"
              title="Configure Supabase PostgreSQL Database & Cloud Sync"
            >
              <Database className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="text-[11px] font-mono tracking-wider uppercase text-emerald-400">SUPABASE</span>
              <span className={`w-2 h-2 rounded-full ${supabaseStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : supabaseStatus === 'connecting' ? 'bg-amber-400 animate-bounce' : 'bg-slate-500'}`} />
            </button>

            {/* Live Date & Time Display */}
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-500 uppercase tracking-tight bg-slate-50 px-2.5 h-8 rounded-lg border border-slate-200/80 shrink-0">
              <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>
                {currentTime.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).toUpperCase()} • {currentTime.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          </div>
        </header>

        {/* VIEW ONLY MODE warning banner */}
        {currentPermission === 'VIEW_ONLY' && (
          <div className="bg-amber-500 text-white px-8 py-2 text-xs font-bold flex items-center justify-between gap-4 shadow-sm border-b border-amber-600 font-mono uppercase shrink-0">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              <span>[READ-ONLY PRIVILEGES ACTIVE]: OPERATOR IS RESTRICTED FROM CREATION, DELETION, OR MODIFICATION OF ANY DATA.</span>
            </div>
            <span className="bg-amber-600 text-amber-50 px-2 py-0.5 rounded text-[10px] tracking-wider shrink-0">VIEW ONLY</span>
          </div>
        )}

        {/* View screen renderer */}
        <div className="p-8 overflow-y-auto flex-1">
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

          {view === 'accounts' && (
            <RegisteredAccountsModule 
              accounts={registeredUsers}
              onAddAccount={handleRegister}
              onUpdateAccount={handleUpdateAccount}
              onRemoveAccount={handleRemoveUser}
              currentUser={currentUser}
              currentEmployeeId={currentEmployeeId}
              isSuperAdmin={currentPermission === 'FULL_ACCESS'}
            />
          )}
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

      {/* Global WMS Central Server & Real-time IP Config Modal */}
      {showServerSettingsModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 text-left relative">
            {/* Minimal Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                  <Wifi className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white tracking-wider font-mono uppercase">Multi-PC Real-Time Sync</h3>
                  <p className="text-[10px] text-slate-400 font-mono">Central Server Network Node</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setShowServerSettingsModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Connection Status Pill */}
            <div className={`px-3 py-2 rounded-xl border text-xs font-mono flex items-center justify-between ${
              connectionStatus === 'connected'
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400'
                : connectionStatus === 'connecting'
                ? 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                : 'bg-rose-950/40 border-rose-500/30 text-rose-400'
            }`}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' :
                  connectionStatus === 'connecting' ? 'bg-amber-400 animate-ping' : 'bg-rose-500'
                }`} />
                <span className="font-bold text-[11px] uppercase tracking-wider">
                  {connectionStatus === 'connected' ? 'Real-Time Connected' : connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono font-medium">Node Port 3000</span>
            </div>

            {/* Compact Quick Sync & QR Card */}
            {(() => {
              const activeHost = sanitizeServerHost(serverAddress) || getDefaultServerAddress();
              const shareUrl = isSecureServerHost(activeHost, serverAddress) ? `https://${activeHost}` : `http://${activeHost}`;
              return (
                <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex items-center gap-3">
                  <div className="bg-white p-1.5 rounded-lg shrink-0">
                    <QRCodeSVG value={shareUrl} size={72} level="M" />
                  </div>
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div>
                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider font-mono block">
                        Sync Workstations
                      </span>
                      <p className="text-[10px] text-slate-400 truncate font-mono">
                        Scan QR code or copy URL to pair
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(shareUrl);
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2500);
                      }}
                      className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-[11px] font-mono font-bold transition cursor-pointer ${
                        linkCopied
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/30'
                      }`}
                    >
                      {linkCopied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-white" />
                          <span>Copied to Clipboard!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-indigo-300" />
                          <span>Copy Connection Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Minimal Server Host Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider block">
                Server Address / Hostname
              </label>
              <input 
                id="wms-server-ip-input-global"
                type="text" 
                value={tempServerAddress} 
                onChange={(e) => setTempServerAddress(e.target.value)}
                placeholder="e.g. 192.168.1.100:3000"
                className="w-full bg-slate-950 border border-slate-800 text-sky-400 text-xs p-2.5 rounded-xl font-mono focus:border-indigo-500 focus:outline-none font-bold"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setTempServerAddress(getDefaultServerAddress())}
                  className="text-[9px] bg-slate-800/80 hover:bg-slate-800 text-slate-300 px-2 py-1 rounded-md font-mono font-bold transition cursor-pointer"
                >
                  Reset Default
                </button>
                {window.location.host && (
                  <button
                    type="button"
                    onClick={() => setTempServerAddress(window.location.host)}
                    className="text-[9px] bg-slate-800/80 hover:bg-slate-800 text-sky-300 px-2 py-1 rounded-md font-mono font-bold transition cursor-pointer"
                  >
                    Use Current Host
                  </button>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-1 flex gap-2">
              <button 
                type="button"
                onClick={() => {
                  const val = sanitizeServerHost(tempServerAddress) || getDefaultServerAddress();
                  setServerAddress(val);
                  localStorage.setItem('juwei_wms_server_address', val);
                  setTempServerAddress(val);
                  setShowServerSettingsModal(false);
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs font-mono transition uppercase cursor-pointer shadow-lg shadow-indigo-900/30"
              >
                Save & Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supabase PostgreSQL Database & Realtime Settings Modal */}
      <SupabaseSettingsModal
        isOpen={showSupabaseSettingsModal}
        onClose={() => setShowSupabaseSettingsModal(false)}
        connectionStatus={supabaseStatus}
        onForceSync={() => {
          const collections = ['stocks', 'receiving', 'returns', 'recycling', 'issuances', 'deliveries', 'envLogs', 'forkliftChecks', 'registries', 'registeredUsers'];
          collections.forEach(col => {
            const cached = localStorage.getItem(`juwei_wms_cache_${col}`);
            if (cached) {
              try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed)) {
                  syncCollectionToSupabase(col, parsed);
                }
              } catch (e) {}
            }
          });
        }}
      />
    </div>
  );
}

