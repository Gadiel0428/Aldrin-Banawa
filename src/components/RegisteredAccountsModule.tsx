import React, { useState } from 'react';
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
  UserCheck,
  CheckCircle2,
  AlertCircle,
  QrCode
} from 'lucide-react';
import AccountQRBadgeModal from './AccountQRBadgeModal';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';

export interface RegisteredAccount {
  username: string;
  role: string;
  employeeId: string;
  permission?: string;
  pin?: string;
}

interface RegisteredAccountsModuleProps {
  accounts: RegisteredAccount[];
  onAddAccount: (username: string, role: string, employeeId: string, permission: string) => boolean;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<RegisteredAccount | null>(null);
  const [selectedQrAccount, setSelectedQrAccount] = useState<RegisteredAccount | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);
  const [showPins, setShowPins] = useState<{ [key: string]: boolean }>({});

  // New Account Form state
  const [newUsername, setNewUsername] = useState('');
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newRole, setNewRole] = useState('WAREHOUSE CLERK');
  const [newPermission, setNewPermission] = useState('LIMITED_ACCESS');

  const toggleShowPin = (empId: string) => {
    setShowPins(prev => ({ ...prev, [empId]: !prev[empId] }));
  };

  const filteredAccounts = accounts.filter(acc => 
    acc.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    acc.employeeId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    acc.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (acc.permission || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newEmployeeId.trim()) return;

    let empId = newEmployeeId.trim().toUpperCase();
    if (!empId.startsWith('JPMP-')) {
      empId = `JPMP-${empId}`;
    }

    const success = onAddAccount(newUsername, newRole, empId, newPermission);
    if (success) {
      // Find or construct the account object for immediate QR Badge modal display
      const newAccObj: RegisteredAccount = {
        username: newUsername.trim().toUpperCase(),
        role: newRole,
        employeeId: empId,
        permission: newPermission,
        pin: '1234'
      };
      setSelectedQrAccount(newAccObj);

      setNewUsername('');
      setNewEmployeeId('');
      setNewRole('WAREHOUSE CLERK');
      setNewPermission('LIMITED_ACCESS');
      setShowAddModal(false);
    }
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;
    onUpdateAccount(editingAccount.employeeId, editingAccount);
    setEditingAccount(null);
  };

  return (
    <div className="space-y-6" id="registered-accounts-module">
      {/* Top Banner & Stats */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 mb-1 font-bold text-xs uppercase tracking-wider font-mono">
            <ShieldCheck className="h-4 w-4" /> Operator Security & Credentials Directory
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-indigo-600" /> JPMP Accounts
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Manage system users, access privileges, 4-digit PIN credentials, and operational roles for Juwei WMS.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg text-center">
            <span className="block text-[10px] font-bold text-slate-400 uppercase font-mono">Total Registered</span>
            <span className="text-lg font-extrabold text-slate-800 font-mono">{accounts.length}</span>
          </div>

          <div className="bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-lg text-center">
            <span className="block text-[10px] font-bold text-indigo-500 uppercase font-mono">Full Access Accounts</span>
            <span className="text-lg font-extrabold text-indigo-700 font-mono">
              {accounts.filter(a => a.permission === 'FULL_ACCESS').length}
            </span>
          </div>

          {isSuperAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg text-xs font-bold transition flex items-center gap-2 shadow-sm uppercase font-mono"
              id="btn-add-account"
            >
              <UserPlus className="h-4 w-4" /> REGISTER JPMP WMS ACCOUNT
            </button>
          )}
        </div>
      </div>

      {/* Search & Accounts Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, ID (e.g. JPMP-002), or role..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="text-xs text-slate-500 font-semibold flex items-center gap-2">
            Showing <span className="font-mono font-bold text-slate-800">{filteredAccounts.length}</span> of <span className="font-mono font-bold text-slate-800">{accounts.length}</span> Accounts
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase font-mono text-[10px] tracking-wider border-b border-slate-200">
                <th className="p-4 font-bold">Operator Name</th>
                <th className="p-4 font-bold">Employee ID</th>
                <th className="p-4 font-bold">Operational Role</th>
                <th className="p-4 font-bold">Permission Level</th>
                <th className="p-4 font-bold">4-Digit Security PIN</th>
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAccounts.map((acc) => {
                const isSelf = acc.employeeId === currentEmployeeId;
                const isSuperAdminAcc = acc.employeeId === 'JPMP-002';
                const isPinVisible = !!showPins[acc.employeeId];

                return (
                  <tr key={acc.employeeId} className={`hover:bg-slate-50/80 transition ${isSelf ? 'bg-indigo-50/20' : ''}`}>
                    <td className="p-4 font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs uppercase">
                          {acc.username.charAt(0)}
                        </div>
                        <div>
                          <span className="block uppercase">{acc.username}</span>
                          {isSelf && (
                            <span className="inline-block bg-indigo-100 text-indigo-700 text-[9px] px-1.5 py-0.2 rounded font-mono font-bold uppercase">
                              Current Session
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="p-4 font-mono font-bold text-indigo-600">
                      {acc.employeeId}
                    </td>

                    <td className="p-4 font-semibold text-slate-700 uppercase">
                      {acc.role}
                    </td>

                    <td className="p-4">
                      {acc.permission === 'FULL_ACCESS' ? (
                        <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase">
                          <Unlock className="h-3 w-3" /> FULL ACCESS
                        </span>
                      ) : acc.permission === 'LIMITED_ACCESS' ? (
                        <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase">
                          <Edit3 className="h-3 w-3" /> LIMITED ACCESS (EDIT)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase">
                          <Lock className="h-3 w-3" /> VIEW ONLY
                        </span>
                      )}
                    </td>

                    <td className="p-4 font-mono font-bold">
                      <div className="flex items-center gap-2">
                        <span className="tracking-widest bg-slate-100 border border-slate-200 px-2 py-1 rounded text-slate-800 text-[11px]">
                          {isPinVisible ? (acc.pin || '1234') : '••••'}
                        </span>
                        {isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => toggleShowPin(acc.employeeId)}
                            className="text-slate-400 hover:text-slate-600 p-1"
                            title={isPinVisible ? "Hide PIN" : "Reveal PIN"}
                          >
                            {isPinVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 text-emerald-600 text-[10px] font-bold uppercase font-mono">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        REGISTERED
                      </span>
                    </td>

                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedQrAccount(acc)}
                          className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1 cursor-pointer font-mono"
                          title="View & Print Login QR Code Badge"
                        >
                          <QrCode className="h-3.5 w-3.5 text-indigo-600" />
                          <span>QR PASS</span>
                        </button>

                        {isSuperAdmin ? (
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === 'QR_BADGE') setSelectedQrAccount(acc);
                              else if (val === 'EDIT') setEditingAccount({ ...acc });
                              else if (val === 'DELETE') {
                                setConfirmAction({
                                  title: 'Delete Operator Account',
                                  message: `Are you sure you want to permanently delete the account for ${acc.username} (${acc.employeeId})?`,
                                  confirmLabel: 'YES, DELETE ACCOUNT',
                                  confirmVariant: 'danger',
                                  onConfirm: () => onRemoveAccount(acc.employeeId)
                                });
                              }
                              e.target.value = '';
                            }}
                            className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                            id={`action-select-acc-${acc.employeeId}`}
                          >
                            <option value="" disabled>Actions...</option>
                            <option value="QR_BADGE">📷 View QR Login Badge</option>
                            <option value="EDIT">📝 Edit Account</option>
                            {!isSuperAdminAcc && <option value="DELETE">🗑️ Delete Account</option>}
                          </select>
                        ) : (
                          <span className="text-slate-400 italic text-[10px]">Read Only</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredAccounts.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400 font-semibold">
                    No operator accounts found matching "{searchQuery}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add New Operator Account */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-indigo-600" /> Register JPMP WMS Account
                </h4>
                <p className="text-[11px] text-slate-500">Super Admin Direct Registration</p>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
                  Full Name / Operator Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="E.G. MARIA SANTOS"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value.toUpperCase())}
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:ring-1 focus:ring-indigo-500 uppercase font-semibold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
                  Employee ID / Register ID
                </label>
                <input
                  type="text"
                  required
                  placeholder="E.G. JPMP-005"
                  value={newEmployeeId}
                  onChange={e => setNewEmployeeId(e.target.value.toUpperCase())}
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:ring-1 focus:ring-indigo-500 font-mono font-bold uppercase"
                />
                <span className="text-[9px] text-slate-400 mt-0.5 block">
                  Automatically prefixed with JPMP- if omitted.
                </span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
                  Operational Role
                </label>
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:ring-1 focus:ring-indigo-500 uppercase font-semibold"
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
                  value={newPermission}
                  onChange={e => setNewPermission(e.target.value)}
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:ring-1 focus:ring-indigo-500 font-bold uppercase"
                >
                  <option value="LIMITED_ACCESS">LIMITED ACCESS (CREATE & EDIT ACCESS)</option>
                  <option value="FULL_ACCESS">FULL ACCESS (CREATE/EDIT/DELETE ACCESS)</option>
                  <option value="VIEW_ONLY">VIEW ONLY (READ-ONLY ACCESS)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold uppercase"
                >
                  Register Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Existing Account */}
      {editingAccount && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Edit className="h-4 w-4 text-indigo-600" /> Edit Registered Account ({editingAccount.employeeId})
                </h4>
                <p className="text-[11px] text-slate-500">Super Admin Credentials Overwrite</p>
              </div>
              <button 
                onClick={() => setEditingAccount(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
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
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:ring-1 focus:ring-indigo-500 uppercase font-semibold"
                />
              </div>

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
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:ring-1 focus:ring-indigo-500 font-mono font-bold uppercase disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase font-mono mb-1">
                  Operational Role
                </label>
                <select
                  value={editingAccount.role}
                  onChange={e => setEditingAccount({ ...editingAccount, role: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:ring-1 focus:ring-indigo-500 uppercase font-semibold"
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
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:ring-1 focus:ring-indigo-500 font-bold uppercase"
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
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:ring-1 focus:ring-indigo-500 font-mono font-bold tracking-widest text-center"
                />
              </div>

              <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold uppercase"
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
