/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RegisteredAccount } from '../types';
import { getApiBaseUrl, getAuthHeaders } from '../config/serverConfig';

function getLocalDeviceId(): string {
  try {
    return typeof localStorage !== 'undefined' ? (localStorage.getItem('juwei_wms_device_id') || '') : '';
  } catch {
    return '';
  }
}

function notifyDeviceRevoked(deviceId?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('juwei_device_revoked', { detail: { deviceId: deviceId || getLocalDeviceId() } }));
  }
}

/**
 * Verify account credentials and PIN against the central database.
 * Issues and persists random crypto.randomBytes session token.
 */
export async function verifyCentralCredentials(
  identifier: string,
  pin: string
): Promise<(RegisteredAccount & { token?: string; sessionToken?: string; mustChangePin?: boolean }) | null> {
  const cleanInput = String(identifier || '').trim();
  const enteredPin = String(pin || '').trim();
  if (!cleanInput || !enteredPin) return null;

  try {
    const baseUrl = getApiBaseUrl();
    const deviceId = getLocalDeviceId();
    const res = await fetch(`${baseUrl}/api/accounts/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(deviceId ? { 'x-device-id': deviceId } : {})
      },
      body: JSON.stringify({ identifier: cleanInput, pin: enteredPin, deviceId }),
    });
    if (res.status === 403) {
      const errJson = await res.json().catch(() => null);
      if (errJson?.error === 'DEVICE_REVOKED') {
        notifyDeviceRevoked(deviceId);
        throw new Error('DEVICE_REVOKED');
      }
      return null;
    }
    if (res.ok) {
      const body = await res.json();
      if (body.success && body.user) {
        const u = {
          ...body.user,
          token: body.token || body.sessionToken,
          sessionToken: body.sessionToken || body.token,
          permission: body.permission || body.user.permission,
          mustChangePin: Boolean(body.mustChangePin ?? body.user?.mustChangePin)
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
  } catch (apiErr: any) {
    if (apiErr?.message === 'DEVICE_REVOKED') {
      throw apiErr;
    }
    console.warn('Central API verify account credentials error:', apiErr);
  }
  return null;
}

/**
 * Update account PIN in the central database with explicit Super Admin or authenticated self verification and audit trail.
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
    const deviceId = getLocalDeviceId();
    const res = await fetch(`${baseUrl}/api/accounts/update-pin`, {
      method: 'POST',
      headers: getAuthHeaders({
        'Content-Type': 'application/json',
        'x-user-employee-id': requesterEmployeeId || employeeId,
        ...(deviceId ? { 'x-device-id': deviceId } : {}),
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
    const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    if (res.status === 403 && data?.error === 'DEVICE_REVOKED') {
      notifyDeviceRevoked(deviceId);
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error updating PIN' };
  }
}
