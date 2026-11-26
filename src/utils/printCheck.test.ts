/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { PrintCheckDocVerification } from '../../shared/types';
import {
  createSamplePrintCheckCodes,
  doesScannedBarcodeMatch,
  evaluatePrintCheckVerification,
  extractScannedPrintCheckCode,
} from './printCheck';

describe('Print check verification helpers', () => {
  it('generates distinct sample barcodes for requisition, picking list, gate pass, and QR badge', () => {
    const codes = createSamplePrintCheckCodes('2026-11-25', '4821');
    expect(codes.REQUISITION).toBe('CHK-REQ-261125-4821');
    expect(codes.PICKING_LIST).toBe('CHK-PCK-261125-4821');
    expect(codes.GATE_PASS).toBe('CHK-GP-261125-4821');
    expect(codes.QR_BADGE).toBe('CHK-QRB-261125-4821');
    expect(new Set(Object.values(codes)).size).toBe(4);
  });

  it('matches plain barcodes case-insensitively and handles JSON QR payloads', () => {
    expect(doesScannedBarcodeMatch('CHK-REQ-261125-4821', 'chk-req-261125-4821 ')).toBe(true);
    expect(doesScannedBarcodeMatch('CHK-REQ-261125-4821', 'CHK-PCK-261125-4821')).toBe(false);
    expect(doesScannedBarcodeMatch('CHK-REQ-261125-4821', '')).toBe(false);

    const qrPayload = JSON.stringify({
      type: 'JPMP_PRINT_CHECK_QR_BADGE',
      sampleCode: 'CHK-QRB-261125-4821',
    });
    expect(extractScannedPrintCheckCode(qrPayload)).toBe('CHK-QRB-261125-4821');
    expect(doesScannedBarcodeMatch('CHK-QRB-261125-4821', qrPayload)).toBe(true);
  });

  it('requires all 4 documents to match and be operator-confirmed for PASS status', () => {
    const passingDocs: PrintCheckDocVerification[] = [
      { docType: 'REQUISITION', expectedCode: 'CHK-REQ-1', scannedCode: 'CHK-REQ-1', confirmedMatch: true },
      { docType: 'PICKING_LIST', expectedCode: 'CHK-PCK-1', scannedCode: 'CHK-PCK-1', confirmedMatch: true },
      { docType: 'GATE_PASS', expectedCode: 'CHK-GP-1', scannedCode: 'CHK-GP-1', confirmedMatch: true },
      { docType: 'QR_BADGE', expectedCode: 'CHK-QRB-1', scannedCode: 'CHK-QRB-1', confirmedMatch: true },
    ];
    expect(evaluatePrintCheckVerification(passingDocs)).toEqual({
      matchedCount: 4,
      totalCount: 4,
      allScanned: true,
      allConfirmed: true,
      overallStatus: 'PASS',
    });

    // Matched scan without operator confirmation still fails until confirmed
    const unconfirmedDocs: PrintCheckDocVerification[] = passingDocs.map((d, idx) =>
      idx === 3 ? { ...d, confirmedMatch: false } : d
    );
    expect(evaluatePrintCheckVerification(unconfirmedDocs)).toEqual({
      matchedCount: 3,
      totalCount: 4,
      allScanned: true,
      allConfirmed: false,
      overallStatus: 'FAIL',
    });

    // Forged confirmedMatch=true when scannedCode mismatches does not count as matched
    const mismatchedDocs: PrintCheckDocVerification[] = passingDocs.map((d, idx) =>
      idx === 0 ? { ...d, scannedCode: 'WRONG-CODE', confirmedMatch: true } : d
    );
    expect(evaluatePrintCheckVerification(mismatchedDocs)).toEqual({
      matchedCount: 3,
      totalCount: 4,
      allScanned: true,
      allConfirmed: false,
      overallStatus: 'FAIL',
    });
  });
});
