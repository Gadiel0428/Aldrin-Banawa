import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  UserPlus, 
  Search, 
  ShieldCheck, 
  Lock, 
  Unlock, 
  KeyRound, 
  Trash2, 
  Edit, 
  Edit3,
  Eye, 
  EyeOff,
  Phone, 
  QrCode, 
  Check, 
  X, 
  AlertCircle, 
  RefreshCw, 
  Copy, 
  CheckCircle2, 
  Clock, 
  ShieldAlert,
  Tag,
  Plus,
  Pencil,
  RotateCcw,
  Archive,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import AccountQRBadgeModal from './AccountQRBadgeModal';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';
import { RegisteredAccount } from '../types';
import { updateCentralPin } from '../lib/centralApi';
export type { RegisteredAccount };

// Centralized default operational roles
export const DEFAULT_OPERATIONAL_ROLES: string[] = [
  "SYSTEM ADMINISTRATOR",
  "WAREHOUSE TEAM LEADER",
  "WAREHOUSE SUPERVISOR",
  "WAREHOUSE MANAGER",
  "WAREHOUSE CLERK",
  "WAREHOUSE INVENTORY SPECIALIST",
  "WAREHOUSE PERSONNEL",
  "INJECTION MATERIAL HANDLER",
  "PRINTING MATERIAL HANDLER",
  "HR/ADMIN",
  "INJECTION (PRODUCTION)",
  "QUALITY INSPECTOR",
  "SALES",
  "PURCHASING",
  "IMPEX",
  "LOGISTIC",
  "PRINTING AND ASSEMBLY (PRODUCTION)",
  "FINANCE/ACCOUNTING",
  "INTERNAL AUDITOR"
];

interface RegisteredAccountsModuleProps {
  accounts: RegisteredAccount[];
  operationalRoles?: string[];
  onUpdateOperationalRoles?: (roles: string[]) => void;
  onAddAccount: (
    username: string, 
    role: string, 
    employeeId: string, 
    permission: string, 
    phoneNumber?: string, 
    customPin?: string,
    status?: 'ACTIVE' | 'PENDING' | 'INACTIVE'
  ) => RegisteredAccount | boolean | null;
  onUpdateAccount: (oldEmpId: string, updated: RegisteredAccount) => void;
  onRemoveAccount: (employeeId: string) => void;
  onClearAllAccounts?: () => void;
  onOpenBackups?: () => void;
  currentUser: string;
  currentEmployeeId: string;
  isSuperAdmin?: boolean;
  canEdit?: boolean;
}

