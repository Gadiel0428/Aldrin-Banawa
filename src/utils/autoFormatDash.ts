/**
 * Auto-formatting utilities for standardized warehouse document and inventory fields.
 * 
 * Rules:
 * 1. As user types digits only, prefix and dashes are inserted automatically.
 * 2. Backspace works normally when removing characters.
 * 3. When backspaced down to the prefix or emptied, the field returns truly empty ('').
 */

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Formats a field with a static prefix, e.g. "DR-", "SI-", "WB-LBC-", "RM-RE-", "LOT-".
 */
export function formatPrefixedDashField(raw: string, prefix: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const cleanPrefix = prefix.toUpperCase();
  const upper = trimmed.toUpperCase();

  // If user backspaced down to or into the prefix, clear the field completely
  if (cleanPrefix.startsWith(upper) || upper === cleanPrefix) {
    return '';
  }

  let remainder = '';
  if (upper.startsWith(cleanPrefix)) {
    remainder = trimmed.slice(cleanPrefix.length);
  } else {
    // If user typed without prefix or typed prefix without dash
    const prefixLetters = cleanPrefix.replace(/[^A-Z]/g, '');
    const match = upper.match(new RegExp(`^${prefixLetters}[- ]*(.*)$`));
    if (match) {
      remainder = match[1];
    } else {
      remainder = trimmed;
    }
  }

  // Keep alphanumeric characters for the identifier/number portion
  const cleanSuffix = remainder.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!cleanSuffix) {
    return '';
  }

  return `${cleanPrefix}${cleanSuffix}`;
}

/**
 * Formats a year-based document field, e.g. "RR-<year>-" or "PO-<year>-".
 */
export function formatYearDashField(
  raw: string, 
  typePrefix: 'RR' | 'PO', 
  defaultYear: number = CURRENT_YEAR
): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const upper = trimmed.toUpperCase();
  const basePrefix = `${typePrefix}-`;

  // If user backspaced down to or into the base prefix or year prefix, clear the field completely
  if (
    basePrefix.startsWith(upper) || 
    upper === basePrefix || 
    upper === `${basePrefix}${defaultYear}` || 
    upper === `${basePrefix}${defaultYear}-`
  ) {
    return '';
  }

  // Check if string includes explicit 4-digit year, e.g. RR-2025-123 or PO-2026-456
  const match = upper.match(new RegExp(`^${typePrefix}[- ]?(\\d{4})[- ]*(.*)$`));
  if (match) {
    const year = match[1];
    const remainder = match[2] ? match[2].replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '';
    if (!remainder) {
      return '';
    }
    return `${typePrefix}-${year}-${remainder}`;
  }

  // If user typed without prefix:
  const cleaned = trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!cleaned) {
    return '';
  }

  // If user typed the 4-digit year first, e.g. 20261234
  if (cleaned.startsWith(String(defaultYear)) && cleaned.length > 4) {
    return `${typePrefix}-${defaultYear}-${cleaned.slice(4)}`;
  }

  return `${typePrefix}-${defaultYear}-${cleaned}`;
}

// Convenient pre-bound formatters
export const formatAutoDashRR = (val: string) => formatYearDashField(val, 'RR');
export const formatAutoDashPO = (val: string) => formatYearDashField(val, 'PO');
export const formatAutoDashDR = (val: string) => formatPrefixedDashField(val, 'DR-');
export const formatAutoDashSI = (val: string) => formatPrefixedDashField(val, 'SI-');
export const formatAutoDashWB = (val: string) => formatPrefixedDashField(val, 'WB-LBC-');
export const formatAutoDashPartCode = (val: string) => formatPrefixedDashField(val, 'RM-RE-');
export const formatAutoDashLot = (val: string) => formatPrefixedDashField(val, 'LOT-');
