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
  Activity,
  AlertTriangle,
  Ban,
  FileClock,
  Settings
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import { SyncStatus } from './components/SyncStatus';
import { LanguageProvider, LanguageSwitch, useI18n } from './i18n';
import { verifyCentralCredentials, updateCentralPin } from './lib/centralApi';
import { getApiBaseUrl, getStoredSessionToken } from './config/serverConfig';
import { RegisteredAccount } from './types';
import logger from './lib/logger';
import {
  useSync,
  wsOpen,
  getPersistentDeviceId,
  getPlatformType,
  getStationId
} from './hooks/useSync';
import { DashboardFeature, computeStockAlerts } from './features/dashboard';
import { useReceivingActions, ReceivingFeature, RecyclingFeature } from './features/receiving';
import {
  useStockActions,
  StockFeature,
  StockMovementsFeature,
  ProductsFeature,
  InventoryMatrixFeature
} from './features/stock';
import { useIssuanceActions, IssuanceFeature } from './features/issuance';
import { useDeliveryActions, DeliveryFeature, EnvironmentalFeature } from './features/delivery';
import {
  useAccountActions,
  canAccessAdminModules,
  AccountsFeature,
  AuditFeature
} from './features/accounts';
import { useMasterDataActions, MasterDataFeature } from './features/master-data';
import { ServerBackupsModal } from './components/ServerBackupsModal';
import { ConfirmModal, ConfirmActionConfig } from './components/ConfirmModal';
import DesktopInstallModal from './components/DesktopInstallModal';
import CentralDatabaseModal from './components/CentralDatabaseModal';
import StartupDiagnosticsModal from './components/StartupDiagnosticsModal';
import ActiveUsersModal from './components/ActiveUsersModal';
import SettingsView from './components/SettingsView';
import {
  AccountQRBadgeModal,
  BarcodeScannerModal,
  QuickLookupModals,
  showPrintToast
} from './features/printing';

// Isolated real-time clock component to prevent full application re-render cycles every second
function LiveClock() {
  const { dateLocale } = useI18n();
  const [time, setTime] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hidden lg:inline-flex items-center gap-1.5 text-[11px] font-mono font-medium text-slate-600 bg-slate-100/80 px-2.5 h-8 rounded-lg border border-slate-200 shrink-0">
      <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      <span>
        {time.toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: '2-digit' })} • {time.toLocaleTimeString(dateLocale, { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  );
}

export default function App() {
  const [langUserKey, setLangUserKey] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('juwei_wms_isLoggedIn');
      const user = localStorage.getItem('juwei_wms_currentUser');
      const empId = localStorage.getItem('juwei_wms_employeeId');
      return stored === 'true' && Boolean(user) ? (empId || user || 'GUEST') : 'GUEST';
    } catch {
      return 'GUEST';
    }
  });

  return (
    <LanguageProvider userKey={langUserKey}>
      <AppWorkspace onAuthUserChange={setLangUserKey} />
    </LanguageProvider>
  );
}

