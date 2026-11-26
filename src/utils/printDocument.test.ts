/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the A4 page-break planner in printDocument.ts
 */

import { describe, it, expect } from 'vitest';
import {
  A4_PORTRAIT_HEIGHT_PX,
  A4_PORTRAIT_WIDTH_PX,
  CLONE_WIDTH_PX,
  planDocumentPageBreaks,
} from './printDocument';

describe('planDocumentPageBreaks (printDocument.ts)', () => {
  it('returns empty pages plan for zero or negative canvas dimensions', () => {
    const zeroHeight = planDocumentPageBreaks({ canvasWidth: 2154, canvasHeight: 0 });
    expect(zeroHeight.pages).toEqual([]);

    const zeroWidth = planDocumentPageBreaks({ canvasWidth: 0, canvasHeight: 1000 });
    expect(zeroWidth.pages).toEqual([]);
  });

  it('fits a short document onto a single page without extra breaks', () => {
    const plan = planDocumentPageBreaks({
      canvasWidth: 2154, // 718 * 3
      canvasHeight: 1800,
      domWidth: CLONE_WIDTH_PX,
    });

    expect(plan.domToCanvasScale).toBe(3);
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0]).toMatchObject({
      pageNumber: 1,
      startY: 0,
      endY: 1800,
      height: 1800,
    });
    expect(plan.pages[0].destDrawHeight).toBeLessThanOrEqual(plan.destContentHeight);
  });

  it('splits tall canvas across multiple pages cleanly when no keep-together blocks cross boundaries', () => {
    const basePlan = planDocumentPageBreaks({
      canvasWidth: A4_PORTRAIT_WIDTH_PX,
      canvasHeight: 100,
    });
    const maxSlice = basePlan.maxSrcSliceHeight;

    const totalHeight = maxSlice * 2 + 400;
    const plan = planDocumentPageBreaks({
      canvasWidth: A4_PORTRAIT_WIDTH_PX,
      canvasHeight: totalHeight,
    });

    expect(plan.pages).toHaveLength(3);
    expect(plan.pages[0]).toMatchObject({ startY: 0, endY: maxSlice, height: maxSlice });
    expect(plan.pages[1]).toMatchObject({ startY: maxSlice, endY: maxSlice * 2, height: maxSlice });
    expect(plan.pages[2]).toMatchObject({ startY: maxSlice * 2, endY: totalHeight, height: 400 });
  });

  it('moves page break before a crossing tr / .avoid-break block so rows are never sliced in half', () => {
    const canvasWidth = 2154; // 718 * 3
    const probe = planDocumentPageBreaks({
      canvasWidth,
      canvasHeight: 100,
      domWidth: CLONE_WIDTH_PX,
    });
    const maxSlice = probe.maxSrcSliceHeight;
    // In DOM coordinates (1/3 of canvas px): idealEnd is at maxSlice / 3
    const idealDomEnd = maxSlice / 3;

    // Place a table row crossing the ideal boundary (starts 40 DOM px before idealEnd, ends 60 DOM px after)
    const blockTopDom = Math.floor(idealDomEnd - 40);
    const blockBottomDom = Math.ceil(idealDomEnd + 60);
    const totalCanvasHeight = maxSlice + 900;

    const plan = planDocumentPageBreaks({
      canvasWidth,
      canvasHeight: totalCanvasHeight,
      domWidth: CLONE_WIDTH_PX,
      rawRanges: [
        { top: 10, bottom: 100 },
        { top: blockTopDom, bottom: blockBottomDom },
        { top: blockBottomDom + 10, bottom: blockBottomDom + 80 },
      ],
    });

    expect(plan.pages).toHaveLength(2);
    const expectedBreakCanvasY = Math.floor(blockTopDom * 3);
    expect(plan.pages[0].endY).toBe(expectedBreakCanvasY);
    expect(plan.pages[1].startY).toBe(expectedBreakCanvasY);
    expect(plan.pages[1].endY).toBe(totalCanvasHeight);
  });

  it('picks the earliest crossing block when multiple nested or sibling blocks cross idealEnd', () => {
    const canvasWidth = 2000;
    const domWidth = 1000; // scale = 2
    const probe = planDocumentPageBreaks({ canvasWidth, canvasHeight: 100, domWidth });
    const idealDomEnd = probe.maxSrcSliceHeight / 2;

    const outerTopDom = Math.floor(idealDomEnd - 120);
    const innerTopDom = Math.floor(idealDomEnd - 30);

    const plan = planDocumentPageBreaks({
      canvasWidth,
      canvasHeight: probe.maxSrcSliceHeight + 500,
      domWidth,
      rawRanges: [
        { top: innerTopDom, bottom: idealDomEnd + 40 },
        { top: outerTopDom, bottom: idealDomEnd + 100 },
      ],
    });

    expect(plan.pages[0].endY).toBe(Math.floor(outerTopDom * 2));
    expect(plan.pages[1].startY).toBe(Math.floor(outerTopDom * 2));
  });

  it('guarantees forward progress when an oversized block starts at or before y + minProgressPx', () => {
    const canvasWidth = 2154;
    const probe = planDocumentPageBreaks({
      canvasWidth,
      canvasHeight: 100,
      domWidth: CLONE_WIDTH_PX,
    });
    const maxSlice = probe.maxSrcSliceHeight;
    const totalHeight = maxSlice + 500;

    // A massive single block starting at top=1 (canvas y=3 <= minProgressPx=8) and spanning past maxSlice
    const plan = planDocumentPageBreaks({
      canvasWidth,
      canvasHeight: totalHeight,
      domWidth: CLONE_WIDTH_PX,
      rawRanges: [{ top: 1, bottom: (maxSlice + 200) / 3 }],
    });

    // Must fall back to idealEnd (maxSlice) instead of stalling at y=3 or looping infinitely
    expect(plan.pages).toHaveLength(2);
    expect(plan.pages[0].endY).toBe(maxSlice);
    expect(plan.pages[1].startY).toBe(maxSlice);
    expect(plan.pages[1].endY).toBe(totalHeight);
  });

  it('supports custom page dimensions and margins while maintaining contiguous slices', () => {
    const plan = planDocumentPageBreaks({
      canvasWidth: 1000,
      canvasHeight: 2500,
      domWidth: 500,
      pageWidthPx: 1200,
      pageHeightPx: 1600,
      marginXPx: 100,
      marginYPx: 100,
    });

    expect(plan.destContentWidth).toBe(1000);
    expect(plan.destContentHeight).toBe(1400);
    expect(plan.srcToDestRatio).toBe(1);
    expect(plan.maxSrcSliceHeight).toBe(1400);
    expect(plan.pages).toEqual([
      { pageNumber: 1, startY: 0, endY: 1400, height: 1400, destDrawHeight: 1400 },
      { pageNumber: 2, startY: 1400, endY: 2500, height: 1100, destDrawHeight: 1100 },
    ]);
    // Verify portrait defaults match ISO A4 constants
    const defaults = planDocumentPageBreaks({ canvasWidth: 1000, canvasHeight: 500 });
    expect(defaults.marginXPx).toBe(Math.round((10 / 210) * A4_PORTRAIT_WIDTH_PX));
    expect(defaults.marginYPx).toBe(Math.round((10 / 297) * A4_PORTRAIT_HEIGHT_PX));
  });
});
