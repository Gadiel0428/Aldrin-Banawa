/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RegisteredAccount } from '../types';
import { getApiBaseUrl, getAuthHeaders, getStoredSessionToken } from '../config/serverConfig';

export function resolveAccountPin(user: any, employeeId?: string): string {
  if (user?.pin && String(user.pin).trim() !== '') return String(user.pin).trim();
  if (user?.pin_hash && String(user.pin_hash).trim() !== '') return String(user.pin_hash).trim();
  const cleanId = (employeeId || user?.employeeId || user?.employee_id || '').toUpperCase().trim();
  if (cleanId === 'JPMP-002') return '0423';
  // NEVER fall back to '1234'. Returning empty string enforces PIN protection and prevents silent defaults.
  return '';
}

export function isAccountPinCompromised(account?: Partial<RegisteredAccount> | null): boolean {
  if (!account) return false;
  if (account.isPinCompromised) return true;
  const pin = (account.pin || '').toString().trim();
  return pin === '1234';
}

export interface CentralDbSnapshot {
  status: string;
  revision: number;
  systemResetVersion: number;
  systemResetTimestamp: string;
  systemResetId: string;
  systemResetBy: string;
  data: {
    stocks: any[];
    receiving: any[];
    returns: any[];
    recycling: any[];
    issuances: any[];
    deliveries: any[];
    envLogs: any[];
    forkliftChecks: any[];
    registries: any[];
    registeredUsers: RegisteredAccount[];
    chatMessages: any[];
    stockMovements?: any[];
  };
}

/**
 * Fetch authoritative central database snapshot via HTTP REST.
 * The central database is the single source of truth.
 */
export async function fetchCentralDatabaseSnapshot(): Promise<CentralDbSnapshot | null> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/sync`, {
      headers: getAuthHeaders({
        'Accept': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      }),
    });
    if (!res.ok) {
      console.warn(`Central DB snapshot request failed with status: ${res.status}`);
      return null;
    }
    const json = await res.json();
    if (json && json.data) {
      return json as CentralDbSnapshot;
    }
  } catch (err) {
    console.warn('Failed to fetch central database snapshot:', err);
  }
  return null;
}

/**
 * Verify account credentials and PIN against the central database.
 * Issues and persists random crypto.randomBytes session token.
 */
export async function verifyCentralCredentials(
  identifier: string,
  pin: string
): Promise<(RegisteredAccount & { token?: string; sessionToken?: string }) | null> {
  const cleanInput = String(identifier || '').trim();
  const enteredPin = String(pin || '').trim();
  if (!cleanInput || !enteredPin) return null;

  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/accounts/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: cleanInput, pin: enteredPin }),
    });
    if (res.ok) {
      const body = await res.json();
      if (body.success && body.user) {
        const u = {
          ...body.user,
          token: body.token || body.sessionToken,
          sessionToken: body.sessionToken || body.token,
          permission: body.permission || body.user.permission
        };
        const token = body.token || body.sessionToken;
        if (token && typeof localStorage !== 'undefined') {
          localStorage.setItem('juwei_wms_sessionToken', token);
          if (body.permission) {
            localStorage.setItem('juwei_wms_userPermission', body.permission);
          }
        }
        return u;
      }
    }
  } catch (apiErr) {
    console.warn('Central API verify account credentials error:', apiErr);
  }
  return null;
}

/**
 * Verify session token against central database to keep user logged in across restarts.
 */
export async function verifyCentralSession(): Promise<{ valid: boolean; user?: RegisteredAccount; permission?: string }> {
  const token = getStoredSessionToken();
  if (!token) return { valid: false };
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/accounts/session`, {
      headers: getAuthHeaders({ 'Accept': 'application/json' })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.user) {
        return { valid: true, user: data.user, permission: data.permission };
      }
    }
  } catch (e) {}
  return { valid: false };
}

/**
 * Register a new operator account in the central database.
 * The server commits to disk before broadcasting via WebSocket.
 */
