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
  Check
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import AccountQRBadgeModal from './components/AccountQRBadgeModal';
import DesktopInstallModal from './components/DesktopInstallModal';
import { ConfirmModal, ConfirmActionConfig } from './components/ConfirmModal';
import BarcodeScannerModal from './components/BarcodeScannerModal';

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
  const cached = localStorage.getItem('juwei_wms_server_address');
  if (cached) {
    const clean = sanitizeServerHost(cached);
    if (clean) return clean;
  }
  if (window.location.host) {
    const cleanHost = sanitizeServerHost(window.location.host);
    if (cleanHost && (cleanHost.includes('.run.app') || cleanHost.includes('onrender.com') || cleanHost.includes('cloud') || cleanHost.includes('appspot') || cleanHost.includes('vercel.app'))) {
      return cleanHost;
    }
  }
  return DEFAULT_ONLINE_CLOUD_HOST;
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

    const applyStatePayload = (dataPayload: any, activeUsersList?: string[]) => {
      if (!dataPayload) return;
      const { stocks, receiving, returns, recycling, issuances, deliveries, envLogs, forkliftChecks, registries, registeredUsers: serverUsers, chatMessages: msgs } = dataPayload;
      if (Array.isArray(stocks)) setStocks(stocks);
      if (Array.isArray(receiving)) setReceiving(receiving);
      if (Array.isArray(returns)) setReturns(returns);
      if (Array.isArray(recycling)) setRecycling(recycling);
      if (Array.isArray(issuances)) setIssuances(issuances);
      if (Array.isArray(deliveries)) setDeliveries(deliveries);
      if (Array.isArray(envLogs)) setEnvLogs(envLogs);
      if (Array.isArray(forkliftChecks)) setForkliftChecks(forkliftChecks);
      if (Array.isArray(registries)) setRegistries(registries);
      
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
                // Upload merged accounts back to server so central database has all accounts
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

    const tryHttpFallback = async (httpUrl: string): Promise<boolean> => {
      try {
        const res = await fetch(httpUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (res.ok) {
          const json = await res.json();
          if (isMounted) {
            setConnectionStatus('connected');
            if (json.data) applyStatePayload(json.data, json.activeUsers);
          }
          return true;
        }
      } catch (e) {
        console.log("HTTP sync check failed for URL:", httpUrl, e);
      }
      return false;
    };

    const runSyncCheck = async (primaryHost: string, primaryHttpUrl: string): Promise<boolean> => {
      // 1. Try primary configured host first via HTTP REST
      const ok = await tryHttpFallback(primaryHttpUrl);
      if (ok) return true;

      // 2. Secondary check on local host if primary failed (without overwriting user's configured serverAddress)
      const currentHost = sanitizeServerHost(window.location.host);
      const fallbackHosts = [currentHost, 'localhost:3000', '127.0.0.1:3000'].filter(
        (h, index, self) => h && h !== primaryHost && self.indexOf(h) === index
      );

      for (const fallbackHost of fallbackHosts) {
        const fallbackProto = isSecureServerHost(fallbackHost) ? 'https:' : 'http:';
        const fallbackUrl = `${fallbackProto}//${fallbackHost}/api/sync`;
        const fallbackOk = await tryHttpFallback(fallbackUrl);
        if (fallbackOk) {
          console.log("Synced successfully via local fallback host:", fallbackHost);
          return true;
        }
      }

      if (isMounted) {
        setConnectionStatus('disconnected');
      }
      return false;
    };

    const connect = async () => {
      if (!isMounted) return;
      setConnectionStatus('connecting');

      let targetAddr = serverAddress.trim();
      const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
      const isHttps = isSecureServerHost(cleanHost, targetAddr);
      const wsProto = isHttps ? 'wss:' : 'ws:';
      const httpProto = isHttps ? 'https:' : 'http:';
      
      const socketUrl = `${wsProto}//${cleanHost}/ws`;
      const httpUrl = `${httpProto}//${cleanHost}/api/sync`;

      console.log("Connecting WebSocket to real-time server:", socketUrl);
      let fallbackTriggered = false;
      let pingInterval: any = null;
      
      try {
        ws = new WebSocket(socketUrl);
      } catch (err) {
        console.warn("WebSocket init error, attempting HTTP fallback:", err);
        await runSyncCheck(cleanHost, httpUrl);
        reconnectTimeout = setTimeout(connect, 3000);
        return;
      }

      ws.onopen = () => {
        if (!isMounted) return;
        console.log('Connected via WebSocket to real-time server:', cleanHost);
        setConnectionStatus('connected');
        setSocket(ws);
        ws?.send(JSON.stringify({
          type: 'join',
          username: currentUser || 'JUWEI OPERATOR'
        }));

        // Send heartbeat ping every 15 seconds to keep WSS connection alive
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'pong') return; // Heartbeat response

          switch (payload.type) {
            case 'init': {
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

      ws.onerror = async () => {
        if (!isMounted) return;
        console.log('WebSocket connection error, testing HTTP REST sync...');
        if (!fallbackTriggered) {
          fallbackTriggered = true;
          await runSyncCheck(cleanHost, httpUrl);
        }
      };

      ws.onclose = async () => {
        if (!isMounted) return;
        if (pingInterval) clearInterval(pingInterval);
        console.log('WebSocket closed. Attempting HTTP sync & reconnection...');
        setSocket(null);
        if (!fallbackTriggered) {
          fallbackTriggered = true;
          await runSyncCheck(cleanHost, httpUrl);
        }
        reconnectTimeout = setTimeout(connect, 3000);
      };
    };

    connect();

    // Secondary HTTP poll every 4 seconds as continuous safety net
    httpPollInterval = setInterval(async () => {
      let targetAddr = serverAddress.trim() || getDefaultServerAddress();
      const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
      const isHttps = isSecureServerHost(cleanHost, targetAddr);
      const httpProto = isHttps ? 'https:' : 'http:';
      const httpUrl = `${httpProto}//${cleanHost}/api/sync`;
      
      try {
        const res = await fetch(httpUrl);
        if (res.ok) {
          const json = await res.json();
          if (isMounted) {
            setConnectionStatus('connected');
            if (json.data) applyStatePayload(json.data, json.activeUsers);
          }
        }
      } catch (err) {
        // Try local host as secondary poll if target host is unreachable
        const currentHost = sanitizeServerHost(window.location.host);
        if (currentHost && currentHost !== cleanHost) {
          try {
            const localProto = isSecureServerHost(currentHost) ? 'https:' : 'http:';
            const localRes = await fetch(`${localProto}//${currentHost}/api/sync`);
            if (localRes.ok) {
              const localJson = await localRes.json();
              if (isMounted) {
                setConnectionStatus('connected');
                if (localJson.data) applyStatePayload(localJson.data, localJson.activeUsers);
              }
            }
          } catch (e) {
            // Ignore
          }
        }
      }
    }, 4000);

    return () => {
      isMounted = false;
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (httpPollInterval) clearInterval(httpPollInterval);
    };
  }, [currentUser, isLoggedIn, serverAddress]);

  // Sync state helpers (supports both WebSocket and HTTP POST REST dual broadcast)
  const syncCollection = (collection: string, data: any[]) => {
    // 1. Send via WebSocket if active
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
    
    // 2. Dual-send via HTTP POST REST to guarantee server disk persistence & update
    let targetAddr = serverAddress.trim() || getDefaultServerAddress();
    const cleanHost = sanitizeServerHost(targetAddr) || DEFAULT_ONLINE_CLOUD_HOST;
    const isHttps = isSecureServerHost(cleanHost, targetAddr);
    const httpProto = isHttps ? 'https:' : 'http:';
    
    fetch(`${httpProto}//${cleanHost}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection, data })
    }).catch(err => console.warn('HTTP REST sync warning:', err));
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
      socket!.send(JSON.stringify({
        type: 'system_activity',
        text
      }));
    }
  };

  const sendChatMessage = (text: string) => {
    if (wsOpen(socket)) {
      socket!.send(JSON.stringify({
        type: 'chat',
        username: currentUser,
        text
      }));
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
          
          {/* Central Server Connection Status & Config Bar */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2 font-mono text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              {connectionStatus === 'connected' ? (
                <>
                  <Wifi className="h-4 w-4 text-emerald-400 shrink-0 animate-pulse" />
                  <div className="truncate">
                    <span className="text-[10px] text-emerald-400 font-bold block uppercase tracking-wider">REAL-TIME CONNECTED</span>
                    <span className="text-[9px] text-slate-400 block truncate font-mono">{serverAddress}</span>
                  </div>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <Loader2 className="h-4 w-4 text-amber-400 animate-spin shrink-0" />
                  <div className="truncate">
                    <span className="text-[10px] text-amber-300 font-bold block uppercase tracking-wider">CONNECTING TO SERVER...</span>
                    <span className="text-[9px] text-slate-400 block truncate font-mono">{serverAddress}</span>
                  </div>
                </>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 text-rose-400 shrink-0" />
                  <div className="truncate">
                    <span className="text-[10px] text-rose-300 font-bold block uppercase tracking-wider">DISCONNECTED</span>
                    <span className="text-[9px] text-slate-400 block truncate font-mono">{serverAddress}</span>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setTempServerAddress(serverAddress);
                setShowServerSettingsModal(true);
              }}
              className="bg-indigo-600/30 hover:bg-indigo-600/60 text-indigo-200 border border-indigo-500/40 px-3 py-1.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1.5 shrink-0 uppercase cursor-pointer font-mono shadow-xs"
              id="btn-login-server-config"
            >
              <Wifi className="h-3.5 w-3.5 text-indigo-400" /> SERVER IP / URL
            </button>
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
          
          <div className="flex items-center gap-3 text-xs font-semibold">
            {/* Real-time Connection status indicator with live Date & Time */}
            <button
              type="button"
              onClick={() => {
                setTempServerAddress(sanitizeServerHost(serverAddress) || getDefaultServerAddress());
                setShowServerSettingsModal(true);
              }}
              title="Click to configure WMS Central Server IP / Connection settings"
              className="cursor-pointer hover:opacity-90 transition flex flex-col items-end gap-1"
              id="btn-server-settings-trigger"
            >
              {connectionStatus === 'connected' ? (
                <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-bold shadow-xs">
                  <Wifi className="h-3.5 w-3.5 text-emerald-600 animate-pulse shrink-0" />
                  <span>REAL-TIME CONNECTED</span>
                </div>
              ) : connectionStatus === 'connecting' ? (
                <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-lg text-xs font-bold shadow-xs">
                  <Loader2 className="h-3.5 w-3.5 text-amber-600 animate-spin shrink-0" />
                  <span>CONNECTING TO SERVER...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 text-rose-700 px-3 py-1.5 rounded-lg text-xs font-bold shadow-xs">
                  <WifiOff className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                  <span>DISCONNECTED • SET SERVER IP</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-500 uppercase tracking-tight pr-0.5">
                <Clock className="h-3 w-3 text-slate-400" />
                <span>
                  {currentTime.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).toUpperCase()} • {currentTime.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            </button>
          </div>
        </header>

        {/* WMS CENTRAL SERVER SETTINGS MODAL */}
        {showServerSettingsModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 uppercase">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 text-left relative max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Wifi className="h-5 w-5 text-indigo-400" />
                  <h3 className="text-sm font-bold text-white tracking-tight font-mono">WMS CENTRAL SERVER & MULTI-PC SYNC</h3>
                </div>
                <button 
                  type="button"
                  onClick={() => setShowServerSettingsModal(false)}
                  className="text-slate-400 hover:text-white text-xs font-bold font-mono px-2 py-1 rounded cursor-pointer"
                >
                  ✕ CLOSE
                </button>
              </div>

              {/* Instant Share Link Banner */}
              <div className="bg-gradient-to-r from-indigo-950/90 to-purple-950/90 border border-indigo-500/40 rounded-xl p-3.5 space-y-2 normal-case">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-indigo-200 uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                    1-CLICK LINK FOR OTHER PCs:
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 font-medium">
                  Click below to copy your app link. Send or paste this link on any second PC, laptop, or phone to sync live with this database!
                </p>
                <div className="flex flex-col sm:flex-row gap-2 pt-1 items-center">
                  <button
                    type="button"
                    onClick={() => {
                      const shareUrl = window.location.href;
                      navigator.clipboard.writeText(shareUrl);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 3000);
                    }}
                    className={`flex-1 w-full flex items-center justify-center gap-2 font-bold py-2.5 px-4 rounded-xl text-xs font-mono transition cursor-pointer ${
                      linkCopied 
                        ? 'bg-emerald-600 text-white' 
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40'
                    }`}
                  >
                    {linkCopied ? (
                      <>
                        <Check className="h-4 w-4 text-white" />
                        <span>✅ LINK COPIED TO CLIPBOARD!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 text-indigo-200" />
                        <span>📋 COPY CONNECTION LINK FOR OTHER PCs</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* QR Code & Mobile Scanner Section */}
              <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-950 border border-slate-800 p-3.5 rounded-xl normal-case">
                <div className="bg-white p-2 rounded-lg shrink-0 shadow-md">
                  <QRCodeSVG value={window.location.href} size={110} level="M" />
                </div>
                <div className="space-y-1 text-left flex-1">
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider font-mono block">
                    📱 SCAN QR CODE WITH OTHER DEVICE:
                  </span>
                  <p className="text-[11px] text-slate-300 font-medium">
                    Scan with a tablet, phone, or handheld scanner camera to open and connect instantly.
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono select-all break-all pt-1">
                    {window.location.href}
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <label className="text-[10px] font-bold text-slate-300 font-mono block">
                  MANUAL CENTRAL SERVER IP / HOSTNAME:
                </label>
                <input 
                  id="wms-server-ip-input"
                  type="text" 
                  value={tempServerAddress} 
                  onChange={(e) => setTempServerAddress(e.target.value)}
                  placeholder="e.g. localhost:3000 or 192.168.1.100:3000"
                  style={{ color: '#ffffff' }}
                  className="w-full bg-slate-950 border border-slate-800 text-white !text-white text-xs p-3 rounded-xl font-mono focus:border-indigo-500 focus:outline-none font-bold"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button 
                  type="button"
                  onClick={() => {
                    const val = tempServerAddress.trim() || 'localhost:3000';
                    setServerAddress(val);
                    localStorage.setItem('juwei_wms_server_address', val);
                    setShowServerSettingsModal(false);
                  }}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs font-mono transition uppercase cursor-pointer"
                >
                  SAVE & CONNECT
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    const defaultAddr = window.location.host || 'localhost:3000';
                    setServerAddress(defaultAddr);
                    localStorage.setItem('juwei_wms_server_address', defaultAddr);
                    setTempServerAddress(defaultAddr);
                    setShowServerSettingsModal(false);
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs font-mono transition uppercase cursor-pointer"
                >
                  RESET DEFAULT
                </button>
              </div>
            </div>
          </div>
        )}

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
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 uppercase">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 text-left relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Wifi className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white tracking-tight font-mono">WMS CENTRAL SERVER & MULTI-PC SYNC</h3>
              </div>
              <button 
                type="button"
                onClick={() => setShowServerSettingsModal(false)}
                className="text-slate-400 hover:text-white text-xs font-bold font-mono px-2 py-1 rounded cursor-pointer"
              >
                ✕ CLOSE
              </button>
            </div>

            {/* Connection Status Banner in Modal */}
            <div className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between ${
              connectionStatus === 'connected'
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                : connectionStatus === 'connecting'
                ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
            }`}>
              <div className="flex items-center gap-2">
                {connectionStatus === 'connected' ? (
                  <Wifi className="h-4 w-4 text-emerald-400 animate-pulse" />
                ) : connectionStatus === 'connecting' ? (
                  <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
                ) : (
                  <WifiOff className="h-4 w-4 text-rose-400" />
                )}
                <div>
                  <span className="font-bold block uppercase">
                    STATUS: {connectionStatus.toUpperCase()}
                  </span>
                  <span className="text-[10px] opacity-80 block font-mono break-all">
                    ACTIVE ADDR: {isSecureServerHost(sanitizeServerHost(serverAddress), serverAddress) ? 'HTTPS://' : 'HTTP://'}{sanitizeServerHost(serverAddress) || DEFAULT_ONLINE_CLOUD_HOST}
                  </span>
                </div>
              </div>
            </div>

            {/* Instant Share Link Banner */}
            <div className="bg-gradient-to-r from-indigo-950/90 to-purple-950/90 border border-indigo-500/40 rounded-xl p-3.5 space-y-2 normal-case">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-indigo-200 uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  1-CLICK LINK FOR OTHER PCs / WORKSTATIONS:
                </span>
              </div>
              <p className="text-[11px] text-slate-300 font-medium">
                Click below to copy your app link. Paste this URL on any second PC, laptop, or handheld scanner to sync in real-time!
              </p>
              <div className="flex flex-col sm:flex-row gap-2 pt-1 items-center">
                <button
                  type="button"
                  onClick={() => {
                    const activeHost = sanitizeServerHost(serverAddress) || DEFAULT_ONLINE_CLOUD_HOST;
                    const shareUrl = isSecureServerHost(activeHost, serverAddress) ? `https://${activeHost}` : `http://${activeHost}`;
                    navigator.clipboard.writeText(shareUrl);
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 3000);
                  }}
                  className={`flex-1 w-full flex items-center justify-center gap-2 font-bold py-2.5 px-4 rounded-xl text-xs font-mono transition cursor-pointer ${
                    linkCopied 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40'
                  }`}
                >
                  {linkCopied ? (
                    <>
                      <Check className="h-4 w-4 text-white" />
                      <span>✅ LINK COPIED TO CLIPBOARD!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 text-indigo-200" />
                      <span>📋 COPY CONNECTION LINK FOR OTHER PCs</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* QR Code & Mobile Scanner Section */}
            {(() => {
              const activeHost = sanitizeServerHost(serverAddress) || DEFAULT_ONLINE_CLOUD_HOST;
              const shareUrl = isSecureServerHost(activeHost, serverAddress) ? `https://${activeHost}` : `http://${activeHost}`;
              return (
                <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-950 border border-slate-800 p-3.5 rounded-xl normal-case">
                  <div className="bg-white p-2 rounded-lg shrink-0 shadow-md">
                    <QRCodeSVG value={shareUrl} size={110} level="M" />
                  </div>
                  <div className="space-y-1 text-left flex-1">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider font-mono block">
                      📱 SCAN QR CODE WITH TABLET OR SCANNER:
                    </span>
                    <p className="text-[11px] text-slate-300 font-medium">
                      Scan with mobile device or handheld barcode scanner camera to open and connect instantly.
                    </p>
                    <p className="text-[10px] text-slate-400 font-mono select-all break-all pt-1">
                      {shareUrl}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Manual Server IP Input & Quick Presets */}
            <div className="space-y-2 pt-1">
              <label className="text-[10px] font-bold text-slate-300 font-mono block">
                CENTRAL SERVER IP / HOSTNAME / WEB URL:
              </label>
              <input 
                id="wms-server-ip-input-global"
                type="text" 
                value={tempServerAddress} 
                onChange={(e) => setTempServerAddress(e.target.value)}
                placeholder="e.g. ais-dev-vmhtsbs5lyqg4e3o5qf35l-327128958892.asia-southeast1.run.app or 192.168.1.100:3000"
                style={{ color: '#38bdf8' }}
                className="w-full bg-slate-950 border border-slate-800 text-sky-400 !text-sky-400 text-xs p-3 rounded-xl font-mono focus:border-indigo-500 focus:outline-none font-bold wms-server-ip-bar"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setTempServerAddress(DEFAULT_ONLINE_CLOUD_HOST)}
                  className="text-[10px] bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-500/40 px-2.5 py-1 rounded-lg font-mono font-bold transition cursor-pointer"
                >
                  🌐 Online Cloud Server ({DEFAULT_ONLINE_CLOUD_HOST})
                </button>
                {window.location.host && window.location.host !== DEFAULT_ONLINE_CLOUD_HOST && (
                  <button
                    type="button"
                    onClick={() => setTempServerAddress(window.location.host)}
                    className="text-[10px] bg-slate-800 hover:bg-slate-700 text-sky-300 px-2.5 py-1 rounded-lg font-mono font-bold transition cursor-pointer"
                  >
                    ⚡ Current App Host ({window.location.host})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTempServerAddress('localhost:3000')}
                  className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-400 px-2.5 py-1 rounded-lg font-mono font-bold transition cursor-pointer"
                >
                  💻 Localhost (localhost:3000)
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button 
                type="button"
                onClick={() => {
                  const val = sanitizeServerHost(tempServerAddress) || getDefaultServerAddress();
                  setServerAddress(val);
                  localStorage.setItem('juwei_wms_server_address', val);
                  setTempServerAddress(val);
                  setShowServerSettingsModal(false);
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs font-mono transition uppercase cursor-pointer"
              >
                SAVE & CONNECT NOW
              </button>
              <button 
                type="button"
                onClick={() => {
                  const defaultAddr = getDefaultServerAddress();
                  setServerAddress(defaultAddr);
                  localStorage.setItem('juwei_wms_server_address', defaultAddr);
                  setTempServerAddress(defaultAddr);
                  setShowServerSettingsModal(false);
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs font-mono transition uppercase cursor-pointer"
              >
                RESET DEFAULT CLOUD SERVER
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

