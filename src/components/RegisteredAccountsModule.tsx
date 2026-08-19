import React, { useState, useMemo } from 'react';
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
  Filter, 
  RefreshCw, 
  Copy, 
  CheckCircle2, 
  Clock, 
  CircleDot,
  User,
  ShieldAlert
} from 'lucide-react';
import AccountQRBadgeModal from './AccountQRBadgeModal';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';
import { RegisteredAccount } from '../types';
export type { RegisteredAccount };

interface RegisteredAccountsModuleProps {
  accounts: RegisteredAccount[];
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
  currentUser: string;
  currentEmployeeId: string;
  isSuperAdmin?: boolean;
}

export default function RegisteredAccountsModule({
  accounts,
  onAddAccount,
  onUpdateAccount,
  onRemoveAccount,
  currentUser,
  currentEmployeeId,
  isSuperAdmin = false
}: RegisteredAccountsModuleProps) {
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

  // Quick inline phone edit state
  const [editingPhoneEmpId, setEditingPhoneEmpId] = useState<string | null>(null);
  const [editingPhoneValue, setEditingPhoneValue] = useState<string>('');

  // New Account Registration Form state
  const [newUsername, setNewUsername] = useState('');
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [newCustomPin, setNewCustomPin] = useState('');
  const [newRole, setNewRole] = useState('WAREHOUSE CLERK');
  const [newPermission, setNewPermission] = useState('LIMITED_ACCESS');
  const [newStatus, setNewStatus] = useState<'ACTIVE' | 'PENDING' | 'INACTIVE'>('ACTIVE');
  const [addError, setAddError] = useState<string>('');

  // Distinct roles available in system for filter dropdown
  const distinctRoles = useMemo(() => {
    const roles = new Set<string>();
    accounts.forEach(a => {
      if (a.role) roles.add(a.role.toUpperCase());
    });
    return Array.from(roles).sort();
  }, [accounts]);

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

    if (newCustomPin && newCustomPin.length !== 4) {
      setAddError('Custom Security PIN must be exactly 4 digits.');
      return;
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
        pin: cleanCustomPin || '1234',
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

    const cleanPin = (editingAccount.pin || '1234').replace(/\D/g, '').slice(0, 4);
    if (cleanPin.length < 4) {
      alert('Security PIN must be exactly 4 digits.');
      return;
    }

    const formatted = formatPhoneNumber(editingAccount.phoneNumber || '');
    const oldId = originalEmployeeId || editingAccount.employeeId;

    onUpdateAccount(oldId, {
      ...editingAccount,
      employeeId: cleanEmpId,
      phoneNumber: formatted,
      pin: cleanPin,
      status: editingAccount.status || 'ACTIVE'
    });

    setEditingAccount(null);
    setOriginalEmployeeId('');
  };

  return (
    <div className="space-y-4" id="registered-accounts-module">
      {/* Top Banner & Metric Badges */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 mb-1 font-bold text-[11px] uppercase tracking-wider font-mono">
            <ShieldCheck className="h-4 w-4" /> JPMP Operator Directory & Access Control
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" /> JPMP Operator Accounts
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Centralized operator registry, role assignment, active/pending status tracking, and QR PIN security.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Total Badge */}
          <div className="bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg text-center min-w-[76px]">
            <span className="block text-[9px] font-bold text-slate-400 uppercase font-mono">Total</span>
            <span className="text-base font-extrabold text-slate-800 font-mono">{accountStats.total}</span>
          </div>

          {/* Active Badge */}
          <div className="bg-emerald-50 border border-emerald-200/80 px-3 py-1.5 rounded-lg text-center min-w-[76px]">
            <span className="flex items-center justify-center gap-1 text-[9px] font-bold text-emerald-700 uppercase font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Active
            </span>
            <span className="text-base font-extrabold text-emerald-700 font-mono">{accountStats.active}</span>
          </div>

          {/* Pending Badge */}
          <div className="bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg text-center min-w-[76px]">
            <span className="flex items-center justify-center gap-1 text-[9px] font-bold text-slate-500 uppercase font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Pending
            </span>
            <span className="text-base font-extrabold text-slate-600 font-mono">{accountStats.pending}</span>
          </div>

          {/* Full Access Badge */}
          <div className="bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-lg text-center min-w-[80px] hidden sm:block">
            <span className="block text-[9px] font-bold text-indigo-500 uppercase font-mono">Full Access</span>
            <span className="text-base font-extrabold text-indigo-700 font-mono">{accountStats.fullAccess}</span>
          </div>

          {isSuperAdmin && (
            <button
              onClick={() => {
                resetAddForm();
                setShowAddModal(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs uppercase font-mono cursor-pointer shrink-0 ml-1"
              id="btn-add-account"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Register Operator</span>
            </button>
          )}
        </div>
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
                        isSelf ? 'bg-indigo-50/30' : ''
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
                        <div className="flex items-center gap-1.5">
                          <span className="tracking-widest bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-slate-800 text-[11px] font-bold">
                            {isPinVisible ? (acc.pin || '1234') : '••••'}
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
                              {isPinVisible && (
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(acc.pin || '1234', `pin-${acc.employeeId}`)}
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
                            </>
                          )}
                        </div>
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
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full space-y-4 relative overflow-hidden text-left">
            {/* Header */}
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-bold text-base text-slate-900">
                    Register JPMP WMS Account
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Provision operator credentials, status, and floor permissions
                  </p>
                </div>
              </div>
              <button 
                onClick={resetAddForm}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Error Notification */}
            {addError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3 rounded-xl flex items-start gap-2 animate-in fade-in">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
                <span>{addError}</span>
              </div>
            )}

            {/* Registration Form */}
            <form onSubmit={handleRegisterAccount} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase font-mono mb-1">
                  Full Name / Operator Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="E.G. MARIA SANTOS"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value.toUpperCase())}
                  className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none uppercase font-semibold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Employee ID / Register ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="E.G. JPMP-005"
                    value={newEmployeeId}
                    onChange={e => setNewEmployeeId(e.target.value.toUpperCase())}
                    className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono font-bold uppercase text-slate-800"
                  />
                  <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">
                    Auto-prefixed with JPMP-
                  </span>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Mobile Phone Number <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Phone className="h-3.5 w-3.5 text-indigo-500" />
                    </div>
                    <input
                      type="tel"
                      placeholder="0917 123 4567 or +63 917..."
                      value={newPhoneNumber}
                      onChange={e => setNewPhoneNumber(e.target.value)}
                      className="w-full pl-8.5 pr-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono font-bold text-slate-800"
                    />
                  </div>
                  <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">
                    For directory contact
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Operational Role <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newRole}
                    onChange={e => setNewRole(e.target.value)}
                    className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none uppercase font-semibold text-slate-800 bg-white"
                  >
                    <option value="SYSTEM ADMINISTRATOR">SYSTEM ADMINISTRATOR</option>
                    <option value="WAREHOUSE TEAM LEADER">WAREHOUSE TEAM LEADER</option>
                    <option value="WAREHOUSE SUPERVISOR">WAREHOUSE SUPERVISOR</option>
                    <option value="WAREHOUSE MANAGER">WAREHOUSE MANAGER</option>
                    <option value="WAREHOUSE CLERK">WAREHOUSE CLERK</option>
                    <option value="WAREHOUSE INVENTORY SPECIALIST">WAREHOUSE INVENTORY SPECIALIST</option>
                    <option value="WAREHOUSE PERSONNEL">WAREHOUSE PERSONNEL</option>
                    <option value="INJECTION MATERIAL HANDLER">INJECTION MATERIAL HANDLER</option>
                    <option value="PRINTING MATERIAL HANDLER">PRINTING MATERIAL HANDLER</option>
                    <option value="HR/ADMIN">HR/ADMIN</option>
                    <option value="INJECTION (PRODUCTION)">INJECTION (PRODUCTION)</option>
                    <option value="QUALITY INSPECTOR">QUALITY INSPECTOR</option>
                    <option value="SALES">SALES</option>
                    <option value="PURCHASING">PURCHASING</option>
                    <option value="IMPEX">IMPEX</option>
                    <option value="LOGISTIC">LOGISTIC</option>
                    <option value="PRINTING AND ASSEMBLY (PRODUCTION)">PRINTING AND ASSEMBLY (PRODUCTION)</option>
                    <option value="FINANCE/ACCOUNTING">FINANCE/ACCOUNTING</option>
                    <option value="INTERNAL AUDITOR">INTERNAL AUDITOR</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Initial Account Status <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newStatus}
                    onChange={e => setNewStatus(e.target.value as 'ACTIVE' | 'PENDING' | 'INACTIVE')}
                    className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-bold uppercase text-slate-800 bg-white font-mono"
                  >
                    <option value="ACTIVE">● ACTIVE (READY FOR OPERATIONS)</option>
                    <option value="PENDING">○ PENDING (AWAITING VERIFICATION)</option>
                    <option value="INACTIVE">⊘ INACTIVE (SUSPENDED)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Access Permission Level <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newPermission}
                    onChange={e => setNewPermission(e.target.value)}
                    className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-bold uppercase text-slate-800 bg-white"
                  >
                    <option value="LIMITED_ACCESS">LIMITED ACCESS (CREATE & EDIT ACCESS)</option>
                    <option value="FULL_ACCESS">FULL ACCESS (CREATE/EDIT/DELETE ACCESS)</option>
                    <option value="VIEW_ONLY">VIEW ONLY (READ-ONLY ACCESS)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Custom 4-Digit PIN <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <KeyRound className="h-3.5 w-3.5 text-indigo-500" />
                    </div>
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="Auto-generate if blank"
                      value={newCustomPin}
                      onChange={e => setNewCustomPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      className="w-full pl-8.5 pr-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono font-bold text-slate-800 tracking-widest"
                    />
                  </div>
                  <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">
                    Leave blank to auto-generate unique 4-digit PIN
                  </span>
                </div>
              </div>

              {/* Information Notice Card */}
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-slate-600 flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  <strong className="text-slate-800">Multi-PC Sync:</strong> The operator account will be registered immediately and synchronized to all active workstations and cloud databases.
                </p>
              </div>

              <div className="flex justify-end gap-2.5 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={resetAddForm}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md font-bold uppercase transition flex items-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>Register Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Existing Account */}
      {editingAccount && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 max-w-md w-full space-y-4 text-left">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Edit className="h-4 w-4 text-indigo-600" /> Edit Registered Account ({editingAccount.employeeId})
                </h4>
                <p className="text-[11px] text-slate-500">Super Admin Credentials & Status Management</p>
              </div>
              <button 
                onClick={() => setEditingAccount(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
                  Full Name / Operator Name
                </label>
                <input
                  type="text"
                  required
                  value={editingAccount.username}
                  onChange={e => setEditingAccount({ ...editingAccount, username: e.target.value.toUpperCase() })}
                  className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-1 focus:ring-indigo-500 uppercase font-semibold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
                    Employee ID
                  </label>
                  <input
                    type="text"
                    required
                    value={editingAccount.employeeId}
                    disabled={editingAccount.employeeId === 'JPMP-002'}
                    onChange={e => setEditingAccount({ ...editingAccount, employeeId: e.target.value.toUpperCase() })}
                    className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-1 focus:ring-indigo-500 font-mono font-bold uppercase disabled:bg-slate-100 disabled:text-slate-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
                    Account Status
                  </label>
                  <select
                    value={editingAccount.status || 'ACTIVE'}
                    onChange={e => setEditingAccount({ ...editingAccount, status: e.target.value as 'ACTIVE' | 'PENDING' | 'INACTIVE' })}
                    className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-1 focus:ring-indigo-500 font-mono font-bold uppercase text-slate-800 bg-white"
                  >
                    <option value="ACTIVE">● ACTIVE</option>
                    <option value="PENDING">○ PENDING</option>
                    <option value="INACTIVE">⊘ INACTIVE</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
                  Registered Mobile Phone Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Phone className="h-3.5 w-3.5 text-indigo-500" />
                  </div>
                  <input
                    type="tel"
                    placeholder="e.g. +63 917 123 4567"
                    value={editingAccount.phoneNumber || ''}
                    onChange={e => setEditingAccount({ ...editingAccount, phoneNumber: e.target.value })}
                    className="w-full pl-8.5 pr-3 py-2 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 font-mono font-semibold text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
                  Operational Role
                </label>
                <select
                  value={editingAccount.role}
                  onChange={e => setEditingAccount({ ...editingAccount, role: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-1 focus:ring-indigo-500 uppercase font-semibold text-slate-800 bg-white"
                >
                  <option value="SYSTEM ADMINISTRATOR">SYSTEM ADMINISTRATOR</option>
                  <option value="WAREHOUSE TEAM LEADER">WAREHOUSE TEAM LEADER</option>
                  <option value="WAREHOUSE SUPERVISOR">WAREHOUSE SUPERVISOR</option>
                  <option value="WAREHOUSE MANAGER">WAREHOUSE MANAGER</option>
                  <option value="WAREHOUSE CLERK">WAREHOUSE CLERK</option>
                  <option value="WAREHOUSE INVENTORY SPECIALIST">WAREHOUSE INVENTORY SPECIALIST</option>
                  <option value="WAREHOUSE PERSONNEL">WAREHOUSE PERSONNEL</option>
                  <option value="INJECTION MATERIAL HANDLER">INJECTION MATERIAL HANDLER</option>
                  <option value="PRINTING MATERIAL HANDLER">PRINTING MATERIAL HANDLER</option>
                  <option value="HR/ADMIN">HR/ADMIN</option>
                  <option value="INJECTION (PRODUCTION)">INJECTION (PRODUCTION)</option>
                  <option value="QUALITY INSPECTOR">QUALITY INSPECTOR</option>
                  <option value="SALES">SALES</option>
                  <option value="PURCHASING">PURCHASING</option>
                  <option value="IMPEX">IMPEX</option>
                  <option value="LOGISTIC">LOGISTIC</option>
                  <option value="PRINTING AND ASSEMBLY (PRODUCTION)">PRINTING AND ASSEMBLY (PRODUCTION)</option>
                  <option value="FINANCE/ACCOUNTING">FINANCE/ACCOUNTING</option>
                  <option value="INTERNAL AUDITOR">INTERNAL AUDITOR</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
                  Access Permission Level
                </label>
                <select
                  value={editingAccount.permission || 'LIMITED_ACCESS'}
                  onChange={e => setEditingAccount({ ...editingAccount, permission: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-1 focus:ring-indigo-500 font-bold uppercase text-slate-800 bg-white"
                >
                  <option value="LIMITED_ACCESS">LIMITED ACCESS (CREATE & EDIT ACCESS)</option>
                  <option value="FULL_ACCESS">FULL ACCESS (CREATE/EDIT/DELETE ACCESS)</option>
                  <option value="VIEW_ONLY">VIEW ONLY (READ-ONLY ACCESS)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
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
                  className="w-full border border-slate-200 px-3 py-2 rounded-xl focus:ring-1 focus:ring-indigo-500 font-mono font-bold tracking-widest text-center text-slate-800"
                />
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-sm font-bold uppercase cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
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
    </div>
  );
}