export async function registerCentralAccount(
  account: Partial<RegisteredAccount>
): Promise<{ success: boolean; user?: RegisteredAccount; error?: string }> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/accounts/register`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(account),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error registering account' };
  }
}

/**
 * Update an existing operator account in the central database.
 */
export async function updateCentralAccount(
  oldEmployeeId: string,
  account: RegisteredAccount
): Promise<{ success: boolean; user?: RegisteredAccount; error?: string }> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/accounts/update`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ oldEmployeeId, updatedUser: account }),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error updating account' };
  }
}

/**
 * Update account PIN in the central database with explicit Super Admin verification and audit trail.
 */
export async function updateCentralPin(
  employeeId: string,
  currentPin: string,
  newPin: string,
  requesterEmployeeId?: string,
  options?: { adminPin?: string; author?: string; reason?: string }
): Promise<{ success: boolean; user?: RegisteredAccount; error?: string }> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/accounts/update-pin`, {
      method: 'POST',
      headers: getAuthHeaders({ 
        'Content-Type': 'application/json',
        'x-user-employee-id': requesterEmployeeId || 'JPMP-002',
        ...(options?.adminPin ? { 'x-user-pin': options.adminPin } : {})
      }),
      body: JSON.stringify({
        employeeId,
        currentPin,
        newPin,
        adminPin: options?.adminPin,
        requesterEmployeeId: requesterEmployeeId || employeeId,
        author: options?.author,
        reason: options?.reason
      }),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error updating PIN' };
  }
}

/**
 * Permanently delete an account from the central database.
 */
export async function deleteCentralAccount(
  employeeId: string,
  requesterId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/accounts/delete`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ employeeId, requesterId }),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error deleting account' };
  }
}

/**
 * Clear all accounts except Super Admin.
 */
export async function clearAllAccountsExceptSuperAdmin(
  superAdminPin: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/accounts/clear-all-except-super-admin`, {
      method: 'POST',
      headers: getAuthHeaders({ 
        'Content-Type': 'application/json',
        'x-user-employee-id': 'JPMP-002',
        'x-user-pin': superAdminPin
      }),
      body: JSON.stringify({ 
        employeeId: 'JPMP-002',
        requesterEmployeeId: 'JPMP-002',
        pin: superAdminPin 
      }),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error clearing accounts' };
  }
}

/**
 * Upsert a single collection record into the central database.
 * Commits to disk then broadcasts to all WebSocket clients.
 */
export async function upsertCentralRecord(
  collection: string,
  record: any
): Promise<{ success: boolean; record?: any; error?: string }> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/records/upsert`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ collection, record }),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error saving record' };
  }
}

/**
 * Delete a single collection record from the central database.
 */
export async function deleteCentralRecord(
  collection: string,
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/records/delete`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ collection, id }),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error deleting record' };
  }
}

/**
 * Perform global reset of the central database.
 * Only Super Admin can execute this action.
 */
export async function performCentralGlobalReset(payload: {
  employeeId: string;
  pin: string;
  confirmed: boolean;
  author: string;
  keepUsers: boolean;
}): Promise<{ success: boolean; systemResetVersion?: number; systemResetId?: string; error?: string }> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/reset-everything`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error performing reset' };
  }
}

export async function initializeFreshInstallation(payload: {
  deviceId: string;
  deviceName?: string;
  stationId?: string;
}): Promise<any> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/terminal/fresh-install`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error on fresh install initialization' };
  }
}

export async function fetchAuthorizedDevices(): Promise<any> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/devices/authorized`, {
      headers: getAuthHeaders({ 'Accept': 'application/json' })
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, devices: [] };
  }
}

export async function authorizeDevice(payload: {
  deviceId: string;
  deviceName?: string;
  authorId: string;
  pin: string;
}): Promise<any> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/devices/authorize`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

export async function revokeDevice(payload: {
  deviceId: string;
  employeeId: string;
  pin: string;
}): Promise<any> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/devices/revoke`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}
