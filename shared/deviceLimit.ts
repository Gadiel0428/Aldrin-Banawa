/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Maximum Devices Limits & Binding Helpers
 */

import type { AuthorizedDevice, RegisteredAccount } from './types';

export const MIN_MAX_DEVICES = 1;
export const MAX_MAX_DEVICES = 10;
export const DEFAULT_MAX_DEVICES = 2;

export interface MaxDevicesValidationResult {
  valid: boolean;
  value: number;
  error?: string;
}

export function isSuperAdminAccount(
  account?: Pick<RegisteredAccount, 'employeeId' | 'role'> | null
): boolean {
  if (!account) return false;
  const empId = String(account.employeeId || '').trim().toUpperCase();
  const role = String(account.role || '').trim().toUpperCase();
  return empId === 'JPMP-002' || role === 'SUPER ADMINISTRATOR';
}

export function validateMaxDevices(
  rawValue: unknown,
  options?: { defaultIfEmpty?: boolean }
): MaxDevicesValidationResult {
  const defaultIfEmpty = options?.defaultIfEmpty ?? true;
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    if (defaultIfEmpty) {
      return { valid: true, value: DEFAULT_MAX_DEVICES };
    }
    return {
      valid: false,
      value: DEFAULT_MAX_DEVICES,
      error: `Maximum devices must be a whole number from ${MIN_MAX_DEVICES} to ${MAX_MAX_DEVICES}.`,
    };
  }

  const num = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim());
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < MIN_MAX_DEVICES || num > MAX_MAX_DEVICES) {
    return {
      valid: false,
      value: DEFAULT_MAX_DEVICES,
      error: `Maximum devices must be a whole number from ${MIN_MAX_DEVICES} to ${MAX_MAX_DEVICES}.`,
    };
  }

  return { valid: true, value: num };
}

export function resolveEffectiveMaxDevices(
  account?: Pick<RegisteredAccount, 'maxDevices'> | null
): number {
  if (!account) return DEFAULT_MAX_DEVICES;
  const parsed = validateMaxDevices(account.maxDevices);
  return parsed.valid ? parsed.value : DEFAULT_MAX_DEVICES;
}

export function countBoundAuthorizedDevicesForEmployee(
  devices: Iterable<AuthorizedDevice>,
  employeeId?: string | null
): number {
  const cleanEmpId = String(employeeId || '').trim().toUpperCase();
  if (!cleanEmpId) return 0;

  let count = 0;
  for (const dev of devices) {
    if (!dev || dev.status !== 'AUTHORIZED') continue;
    const boundEmpId = String(dev.boundEmployeeId || '').trim().toUpperCase();
    if (boundEmpId && boundEmpId === cleanEmpId) {
      count++;
    }
  }
  return count;
}

export function buildDeviceLimitReachedMessage(limit: number): string {
  return `You have reached your device limit (${limit}). Ask your Super Administrator to remove an old device or raise your limit.`;
}
