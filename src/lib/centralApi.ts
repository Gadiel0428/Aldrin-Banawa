/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RegisteredAccount } from '../types';
import { getApiBaseUrl, getAuthHeaders } from '../config/serverConfig';

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
