/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure TypeScript ISO/IEC 15417 Code 128 (Code Set B) encoder & geometry helper.
 * Produces real scannable 1D barcode module bars for SVG rendering and printing.
 */

// Code 128 bar/space width patterns for values 0..106 (ISO/IEC 15417)
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', // 0..7
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', // 8..15
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', // 16..23
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', // 24..31
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', // 32..39
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', // 40..47
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', // 48..55
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', // 56..63
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', // 64..71
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', // 72..79
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', // 80..87
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', // 88..95
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', // 96..103 (Start A = 103)
  '211214', '211232', '2331112', // 104 (Start B), 105 (Start C), 106 (Stop, 13 modules)
];

export const CODE128_START_B = 104;
export const CODE128_STOP = 106;

export interface Code128Bar {
  x: number;
  width: number;
}

export interface Code128EncodingResult {
  text: string;
  codeValues: number[];
  checksum: number;
  quietZoneModules: number;
  totalModules: number;
  bars: Code128Bar[];
  binaryPattern: string;
}

export function encodeCode128B(rawText: string, quietZoneModules: number = 10): Code128EncodingResult {
  const sanitized = String(rawText ?? '').trim();
  if (!sanitized) {
    throw new Error('Cannot encode an empty Code 128 barcode.');
  }

  const dataValues: number[] = [];
  for (let i = 0; i < sanitized.length; i++) {
    const charCode = sanitized.charCodeAt(i);
    if (charCode < 32 || charCode > 126) {
      throw new Error(`Unsupported Code 128 Set B character at index ${i}: "${sanitized[i]}"`);
    }
    dataValues.push(charCode - 32);
  }

  let weightedSum = CODE128_START_B;
  for (let i = 0; i < dataValues.length; i++) {
    weightedSum += (i + 1) * dataValues[i];
  }
  const checksum = weightedSum % 103;

  const codeValues = [CODE128_START_B, ...dataValues, checksum, CODE128_STOP];
  const quiet = Math.max(10, Math.floor(quietZoneModules));
  const bars: Code128Bar[] = [];
  let binaryPattern = '';
  let cursorX = quiet;

  for (const val of codeValues) {
    const pattern = CODE128_PATTERNS[val];
    if (!pattern) {
      throw new Error(`Missing Code 128 pattern for value ${val}`);
    }
    for (let idx = 0; idx < pattern.length; idx++) {
      const w = Number(pattern[idx]);
      const isBar = idx % 2 === 0;
      binaryPattern += (isBar ? '1' : '0').repeat(w);
      if (isBar) {
        bars.push({ x: cursorX, width: w });
      }
      cursorX += w;
    }
  }

  const totalModules = cursorX + quiet;

  return {
    text: sanitized,
    codeValues,
    checksum,
    quietZoneModules: quiet,
    totalModules,
    bars,
    binaryPattern,
  };
}
