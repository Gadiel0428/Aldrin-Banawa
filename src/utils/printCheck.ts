/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Print Check sample generation, barcode comparison, and verification helpers.
 */

import type {
  PrintCheckDocVerification,
  PrintCheckDocumentType,
} from '../../shared/types';
import { getManilaTodayString } from '../lib/businessDate';

export const PRINT_CHECK_DOC_TYPES: readonly PrintCheckDocumentType[] = [
  'REQUISITION',
  'PICKING_LIST',
  'GATE_PASS',
  'QR_BADGE',
] as const;

export const PRINT_CHECK_PREFIXES: Record<PrintCheckDocumentType, string> = {
  REQUISITION: 'CHK-REQ',
  PICKING_LIST: 'CHK-PCK',
  GATE_PASS: 'CHK-GP',
  QR_BADGE: 'CHK-QRB',
};

const RECENT_PRINTERS_KEY = 'juwei_wms_recent_printers';
const LOCAL_PRINT_CHECK_LOGS_KEY = 'juwei_wms_print_check_logs';

export function generateSampleBarcodeToken(randomValue?: number): string {
  const raw = typeof randomValue === 'number' ? randomValue : Math.random();
  const clamped = Math.max(0, Math.min(0.9999, Math.abs(raw)));
  const num = Math.floor(1000 + clamped * 9000);
  return String(num);
}

export function createSamplePrintCheckCodes(
  businessDate?: string,
  tokenOverride?: string
): Record<PrintCheckDocumentType, string> {
  const cleanDate = (businessDate || getManilaTodayString()).replace(/-/g, '').slice(2, 8);
  const token = (tokenOverride || generateSampleBarcodeToken()).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6) || '1001';

  return {
    REQUISITION: `${PRINT_CHECK_PREFIXES.REQUISITION}-${cleanDate}-${token}`,
    PICKING_LIST: `${PRINT_CHECK_PREFIXES.PICKING_LIST}-${cleanDate}-${token}`,
    GATE_PASS: `${PRINT_CHECK_PREFIXES.GATE_PASS}-${cleanDate}-${token}`,
    QR_BADGE: `${PRINT_CHECK_PREFIXES.QR_BADGE}-${cleanDate}-${token}`,
  };
}

/**
 * Extracts normalized barcode text from raw scanner output.
 * Handles plain barcode strings and JSON QR payloads containing `sampleCode` / `code`.
 */
export function extractScannedPrintCheckCode(rawScanned: string): string {
  const trimmed = String(rawScanned ?? '').trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const candidate = parsed?.sampleCode ?? parsed?.code ?? parsed?.barcode ?? parsed?.id;
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    } catch {
      // Fall through to literal value
    }
  }

  return trimmed;
}

export function doesScannedBarcodeMatch(expectedCode: string, scannedCode: string): boolean {
  const cleanExpected = String(expectedCode ?? '').trim().toUpperCase();
  const cleanScanned = extractScannedPrintCheckCode(scannedCode).toUpperCase();
  if (!cleanExpected || !cleanScanned) return false;
  return cleanExpected === cleanScanned;
}

export function evaluatePrintCheckVerification(
  documents: PrintCheckDocVerification[]
): {
  matchedCount: number;
  totalCount: number;
  allScanned: boolean;
  allConfirmed: boolean;
  overallStatus: 'PASS' | 'FAIL';
} {
  const totalCount = documents.length;
  let matchedCount = 0;
  let scannedCount = 0;

  for (const doc of documents) {
    const hasScan = extractScannedPrintCheckCode(doc.scannedCode).length > 0;
    if (hasScan) scannedCount++;
    if (doc.confirmedMatch && doesScannedBarcodeMatch(doc.expectedCode, doc.scannedCode)) {
      matchedCount++;
    }
  }

  const allScanned = totalCount > 0 && scannedCount === totalCount;
  const allConfirmed = totalCount === 4 && matchedCount === 4;

  return {
    matchedCount,
    totalCount,
    allScanned,
    allConfirmed,
    overallStatus: allConfirmed ? 'PASS' : 'FAIL',
  };
}

export function loadRecentPrinters(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_PRINTERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function saveRecentPrinter(printerName: string): string[] {
  const clean = String(printerName || '').trim();
  if (!clean) return loadRecentPrinters();
  const existing = loadRecentPrinters().filter(
    (p) => p.toLowerCase() !== clean.toLowerCase()
  );
  const updated = [clean, ...existing].slice(0, 8);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(RECENT_PRINTERS_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage failures
    }
  }
  return updated;
}

export function loadCachedPrintCheckLogs<T>(): T[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_PRINT_CHECK_LOGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function saveCachedPrintCheckLogs<T>(logs: T[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_PRINT_CHECK_LOGS_KEY, JSON.stringify(logs.slice(0, 200)));
  } catch {
    // Ignore storage failures
  }
}
