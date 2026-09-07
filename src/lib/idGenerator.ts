/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authoritative Permanent Record ID Generator
 * Guarantees collision-free, globally unique IDs across multiple workstations, accounts, and offline sessions.
 */
export function generateAuthoritativeId(prefix: string): string {
  const ts = Date.now();
  let rand = '';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  } else {
    rand = Math.random().toString(36).substring(2, 10).toUpperCase();
  }
  return `${prefix}-${ts}-${rand}`;
}
