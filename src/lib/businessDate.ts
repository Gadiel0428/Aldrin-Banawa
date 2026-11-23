/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Business Date Utilities (Asia/Manila Local YYYY-MM-DD vs UTC Audit Timestamps)
 */

export const TIMEZONE_ASIA_MANILA = 'Asia/Manila';

/**
 * Returns current business date in Asia/Manila as YYYY-MM-DD.
 */
export function getManilaTodayString(dateInput: Date | string | number = new Date()): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE_ASIA_MANILA,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(d);
  } catch {
    // Fallback: Manila is UTC+8 (+28800000 ms)
    const manilaTime = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return manilaTime.toISOString().slice(0, 10);
  }
}

/**
 * Converts any date input to Asia/Manila local YYYY-MM-DD string.
 */
export function formatDateToManila(dateInput: Date | string | number | null | undefined): string {
  if (!dateInput) return getManilaTodayString();
  return getManilaTodayString(dateInput);
}

/**
 * Returns current ISO string in UTC for audit timestamps.
 */
export function getUtcAuditTimestamp(dateInput: Date | string | number = new Date()): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

/**
 * Adds or subtracts days to a Manila date string (YYYY-MM-DD) and returns YYYY-MM-DD.
 */
export function addDaysToManilaDate(dateStr: string, days: number): string {
  const cleaned = String(dateStr || '').trim().slice(0, 10);
  if (!cleaned || !/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return getManilaTodayString();
  }
  const [y, m, d] = cleaned.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d + days, 0, 0, 0));
  return getManilaTodayString(target);
}

/**
 * Compares two Manila date strings (YYYY-MM-DD). Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareManilaDates(dateA: string, dateB: string): number {
  const a = String(dateA || '').trim().slice(0, 10);
  const b = String(dateB || '').trim().slice(0, 10);
  return a.localeCompare(b);
}
