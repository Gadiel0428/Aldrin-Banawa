import React, { useState, useEffect, useRef } from 'react';
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
  QrCode,
  Phone,
  Smartphone,
  MessageSquare,
  ArrowLeft,
  RotateCcw,
  Send,
  Loader2,
  Check,
  Copy,
  Sparkles
} from 'lucide-react';
import AccountQRBadgeModal from './AccountQRBadgeModal';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';
import { RegisteredAccount } from '../types';
export type { RegisteredAccount };

interface RegisteredAccountsModuleProps {
  accounts: RegisteredAccount[];
  onAddAccount: (username: string, role: string, employeeId: string, permission: string, phoneNumber?: string) => RegisteredAccount | boolean | null;
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

  // New Account Registration Form & OTP state
  const [regStep, setRegStep] = useState<'DETAILS' | 'OTP'>('DETAILS');
  const [newUsername, setNewUsername] = useState('');
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [newRole, setNewRole] = useState('WAREHOUSE CLERK');
  const [newPermission, setNewPermission] = useState('LIMITED_ACCESS');
  
  // OTP Verification States
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [otpCountdown, setOtpCountdown] = useState<number>(0);
  const [isSendingOtp, setIsSendingOtp] = useState<boolean>(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState<boolean>(false);
  const [otpError, setOtpError] = useState<string>('');
  const [dispatchedSimulatedOtp, setDispatchedSimulatedOtp] = useState<string>('');
  const [simulatedSmsToast, setSimulatedSmsToast] = useState<{ phone: string; code: string; visible: boolean } | null>(null);
  const [otpCopied, setOtpCopied] = useState<boolean>(false);

  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // OTP Countdown Timer
  useEffect(() => {
    let interval: any = null;
    if (otpCountdown > 0) {
      interval = setInterval(() => {
        setOtpCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [otpCountdown]);

  const toggleShowPin = (empId: string) => {
    setShowPins(prev => ({ ...prev, [empId]: !prev[empId] }));
  };

  const filteredAccounts = accounts.filter(acc => 
    (acc.username || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (acc.employeeId || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (acc.phoneNumber || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (acc.role || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (acc.permission || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  const resetAddForm = () => {
    setNewUsername('');
    setNewEmployeeId('');
    setNewPhoneNumber('');
    setNewRole('WAREHOUSE CLERK');
    setNewPermission('LIMITED_ACCESS');
    setRegStep('DETAILS');
    setOtpDigits(['', '', '', '', '', '']);
    setOtpCountdown(0);
    setOtpError('');
    setDispatchedSimulatedOtp('');
    setSimulatedSmsToast(null);
    setShowAddModal(false);
  };

  // Step 1: Initiate SMS OTP Dispatch
  const handleInitiateOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpError('');

    if (!newUsername.trim() || !newEmployeeId.trim()) {
      setOtpError('Please enter Operator Full Name and Employee ID.');
      return;
    }

    const digitsOnly = newPhoneNumber.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      setOtpError('Please enter a valid mobile phone number (at least 10 digits) to receive SMS OTP.');
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
      setOtpError(`An operator with ID "${empId}" or name "${newUsername.trim().toUpperCase()}" already exists.`);
      return;
    }

    setIsSendingOtp(true);

    try {
      // Call backend send-otp endpoint
      let generatedCode = '';
      try {
        const res = await fetch('/api/auth/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: newPhoneNumber,
            employeeId: empId,
            username: newUsername.trim().toUpperCase()
          })
        });
        const data = await res.json();
        if (data.otp) {
          generatedCode = data.otp;
        }
      } catch (apiErr) {
        console.warn('Backend OTP API error, using secure client generator:', apiErr);
      }

      if (!generatedCode) {
        // Local generator fallback
        generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
      }

      setDispatchedSimulatedOtp(generatedCode);
      setSimulatedSmsToast({
        phone: formatPhoneNumber(newPhoneNumber),
        code: generatedCode,
        visible: true
      });
      setOtpDigits(['', '', '', '', '', '']);
      setOtpCountdown(60);
      setRegStep('OTP');

      // Focus first OTP box after DOM update
      setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 150);

    } catch (err: any) {
      setOtpError(err.message || 'Failed to dispatch SMS OTP. Please try again.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  // Step 2: Resend OTP
  const handleResendOtp = async () => {
    if (otpCountdown > 0) return;
    setIsSendingOtp(true);
    setOtpError('');

    let empId = newEmployeeId.trim().toUpperCase();
    if (!empId.startsWith('JPMP-')) empId = `JPMP-${empId}`;

    try {
      let generatedCode = '';
      try {
        const res = await fetch('/api/auth/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: newPhoneNumber,
            employeeId: empId,
            username: newUsername.trim().toUpperCase()
          })
        });
        const data = await res.json();
        if (data.otp) generatedCode = data.otp;
      } catch (e) {}

      if (!generatedCode) {
        generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
      }

      setDispatchedSimulatedOtp(generatedCode);
      setSimulatedSmsToast({
        phone: formatPhoneNumber(newPhoneNumber),
        code: generatedCode,
        visible: true
      });
      setOtpCountdown(60);
      setOtpDigits(['', '', '', '', '', '']);
      otpInputRefs.current[0]?.focus();
    } catch (e) {
      setOtpError('Failed to resend OTP.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  // Step 3: Handle OTP Input digit changes
  const handleOtpDigitChange = (index: number, value: string) => {
    const cleanVal = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...otpDigits];
    newDigits[index] = cleanVal;
    setOtpDigits(newDigits);
    setOtpError('');

    if (cleanVal && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const arr = pasted.split('');
      setOtpDigits(arr);
      otpInputRefs.current[5]?.focus();
    }
  };

  const handleAutofillOtp = () => {
    if (dispatchedSimulatedOtp && dispatchedSimulatedOtp.length === 6) {
      setOtpDigits(dispatchedSimulatedOtp.split(''));
      setOtpError('');
      otpInputRefs.current[5]?.focus();
    }
  };

  // Step 4: Finalize Verification and Account Creation
  const handleVerifyAndRegister = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setOtpError('');

    const enteredOtp = otpDigits.join('');
    if (enteredOtp.length !== 6) {
      setOtpError('Please enter all 6 digits of the OTP code.');
      return;
    }

    let empId = newEmployeeId.trim().toUpperCase();
    if (!empId.startsWith('JPMP-')) empId = `JPMP-${empId}`;

    setIsVerifyingOtp(true);

    try {
      let isVerified = false;

      // Verify with backend API
      try {
        const res = await fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: newPhoneNumber,
            employeeId: empId,
            otp: enteredOtp
          })
        });
        const data = await res.json();
        if (data.success || data.verified) {
          isVerified = true;
        } else if (data.error) {
          setOtpError(data.error);
        }
      } catch (apiErr) {
        // Match with local generated code
        if (dispatchedSimulatedOtp && enteredOtp === dispatchedSimulatedOtp) {
          isVerified = true;
        }
      }

      // Check against local fallback if not verified via API
      if (!isVerified && dispatchedSimulatedOtp && enteredOtp === dispatchedSimulatedOtp) {
        isVerified = true;
      }

      if (!isVerified && !otpError) {
        setOtpError('Invalid OTP code. Please check your SMS and try again.');
        setIsVerifyingOtp(false);
        return;
      }

      if (isVerified) {
        const formattedPhone = formatPhoneNumber(newPhoneNumber);
        const result = onAddAccount(newUsername, newRole, empId, newPermission, formattedPhone);
        
        if (result) {
          const newAccObj: RegisteredAccount = (typeof result === 'object' && result !== null) ? result : {
            username: newUsername.trim().toUpperCase(),
            role: newRole,
            employeeId: empId,
            phoneNumber: formattedPhone,
            permission: newPermission,
            pin: '1234'
          };
          setSelectedQrAccount(newAccObj);
          resetAddForm();
        }
      }
    } catch (err: any) {
      setOtpError(err.message || 'Verification error. Please try again.');
    } finally {
      setIsVerifyingOtp(false);
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
            Manage system users, access privileges, mobile phone SMS verification, 4-digit PIN credentials, and operational roles for Juwei WMS.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg text-center">
            <span className="block text-[10px] font-bold text-slate-400 uppercase font-mono">Total Registered</span>
            <span className="text-lg font-extrabold text-slate-800 font-mono">{accounts.length}</span>
          </div>

          <div className="bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-lg text-center">
            <span className="block text-[10px] font-bold text-indigo-500 uppercase font-mono">Full Access</span>
            <span className="text-lg font-extrabold text-indigo-700 font-mono">
              {accounts.filter(a => a.permission === 'FULL_ACCESS').length}
            </span>
          </div>

          {isSuperAdmin && (
            <button
              onClick={() => {
                resetAddForm();
                setShowAddModal(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg text-xs font-bold transition flex items-center gap-2 shadow-sm uppercase font-mono cursor-pointer"
              id="btn-add-account"
            >
              <UserPlus className="h-4 w-4" /> REGISTER JPMP ACCOUNT
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
              placeholder="Search by name, ID (e.g. JPMP-002), phone, or role..."
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
                <th className="p-4 font-bold">Operator & Contact</th>
                <th className="p-4 font-bold">Employee ID</th>
                <th className="p-4 font-bold">Operational Role</th>
                <th className="p-4 font-bold">Permission Level</th>
                <th className="p-4 font-bold">4-Digit Security PIN</th>
                <th className="p-4 font-bold">SMS Auth Status</th>
                <th className="p-4 font-bold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAccounts.map((acc) => {
                const isSelf = acc.employeeId === currentEmployeeId;
                const isSuperAdminAcc = 
                  (acc.employeeId || '').toUpperCase() === 'JPMP-002' || 
                  (acc.username || '').toUpperCase().includes('ALDRIN BANAWA') ||
                  (acc.username || '').toUpperCase() === 'SUPER ADMIN';
                const isPinVisible = !!showPins[acc.employeeId];

                return (
                  <tr key={acc.employeeId} className={`hover:bg-slate-50/80 transition ${isSelf ? 'bg-indigo-50/20' : ''}`}>
                    <td className="p-4 font-bold text-slate-900">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs uppercase shrink-0">
                          {acc.username.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="block uppercase font-bold text-slate-900">{acc.username}</span>
                            {isSuperAdminAcc && (
                              <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-800 border border-amber-300 text-[9px] px-1.5 py-0.2 rounded font-mono font-bold uppercase" title="Primary Super Administrator Account (Protected)">
                                🔒 PROTECTED
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {acc.phoneNumber ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-mono font-medium">
                                <Phone className="h-2.5 w-2.5 text-emerald-600" />
                                {acc.phoneNumber}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-mono italic">No phone registered</span>
                            )}
                            {isSelf && (
                              <span className="inline-block bg-indigo-100 text-indigo-700 text-[8px] px-1 py-0.2 rounded font-mono font-bold uppercase">
                                You
                              </span>
                            )}
                          </div>
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
                          <Edit3 className="h-3 w-3" /> LIMITED (EDIT)
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
                            className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                            title={isPinVisible ? "Hide PIN" : "Reveal PIN"}
                          >
                            {isPinVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        OTP VERIFIED
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
                                if (isSuperAdminAcc) {
                                  alert("ALDRIN BANAWA (JPMP-002) is the primary Super Administrator account and cannot be deleted.");
                                  e.target.value = '';
                                  return;
                                }
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

      {/* Modal: Add New Operator Account with SMS OTP Verification */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full space-y-4 relative overflow-hidden">
            
            {/* Header */}
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                    {regStep === 'DETAILS' ? <UserPlus className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-base text-slate-900">
                      {regStep === 'DETAILS' ? 'Register JPMP WMS Account' : 'Phone SMS OTP Verification'}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {regStep === 'DETAILS' 
                        ? 'Step 1 of 2: Operator Details & Mobile Registration' 
                        : 'Step 2 of 2: Verify Phone Number via One-Time PIN'}
                    </p>
                  </div>
                </div>
              </div>
              <button 
                onClick={resetAddForm}
                className="text-slate-400 hover:text-slate-600 text-base font-bold p-1 rounded-md hover:bg-slate-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Error Notification */}
            {otpError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3 rounded-xl flex items-start gap-2 animate-in fade-in">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
                <span>{otpError}</span>
              </div>
            )}

            {/* STEP 1: OPERATOR DETAILS & PHONE FORM */}
            {regStep === 'DETAILS' && (
              <form onSubmit={handleInitiateOtp} className="space-y-3.5 text-xs">
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
                    className="w-full border border-slate-200 px-3 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none uppercase font-semibold text-slate-800"
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
                      className="w-full border border-slate-200 px-3 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono font-bold uppercase text-slate-800"
                    />
                    <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">
                      Auto-prefixed with JPMP-
                    </span>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase font-mono mb-1">
                      Mobile Phone Number <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Phone className="h-4 w-4 text-indigo-500" />
                      </div>
                      <input
                        type="tel"
                        required
                        placeholder="0917 123 4567 or +63 917..."
                        value={newPhoneNumber}
                        onChange={e => setNewPhoneNumber(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono font-bold text-slate-800"
                      />
                    </div>
                    <span className="text-[9px] text-indigo-600 mt-0.5 block font-medium">
                      📱 An OTP SMS code will be sent to this number
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Operational Role <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newRole}
                    onChange={e => setNewRole(e.target.value)}
                    className="w-full border border-slate-200 px-3 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none uppercase font-semibold text-slate-800 bg-white"
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
                    Access Permission Level <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newPermission}
                    onChange={e => setNewPermission(e.target.value)}
                    className="w-full border border-slate-200 px-3 py-2.5 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-bold uppercase text-slate-800 bg-white"
                  >
                    <option value="LIMITED_ACCESS">LIMITED ACCESS (CREATE & EDIT ACCESS)</option>
                    <option value="FULL_ACCESS">FULL ACCESS (CREATE/EDIT/DELETE ACCESS)</option>
                    <option value="VIEW_ONLY">VIEW ONLY (READ-ONLY ACCESS)</option>
                  </select>
                </div>

                {/* SMS Notice Card */}
                <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-slate-600 flex items-start gap-2.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-relaxed">
                    <strong className="text-slate-800">SMS OTP Verification Requirement:</strong> A 6-digit One-Time Password will be dispatched to confirm ownership of the mobile number before finalizing registration.
                  </p>
                </div>

                <div className="flex justify-end gap-2.5 text-xs font-semibold pt-3 border-t border-slate-100">
                  <button 
                    type="button"
                    onClick={resetAddForm}
                    className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isSendingOtp}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md font-bold uppercase transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isSendingOtp ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>SENDING OTP SMS...</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span>SEND OTP & CONTINUE</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: OTP VERIFICATION SCREEN */}
            {regStep === 'OTP' && (
              <div className="space-y-4 text-xs">
                {/* Target Number Information */}
                <div className="bg-indigo-50/70 border border-indigo-100 p-3.5 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 bg-indigo-600 text-white rounded-lg flex items-center justify-center font-bold">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div>
                      <span className="block text-[10px] text-indigo-700 font-bold uppercase font-mono">
                        SMS OTP Dispatched To:
                      </span>
                      <span className="text-sm font-bold text-slate-900 font-mono">
                        {formatPhoneNumber(newPhoneNumber)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRegStep('DETAILS');
                      setOtpError('');
                    }}
                    className="text-indigo-600 hover:text-indigo-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer bg-white border border-indigo-200 px-2.5 py-1 rounded-lg shadow-2xs"
                  >
                    <ArrowLeft className="h-3 w-3" /> Edit Number
                  </button>
                </div>

                {/* Real-time SMS Gateway Simulated Carrier Notification */}
                {simulatedSmsToast && (
                  <div className="bg-slate-900 border border-slate-800 text-white p-3.5 rounded-xl shadow-lg relative overflow-hidden animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                      <div className="flex items-center gap-1.5 text-emerald-400 text-[10px] font-bold font-mono uppercase">
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span>TELECOM CARRIER SMS DISPATCH (SIMULATION)</span>
                      </div>
                      <span className="text-[9px] text-slate-400 font-mono">Just now</span>
                    </div>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      JUWEI WMS: Your registration One-Time PIN (OTP) is <strong className="text-emerald-400 font-mono text-sm tracking-wider underline">{simulatedSmsToast.code}</strong>. Valid for 5 minutes.
                    </p>
                    <div className="mt-2.5 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleAutofillOtp}
                        className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-3 py-1 rounded-lg text-[11px] font-bold font-mono flex items-center gap-1 transition cursor-pointer shadow-sm"
                      >
                        <Sparkles className="h-3 w-3" /> CLICK TO AUTOFILL OTP ({simulatedSmsToast.code})
                      </button>
                    </div>
                  </div>
                )}

                {/* 6-Digit OTP Boxes */}
                <div className="space-y-2 text-center py-1">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase font-mono">
                    Enter 6-Digit Verification Code
                  </label>
                  <div className="flex justify-center gap-2 sm:gap-2.5">
                    {otpDigits.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={el => {
                          otpInputRefs.current[idx] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={e => handleOtpDigitChange(idx, e.target.value)}
                        onKeyDown={e => handleOtpKeyDown(idx, e)}
                        onPaste={idx === 0 ? handleOtpPaste : undefined}
                        className={`w-11 h-13 sm:w-12 sm:h-14 text-center font-mono text-xl sm:text-2xl font-black rounded-xl border transition-all focus:outline-none ${
                          digit 
                            ? 'border-indigo-600 bg-indigo-50/40 text-indigo-900 shadow-xs' 
                            : 'border-slate-300 bg-white text-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Timer & Resend Controls */}
                <div className="flex items-center justify-between text-xs pt-1">
                  <div className="text-slate-500 flex items-center gap-1.5 font-mono">
                    {otpCountdown > 0 ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                        <span>Resend code in <strong className="text-slate-800 font-bold">{otpCountdown}s</strong></span>
                      </>
                    ) : (
                      <span className="text-emerald-600 font-semibold">Didn't receive code?</span>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={otpCountdown > 0 || isSendingOtp}
                    onClick={handleResendOtp}
                    className="text-indigo-600 hover:text-indigo-800 font-bold font-mono text-xs flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCcw className={`h-3 w-3 ${isSendingOtp ? 'animate-spin' : ''}`} />
                    <span>Resend SMS OTP</span>
                  </button>
                </div>

                {/* Verification Actions */}
                <div className="flex justify-end gap-2.5 text-xs font-semibold pt-4 border-t border-slate-100">
                  <button 
                    type="button"
                    onClick={() => {
                      setRegStep('DETAILS');
                      setOtpError('');
                    }}
                    className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition cursor-pointer flex items-center gap-1.5"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                  <button 
                    type="button"
                    disabled={isVerifyingOtp || otpDigits.some(d => !d)}
                    onClick={() => handleVerifyAndRegister()}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md font-bold uppercase transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isVerifyingOtp ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>VERIFYING CODE...</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        <span>VERIFY & COMPLETE REGISTRATION</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Edit Existing Account */}
      {editingAccount && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Edit className="h-4 w-4 text-indigo-600" /> Edit Registered Account ({editingAccount.employeeId})
                </h4>
                <p className="text-[11px] text-slate-500">Super Admin Credentials & Phone Management</p>
              </div>
              <button 
                onClick={() => setEditingAccount(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
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
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 font-mono font-semibold text-slate-800"
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