export default function RegisteredAccountsModule({
  accounts,
  operationalRoles,
  onUpdateOperationalRoles,
  onAddAccount,
  onUpdateAccount,
  onRemoveAccount,
  onClearAllAccounts,
  onOpenBackups,
  currentUser,
  currentEmployeeId,
  isSuperAdmin = false,
  canEdit: _canEdit = false
}: RegisteredAccountsModuleProps) {
  // Centralized managed operational roles list
  const managedRoles = useMemo(() => {
    if (Array.isArray(operationalRoles) && operationalRoles.length > 0) {
      return Array.from(new Set(operationalRoles.map(r => String(r || '').trim().toUpperCase()).filter(Boolean)));
    }
    return DEFAULT_OPERATIONAL_ROLES;
  }, [operationalRoles]);

  // Search and Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PENDING' | 'INACTIVE'>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [permissionFilter, setPermissionFilter] = useState<string>('ALL');

  // UI / Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<RegisteredAccount | null>(null);
  const [originalEmployeeId, setOriginalEmployeeId] = useState<string>('');
  const [selectedQrAccount, setSelectedQrAccount] = useState<RegisteredAccount | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);
  const [showPins, setShowPins] = useState<{ [key: string]: boolean }>({});
  const [revealAllPins, setRevealAllPins] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Manage Roles Modal States (Super Admin)
  const [showRolesModal, setShowRolesModal] = useState(false);
  const [newRoleInput, setNewRoleInput] = useState('');
  const [editingRoleOriginal, setEditingRoleOriginal] = useState<string | null>(null);
  const [editingRoleNewValue, setEditingRoleNewValue] = useState('');
  const [roleSearchQuery, setRoleSearchQuery] = useState('');
  const [roleModalError, setRoleModalError] = useState('');
  const [roleModalSuccess, setRoleModalSuccess] = useState('');

  // Inline Add Role states for modals
  const [showEditInlineAddRole, setShowEditInlineAddRole] = useState(false);
  const [editInlineRoleInput, setEditInlineRoleInput] = useState('');
  const [showAddInlineRole, setShowAddInlineRole] = useState(false);
  const [addInlineRoleInput, setAddInlineRoleInput] = useState('');

  // Quick inline phone edit state
  const [editingPhoneEmpId, setEditingPhoneEmpId] = useState<string | null>(null);
  const [editingPhoneValue, setEditingPhoneValue] = useState<string>('');

  // New Account Registration Form state
  const [newUsername, setNewUsername] = useState('');
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [newCustomPin, setNewCustomPin] = useState('');
  const [newRole, setNewRole] = useState(() => managedRoles[4] || 'WAREHOUSE CLERK');
  const [newPermission, setNewPermission] = useState('LIMITED_ACCESS');
  const [newStatus, setNewStatus] = useState<'ACTIVE' | 'PENDING' | 'INACTIVE'>('ACTIVE');
  const [addError, setAddError] = useState<string>('');

  // Compromised PIN Detection: Any account with '1234' or isPinCompromised flag
  const compromisedAccounts = useMemo(() => {
    return accounts.filter(acc => acc.pin === '1234' || acc.isPinCompromised);
  }, [accounts]);

  // Dedicated Super Admin PIN Change Modal State
  const [pinChangeAccount, setPinChangeAccount] = useState<RegisteredAccount | null>(null);
  const [newPinValue, setNewPinValue] = useState<string>('');
  const [confirmPinValue, setConfirmPinValue] = useState<string>('');
  const [superAdminPinValue, setSuperAdminPinValue] = useState<string>('');
  const [pinChangeReason, setPinChangeReason] = useState<string>('');
  const [pinChangeError, setPinChangeError] = useState<string>('');
  const [pinChangeSuccess, setPinChangeSuccess] = useState<string>('');
  const [isSubmittingPinChange, setIsSubmittingPinChange] = useState<boolean>(false);

  const handleOpenPinModal = (acc: RegisteredAccount) => {
    setPinChangeAccount(acc);
    setNewPinValue('');
    setConfirmPinValue('');
    setSuperAdminPinValue('');
    setPinChangeReason(
      acc.pin === '1234' || acc.isPinCompromised 
        ? 'Resolving compromised default PIN (1234)' 
        : 'Authorized Super Admin PIN update'
    );
    setPinChangeError('');
    setPinChangeSuccess('');
  };

  const handleSubmitPinChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinChangeAccount) return;
    setPinChangeError('');
    setPinChangeSuccess('');

    const cleanNewPin = newPinValue.replace(/\D/g, '').slice(0, 6);
    const cleanConfirm = confirmPinValue.replace(/\D/g, '').slice(0, 6);
    const cleanAdminPin = superAdminPinValue.trim();

    if (cleanNewPin.length < 4) {
      setPinChangeError('New PIN must be between 4 and 6 numeric digits.');
      return;
    }
    if (cleanNewPin !== cleanConfirm) {
      setPinChangeError('Confirmation PIN does not match new PIN.');
      return;
    }
    if (cleanNewPin === '1234') {
      setPinChangeError("SECURITY REJECTED: '1234' is a compromised default PIN and is strictly prohibited.");
      return;
    }
    if (/^(\d)\1+$/.test(cleanNewPin)) {
      setPinChangeError('SECURITY REJECTED: Repetitive PIN patterns (e.g. 0000, 1111) are not allowed.');
      return;
    }
    if (!cleanAdminPin) {
      setPinChangeError('Super Administrator confirmation PIN (0423) is required to authorize this security change.');
      return;
    }

    setIsSubmittingPinChange(true);
    try {
      const res = await updateCentralPin(
        pinChangeAccount.employeeId,
        cleanAdminPin,
        cleanNewPin,
        currentEmployeeId || 'JPMP-002',
        {
          adminPin: cleanAdminPin,
          author: `${currentUser || 'ALDRIN BANAWA'} (${currentEmployeeId || 'JPMP-002'})`,
          reason: pinChangeReason.trim() || 'Super Admin PIN reset'
        }
      );

      if (res.success) {
        setPinChangeSuccess(`PIN successfully updated for ${pinChangeAccount.username}. Audit log recorded.`);
        if (res.user) {
          onUpdateAccount(pinChangeAccount.employeeId, res.user);
        } else {
          onUpdateAccount(pinChangeAccount.employeeId, {
            ...pinChangeAccount,
            pin: cleanNewPin,
            isPinCompromised: false
          });
        }
        setTimeout(() => {
          setPinChangeAccount(null);
          setIsSubmittingPinChange(false);
          setPinChangeSuccess('');
        }, 1200);
      } else {
        setPinChangeError(res.error || 'Failed to update PIN in central database.');
        setIsSubmittingPinChange(false);
      }
    } catch (err: any) {
      setPinChangeError(err?.message || 'Network error updating PIN.');
      setIsSubmittingPinChange(false);
    }
  };

  // Managed roles for Edit dropdown (ensuring current account role is always an option)
  const editDropdownRoles = useMemo(() => {
    const set = new Set<string>(managedRoles);
    if (editingAccount?.role) {
      set.add(editingAccount.role.toUpperCase().trim());
    }
    return Array.from(set).filter(Boolean).sort();
  }, [managedRoles, editingAccount?.role]);

  // Managed roles for Add dropdown (ensuring newRole is always an option)
  const addDropdownRoles = useMemo(() => {
    const set = new Set<string>(managedRoles);
    if (newRole) {
      set.add(newRole.toUpperCase().trim());
    }
    return Array.from(set).filter(Boolean).sort();
  }, [managedRoles, newRole]);

  // Role Management Operations
  const handleAddManagedRole = (roleNameToAdd?: string): string | false => {
    const candidate = String(roleNameToAdd !== undefined ? roleNameToAdd : newRoleInput).trim().toUpperCase();
    if (!candidate) {
      setRoleModalError("Please enter a valid operational role name.");
      return false;
    }
    if (managedRoles.some(r => r.toUpperCase() === candidate)) {
      setRoleModalError(`Role "${candidate}" already exists.`);
      return false;
    }

    const updated = [...managedRoles, candidate];
    if (onUpdateOperationalRoles) {
      onUpdateOperationalRoles(updated);
    }
    setNewRoleInput('');
    setRoleModalError('');
    setRoleModalSuccess(`Role "${candidate}" created successfully.`);
    setTimeout(() => setRoleModalSuccess(''), 3000);
    return candidate;
  };

  const handleRenameManagedRole = (oldRole: string, newRole: string) => {
    const cleanOld = oldRole.trim().toUpperCase();
    const cleanNew = newRole.trim().toUpperCase();
    if (!cleanNew) {
      setRoleModalError("Role name cannot be empty.");
      return;
    }
    if (cleanNew !== cleanOld && managedRoles.some(r => r.toUpperCase() === cleanNew)) {
      setRoleModalError(`Role "${cleanNew}" already exists.`);
      return;
    }

    const updated = managedRoles.map(r => r.toUpperCase() === cleanOld ? cleanNew : r);
    if (onUpdateOperationalRoles) {
      onUpdateOperationalRoles(updated);
    }

    // Cascade rename to any existing accounts assigned this role
    accounts.forEach(acc => {
      if ((acc.role || '').toUpperCase().trim() === cleanOld) {
        onUpdateAccount(acc.employeeId, { ...acc, role: cleanNew });
      }
    });

    setEditingRoleOriginal(null);
    setEditingRoleNewValue('');
    setRoleModalError('');
    setRoleModalSuccess(`Renamed "${cleanOld}" to "${cleanNew}".`);
    setTimeout(() => setRoleModalSuccess(''), 3000);
  };

  const handleDeleteManagedRole = (roleToDelete: string) => {
    const clean = roleToDelete.trim().toUpperCase();
    const assignedCount = accounts.filter(a => (a.role || '').toUpperCase().trim() === clean).length;

    setConfirmAction({
      title: `DELETE ROLE: ${clean}`,
      message: assignedCount > 0
        ? `Warning: "${clean}" is currently assigned to ${assignedCount} operator account(s). Deleting it will remove it from the operational role list. Assigned accounts will retain their label until updated. Proceed?`
        : `Are you sure you want to delete the operational role "${clean}"?`,
      confirmVariant: "danger",
      confirmLabel: "DELETE ROLE",
      onConfirm: () => {
        const updated = managedRoles.filter(r => r.toUpperCase() !== clean);
        if (onUpdateOperationalRoles) {
          onUpdateOperationalRoles(updated);
        }
        setRoleModalSuccess(`Role "${clean}" removed from managed list.`);
        setTimeout(() => setRoleModalSuccess(''), 3000);
        setConfirmAction(null);
      }
    });
  };

  const handleResetRolesToDefaults = () => {
    setConfirmAction({
      title: "RESET TO DEFAULT OPERATIONAL ROLES",
      message: "This will reset the operational roles list back to the standard JUWEI factory default roles. Any custom added roles will be removed. Are you sure?",
      confirmVariant: "danger",
      confirmLabel: "RESET TO DEFAULTS",
      onConfirm: () => {
        if (onUpdateOperationalRoles) {
          onUpdateOperationalRoles([...DEFAULT_OPERATIONAL_ROLES]);
        }
        setRoleModalSuccess("Operational roles reset to JUWEI factory defaults.");
        setTimeout(() => setRoleModalSuccess(''), 3000);
        setConfirmAction(null);
      }
    });
  };

  // Distinct roles available in system for filter dropdown (backed by managedRoles + existing account roles)
  const distinctRoles = useMemo(() => {
    const roles = new Set<string>(managedRoles.map(r => r.toUpperCase().trim()));
    accounts.forEach(a => {
      if (a.role) roles.add(a.role.toUpperCase().trim());
    });
    return Array.from(roles).filter(Boolean).sort();
  }, [managedRoles, accounts]);

  // Status computation and counts
  const accountStats = useMemo(() => {
    let active = 0;
    let pending = 0;
    let inactive = 0;
    let fullAccess = 0;

    accounts.forEach(a => {
      const st = a.status || 'ACTIVE';
      if (st === 'ACTIVE') active++;
      else if (st === 'PENDING') pending++;
      else if (st === 'INACTIVE') inactive++;

      if (a.permission === 'FULL_ACCESS') fullAccess++;
    });

    return { total: accounts.length, active, pending, inactive, fullAccess };
  }, [accounts]);

  // Filtered Accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter(acc => {
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch = !query || 
        (acc.username || '').toLowerCase().includes(query) ||
        (acc.employeeId || '').toLowerCase().includes(query) ||
        (acc.phoneNumber || '').toLowerCase().includes(query) ||
        (acc.role || '').toLowerCase().includes(query) ||
        (acc.permission || '').toLowerCase().includes(query) ||
        (acc.pin || '').includes(query);

      const accStatus = acc.status || 'ACTIVE';
      const matchesStatus = statusFilter === 'ALL' || accStatus === statusFilter;
      const matchesRole = roleFilter === 'ALL' || (acc.role || '').toUpperCase() === roleFilter;
      const matchesPermission = permissionFilter === 'ALL' || (acc.permission || 'LIMITED_ACCESS') === permissionFilter;

      return matchesSearch && matchesStatus && matchesRole && matchesPermission;
    });
  }, [accounts, searchQuery, statusFilter, roleFilter, permissionFilter]);

  // Format phone number utility
  const formatPhoneNumber = (phone: string) => {
    const cleaned = phone.replace(/[^\d+]/g, '');
    if (!cleaned) return '';
    if (cleaned.startsWith('09') && cleaned.length === 11) {
      return `+63 ${cleaned.slice(1, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
    }
    if (cleaned.startsWith('+63') && cleaned.length === 13) {
      return `+63 ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
    }
    return cleaned;
  };

  // Format timestamp for Last Active column
  const formatLastActive = (isoString?: string) => {
    if (!isoString) return { display: 'Never', time: '', isRecent: false, full: 'Never logged in' };
    
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return { display: 'Never', time: '', isRecent: false, full: 'Invalid timestamp' };
      
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      const fullStr = `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} ${timeStr}`;

      if (diffSec < 60) {
        return { display: 'Just now', time: timeStr, isRecent: true, full: fullStr };
      }
      if (diffMin < 60) {
        return { display: `${diffMin}m ago`, time: timeStr, isRecent: true, full: fullStr };
      }
      if (diffHours < 24 && d.getDate() === now.getDate()) {
        return { display: 'Today', time: timeStr, isRecent: true, full: fullStr };
      }
      if (diffDays === 1 || (diffHours < 48 && d.getDate() === now.getDate() - 1)) {
        return { display: 'Yesterday', time: timeStr, isRecent: false, full: fullStr };
      }
      
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      return { display: dateStr, time: timeStr, isRecent: false, full: fullStr };
    } catch (e) {
      return { display: 'Invalid Date', time: '', isRecent: false, full: 'Invalid date' };
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleShowPin = (empId: string) => {
    setShowPins(prev => ({ ...prev, [empId]: !prev[empId] }));
  };

  const resetAddForm = () => {
    setNewUsername('');
    setNewEmployeeId('');
    setNewPhoneNumber('');
    setNewCustomPin('');
    setNewRole('WAREHOUSE CLERK');
    setNewPermission('LIMITED_ACCESS');
    setNewStatus('ACTIVE');
    setAddError('');
    setShowAddModal(false);
  };

  // Direct Account Registration
  const handleRegisterAccount = (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');

    if (!isSuperAdmin) {
      setAddError('AUTHORIZATION RESTRICTION: Only accounts registered by Super Administrator (ALDRIN BANAWA - JPMP-002) in this computer will be authorized for use by other users and computers.');
      return;
    }

    if (!newUsername.trim() || !newEmployeeId.trim()) {
      setAddError('Please enter Operator Full Name and Employee ID.');
      return;
    }

    let empId = newEmployeeId.trim().toUpperCase();
    if (!empId.startsWith('JPMP-')) {
      empId = `JPMP-${empId}`;
    }

    // Check if employeeId or username already exists
    const exists = accounts.some(
      a => a.employeeId.toUpperCase() === empId || 
           a.username.toUpperCase() === newUsername.trim().toUpperCase()
    );
    if (exists) {
      setAddError(`An operator with ID "${empId}" or name "${newUsername.trim().toUpperCase()}" already exists.`);
      return;
    }

    if (newCustomPin) {
      if (newCustomPin.length !== 4) {
        setAddError('Custom Security PIN must be exactly 4 digits.');
        return;
      }
      if (newCustomPin === '1234') {
        setAddError("SECURITY VIOLATION: '1234' is a compromised default PIN and cannot be used. Enter another PIN or leave blank to auto-generate.");
        return;
      }
    }

    const formattedPhone = newPhoneNumber.trim() ? formatPhoneNumber(newPhoneNumber.trim()) : '';
    const cleanCustomPin = newCustomPin ? newCustomPin.replace(/\D/g, '').slice(0, 4) : undefined;
    
    const result = onAddAccount(
      newUsername.trim().toUpperCase(), 
      newRole, 
      empId, 
      newPermission, 
      formattedPhone, 
      cleanCustomPin,
      newStatus
    );
    
    if (result) {
      const newAccObj: RegisteredAccount = (typeof result === 'object' && result !== null) ? result : {
        username: newUsername.trim().toUpperCase(),
        role: newRole,
        employeeId: empId,
        phoneNumber: formattedPhone,
        permission: newPermission,
        pin: cleanCustomPin || (typeof result === 'object' && (result as any)?.pin) || '',
        status: newStatus
      };
      setSelectedQrAccount(newAccObj);
      resetAddForm();
    }
  };

  const handleStartEditPhone = (acc: RegisteredAccount) => {
    setEditingPhoneEmpId(acc.employeeId);
    setEditingPhoneValue(acc.phoneNumber || '');
  };

  const handleSaveQuickPhone = (acc: RegisteredAccount) => {
    const formatted = formatPhoneNumber(editingPhoneValue.trim());
    onUpdateAccount(acc.employeeId, {
      ...acc,
      phoneNumber: formatted
    });
    setEditingPhoneEmpId(null);
    setEditingPhoneValue('');
  };

  const handleCancelQuickPhone = () => {
    setEditingPhoneEmpId(null);
    setEditingPhoneValue('');
  };

  const handleQuickToggleStatus = (acc: RegisteredAccount, nextStatus: 'ACTIVE' | 'PENDING' | 'INACTIVE') => {
    if (!isSuperAdmin) return;
    onUpdateAccount(acc.employeeId, {
      ...acc,
      status: nextStatus
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;

    let cleanEmpId = (editingAccount.employeeId || '').trim().toUpperCase();
    if (cleanEmpId && !cleanEmpId.startsWith('JPMP-')) {
      cleanEmpId = `JPMP-${cleanEmpId.replace(/^EMP-/, '')}`;
    }

    const formatted = formatPhoneNumber(editingAccount.phoneNumber || '');
    const oldId = originalEmployeeId || editingAccount.employeeId;

    // CRITICAL SECURITY FIX: Profile updates do NOT modify PIN!
    // Operator PIN changes are strictly managed via the dedicated Super Admin PIN modal.
    onUpdateAccount(oldId, {
      ...editingAccount,
      employeeId: cleanEmpId,
      phoneNumber: formatted,
      status: editingAccount.status || 'ACTIVE'
    });

    setEditingAccount(null);
    setOriginalEmployeeId('');
  };

  return (
    <div className="space-y-4" id="registered-accounts-module">
      {/* Top Banner & Metric Badges matching Dashboard Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-2xl shadow-md border border-slate-800 p-5 flex flex-col gap-4 text-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1 font-bold text-[11px] uppercase tracking-wider font-mono">
              <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold font-mono px-2 py-0.5 rounded border border-indigo-500/30 flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" /> JPMP OPERATOR DIRECTORY
              </span>
              <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold font-mono px-2 py-0.5 rounded border border-emerald-500/30 flex items-center gap-1">
                <Lock className="h-3 w-3" /> SUPER ADMIN MASTER PROVISIONING
              </span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-400" /> JPMP Operator Accounts
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Centralized operator registry, role assignment, active/pending status tracking, and QR PIN security.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap justify-start xl:justify-end shrink-0">
            {/* Total Badge */}
            <div className="bg-slate-950/70 border border-slate-700/80 px-3 py-1.5 rounded-xl text-center min-w-[70px]">
              <span className="block text-[9px] font-bold text-slate-400 uppercase font-mono">Total</span>
              <span className="text-base font-extrabold text-white font-mono">{accountStats.total}</span>
            </div>

            {/* Active Badge */}
            <div className="bg-emerald-950/60 border border-emerald-500/40 px-3 py-1.5 rounded-xl text-center min-w-[70px]">
              <span className="flex items-center justify-center gap-1 text-[9px] font-bold text-emerald-400 uppercase font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
              </span>
              <span className="text-base font-extrabold text-emerald-300 font-mono">{accountStats.active}</span>
            </div>

            {/* Pending Badge */}
            <div className="bg-slate-950/70 border border-slate-700/80 px-3 py-1.5 rounded-xl text-center min-w-[70px]">
              <span className="flex items-center justify-center gap-1 text-[9px] font-bold text-slate-400 uppercase font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Pending
              </span>
              <span className="text-base font-extrabold text-slate-300 font-mono">{accountStats.pending}</span>
            </div>

            {/* Full Access Badge */}
            <div className="bg-indigo-950/60 border border-indigo-500/40 px-3 py-1.5 rounded-xl text-center min-w-[76px] hidden sm:block">
              <span className="block text-[9px] font-bold text-indigo-300 uppercase font-mono">Full Access</span>
              <span className="text-base font-extrabold text-indigo-200 font-mono">{accountStats.fullAccess}</span>
            </div>

            {isSuperAdmin && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRolesModal(true);
                    setRoleModalError('');
                    setRoleModalSuccess('');
                  }}
                  className="bg-slate-800/90 hover:bg-slate-700 active:bg-slate-800 text-indigo-300 hover:text-white border border-indigo-500/40 px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs uppercase font-mono cursor-pointer shrink-0"
                  id="btn-manage-roles"
                  title="Manage operational role definitions"
                >
                  <Tag className="h-3.5 w-3.5 text-indigo-400" />
                  <span className="whitespace-nowrap">Manage Roles</span>
                </button>
                {onOpenBackups && (
                  <button
                    type="button"
                    onClick={onOpenBackups}
                    className="bg-emerald-950/60 hover:bg-emerald-900/80 active:bg-emerald-850 text-emerald-300 hover:text-white border border-emerald-500/40 px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs uppercase font-mono cursor-pointer shrink-0"
                    id="btn-server-backups"
                    title="Automated 24h backups & disaster recovery restore"
                  >
                    <Archive className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="whitespace-nowrap">Server Backups</span>
                  </button>
                )}
                {onClearAllAccounts && (accounts.length > 1 || accounts.some(u => (u.employeeId || '').toUpperCase() !== 'JPMP-002')) && (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmAction({
                        title: "PURGE ALL OPERATOR ACCOUNTS",
                        message: "WARNING: This will permanently remove all registered operator accounts from the system. Only the root Super Administrator (ALDRIN BANAWA / JPMP-002) will remain active. Are you sure?",
                        confirmVariant: "danger",
                        confirmLabel: "YES, CLEAR ALL",
                        onConfirm: () => {
                          if (onClearAllAccounts) onClearAllAccounts();
                          setConfirmAction(null);
                        }
                      });
                    }}
                    className="bg-red-950/60 hover:bg-red-900/80 active:bg-red-800 text-red-300 border border-red-500/40 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs uppercase font-mono cursor-pointer shrink-0"
                    id="btn-clear-all-accounts"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="whitespace-nowrap">Clear All</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    resetAddForm();
                    setShowAddModal(true);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-indigo-950/40 uppercase font-mono cursor-pointer shrink-0 border border-indigo-400/30"
                  id="btn-add-account"
                >
                  <UserPlus className="h-4 w-4" />
                  <span className="whitespace-nowrap">Register Operator</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Master Authority Policy Notice */}
        <div className="bg-indigo-950/50 border border-indigo-500/30 rounded-xl px-3.5 py-2 flex items-center gap-2.5 text-xs text-indigo-100">
          <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
          <span>
            <strong className="text-amber-300 uppercase font-mono">Master Computer Authority Rule:</strong> Only operator accounts registered by Super Administrator (<span className="text-white font-semibold">ALDRIN BANAWA - JPMP-002</span>) on this computer are authorized for use across all other users and warehouse terminal computers.
          </span>
        </div>

        {/* Compromised PIN Security Warning Alert Banner */}
        {compromisedAccounts.length > 0 && (
          <div className="bg-rose-950/90 border-2 border-rose-500 rounded-xl p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-white shadow-lg shadow-rose-950/40">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-rose-600/30 border border-rose-500/50 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-rose-400 animate-pulse" />
              </div>
              <div>
                <div className="text-xs font-bold text-rose-300 font-mono tracking-wide uppercase flex items-center gap-2">
                  <span>CRITICAL SECURITY ALERT: COMPROMISED DEFAULT PIN DETECTED</span>
                  <span className="bg-rose-500 text-white text-[9px] px-2 py-0.5 rounded-full font-bold">
                    {compromisedAccounts.length} ACCOUNT{compromisedAccounts.length > 1 ? 'S' : ''}
                  </span>
                </div>
                <p className="text-xs text-rose-100 mt-0.5">
                  {compromisedAccounts.length} operator account(s) currently have the compromised default PIN (&quot;1234&quot;) or are marked as compromised. Default PINs are strictly prohibited and vulnerable. Super Admin must reset these PINs to unique credentials immediately.
                </p>
              </div>
            </div>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => handleOpenPinModal(compromisedAccounts[0])}
                className="bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-mono font-bold text-xs px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 shadow-md cursor-pointer uppercase shrink-0 self-end md:self-auto"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>Resolve PIN ({compromisedAccounts[0].username.split(' ')[0]})</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        {/* Search, Filter & Quick Actions Bar */}
        <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
          {/* Left: Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by operator name, JPMP ID, role, phone, or PIN..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8.5 pr-8 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-medium"
            />
            {searchQuery && (
              <button 
                type="button" 
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Center / Right: Filter Pills & Dropdowns */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status Filter Tabs */}
            <div className="inline-flex bg-slate-200/70 p-0.5 rounded-lg text-[11px] font-bold font-mono">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-md transition ${
                  statusFilter === 'ALL' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ALL ({accountStats.total})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 transition ${
                  statusFilter === 'ACTIVE' ? 'bg-emerald-600 text-white shadow-2xs font-bold' : 'text-emerald-700 hover:text-emerald-900'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                ACTIVE ({accountStats.active})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('PENDING')}
                className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 transition ${
                  statusFilter === 'PENDING' ? 'bg-slate-700 text-white shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                PENDING ({accountStats.pending})
              </button>
              {accountStats.inactive > 0 && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('INACTIVE')}
                  className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 transition ${
                    statusFilter === 'INACTIVE' ? 'bg-rose-700 text-white shadow-2xs font-bold' : 'text-rose-700 hover:text-rose-900'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                  INACTIVE ({accountStats.inactive})
                </button>
              )}
            </div>

            {/* Role Filter Dropdown */}
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="bg-white border border-slate-200 text-slate-700 text-[11px] font-semibold py-1.5 px-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="ALL">All Roles ({distinctRoles.length})</option>
              {distinctRoles.map(role => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>

            {/* Permission Filter Dropdown */}
            <select
              value={permissionFilter}
              onChange={e => setPermissionFilter(e.target.value)}
              className="bg-white border border-slate-200 text-slate-700 text-[11px] font-semibold py-1.5 px-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="ALL">All Permissions</option>
              <option value="FULL_ACCESS">Full Access</option>
              <option value="LIMITED_ACCESS">Limited (Edit)</option>
              <option value="VIEW_ONLY">View Only</option>
            </select>

            {/* Global Reveal PIN Toggle for Super Admin */}
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setRevealAllPins(!revealAllPins)}
                className={`p-1.5 rounded-lg border text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                  revealAllPins
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
                title={revealAllPins ? 'Hide all operator PINs' : 'Reveal all operator PINs for auditing'}
              >
                {revealAllPins ? <EyeOff className="h-3.5 w-3.5 text-amber-700" /> : <Eye className="h-3.5 w-3.5 text-slate-500" />}
                <span className="text-[10px] font-mono uppercase hidden xl:inline">
                  {revealAllPins ? 'Conceal PINs' : 'Show PINs'}
                </span>
              </button>
            )}

            {/* Reset Filters */}
            {(searchQuery || statusFilter !== 'ALL' || roleFilter !== 'ALL' || permissionFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('ALL');
                  setRoleFilter('ALL');
                  setPermissionFilter('ALL');
                }}
                className="text-xs text-rose-600 hover:text-rose-800 font-bold p-1 rounded hover:bg-rose-50 transition cursor-pointer"
                title="Reset all active search and filter constraints"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Dense / Compact Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100/80 text-slate-600 uppercase font-mono text-[10px] tracking-wider border-b border-slate-200 select-none">
                <th className="py-2.5 px-3 font-bold w-24">Status</th>
                <th className="py-2.5 px-3 font-bold">Operator & ID</th>
                <th className="py-2.5 px-3 font-bold">Operational Role</th>
                <th className="py-2.5 px-3 font-bold">Access Level</th>
                <th className="py-2.5 px-3 font-bold">Phone / Contact</th>
                <th className="py-2.5 px-3 font-bold w-28">4-Digit PIN</th>
                <th className="py-2.5 px-3 font-bold w-36">Last Active</th>
                <th className="py-2.5 px-3 font-bold text-right w-44">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <AnimatePresence mode="popLayout" initial={false}>
                {filteredAccounts.map((acc) => {
                  const isSelf = acc.employeeId === currentEmployeeId;
                  const isSuperAdminAcc = 
                    (acc.employeeId || '').toUpperCase() === 'JPMP-002' || 
                    (acc.username || '').toUpperCase().includes('ALDRIN BANAWA') ||
                    (acc.username || '').toUpperCase() === 'SUPER ADMIN';
                  
                  const currentStatus = acc.status || 'ACTIVE';
                  const isPinVisible = revealAllPins || !!showPins[acc.employeeId];
                  const isCompromisedAcc = acc.pin === '1234' || !!acc.isPinCompromised;

                  return (
                    <motion.tr 
                      key={acc.employeeId} 
                      layout
                      initial={{ opacity: 0, y: 8, scale: 0.99 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96, x: -16, transition: { duration: 0.2 } }}
                      transition={{
                        layout: { type: 'spring', stiffness: 350, damping: 28 },
                        opacity: { duration: 0.22 }
                      }}
                      className={`hover:bg-slate-50/90 transition-colors group ${
                        isCompromisedAcc
                          ? 'bg-rose-50/40 border-l-4 border-l-rose-500'
                          : isSelf
                          ? 'bg-indigo-50/30'
                          : ''
                      }`}
                    >
                      {/* 1. Status Indicator */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {isSuperAdmin ? (
                          <div className="relative inline-block">
                            <select
                              value={currentStatus}
                              onChange={(e) => handleQuickToggleStatus(acc, e.target.value as 'ACTIVE' | 'PENDING' | 'INACTIVE')}
                              className={`text-[10px] font-bold font-mono uppercase px-2 py-0.5 rounded-full border cursor-pointer focus:outline-none transition-colors ${
                                currentStatus === 'ACTIVE'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                                  : currentStatus === 'PENDING'
                                  ? 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100'
                              }`}
                              title="Click to toggle operator status (Active / Pending / Inactive)"
                            >
                              <option value="ACTIVE">● ACTIVE</option>
                              <option value="PENDING">○ PENDING</option>
                              <option value="INACTIVE">⊘ INACTIVE</option>
                            </select>
                          </div>
                        ) : (
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase border ${
                            currentStatus === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : currentStatus === 'PENDING'
                              ? 'bg-slate-100 text-slate-600 border-slate-300'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${
                              currentStatus === 'ACTIVE' ? 'bg-emerald-500 animate-pulse' : currentStatus === 'PENDING' ? 'bg-slate-400' : 'bg-rose-500'
                            }`} />
                            {currentStatus}
                          </span>
                        )}
                      </td>

                      {/* 2. Operator Name & Employee ID */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className={`h-7 w-7 rounded-lg flex items-center justify-center font-bold text-xs uppercase shrink-0 border ${
                            isSuperAdminAcc 
                              ? 'bg-indigo-600 text-white border-indigo-700' 
                              : isCompromisedAcc
                              ? 'bg-rose-100 text-rose-700 border-rose-300'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}>
                            {acc.username.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-900 uppercase text-xs truncate">
                                {acc.username}
                              </span>
                              {isSuperAdminAcc && (
                                <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-800 border border-amber-300 text-[8px] px-1.5 py-0.2 rounded font-mono font-bold uppercase shrink-0" title="Primary Super Administrator Root Account">
                                  🔒 ROOT
                                </span>
                              )}
                              {isSelf && (
                                <span className="inline-block bg-indigo-100 text-indigo-700 text-[8px] px-1.5 py-0.2 rounded font-mono font-bold uppercase shrink-0">
                                  You
                                </span>
                              )}
                              {isCompromisedAcc && (
                                <span className="inline-flex items-center gap-0.5 bg-rose-100 text-rose-800 border border-rose-300 text-[8px] px-1.5 py-0.2 rounded font-mono font-bold uppercase shrink-0" title="This account has a compromised default PIN (1234)">
                                  ⚠️ COMPROMISED PIN
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-[11px] font-mono font-bold text-indigo-600">
                              <span>{acc.employeeId}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(acc.employeeId, `id-${acc.employeeId}`)}
                                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-indigo-600 transition p-0.5"
                                title="Copy Employee ID"
                              >
                                {copiedId === `id-${acc.employeeId}` ? (
                                  <Check className="h-3 w-3 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="inline-flex items-center gap-0.5 text-[8.5px] font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-1 py-0.2 rounded" title="Registered & authorized by Super Administrator (ALDRIN BANAWA) on master computer">
                                <ShieldCheck className="h-2.5 w-2.5 text-emerald-600" /> Super Admin Authorized
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 3. Operational Role */}
                      <td className="py-2.5 px-3 font-semibold text-slate-700 uppercase text-[11px]">
                        <span className="bg-slate-100/90 text-slate-800 border border-slate-200/80 px-2 py-0.5 rounded-md inline-block max-w-[200px] truncate">
                          {acc.role || 'WAREHOUSE CLERK'}
                        </span>
                      </td>

                      {/* 4. Access Permission Level */}
                      <td className="py-2.5 px-3">
                        {acc.permission === 'FULL_ACCESS' ? (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase whitespace-nowrap">
                            <Unlock className="h-3 w-3" /> FULL ACCESS
                          </span>
                        ) : acc.permission === 'LIMITED_ACCESS' ? (
                          <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase whitespace-nowrap">
                            <Edit3 className="h-3 w-3" /> LIMITED (EDIT)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase whitespace-nowrap">
                            <Lock className="h-3 w-3" /> VIEW ONLY
                          </span>
                        )}
                      </td>

                      {/* 5. Phone / Contact */}
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                        {editingPhoneEmpId === acc.employeeId ? (
                          <div className="flex items-center gap-1 animate-in fade-in duration-100">
                            <input
                              type="tel"
                              autoFocus
                              placeholder="0917 123 4567"
                              value={editingPhoneValue}
                              onChange={e => setEditingPhoneValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveQuickPhone(acc);
                                } else if (e.key === 'Escape') {
                                  handleCancelQuickPhone();
                                }
                              }}
                              className="w-32 px-2 py-0.5 bg-white border-2 border-indigo-500 rounded text-xs font-mono font-bold text-slate-900 focus:outline-none shadow-xs"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveQuickPhone(acc)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white p-1 rounded text-xs transition cursor-pointer"
                              title="Save"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelQuickPhone}
                              className="bg-slate-200 hover:bg-slate-300 text-slate-700 p-1 rounded text-xs transition cursor-pointer"
                              title="Cancel"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group/phone">
                            {acc.phoneNumber ? (
                              <span 
                                onClick={() => isSuperAdmin && handleStartEditPhone(acc)}
                                className={`inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 ${isSuperAdmin ? 'hover:text-indigo-600 cursor-pointer' : ''}`}
                                title={isSuperAdmin ? 'Click to edit phone number' : undefined}
                              >
                                <Phone className="h-3 w-3 text-emerald-600 shrink-0" />
                                <span>{acc.phoneNumber}</span>
                              </span>
                            ) : (
                              <span 
                                onClick={() => isSuperAdmin && handleStartEditPhone(acc)}
                                className={`text-[10px] text-slate-400 italic ${isSuperAdmin ? 'hover:text-indigo-600 hover:underline cursor-pointer' : ''}`}
                                title={isSuperAdmin ? 'Click to add phone number' : undefined}
                              >
                                + Add Phone
                              </span>
                            )}
                            {isSuperAdmin && acc.phoneNumber && (
                              <button
                                type="button"
                                onClick={() => handleStartEditPhone(acc)}
                                className="opacity-0 group-hover/phone:opacity-100 p-0.5 text-slate-400 hover:text-indigo-600 transition"
                                title="Edit Phone"
                              >
                                <Edit className="h-2.5 w-2.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 6. 4-Digit Security PIN */}
                      <td className="py-2.5 px-3 font-mono">
                        {isCompromisedAcc ? (
                          <div className="flex flex-col gap-1 items-start">
                            <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-800 border border-rose-300 px-1.5 py-0.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider">
                              <AlertTriangle className="h-3 w-3 text-rose-600 shrink-0" />
                              <span>COMPROMISED (1234)</span>
                            </span>
                            {isSuperAdmin && (
                              <button
                                type="button"
                                onClick={() => handleOpenPinModal(acc)}
                                className="inline-flex items-center gap-1 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-mono font-bold text-[9px] px-2 py-0.5 rounded transition cursor-pointer shadow-2xs uppercase"
                                title="Reset compromised PIN to secure PIN"
                              >
                                <KeyRound className="h-2.5 w-2.5" />
                                <span>RESET PIN</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="tracking-widest bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-slate-800 text-[11px] font-bold">
                              {isPinVisible ? (acc.pin || '••••') : '••••'}
                            </span>
                            {isSuperAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => toggleShowPin(acc.employeeId)}
                                  className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                                  title={isPinVisible ? 'Hide PIN' : 'Reveal PIN'}
                                >
                                  {isPinVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                </button>
                                {isPinVisible && acc.pin && (
                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(acc.pin, `pin-${acc.employeeId}`)}
                                    className="text-slate-400 hover:text-indigo-600 p-0.5 cursor-pointer"
                                    title="Copy PIN"
                                  >
                                    {copiedId === `pin-${acc.employeeId}` ? (
                                      <Check className="h-3 w-3 text-emerald-600" />
                                    ) : (
                                      <Copy className="h-3 w-3" />
                                    )}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleOpenPinModal(acc)}
                                  className="text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 p-0.5 rounded cursor-pointer transition ml-0.5"
                                  title="Super Admin PIN Edit"
                                >
                                  <KeyRound className="h-3 w-3" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 7. Last Active */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {acc.lastActive ? (() => {
                          const { display, time, isRecent, full } = formatLastActive(acc.lastActive);
                          return (
                            <div className="flex items-center gap-1.5" title={`Last Active: ${full}`}>
                              <Clock className={`h-3.5 w-3.5 shrink-0 ${isRecent ? 'text-emerald-500' : 'text-slate-400'}`} />
                              <div className="flex flex-col leading-tight">
                                <span className={`font-mono text-[11px] font-bold ${isRecent ? 'text-emerald-700' : 'text-slate-700'}`}>
                                  {display}
                                </span>
                                {time && (
                                  <span className="font-mono text-[9px] text-slate-400">
                                    {time}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })() : (
                          <div className="flex items-center gap-1 text-slate-400" title="No successful login recorded yet">
                            <Clock className="h-3 w-3 text-slate-300 shrink-0" />
                            <span className="text-[10px] font-mono italic">
                              Never
                            </span>
                          </div>
                        )}
                      </td>

                      {/* 8. Action Controls */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* QR Badge Button */}
                          <button
                            type="button"
                            onClick={() => setSelectedQrAccount(acc)}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 px-2 py-1 rounded-md text-[10px] font-bold transition flex items-center gap-1 cursor-pointer font-mono shadow-2xs"
                            title="View & Print Login QR Code Badge"
                          >
                            <QrCode className="h-3 w-3 text-indigo-600" />
                            <span>QR PASS</span>
                          </button>

                          {/* Edit Button */}
                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAccount({ ...acc });
                                setOriginalEmployeeId(acc.employeeId);
                              }}
                              className="bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 px-2 py-1 rounded-md text-[10px] font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs"
                              title="Edit Operator Information & Access"
                            >
                              <Edit className="h-3 w-3 text-slate-600" />
                              <span className="hidden sm:inline">EDIT</span>
                            </button>
                          )}

                          {/* Super Admin Explicit PIN Management Button */}
                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={() => handleOpenPinModal(acc)}
                              className={`${
                                isCompromisedAcc
                                  ? 'bg-rose-100 hover:bg-rose-200 text-rose-700 border-rose-300'
                                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200/80'
                              } border px-2 py-1 rounded-md text-[10px] font-bold transition flex items-center gap-1 cursor-pointer font-mono shadow-2xs`}
                              title={isCompromisedAcc ? "Reset Compromised PIN (1234)" : "Edit Security PIN"}
                            >
                              <KeyRound className="h-3 w-3" />
                              <span className="hidden sm:inline">{isCompromisedAcc ? 'RESET PIN' : 'PIN'}</span>
                            </button>
                          )}

                          {/* Delete Button */}
                          {isSuperAdmin && !isSuperAdminAcc && (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmAction({
                                  title: 'Delete Operator Account',
                                  message: `Are you sure you want to permanently delete the account for ${acc.username} (${acc.employeeId})? This action will sync across all terminals.`,
                                  confirmLabel: 'YES, DELETE ACCOUNT',
                                  confirmVariant: 'danger',
                                  onConfirm: () => onRemoveAccount(acc.employeeId)
                                });
                              }}
                              className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-1.5 py-1 rounded-md text-[10px] font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs"
                              title="Delete Account"
                            >
                              <Trash2 className="h-3 w-3 text-rose-600" />
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}

                {filteredAccounts.length === 0 && (
                  <motion.tr
                    key="empty-accounts-state"
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <td colSpan={8} className="py-12 px-4 text-center">
                      <div className="max-w-xs mx-auto space-y-2 text-slate-400">
                        <Users className="h-8 w-8 mx-auto text-slate-300" />
                        <p className="text-xs font-semibold text-slate-600">
                          No operator accounts match your filter criteria.
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Try resetting your search query or adjusting status / role filters.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setStatusFilter('ALL');
                            setRoleFilter('ALL');
                            setPermissionFilter('ALL');
                          }}
                          className="mt-2 text-xs font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
                        >
                          Clear all filters
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Table Footer Count Summary */}
        <div className="p-3 bg-slate-50 border-t border-slate-200/80 flex justify-between items-center text-[11px] text-slate-500 font-semibold">
          <div>
            Showing <span className="font-mono font-bold text-slate-800">{filteredAccounts.length}</span> of <span className="font-mono font-bold text-slate-800">{accounts.length}</span> registered operators
          </div>
          <div className="text-[10px] text-slate-400 font-mono hidden sm:block">
            {accountStats.active} Active • {accountStats.pending} Pending • {accountStats.inactive} Inactive
          </div>
        </div>
      </div>

      {/* Modal: Add New Operator Account */}
      {showAddModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full flex flex-col max-h-[calc(100vh-2rem)] my-auto overflow-hidden text-left relative">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/70 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600 border border-indigo-100/80">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-bold text-base text-slate-900">
                    Register JPMP WMS Account
                  </h4>
                  <p className="text-xs text-slate-500">
                    Provision operator credentials, status, and floor permissions
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={resetAddForm}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleRegisterAccount} className="overflow-y-auto flex-1 p-6 space-y-4 text-xs">
              {/* Master Computer Authority Rule Notice */}
              <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3.5 rounded-xl flex items-start gap-3 shadow-xs">
                <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <span className="font-bold font-mono uppercase text-amber-950 block mb-0.5">Master Authorization Notice:</span>
                  Accounts registered here by Super Administrator (<strong className="font-semibold text-slate-900">ALDRIN BANAWA - JPMP-002</strong>) will be securely distributed and authorized for sign-in by operators across all other terminals and computers.
                </div>
              </div>

              {/* Error Notification */}
              {addError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3.5 rounded-xl flex items-start gap-2.5 animate-in fade-in">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
                  <span className="font-medium">{addError}</span>
                </div>
              )}

              {/* Full Name */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                  Full Name / Operator Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="E.G. MARIA SANTOS"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value.toUpperCase())}
                  className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none uppercase font-semibold text-slate-800 text-xs bg-white"
                />
              </div>

              {/* Employee ID & Phone Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                    Employee ID / Register ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="E.G. JPMP-005"
                    value={newEmployeeId}
                    onChange={e => setNewEmployeeId(e.target.value.toUpperCase())}
                    className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono font-bold uppercase text-slate-800 text-xs bg-white"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block font-mono">
                    Auto-prefixed with JPMP-
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                    Mobile Phone Number <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Phone className="h-4 w-4 text-indigo-500" />
                    </div>
                    <input
                      type="tel"
                      placeholder="e.g. 0917 123 4567"
                      value={newPhoneNumber}
                      onChange={e => setNewPhoneNumber(e.target.value)}
                      className="w-full pl-9.5 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono font-bold text-slate-800 text-xs bg-white"
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block font-mono">
                    For direct mobile directory contact
                  </span>
                </div>
              </div>

              {/* Operational Role & Initial Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono">
                      Operational Role <span className="text-rose-500">*</span>
                    </label>
                    {isSuperAdmin && !showAddInlineRole && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddInlineRole(true);
                          setAddInlineRoleInput('');
                        }}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-0.5 hover:underline cursor-pointer"
                      >
                        <Plus className="h-3 w-3" /> Add role
                      </button>
                    )}
                  </div>

                  {showAddInlineRole ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        autoFocus
                        placeholder="ENTER NEW ROLE..."
                        value={addInlineRoleInput}
                        onChange={e => setAddInlineRoleInput(e.target.value.toUpperCase())}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const added = handleAddManagedRole(addInlineRoleInput);
                            if (added) {
                              setNewRole(added);
                              setShowAddInlineRole(false);
                              setAddInlineRoleInput('');
                            }
                          } else if (e.key === 'Escape') {
                            setShowAddInlineRole(false);
                          }
                        }}
                        className="flex-1 border border-indigo-300 px-3 py-2 rounded-xl focus:ring-2 focus:ring-indigo-500 uppercase font-semibold text-slate-800 bg-indigo-50/40 text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const added = handleAddManagedRole(addInlineRoleInput);
                          if (added) {
                            setNewRole(added);
                            setShowAddInlineRole(false);
                            setAddInlineRoleInput('');
                          }
                        }}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
                        title="Save & select role"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddInlineRole(false)}
                        className="bg-slate-200 hover:bg-slate-300 text-slate-700 p-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0"
                        title="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <select
                      value={newRole}
                      onChange={e => {
                        if (e.target.value === '__ADD_NEW_ROLE__') {
                          setShowAddInlineRole(true);
                          setAddInlineRoleInput('');
                        } else {
                          setNewRole(e.target.value);
                        }
                      }}
                      className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none uppercase font-semibold text-slate-800 bg-white text-xs cursor-pointer"
                    >
                      {addDropdownRoles.map(role => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                      {isSuperAdmin && (
                        <option value="__ADD_NEW_ROLE__" className="text-indigo-600 font-bold bg-indigo-50">
                          + Add new role...
                        </option>
                      )}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                    Initial Account Status <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newStatus}
                    onChange={e => setNewStatus(e.target.value as 'ACTIVE' | 'PENDING' | 'INACTIVE')}
                    className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-bold uppercase text-slate-800 bg-white font-mono text-xs"
                  >
                    <option value="ACTIVE">ACTIVE (Ready)</option>
                    <option value="PENDING">PENDING (Verification)</option>
                    <option value="INACTIVE">INACTIVE (Suspended)</option>
                  </select>
                </div>
              </div>

              {/* Permission & PIN */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                    Access Permission Level <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newPermission}
                    onChange={e => setNewPermission(e.target.value)}
                    className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-bold uppercase text-slate-800 bg-white text-xs"
                  >
                    <option value="LIMITED_ACCESS">LIMITED (Create & Edit)</option>
                    <option value="FULL_ACCESS">FULL (Full Access)</option>
                    <option value="VIEW_ONLY">VIEW ONLY (Read Only)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                    Custom 4-Digit PIN <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <KeyRound className="h-4 w-4 text-indigo-500" />
                    </div>
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="e.g. 8492 (Optional)"
                      value={newCustomPin}
                      onChange={e => setNewCustomPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      className="w-full pl-9.5 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono font-bold text-slate-800 tracking-widest text-xs bg-white"
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block font-mono">
                    Leave blank to auto-generate PIN
                  </span>
                </div>
              </div>

              {/* Multi-PC Sync Info Notice */}
              <div className="bg-slate-50 border border-slate-200/80 p-3.5 rounded-xl text-slate-600 flex items-start gap-3">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  <strong className="text-slate-800 font-bold">Multi-PC Sync:</strong> The operator account will be registered immediately and synchronized to all active workstations and cloud databases.
                </p>
              </div>

              {/* Sticky / Fixed Footer Buttons */}
              <div className="flex justify-end gap-3 text-xs font-semibold pt-4 border-t border-slate-100 shrink-0">
                <button 
                  type="button"
                  onClick={resetAddForm}
                  className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition cursor-pointer font-bold"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md font-bold uppercase transition flex items-center gap-2 cursor-pointer"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>Register Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Edit Existing Account */}
      {editingAccount && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full flex flex-col max-h-[calc(100vh-2rem)] my-auto overflow-hidden text-left relative">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/70 shrink-0">
              <div>
                <h4 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <Edit className="h-4 w-4 text-indigo-600" /> Edit Registered Account ({editingAccount.employeeId})
                </h4>
                <p className="text-xs text-slate-500">Super Admin Credentials & Status Management</p>
              </div>
              <button 
                type="button"
                onClick={() => setEditingAccount(null)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="overflow-y-auto flex-1 p-6 space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                  Full Name / Operator Name
                </label>
                <input
                  type="text"
                  required
                  value={editingAccount.username}
                  onChange={e => setEditingAccount({ ...editingAccount, username: e.target.value.toUpperCase() })}
                  className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 uppercase font-semibold text-slate-800 text-xs bg-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                    Employee ID
                  </label>
                  <input
                    type="text"
                    required
                    value={editingAccount.employeeId}
                    disabled={editingAccount.employeeId === 'JPMP-002'}
                    onChange={e => setEditingAccount({ ...editingAccount, employeeId: e.target.value.toUpperCase() })}
                    className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono font-bold uppercase disabled:bg-slate-100 disabled:text-slate-500 text-slate-800 text-xs bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                    Account Status
                  </label>
                  <select
                    value={editingAccount.status || 'ACTIVE'}
                    onChange={e => setEditingAccount({ ...editingAccount, status: e.target.value as 'ACTIVE' | 'PENDING' | 'INACTIVE' })}
                    className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono font-bold uppercase text-slate-800 bg-white text-xs"
                  >
                    <option value="ACTIVE">ACTIVE (Ready)</option>
                    <option value="PENDING">PENDING (Verification)</option>
                    <option value="INACTIVE">INACTIVE (Suspended)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                  Registered Mobile Phone Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Phone className="h-4 w-4 text-indigo-500" />
                  </div>
                  <input
                    type="tel"
                    placeholder="e.g. +63 917 123 4567"
                    value={editingAccount.phoneNumber || ''}
                    onChange={e => setEditingAccount({ ...editingAccount, phoneNumber: e.target.value })}
                    className="w-full pl-9.5 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono font-semibold text-slate-800 text-xs bg-white"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono">
                    Operational Role
                  </label>
                  {isSuperAdmin && !showEditInlineAddRole && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditInlineAddRole(true);
                        setEditInlineRoleInput('');
                      }}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-0.5 hover:underline cursor-pointer"
                    >
                      <Plus className="h-3 w-3" /> Add role
                    </button>
                  )}
                </div>

                {showEditInlineAddRole ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      placeholder="ENTER NEW ROLE..."
                      value={editInlineRoleInput}
                      onChange={e => setEditInlineRoleInput(e.target.value.toUpperCase())}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const added = handleAddManagedRole(editInlineRoleInput);
                          if (added) {
                            setEditingAccount({ ...editingAccount, role: added });
                            setShowEditInlineAddRole(false);
                            setEditInlineRoleInput('');
                          }
                        } else if (e.key === 'Escape') {
                          setShowEditInlineAddRole(false);
                        }
                      }}
                      className="flex-1 border border-indigo-300 px-3 py-2 rounded-xl focus:ring-2 focus:ring-indigo-500 uppercase font-semibold text-slate-800 bg-indigo-50/40 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const added = handleAddManagedRole(editInlineRoleInput);
                        if (added) {
                          setEditingAccount({ ...editingAccount, role: added });
                          setShowEditInlineAddRole(false);
                          setEditInlineRoleInput('');
                        }
                      }}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
                      title="Save & select role"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowEditInlineAddRole(false)}
                      className="bg-slate-200 hover:bg-slate-300 text-slate-700 p-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0"
                      title="Cancel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <select
                    value={editingAccount.role}
                    onChange={e => {
                      if (e.target.value === '__ADD_NEW_ROLE__') {
                        setShowEditInlineAddRole(true);
                        setEditInlineRoleInput('');
                      } else {
                        setEditingAccount({ ...editingAccount, role: e.target.value });
                      }
                    }}
                    className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 uppercase font-semibold text-slate-800 bg-white text-xs cursor-pointer"
                  >
                    {editDropdownRoles.map(role => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                    {isSuperAdmin && (
                      <option value="__ADD_NEW_ROLE__" className="text-indigo-600 font-bold bg-indigo-50">
                        + Add new role...
                      </option>
                    )}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                  Access Permission Level
                </label>
                <select
                  value={editingAccount.permission || 'LIMITED_ACCESS'}
                  onChange={e => setEditingAccount({ ...editingAccount, permission: e.target.value })}
                  className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 font-bold uppercase text-slate-800 bg-white text-xs"
                >
                  <option value="LIMITED_ACCESS">LIMITED (Create & Edit)</option>
                  <option value="FULL_ACCESS">FULL (Full Access)</option>
                  <option value="VIEW_ONLY">VIEW ONLY (Read Only)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                  Reset 4-Digit Security PIN
                </label>
                <input
                  type="text"
                  maxLength={4}
                  pattern="\d*"
                  required
                  value={editingAccount.pin || ''}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setEditingAccount({ ...editingAccount, pin: digits });
                  }}
                  className="w-full border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono font-bold tracking-widest text-center text-slate-800 text-xs bg-white"
                />
              </div>

              <div className="flex justify-end gap-3 text-xs font-semibold pt-4 border-t border-slate-100 shrink-0">
                <button 
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition cursor-pointer font-bold"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-md font-bold uppercase transition cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* QR Code Login Badge Modal */}
      {selectedQrAccount && (
        <AccountQRBadgeModal
          account={selectedQrAccount}
          isOpen={!!selectedQrAccount}
          onClose={() => setSelectedQrAccount(null)}
        />
      )}

      {/* Confirmation Modal with YES / NO options */}
      <ConfirmModal config={confirmAction} onClose={() => setConfirmAction(null)} />

      {/* Super Admin Explicit PIN Management & Reset Modal */}
      {pinChangeAccount && isSuperAdmin && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 z-[999999]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-xl ${
                  pinChangeAccount.pin === '1234' || pinChangeAccount.isPinCompromised
                    ? 'bg-rose-500/20 border-rose-400/30 text-rose-300'
                    : 'bg-indigo-500/20 border-indigo-400/30 text-indigo-300'
                } border flex items-center justify-center`}>
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold tracking-tight">
                      {pinChangeAccount.pin === '1234' || pinChangeAccount.isPinCompromised
                        ? 'RESOLVE COMPROMISED PIN'
                        : 'SUPER ADMIN PIN UPDATE'}
                    </h3>
                    <span className="bg-indigo-500/30 text-indigo-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border border-indigo-400/30">
                      STRICT AUDIT
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Target: <strong className="text-white uppercase">{pinChangeAccount.username}</strong> ({pinChangeAccount.employeeId})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPinChangeAccount(null);
                  setPinChangeError('');
                  setPinChangeSuccess('');
                }}
                className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body Form */}
            <form onSubmit={handleSubmitPinChange} className="p-6 space-y-4 overflow-y-auto">
              {/* Compromised Alert Warning */}
              {(pinChangeAccount.pin === '1234' || pinChangeAccount.isPinCompromised) && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-semibold uppercase text-rose-900 font-mono text-[11px]">Compromised Default PIN Detected:</strong>
                    This account was assigned the prohibited default PIN &quot;1234&quot;. Please assign a secure 4-6 digit numeric PIN to clear the security alert and protect account integrity.
                  </div>
                </div>
              )}

              {/* Error & Success Messages */}
              {pinChangeError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="font-semibold">{pinChangeError}</span>
                </div>
              )}
              {pinChangeSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="font-semibold">{pinChangeSuccess}</span>
                </div>
              )}

              {/* Operator Summary Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono block">Operator Details</span>
                  <span className="text-xs font-bold text-slate-800">{pinChangeAccount.username}</span>
                  <span className="text-[11px] font-mono text-indigo-600 block">{pinChangeAccount.employeeId}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono block">Role</span>
                  <span className="text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded">
                    {pinChangeAccount.role || 'WAREHOUSE CLERK'}
                  </span>
                </div>
              </div>

              {/* New PIN & Confirm PIN */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase font-mono mb-1.5">
                    New Security PIN <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={6}
                      autoFocus
                      required
                      placeholder="4 to 6 digits"
                      value={newPinValue}
                      onChange={e => setNewPinValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono font-bold text-slate-800 tracking-widest text-sm bg-white"
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block font-mono">
                    4-6 numeric digits (no &quot;1234&quot;)
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase font-mono mb-1.5">
                    Confirm New PIN <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    required
                    placeholder="Repeat new PIN"
                    value={confirmPinValue}
                    onChange={e => setConfirmPinValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono font-bold text-slate-800 tracking-widest text-sm bg-white"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block font-mono">
                    Must match new PIN
                  </span>
                </div>
              </div>

              {/* Super Admin Authorization PIN */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase font-mono mb-1.5 flex items-center justify-between">
                  <span>Super Admin Confirmation PIN (0423) <span className="text-rose-500">*</span></span>
                  <span className="text-[10px] text-indigo-600 font-semibold lowercase">authorization step</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="h-4 w-4 text-indigo-600" />
                  </div>
                  <input
                    type="password"
                    maxLength={6}
                    required
                    placeholder="Enter Master Super Admin PIN (0423)"
                    value={superAdminPinValue}
                    onChange={e => setSuperAdminPinValue(e.target.value.trim())}
                    className="w-full pl-9.5 pr-3.5 py-2.5 border-2 border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none font-mono font-bold text-slate-800 tracking-widest text-xs bg-indigo-50/20"
                  />
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block font-mono">
                  Super Admin authorization is required by server security policy.
                </span>
              </div>

              {/* Change Reason Note */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase font-mono mb-1.5">
                  Security Audit Reason / Note
                </label>
                <input
                  type="text"
                  placeholder="e.g. Resolving compromised default PIN"
                  value={pinChangeReason}
                  onChange={e => setPinChangeReason(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-xs text-slate-800 bg-white"
                />
              </div>

              {/* Audit Notice */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-500 flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Server Security Policy:</strong> PIN changes are committed directly to the central database and recorded in the permanent audit log (timestamp, administrator ID, target operator, terminal IP).
                </span>
              </div>

              {/* Modal Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPinChangeAccount(null);
                    setPinChangeError('');
                    setPinChangeSuccess('');
                  }}
                  disabled={isSubmittingPinChange}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer font-mono uppercase"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPinChange}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold uppercase transition flex items-center gap-2 shadow-md cursor-pointer font-mono disabled:opacity-50"
                >
                  {isSubmittingPinChange ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Verifying & Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Confirm & Update PIN</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Manage Operational Roles Modal (Super Admin only) */}
      {showRolesModal && isSuperAdmin && createPortal(
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-[999999]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                  <Tag className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold tracking-tight">MANAGE OPERATIONAL ROLES</h3>
                    <span className="bg-indigo-500/30 text-indigo-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border border-indigo-400/30">
                      {managedRoles.length} ROLES
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Centralized role definitions synced across all devices & operator forms
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowRolesModal(false);
                  setEditingRoleOriginal(null);
                  setRoleModalError('');
                  setRoleModalSuccess('');
                  setRoleSearchQuery('');
                }}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-white/10 transition cursor-pointer"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Alert / Notification banners */}
              {roleModalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2 animate-fadeIn font-semibold">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                  <span>{roleModalError}</span>
                </div>
              )}
              {roleModalSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex items-center gap-2 animate-fadeIn font-semibold">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{roleModalSuccess}</span>
                </div>
              )}

              {/* Add New Role Form */}
              <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
                <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5">
                  Create New Operational Role
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="E.G. LOGISTICS COORDINATOR, QC LEAD..."
                    value={newRoleInput}
                    onChange={e => {
                      setNewRoleInput(e.target.value.toUpperCase());
                      setRoleModalError('');
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddManagedRole();
                      }
                    }}
                    className="flex-1 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 uppercase font-semibold text-slate-800 bg-white text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddManagedRole()}
                    className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer uppercase font-mono"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add Role</span>
                  </button>
                </div>
              </div>

              {/* Search filter for roles */}
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="FILTER ROLES LIST..."
                  value={roleSearchQuery}
                  onChange={e => setRoleSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-xs font-mono uppercase bg-slate-50/50"
                />
              </div>

              {/* Roles List */}
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[280px] overflow-y-auto bg-white shadow-inner">
                {managedRoles
                  .filter(r => !roleSearchQuery || r.toLowerCase().includes(roleSearchQuery.toLowerCase()))
                  .map(role => {
                    const assignedCount = accounts.filter(a => (a.role || '').toUpperCase().trim() === role.toUpperCase().trim()).length;
                    const isEditing = editingRoleOriginal === role;

                    return (
                      <div key={role} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50/80 transition-colors">
                        {isEditing ? (
                          <div className="flex-1 flex items-center gap-2">
                            <input
                              type="text"
                              autoFocus
                              value={editingRoleNewValue}
                              onChange={e => setEditingRoleNewValue(e.target.value.toUpperCase())}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleRenameManagedRole(role, editingRoleNewValue);
                                } else if (e.key === 'Escape') {
                                  setEditingRoleOriginal(null);
                                }
                              }}
                              className="flex-1 border border-indigo-300 px-3 py-1.5 rounded-lg focus:ring-2 focus:ring-indigo-500 uppercase font-semibold text-slate-800 bg-indigo-50/30 text-xs font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => handleRenameManagedRole(role, editingRoleNewValue)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white p-1.5 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer shrink-0"
                              title="Save rename"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingRoleOriginal(null)}
                              className="bg-slate-200 hover:bg-slate-300 text-slate-700 p-1.5 rounded-lg text-xs font-bold transition cursor-pointer shrink-0"
                              title="Cancel"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
                              <span className="font-mono font-bold text-xs text-slate-800 uppercase truncate">
                                {role}
                              </span>
                              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold shrink-0 ${
                                assignedCount > 0 
                                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' 
                                  : 'bg-slate-100 text-slate-500'
                              }`}>
                                {assignedCount} {assignedCount === 1 ? 'account' : 'accounts'}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRoleOriginal(role);
                                  setEditingRoleNewValue(role);
                                  setRoleModalError('');
                                }}
                                className="text-slate-500 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50 transition cursor-pointer"
                                title={`Rename ${role}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteManagedRole(role)}
                                className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                                title={`Delete ${role}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                {managedRoles.filter(r => !roleSearchQuery || r.toLowerCase().includes(roleSearchQuery.toLowerCase())).length === 0 && (
                  <div className="p-6 text-center text-slate-400 text-xs font-mono">
                    No matching roles found.
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={handleResetRolesToDefaults}
                className="text-xs text-slate-500 hover:text-slate-800 font-mono font-bold flex items-center gap-1.5 hover:underline cursor-pointer"
                title="Restore default factory roles list"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset Defaults
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRolesModal(false);
                  setEditingRoleOriginal(null);
                  setRoleModalError('');
                  setRoleModalSuccess('');
                  setRoleSearchQuery('');
                }}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase transition shadow-xs cursor-pointer font-mono"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
