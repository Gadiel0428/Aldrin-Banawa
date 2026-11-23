/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test suite for Asia/Manila Business Dates & Audit Timestamps
 */

import { formatDateToManila, getUtcAuditTimestamp } from './businessDate';

function runBusinessDateTests() {
  console.log('Running businessDate tests...');

  // Test 1: Record saved at 00:30 Manila time on Nov 23, 2026.
  // 00:30 Manila time (UTC+8) corresponds to 2026-11-22T16:30:00.000Z in UTC.
  // In pure UTC, this is Nov 22. But in Manila local time, it is Nov 23.
  const recordSavedAt0030Manila = new Date('2026-11-22T16:30:00.000Z');
  const businessDate = formatDateToManila(recordSavedAt0030Manila);
  
  console.log(`Input UTC time: ${recordSavedAt0030Manila.toISOString()}`);
  console.log(`Resolved Manila Business Date: ${businessDate}`);

  if (businessDate !== '2026-11-23') {
    throw new Error(`Expected business date to be 2026-11-23 for 00:30 Manila time, got ${businessDate}`);
  }

  // Test 2: Audit timestamp uses UTC
  const auditTs = getUtcAuditTimestamp(recordSavedAt0030Manila);
  if (!auditTs.endsWith('Z')) {
    throw new Error(`Expected audit timestamp to be in UTC (ending with Z), got ${auditTs}`);
  }

  console.log('ALL BUSINESS DATE TESTS PASSED SUCCESSFULLY!');
}

runBusinessDateTests();
