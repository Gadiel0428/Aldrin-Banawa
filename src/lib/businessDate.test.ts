/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test suite for Asia/Manila Business Dates & Audit Timestamps
 */

import { describe, it, expect } from 'vitest';
import {
  TIMEZONE_ASIA_MANILA,
  getManilaTodayString,
  formatDateToManila,
  getUtcAuditTimestamp,
  addDaysToManilaDate,
  compareManilaDates,
} from './businessDate';

describe('businessDate utilities (Asia/Manila)', () => {
  it('defines the Asia/Manila timezone constant', () => {
    expect(TIMEZONE_ASIA_MANILA).toBe('Asia/Manila');
  });

  it('rolls UTC evening over to next Manila calendar day (00:30 Manila = 16:30Z prev day)', () => {
    const recordSavedAt0030Manila = new Date('2026-11-22T16:30:00.000Z');
    expect(formatDateToManila(recordSavedAt0030Manila)).toBe('2026-11-23');
    expect(getManilaTodayString(recordSavedAt0030Manila)).toBe('2026-11-23');
  });

  it('stays on same Manila day just before Manila midnight (23:59 Manila = 15:59Z)', () => {
    const justBeforeManilaMidnight = new Date('2026-11-22T15:59:59.999Z');
    expect(formatDateToManila(justBeforeManilaMidnight)).toBe('2026-11-22');
  });

  it('handles epoch millisecond numbers and ISO date strings', () => {
    const epochMs = Date.UTC(2026, 0, 1, 16, 0, 0); // 2026-01-02 00:00 Manila
    expect(getManilaTodayString(epochMs)).toBe('2026-01-02');
    expect(formatDateToManila('2026-05-10T18:00:00.000Z')).toBe('2026-05-11');
  });

  it('falls back gracefully for null, undefined, or invalid date inputs', () => {
    const expectedToday = getManilaTodayString();
    expect(formatDateToManila(null)).toBe(expectedToday);
    expect(formatDateToManila(undefined)).toBe(expectedToday);
    expect(getManilaTodayString('not-a-valid-date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats UTC audit timestamps ending in Z', () => {
    const ts = getUtcAuditTimestamp(new Date('2026-11-22T16:30:00.000Z'));
    expect(ts).toBe('2026-11-22T16:30:00.000Z');
    expect(ts.endsWith('Z')).toBe(true);

    const fallbackTs = getUtcAuditTimestamp('invalid-date');
    expect(fallbackTs.endsWith('Z')).toBe(true);
    expect(Number.isNaN(Date.parse(fallbackTs))).toBe(false);
  });

  it('adds and subtracts days accurately across month, year, and leap-year boundaries', () => {
    expect(addDaysToManilaDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToManilaDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToManilaDate('2024-02-28', 1)).toBe('2024-02-29'); // leap year
    expect(addDaysToManilaDate('2026-02-28', 1)).toBe('2026-03-01'); // non-leap year
    expect(addDaysToManilaDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToManilaDate('2026-11-15T12:00:00Z', 5)).toBe('2026-11-20');
  });

  it('falls back to Manila today when addDaysToManilaDate receives invalid input', () => {
    expect(addDaysToManilaDate('bad-date', 3)).toBe(getManilaTodayString());
  });

  it('compares Manila YYYY-MM-DD date strings chronologically', () => {
    expect(compareManilaDates('2026-11-01', '2026-11-02')).toBeLessThan(0);
    expect(compareManilaDates('2026-11-02', '2026-11-02')).toBe(0);
    expect(compareManilaDates('2026-11-03', '2026-11-02')).toBeGreaterThan(0);
    expect(compareManilaDates(' 2026-11-02T08:00:00Z ', '2026-11-02')).toBe(0);
  });
});
