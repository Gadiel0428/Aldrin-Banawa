/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  CODE128_PATTERNS,
  CODE128_START_B,
  CODE128_STOP,
  encodeCode128B,
} from './barcode128';

describe('Code 128-B barcode encoder', () => {
  it('verifies every ISO/IEC 15417 pattern has valid module widths (11 for data, 13 for Stop)', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.forEach((pattern, idx) => {
      const widths = pattern.split('').map(Number);
      const sum = widths.reduce((a, b) => a + b, 0);
      if (idx === CODE128_STOP) {
        expect(widths).toHaveLength(7);
        expect(sum).toBe(13);
      } else {
        expect(widths).toHaveLength(6);
        expect(sum).toBe(11);
      }
    });
  });

  it('encodes sample requisition, picking list, and gate pass barcodes with Start B, checksum, Stop, and quiet zones', () => {
    const samples = ['CHK-REQ-261125-4821', 'CHK-PCK-261125-4821', 'CHK-GP-261125-4821'];
    for (const sample of samples) {
      const encoded = encodeCode128B(sample, 10);
      expect(encoded.text).toBe(sample);
      expect(encoded.codeValues[0]).toBe(CODE128_START_B);
      expect(encoded.codeValues[encoded.codeValues.length - 1]).toBe(CODE128_STOP);
      expect(encoded.codeValues).toHaveLength(sample.length + 3); // Start B + chars + Checksum + Stop

      // Verify modulo-103 checksum independently
      let weightedSum = CODE128_START_B;
      for (let i = 0; i < sample.length; i++) {
        weightedSum += (i + 1) * (sample.charCodeAt(i) - 32);
      }
      expect(encoded.checksum).toBe(weightedSum % 103);
      expect(encoded.codeValues[encoded.codeValues.length - 2]).toBe(weightedSum % 103);

      // Total modules = 2 * quietZone + (StartB + data + checksum)*11 + Stop(13)
      const expectedDataModules = (sample.length + 2) * 11 + 13;
      expect(encoded.totalModules).toBe(20 + expectedDataModules);
      expect(encoded.binaryPattern).toHaveLength(expectedDataModules);
      expect(encoded.bars[0]?.x).toBe(10);
    }
  });

  it('decodes generated binary bar/space pattern back to exact original text', () => {
    const input = 'CHK-REQ-261125-9042';
    const encoded = encodeCode128B(input);

    // Parse run-lengths back into symbols
    const bin = encoded.binaryPattern;
    let cursor = 0;
    const decodedChars: string[] = [];
    let symbolIndex = 0;
    let readStop = false;

    while (cursor < bin.length && !readStop) {
      // Stop symbol is last 13 bits
      if (bin.length - cursor === 13) {
        expect(bin.slice(cursor)).toBe('1100011101011');
        readStop = true;
        break;
      }

      const slice = bin.slice(cursor, cursor + 11);
      cursor += 11;

      const runs: number[] = [];
      let runLen = 1;
      for (let i = 1; i < slice.length; i++) {
        if (slice[i] === slice[i - 1]) {
          runLen++;
        } else {
          runs.push(runLen);
          runLen = 1;
        }
      }
      runs.push(runLen);

      const widthStr = runs.join('');
      const value = CODE128_PATTERNS.indexOf(widthStr);
      expect(value).toBeGreaterThanOrEqual(0);

      if (symbolIndex === 0) {
        expect(value).toBe(CODE128_START_B);
      } else if (cursor < bin.length - 13) {
        // Data symbol (exclude checksum right before 13-bit stop)
        decodedChars.push(String.fromCharCode(value + 32));
      } else {
        expect(value).toBe(encoded.checksum);
      }
      symbolIndex++;
    }

    expect(readStop).toBe(true);
    expect(decodedChars.join('')).toBe(input);
  });

  it('rejects empty or non-ASCII Code 128-B strings', () => {
    expect(() => encodeCode128B('   ')).toThrow();
    expect(() => encodeCode128B('ABC-中文')).toThrow();
  });
});