function AppWorkspace({ onAuthUserChange }: { onAuthUserChange: (userKey: string) => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<string>('dashboard');
  const [showDesktopInstallModal, setShowDesktopInstallModal] = useState<boolean>(false);

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

  useEffect(() => {
    onAuthUserChange(isLoggedIn ? (currentEmployeeId || currentUser || 'GUEST') : 'GUEST');
  }, [isLoggedIn, currentEmployeeId, currentUser, onAuthUserChange]);

  // Global Modal states
  const [showCentralDatabaseModal, setShowCentralDatabaseModal] = useState<boolean>(false);
  const [showBackupsModal, setShowBackupsModal] = useState<boolean>(false);
  const [showStartupDiagnosticsModal, setShowStartupDiagnosticsModal] = useState<boolean>(false);
  const [showActiveUsersModal, setShowActiveUsersModal] = useState<boolean>(false);
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState<boolean>(false);
  const [openDashboardAlertsSignal, setOpenDashboardAlertsSignal] = useState<number>(0);

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

  const onLogoutRef = useRef<() => void>(() => {});

  const sync = useSync({
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
  });

  const {
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
    registeredUsers,
    setRegisteredUsers,
    operationalRoles,
    receivingCategories,
    fifoColorsByMonth,
    chatMessages,
    socket,
    syncChannelRef,
    clientSessionId,
    clientConnectionId,
    isDeviceRevoked,
    isDeviceRevokedRef,
    syncConflicts,
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
    appVersion,
    markRecordMutatedLocally,
    markUserAsDeleted,
    unmarkUserAsDeleted,
    upsertUserInState,
    syncCollection,
    upsertRecordLocallyAndRemotely,
    deleteRecordLocallyAndRemotely,
    handleManualSync,
    resetStateToDefaults,
    resetAccountsToDefaults,
    handleDeviceRevoked,
    sendSystemActivity,
    sendChatMessage,
    handleResolveConflictKeepMine,
    handleResolveConflictAcceptServer,
    handleUpdateOperationalRoles,
    handleUpdateReceivingCategories,
    handleUpdateFifoColors
  } = sync;

  const dashboardAlertCount = useMemo(
    () => computeStockAlerts(stocks, undefined, registries).totalCount,
    [stocks, registries]
  );

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
        Accept: 'application/json',
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

  // Domain action hooks
  const receivingActions = useReceivingActions({
    receiving,
    setReceiving,
    returns,
    setReturns,
    recycling,
    setRecycling,
    stocks,
    setStocks,
    fifoColorsByMonth,
    currentUser,
    currentPermission,
    upsertRecordLocallyAndRemotely,
    deleteRecordLocallyAndRemotely,
    sendSystemActivity
  });

  const stockActions = useStockActions({
    stocks,
    setStocks,
    currentUser,
    currentPermission,
    upsertRecordLocallyAndRemotely,
    deleteRecordLocallyAndRemotely,
    sendSystemActivity
  });

  const issuanceActions = useIssuanceActions({
    issuances,
    setIssuances,
    stocks,
    setStocks,
    currentUser,
    currentPermission,
    upsertRecordLocallyAndRemotely,
    deleteRecordLocallyAndRemotely,
    sendSystemActivity
  });

  const deliveryActions = useDeliveryActions({
    deliveries,
    setDeliveries,
    stocks,
    setStocks,
    envLogs,
    setEnvLogs,
    forkliftChecks,
    setForkliftChecks,
    currentUser,
    currentRole,
    currentPermission,
    upsertRecordLocallyAndRemotely,
    deleteRecordLocallyAndRemotely,
    syncCollection,
    sendSystemActivity
  });

  const masterDataActions = useMasterDataActions({
    registries,
    setRegistries,
    upsertRecordLocallyAndRemotely,
    deleteRecordLocallyAndRemotely,
    syncCollection
  });

  const accountActions = useAccountActions({
    registeredUsers,
    setRegisteredUsers,
    currentUser,
    currentRole,
    currentEmployeeId,
    socket,
    syncChannelRef,
    markRecordMutatedLocally,
    markUserAsDeleted,
    unmarkUserAsDeleted,
    handleDeviceRevoked,
    syncCollection,
    setNewlyRegisteredUser
  });

  const handleExportCurrentData = () => {
    try {
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser || 'OPERATOR',
        employeeId: currentEmployeeId || 'JPMP-002',
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
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `juwei-wms-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showPrintToast(t('sidebar.exportBackupSuccess'), 'info');
    } catch (err: any) {
      showPrintToast(t('sidebar.exportBackupError', { error: err?.message || t('common.unknownError') }), 'error');
    }
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result || '{}'));
        const payload = raw?.state && typeof raw.state === 'object' ? raw.state : raw;
        let restoredCount = 0;

        if (Array.isArray(payload.stocks)) { setStocks(payload.stocks); syncCollection('stocks', payload.stocks); restoredCount++; }
        if (Array.isArray(payload.receiving)) { setReceiving(payload.receiving); syncCollection('receiving', payload.receiving); restoredCount++; }
        if (Array.isArray(payload.returns)) { setReturns(payload.returns); syncCollection('returns', payload.returns); restoredCount++; }
        if (Array.isArray(payload.recycling)) { setRecycling(payload.recycling); syncCollection('recycling', payload.recycling); restoredCount++; }
        if (Array.isArray(payload.issuances)) { setIssuances(payload.issuances); syncCollection('issuances', payload.issuances); restoredCount++; }
        if (Array.isArray(payload.deliveries)) { setDeliveries(payload.deliveries); syncCollection('deliveries', payload.deliveries); restoredCount++; }
        if (Array.isArray(payload.envLogs)) { setEnvLogs(payload.envLogs); syncCollection('envLogs', payload.envLogs); restoredCount++; }
        if (Array.isArray(payload.forkliftChecks)) { setForkliftChecks(payload.forkliftChecks); syncCollection('forkliftChecks', payload.forkliftChecks); restoredCount++; }
        if (Array.isArray(payload.registries)) { setRegistries(payload.registries); syncCollection('registries', payload.registries); restoredCount++; }

        if (restoredCount > 0) {
          showPrintToast(t('sidebar.restoreSuccess', { count: restoredCount }), 'info');
        } else {
          showPrintToast(t('sidebar.restoreEmpty'), 'warning');
        }
      } catch {
        showPrintToast(t('sidebar.restoreInvalid'), 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const backupActions = { handleExportCurrentData, handleImportBackup };

  // Auth & Login handlers
  const handleLogin = (user: { username: string; role: string; employeeId: string; permission?: string; status?: string; lastActive?: string }) => {
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

    try {
      localStorage.setItem('juwei_wms_isLoggedIn', 'true');
      localStorage.setItem('juwei_wms_currentUser', cleanUsername);
      localStorage.setItem('juwei_wms_userRole', cleanRole);
      localStorage.setItem('juwei_wms_employeeId', cleanEmployeeId);
      localStorage.setItem('juwei_wms_userPermission', cleanPermission);
    } catch (e) {
      console.warn('Failed to persist user session to localStorage:', e);
    }

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

  onLogoutRef.current = handleLogout;

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
      setFirstLoginPinError(t('auth.pin4Digits'));
      return;
    }
    if (cleanNew !== cleanConfirm) {
      setFirstLoginPinError(t('auth.pinMismatch'));
      return;
    }
    if (cleanNew === pendingFirstLoginPinChange.currentPin) {
      setFirstLoginPinError(t('auth.pinSameAsOld'));
      return;
    }
    if (cleanNew === '1234' || /^(\d)\1+$/.test(cleanNew)) {
      setFirstLoginPinError(t('auth.pinWeakRejected'));
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
        setFirstLoginPinError(res.error || t('auth.pinUpdateFailed'));
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
      setFirstLoginPinError(err?.message || t('auth.pinNetworkError'));
      setIsSavingFirstLoginPin(false);
    }
  };

  const handleDirectLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (isDeviceRevokedRef.current) {
      setLoginError(t('auth.deviceRevoked'));
      return;
    }

    const rawInput = (loginEmployeeId || '').trim();
    const enteredPin = (loginPin || '').trim();
    if (!rawInput || !enteredPin) {
      setLoginError(t('auth.missingCredsError'));
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
        setLoginError(t('auth.deviceRevoked'));
        return;
      }
      console.warn('Authoritative login verification error:', authErr);
    }

    setIsLoggingIn(false);
    setLoginError(t('auth.invalidCredsError'));
  };

  const handleQrLoginScan = async (scannedText: string) => {
    if (isDeviceRevokedRef.current) {
      setLoginError(t('auth.deviceRevoked'));
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
      setLoginError(t('auth.invalidQrNoId'));
      return;
    }

    if (!searchPin) {
      setLoginError(t('auth.invalidQrMissingPin', { id: searchEmpId }));
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
        setLoginError(t('auth.deviceRevoked'));
        return;
      }
    }
    setIsLoggingIn(false);
    setLoginError(t('auth.incorrectQrPin', { id: searchEmpId }));
  };

  const getPageTitle = () => {
    switch (view) {
      case 'dashboard': return t('pageTitles.dashboard');
      case 'receiving': return t('pageTitles.receiving');
      case 'stock': return t('pageTitles.stock');
      case 'stock-movements': return t('pageTitles.stockMovements');
      case 'products': return t('pageTitles.products');
      case 'inventory-matrix': return t('pageTitles.inventoryMatrix');
      case 'recycling': return t('pageTitles.recycling');
      case 'issuance': return t('pageTitles.issuance');
      case 'delivery': return t('pageTitles.delivery');
      case 'environmental': return t('pageTitles.environmental');
      case 'master-registry': return t('pageTitles.masterRegistry');
      case 'accounts': return t('pageTitles.accounts');
      case 'audit': return t('pageTitles.audit');
      case 'settings': return t('pageTitles.settings');
      default: return t('pageTitles.default');
    }
  };

  const isAdminSession = canAccessAdminModules(currentPermission, currentEmployeeId, currentUser, currentRole);
  const isSuperAdminFlag = currentPermission === 'FULL_ACCESS' || currentEmployeeId === 'JPMP-002';
  const canEditFlag = currentPermission === 'FULL_ACCESS' || currentPermission === 'LIMITED_ACCESS';

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex flex-col justify-center bg-slate-950 font-sans relative overflow-hidden" id="juwei-auth-container">
        <div className="glass-ambient-orb-1" />
        <div className="glass-ambient-orb-2" />
        <div className="glass-ambient-orb-3" />

        <div className="w-full flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
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
                    {t('auth.regSuccessBadge')}
                  </span>
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight mt-1">
                    {t('auth.regSuccessTitle')}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Juwei Plastic Moulding Phils. Inc.
                  </p>
                </div>

                <div className="bg-slate-50/80 backdrop-blur-md p-4 rounded-2xl border border-slate-200/80 text-left space-y-2 text-xs">
                  <div className="flex justify-between items-center border-b border-slate-200/80 pb-1.5">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase">{t('auth.regOperator')}</span>
                    <span className="font-semibold text-slate-900">{newlyRegisteredUser.username}</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-slate-200/80 pb-1.5">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase">{t('auth.regEmpId')}</span>
                    <span className="font-semibold text-indigo-600 font-mono">{newlyRegisteredUser.employeeId}</span>
                  </div>
                  {newlyRegisteredUser.phoneNumber && (
                    <div className="flex justify-between items-center border-b border-slate-200/80 pb-1.5">
                      <span className="text-[10px] text-slate-500 font-semibold uppercase">{t('auth.regPhone')}</span>
                      <span className="font-semibold text-emerald-600 font-mono flex items-center gap-1">
                        <Phone className="h-3 w-3 text-emerald-500" />
                        {newlyRegisteredUser.phoneNumber}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase">{t('auth.regRole')}</span>
                    <span className="font-semibold text-slate-800">{newlyRegisteredUser.role}</span>
                  </div>
                </div>

                <div className="bg-indigo-50/70 backdrop-blur-md p-5 rounded-2xl border border-indigo-100/80 relative space-y-3">
                  <div className="text-[10px] text-indigo-700 font-mono font-semibold uppercase tracking-wider">
                    {t('auth.regPinQrTitle')}
                  </div>

                  <div className="flex items-center justify-center gap-2">
                    <div className="text-2xl font-mono font-bold text-emerald-700 tracking-[0.25em] pl-[0.25em] text-center select-all">
                      {showNewlyRegisteredPin ? newlyRegisteredUser.pin : '••••'}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowNewlyRegisteredPin(!showNewlyRegisteredPin)}
                      className="text-slate-500 hover:text-emerald-700 p-1.5 rounded-lg transition cursor-pointer"
                      title={showNewlyRegisteredPin ? t('auth.hidePin') : t('auth.revealPin')}
                    >
                      {showNewlyRegisteredPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

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
                    {t('auth.scanQrHint')}
                  </div>

                  <button
                    type="button"
                    onClick={() => setQrBadgeAccount(newlyRegisteredUser)}
                    className="w-full bg-white hover:bg-slate-50 text-indigo-700 border border-indigo-200 py-2 px-3 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Printer className="h-3.5 w-3.5 text-indigo-600" /> {t('auth.printQrBtn')}
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
                  <Fingerprint className="h-4 w-4" /> {t('auth.proceedLoginBtn')}
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
                <span>{t('auth.deviceRevoked')}</span>
              </div>
            )}
            {oneTimeSetupPinNotice && (
              <div className="bg-amber-950/85 border border-amber-500/60 text-amber-100 px-3.5 py-3 rounded-xl text-xs space-y-1.5" id="one-time-initial-pin-banner">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold uppercase text-amber-300 text-[10px] tracking-wider">
                    {t('auth.freshInstallTitle')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginEmployeeId(oneTimeSetupPinNotice.employeeId);
                      setLoginPin(oneTimeSetupPinNotice.initialPin);
                    }}
                    className="text-[10px] font-mono font-bold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 px-2 py-0.5 rounded cursor-pointer"
                  >
                    {t('auth.usePinBtn')}
                  </button>
                </div>
                <div className="flex items-center justify-between font-mono">
                  <span className="text-[11px] text-amber-200">ID: <strong>{oneTimeSetupPinNotice.employeeId}</strong></span>
                  <span className="text-base font-extrabold tracking-[0.25em] text-white bg-amber-900/80 border border-amber-500/40 px-2.5 py-0.5 rounded select-all">
                    {oneTimeSetupPinNotice.initialPin}
                  </span>
                </div>
                <p className="text-[10px] text-amber-200/90">
                  {t('auth.freshInstallNote')}
                </p>
              </div>
            )}

            <div className="flex justify-between items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[11px] text-slate-400 font-mono font-medium">{t('auth.systemReady')}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <LanguageSwitch compact dark />

                <button
                  type="button"
                  onClick={() => setShowStartupDiagnosticsModal(true)}
                  className="flex items-center justify-center p-1.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                  title={t('auth.diagnosticsTitle')}
                  aria-label={t('auth.diagnosticsTitle')}
                  id="btn-login-diagnostics"
                >
                  <Activity className="h-3.5 w-3.5 text-indigo-400" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowCentralDatabaseModal(true)}
                  className="flex items-center justify-center p-1.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                  title={t('auth.centralDbTitle')}
                  aria-label={t('auth.centralDbTitle')}
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
                {t('auth.gatewayBadge', { version: appVersion })}
              </span>
              <h2 className="text-xl font-bold tracking-tight text-white">
                {t('auth.signInTitle')}
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                {t('auth.signInSubtitle')}
              </p>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/80 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-white flex items-center gap-1.5 truncate">
                    <QrCode className="h-4 w-4 text-emerald-400 shrink-0" /> {t('auth.qrPassTitle')}
                  </span>
                  <span className="text-[11px] text-slate-400 block truncate mt-0.5">
                    {t('auth.qrPassSubtitle')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLoginQrScanner(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                  id="btn-gateway-scan-qr"
                >
                  <ScanLine className="h-3.5 w-3.5" /> {t('auth.scanQrBtn')}
                </button>
              </div>

              <div className="flex items-center gap-2 my-2 text-slate-500 text-[10px] font-mono font-medium uppercase">
                <div className="h-px bg-slate-800 flex-1" />
                <span>{t('auth.orEnterManually')}</span>
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
                    {t('auth.employeeIdLabel')}
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
                      placeholder={t('auth.employeeIdPlaceholder')}
                      className="w-full bg-slate-800/80 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono tracking-wide"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    {t('auth.pinCodeLabel')}
                  </label>
                  <div className="relative">
                    <input
                      type={showPin ? 'text' : 'password'}
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
                      placeholder={t('auth.pinCodePlaceholder')}
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

                <div className="flex items-center justify-between pt-0.5">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300 hover:text-white text-xs">
                    <input
                      type="checkbox"
                      checked={rememberLogin}
                      onChange={(e) => setRememberLogin(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900 cursor-pointer"
                    />
                    <span>{t('auth.rememberLogin')}</span>
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
                  <LogIn className="h-4 w-4" /> {t('auth.signInBtn')}
                </button>
              </form>
            </div>
          </motion.div>

          {showLoginQrScanner && (
            <BarcodeScannerModal
              isOpen={showLoginQrScanner}
              onClose={() => setShowLoginQrScanner(false)}
              title={t('auth.qrModalTitle')}
              subtitle={t('auth.qrModalSubtitle')}
              onScanResult={handleQrLoginScan}
            />
          )}

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

          {pendingFirstLoginPinChange && (
            <div className="fixed inset-0 z-[135] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
              <div className="bg-white border border-slate-300 rounded-2xl p-6 max-w-sm w-full shadow-2xl text-slate-900 space-y-4 my-auto">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0">
                    <Lock className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 uppercase font-mono">{t('auth.pinChangeRequired')}</h3>
                    <p className="text-[11px] text-slate-500">
                      {t('auth.pinChangeDesc', {
                        username: pendingFirstLoginPinChange.user.username,
                        employeeId: pendingFirstLoginPinChange.user.employeeId,
                      })}
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
                      {t('auth.newPinLabel')}
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
                      {t('auth.confirmNewPinLabel')}
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
                      {t('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingFirstLoginPin}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold uppercase cursor-pointer disabled:opacity-50"
                    >
                      {isSavingFirstLoginPin ? t('auth.saving') : t('auth.savePinSignIn')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {isLoggingIn && (
            <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-200">
              <div className="bg-white border border-slate-300 rounded-3xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl text-slate-900 my-auto">
                <div className="inline-flex p-4 bg-blue-100 text-blue-700 rounded-full border border-blue-300">
                  <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-extrabold text-slate-900 text-base tracking-wide uppercase font-mono">
                    {t('auth.verifyingTitle')}
                  </h3>
                  <p className="text-xs text-blue-700 font-bold font-mono">
                    {t('auth.verifyingSubtitle')}
                  </p>
                </div>
                <p className="text-[11px] text-slate-600 font-sans font-medium">
                  {t('auth.verifyingDesc')}
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
      <div className="glass-ambient-orb-1" />
      <div className="glass-ambient-orb-2" />
      <div className="glass-ambient-orb-3" />

      {/* Sidebar navigation */}
      <aside className="w-full md:w-64 h-auto md:h-screen glass-sidebar text-slate-200 flex flex-col justify-between z-20 shrink-0 relative overflow-hidden" id="sidebar-nav">
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
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
                title={t('auth.logOutTooltip')}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/90 border border-slate-700/60 rounded-xl transition-all cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>

            {currentPermission === 'VIEW_ONLY' ? (
              <div className="bg-amber-950/40 border border-amber-500/30 text-amber-300 px-2.5 py-1 rounded-lg text-[9px] font-semibold flex items-center justify-center gap-1 font-mono uppercase" title={t('permissions.viewOnly')}>
                <Lock className="h-3 w-3 text-amber-400 shrink-0" />
                <span>{t('permissions.viewOnly')}</span>
              </div>
            ) : currentPermission === 'LIMITED_ACCESS' ? (
              <div className="bg-blue-950/40 border border-blue-500/30 text-blue-300 px-2.5 py-1 rounded-lg text-[9px] font-semibold flex items-center justify-center gap-1 font-mono uppercase" title={t('permissions.limitedAccess')}>
                <Edit3 className="h-3 w-3 text-blue-400 shrink-0" />
                <span>{t('permissions.limitedAccess')}</span>
              </div>
            ) : (
              <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 px-2.5 py-1 rounded-lg text-[9px] font-semibold flex items-center justify-center gap-1 font-mono uppercase" title={t('permissions.fullAccess')}>
                <Unlock className="h-3 w-3 text-emerald-400 shrink-0" />
                <span>{t('permissions.fullAccess')}</span>
              </div>
            )}
          </div>

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
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title={t('sidebar.systemLive')} />
          </div>

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
                <LayoutDashboard className="h-4 w-4 shrink-0" /> {t('nav.dashboard')}
              </button>
              {dashboardAlertCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setView('dashboard');
                    setOpenDashboardAlertsSignal(n => n + 1);
                  }}
                  id="nav-dashboard-alerts-badge"
                  title={t('nav.viewAlertsBadgeTitle')}
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
              <ArrowLeftRight className="h-4 w-4 shrink-0" /> {t('nav.receiving')}
            </button>

            <button
              onClick={() => setView('stock')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'stock'
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <PackageSearch className="h-4 w-4 shrink-0" /> {t('nav.stock')}
            </button>

            <button
              onClick={() => setView('recycling')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'recycling'
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <RotateCcw className="h-4 w-4 shrink-0" /> {t('nav.recycling')}
            </button>

            <button
              onClick={() => setView('issuance')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'issuance'
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <Briefcase className="h-4 w-4 shrink-0" /> {t('nav.issuance')}
            </button>

            <button
              onClick={() => setView('delivery')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'delivery'
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <Truck className="h-4 w-4 shrink-0" /> {t('nav.delivery')}
            </button>

            <button
              onClick={() => setView('environmental')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'environmental'
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
            >
              <Boxes className="h-4 w-4 shrink-0" /> {t('nav.environmental')}
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
              <ArrowLeftRight className="h-4 w-4 shrink-0" /> {t('nav.stockMovements')}
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
              <PackageSearch className="h-4 w-4 shrink-0" /> {t('nav.products')}
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
              <Boxes className="h-4 w-4 shrink-0" /> {t('nav.inventoryMatrix')}
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
              <FolderPlus className="h-4 w-4 shrink-0" /> {t('nav.masterRegistry')}
            </button>

            {isAdminSession && (
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
                  <Users className="h-4 w-4 shrink-0" /> {t('nav.accounts')}
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
                  <FileClock className="h-4 w-4 shrink-0" /> {t('nav.audit')}
                </button>
              </>
            )}

            <button
              onClick={() => setView('settings')}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-300 cursor-pointer ${
                view === 'settings'
                  ? 'bg-indigo-600/95 text-white font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 backdrop-blur-md'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 font-medium'
              }`}
              id="nav-settings"
            >
              <Settings className="h-4 w-4 shrink-0" /> {t('nav.settings')}
            </button>
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-800/80 space-y-2 bg-slate-950/60 backdrop-blur-md">
          <div className="space-y-1.5">
            <button
              onClick={backupActions.handleExportCurrentData}
              id="btn-sidebar-export-current-data"
              className="w-full bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white py-2 px-3 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 border border-slate-700/80 transition-colors cursor-pointer shadow-xs active:scale-95"
              title={t('sidebar.exportCurrentDataTitle')}
            >
              <Download className="h-3.5 w-3.5 text-indigo-400" /> {t('sidebar.exportCurrentData')}
            </button>

            {isSuperAdminFlag && (
              <>
                <button
                  onClick={() => setShowBackupsModal(true)}
                  className="w-full bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 hover:text-emerald-100 py-2 px-3 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 border border-emerald-500/40 transition-colors cursor-pointer shadow-sm"
                  title={t('sidebar.serverBackupsTitle')}
                >
                  <Archive className="h-3.5 w-3.5 text-emerald-400" /> {t('sidebar.serverBackups')}
                </button>

                <label className="w-full bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white py-2 px-3 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700/60 transition-colors">
                  <Upload className="h-3.5 w-3.5 text-indigo-400" /> {t('sidebar.importDbRestore')}
                  <input type="file" accept=".json" onChange={backupActions.handleImportBackup} className="hidden" />
                </label>

                <button
                  onClick={() => {
                    setConfirmActionApp({
                      title: t('sidebar.resetDefaultDbTitle'),
                      message: t('sidebar.resetDefaultDbMsg'),
                      confirmLabel: t('sidebar.resetDefaultDbConfirm'),
                      confirmVariant: 'danger',
                      onConfirm: () => resetStateToDefaults()
                    });
                  }}
                  className="w-full text-rose-400/80 hover:text-rose-300 py-1 text-[10px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <Trash2 className="h-3 w-3" /> {t('sidebar.resetDefaultDb')}
                </button>

                <button
                  onClick={() => {
                    setConfirmActionApp({
                      title: t('sidebar.wipeAccountsTitle'),
                      message: t('sidebar.wipeAccountsMsg'),
                      confirmLabel: t('sidebar.wipeAccountsConfirm'),
                      confirmVariant: 'danger',
                      onConfirm: () => resetAccountsToDefaults()
                    });
                  }}
                  className="w-full text-rose-400/70 hover:text-rose-300 py-1 text-[10px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <Trash2 className="h-3 w-3" /> {t('sidebar.wipeAccounts')}
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col h-full min-w-0 bg-slate-50/70 z-10 relative overflow-hidden">
        {/* Header Bar */}
        <header className="h-16 glass-header px-4 sm:px-6 lg:px-8 flex justify-between items-center shrink-0 z-20 sticky top-0">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="font-bold text-base sm:text-lg text-slate-900 tracking-tight truncate flex items-center gap-2" id="top-bar-page-title">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shadow-xs shadow-indigo-500/50 shrink-0 animate-pulse" />
              <span>{getPageTitle()}</span>
            </h1>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium shrink-0">
            <LanguageSwitch compact />

            <SyncStatus
              onOpenSettings={() => setShowCentralDatabaseModal(true)}
              onOpenDiagnostics={() => setShowStartupDiagnosticsModal(true)}
              onOpenConflicts={() => setShowConflictsModal(true)}
            />

            <button
              type="button"
              onClick={() => {
                setQuickLookupTerm('');
                setShowQuickLookupScanner(true);
              }}
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white px-2.5 sm:px-3 h-8 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 shadow-xs shadow-indigo-500/25 border border-indigo-500/40"
              title={t('header.quickScanTitle')}
              aria-label={t('header.quickScanTitle')}
              id="header-barcode-scanner-button"
            >
              <Barcode className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline font-medium">{t('header.quickScan')}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowActiveUsersModal(true)}
              className="inline-flex items-center justify-center bg-indigo-50/90 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/90 w-8 h-8 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 shadow-xs backdrop-blur-md relative"
              title={t('header.activeWorkstationsTitle', { count: Math.max(1, activePresence.length, activeUsers.length) })}
              aria-label={t('header.activeWorkstations')}
            >
              <Users className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <span className="absolute -top-1.5 -right-1.5 bg-indigo-600 text-white text-[9px] font-bold rounded-full min-w-3.5 h-3.5 flex items-center justify-center px-0.5 font-mono">
                {Math.max(1, activePresence.length, activeUsers.length)}
              </span>
            </button>

            <LiveClock />
          </div>
        </header>

        {/* Status Banners */}
        {isDeviceRevoked && (
          <div className="bg-rose-600 text-white px-4 sm:px-6 lg:px-8 py-2.5 text-xs font-semibold flex items-center justify-between gap-4 border-b border-rose-700 font-mono uppercase shrink-0" id="device-revoked-banner">
            <div className="flex items-center gap-2">
              <Ban className="h-4 w-4 shrink-0" />
              <span>{t('permissions.deviceRevokedBanner')}</span>
            </div>
            <span className="bg-rose-800 text-rose-50 px-2 py-0.5 rounded text-[10px] tracking-wider shrink-0">{t('permissions.deviceRevokedTag')}</span>
          </div>
        )}

        {syncConflicts.length > 0 && (
          <div className="bg-amber-600 text-white px-4 sm:px-6 lg:px-8 py-2 text-xs font-semibold flex items-center justify-between gap-4 border-b border-amber-700 shrink-0" id="sync-conflicts-banner">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {syncConflicts.length === 1
                  ? t('permissions.conflictBannerSingle', { count: syncConflicts.length })
                  : t('permissions.conflictBannerPlural', { count: syncConflicts.length })}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowConflictsModal(true)}
              className="bg-white text-amber-800 hover:bg-amber-50 px-3 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer shrink-0 shadow-xs"
              id="btn-review-sync-conflicts"
            >
              {t('permissions.reviewConflicts', { count: syncConflicts.length })}
            </button>
          </div>
        )}

        {currentPermission === 'VIEW_ONLY' && (
          <div className="bg-amber-500 text-white px-4 sm:px-6 lg:px-8 py-2 text-xs font-semibold flex items-center justify-between gap-4 border-b border-amber-600 font-mono uppercase shrink-0">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              <span>{t('permissions.viewOnlyBanner')}</span>
            </div>
            <span className="bg-amber-600 text-amber-50 px-2 py-0.5 rounded text-[10px] tracking-wider shrink-0">{t('permissions.viewOnlyTag')}</span>
          </div>
        )}

        {/* Feature Viewport */}
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
                <DashboardFeature
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
                  isSuperAdmin={isSuperAdminFlag}
                  canEdit={canEditFlag}
                  registries={registries}
                  openAlertsSignal={openDashboardAlertsSignal}
                />
              )}

              {view === 'receiving' && (
                <ReceivingFeature
                  receiving={receiving}
                  onAddReceiving={receivingActions.handleAddReceiving}
                  onUpdateIqc={receivingActions.handleUpdateIqc}
                  onEditReceiving={receivingActions.handleEditReceiving}
                  onDeleteReceiving={receivingActions.handleDeleteReceiving}
                  returns={returns}
                  onAddReturn={receivingActions.handleAddReturn}
                  onUpdateReturnStatus={receivingActions.handleUpdateReturnStatus}
                  onEditReturn={receivingActions.handleEditReturn}
                  onDeleteReturn={receivingActions.handleDeleteReturn}
                  stocks={stocks}
                  registries={registries}
                  isSuperAdmin={isSuperAdminFlag}
                  canEdit={canEditFlag}
                  onOpenRegisterModal={() => setView('master-registry')}
                  receivingCategories={receivingCategories}
                  onUpdateReceivingCategories={handleUpdateReceivingCategories}
                  fifoColorsByMonth={fifoColorsByMonth}
                />
              )}

              {view === 'stock' && (
                <StockFeature
                  stocks={stocks}
                  onAddStock={stockActions.handleAddStock}
                  onUpdateStockQty={stockActions.handleUpdateStockQty}
                  onUpdateStockStatus={stockActions.handleUpdateStockStatus}
                  onEditStock={stockActions.handleEditStock}
                  onDeleteStock={stockActions.handleDeleteStock}
                  isSuperAdmin={isSuperAdminFlag}
                  canEdit={canEditFlag}
                  receiving={receiving}
                  issuances={issuances}
                  returns={returns}
                  registries={registries}
                  fifoColorsByMonth={fifoColorsByMonth}
                  onUpdateFifoColors={handleUpdateFifoColors}
                />
              )}

              {view === 'recycling' && (
                <RecyclingFeature
                  recycling={recycling}
                  registries={registries}
                  onAddRecycling={receivingActions.handleAddRecycling}
                  onDeleteRecycling={receivingActions.handleDeleteRecycling}
                  isSuperAdmin={isSuperAdminFlag}
                  canEdit={canEditFlag}
                />
              )}

              {view === 'issuance' && (
                <IssuanceFeature
                  stocks={stocks}
                  issuances={issuances}
                  onAddIssuance={issuanceActions.handleAddIssuance}
                  onDeductStock={issuanceActions.handleDeductStock}
                  onEditIssuance={issuanceActions.handleEditIssuance}
                  onDeleteIssuance={issuanceActions.handleDeleteIssuance}
                  registries={registries}
                  currentUser={currentUser}
                  isSuperAdmin={isSuperAdminFlag}
                  canEdit={canEditFlag}
                />
              )}

              {view === 'delivery' && (
                <DeliveryFeature
                  deliveries={deliveries}
                  forkliftChecks={forkliftChecks}
                  onAddDelivery={deliveryActions.handleAddDelivery}
                  onAddForkliftCheck={deliveryActions.handleAddForkliftCheck}
                  onUpdateDeliveryStatus={deliveryActions.handleUpdateDeliveryStatus}
                  onEditDelivery={deliveryActions.handleEditDelivery}
                  onDeleteDelivery={deliveryActions.handleDeleteDelivery}
                  stocks={stocks}
                  registries={registries}
                  currentUser={currentUser}
                  isSuperAdmin={isSuperAdminFlag}
                  canEdit={canEditFlag}
                />
              )}

              {view === 'environmental' && (
                <EnvironmentalFeature
                  envLogs={envLogs}
                  onAddEnvLog={deliveryActions.handleAddEnvLog}
                  onClearEnvLogs={deliveryActions.handleClearEnvLogs}
                  onDeleteEnvLog={deliveryActions.handleDeleteEnvLog}
                  registries={registries}
                  onRegisterLocation={masterDataActions.handleRegisterMasterItem}
                  onUpdateLocation={(id, data) => {
                    const existing = registries.find(r => r.id === id);
                    if (existing) {
                      masterDataActions.handleUpdateMasterItem({ ...existing, ...data });
                    }
                  }}
                  onDeleteLocation={masterDataActions.handleDeleteMasterItem}
                  currentUserRole={currentRole}
                  currentUser={currentUser}
                  isSuperAdmin={currentPermission === 'FULL_ACCESS' || currentRole?.toUpperCase().includes('SUPER') || currentRole?.toUpperCase().includes('SYSTEM')}
                  canEdit={canEditFlag}
                />
              )}

              {view === 'stock-movements' && (
                <StockMovementsFeature
                  stocks={stocks}
                  currentUser={{ id: currentEmployeeId, name: currentUser, username: currentUser }}
                  onStockUpdated={() => handleManualSync()}
                />
              )}

              {view === 'products' && <ProductsFeature />}

              {view === 'inventory-matrix' && <InventoryMatrixFeature />}

              {view === 'master-registry' && (
                <MasterDataFeature
                  registries={registries}
                  onRegisterItem={masterDataActions.handleRegisterMasterItem}
                  onUpdateItem={masterDataActions.handleUpdateMasterItem}
                  onDeleteItem={masterDataActions.handleDeleteMasterItem}
                  onResetDefaults={masterDataActions.handleResetMasterDefaults}
                  isSuperAdmin={isSuperAdminFlag}
                  canEdit={canEditFlag}
                  defaultType="ALL"
                  categories={receivingCategories}
                />
              )}

              {view === 'accounts' && isAdminSession && (
                <AccountsFeature
                  accounts={registeredUsers}
                  operationalRoles={operationalRoles}
                  onUpdateOperationalRoles={handleUpdateOperationalRoles}
                  onAddAccount={accountActions.handleRegister}
                  onUpdateAccount={accountActions.handleUpdateAccount}
                  onRemoveAccount={accountActions.handleRemoveUser}
                  onClearAllAccounts={accountActions.handleClearAllAccountsExceptSuperAdmin}
                  onOpenBackups={() => setShowBackupsModal(true)}
                  currentUser={currentUser}
                  currentEmployeeId={currentEmployeeId}
                  isSuperAdmin={isSuperAdminFlag}
                  canEdit={canEditFlag}
                />
              )}

              {view === 'audit' && isAdminSession && (
                <AuditFeature
                  isSuperAdmin={isAdminSession}
                  currentUser={currentUser}
                  currentEmployeeId={currentEmployeeId}
                />
              )}

              {view === 'settings' && (
                <SettingsView
                  currentUser={currentUser}
                  currentEmployeeId={currentEmployeeId}
                  currentRole={currentRole}
                  canEdit={canEditFlag}
                  isManualSyncing={isManualSyncing}
                  onForceSync={handleManualSync}
                  onOpenCentralDatabase={() => setShowCentralDatabaseModal(true)}
                  onOpenDiagnostics={() => setShowStartupDiagnosticsModal(true)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {qrBadgeAccount && (
        <AccountQRBadgeModal
          account={qrBadgeAccount}
          isOpen={!!qrBadgeAccount}
          onClose={() => setQrBadgeAccount(null)}
        />
      )}

      <ConfirmModal
        config={confirmActionApp}
        onClose={() => setConfirmActionApp(null)}
      />

      <DesktopInstallModal
        isOpen={showDesktopInstallModal}
        onClose={() => setShowDesktopInstallModal(false)}
      />

      <CentralDatabaseModal
        isOpen={showCentralDatabaseModal}
        onClose={() => setShowCentralDatabaseModal(false)}
        connectionStatus={connectionStatus}
        systemResetVersion={(() => {
          try {
            return Number(localStorage.getItem('juwei_wms_system_reset_version')) || 1;
          } catch {
            return 1;
          }
        })()}
        systemResetId={(() => {
          try {
            return localStorage.getItem('juwei_wms_system_reset_id') || 'RESET-INIT';
          } catch {
            return 'RESET-INIT';
          }
        })()}
        onForceSync={handleManualSync}
        isManualSyncing={isManualSyncing}
        totalRecordsCount={stocks.length + receiving.length + returns.length + recycling.length + issuances.length + deliveries.length}
        totalUsersCount={registeredUsers.length}
      />

      {isSuperAdminFlag && (
        <ServerBackupsModal
          isOpen={showBackupsModal}
          onClose={() => setShowBackupsModal(false)}
          currentUser={currentUser}
          currentEmployeeId={currentEmployeeId}
        />
      )}

      <StartupDiagnosticsModal
        isOpen={showStartupDiagnosticsModal}
        onClose={() => setShowStartupDiagnosticsModal(false)}
        currentUser={{
          username: currentUser,
          role: currentRole,
          employeeId: currentEmployeeId,
          permission: currentPermission
        }}
        wsConnected={wsOpen(socket)}
        systemResetVersion={(() => {
          try {
            return Number(localStorage.getItem('juwei_wms_system_reset_version')) || 1;
          } catch {
            return 1;
          }
        })()}
        onForceSync={handleManualSync}
      />

      <ActiveUsersModal
        isOpen={showActiveUsersModal}
        onClose={() => setShowActiveUsersModal(false)}
        activeUsers={activeUsers}
        activePresence={activePresence}
        registeredUsers={registeredUsers}
        connectionStatus={connectionStatus}
        wsLatency={wsLatency}
        lastSyncedTime={lastSyncedTime}
        onForceSync={handleManualSync}
        isManualSyncing={isManualSyncing}
      />

      {showConflictsModal && (
        <div
          className="fixed inset-0 z-[125] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowConflictsModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden text-slate-100"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">{t('conflicts.title', { count: syncConflicts.length })}</h3>
                  <p className="text-xs text-slate-400">{t('conflicts.subtitle')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConflictsModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {syncConflicts.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">{t('conflicts.empty')}</div>
              ) : (
                syncConflicts.map((conflict) => (
                  <div key={conflict.id} className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/80 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-amber-300">
                        {conflict.collection} • {conflict.recordId}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {new Date(conflict.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-300 text-[11px]">{conflict.error}</p>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleResolveConflictAcceptServer(conflict)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[11px] border border-slate-600 cursor-pointer transition"
                      >
                        {t('conflicts.acceptServer')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolveConflictKeepMine(conflict)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] cursor-pointer transition"
                      >
                        {t('conflicts.keepMine')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

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
                  <h3 className="text-sm font-bold text-white tracking-tight">{t('auth.confirmSignOut')}</h3>
                  <p className="text-xs text-slate-400">{t('auth.confirmSignOutDesc')}</p>
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
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">{t('auth.activeSession')}</span>
              <span className="font-bold text-white text-xs">{currentUser || 'OPERATOR'}</span>
              <span className="text-[11px] text-indigo-400 font-mono">({currentEmployeeId || 'JPMP-002'}) • {currentRole || 'WAREHOUSE CLERK'}</span>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowLogoutConfirmModal(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700 transition cursor-pointer"
              >
                {t('auth.noCancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutConfirmModal(false);
                  handleLogout();
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <LogOut className="h-3.5 w-3.5" /> {t('auth.yesLogOut')}
              </button>
            </div>
          </div>
        </div>
      )}

      <QuickLookupModals
        showScanner={showQuickLookupScanner}
        onCloseScanner={() => setShowQuickLookupScanner(false)}
        onScanResult={handleQuickLookupScan}
        showResults={showQuickLookupResults}
        onCloseResults={() => setShowQuickLookupResults(false)}
        onOpenScannerFromResults={() => {
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
