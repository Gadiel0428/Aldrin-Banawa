/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// ISO A4 @ 300 DPI dimensions
export const A4_PORTRAIT_WIDTH_PX = 2480;
export const A4_PORTRAIT_HEIGHT_PX = 3508;
export const A4_LANDSCAPE_WIDTH_PX = 3508;
export const A4_LANDSCAPE_HEIGHT_PX = 2480;
export const A4_MARGIN_MM = 10;
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
export const CLONE_WIDTH_PX = 718;

export interface PageBreakBlockRange {
  top: number;
  bottom: number;
}

export interface PlannedPageSlice {
  pageNumber: number;
  startY: number;
  endY: number;
  height: number;
  destDrawHeight: number;
}

export interface PageBreakPlanOptions {
  canvasWidth: number;
  canvasHeight: number;
  domWidth?: number;
  rawRanges?: PageBreakBlockRange[];
  pageWidthPx?: number;
  pageHeightPx?: number;
  marginXPx?: number;
  marginYPx?: number;
  minProgressPx?: number;
}

export interface PageBreakPlanResult {
  marginXPx: number;
  marginYPx: number;
  destContentWidth: number;
  destContentHeight: number;
  maxSrcSliceHeight: number;
  srcToDestRatio: number;
  domToCanvasScale: number;
  pages: PlannedPageSlice[];
}

/**
 * Computes A4 page slice boundaries for a rasterized document canvas while avoiding
 * mid-element splits across `tr` / `.avoid-break` DOM ranges.
 */
export function planDocumentPageBreaks(options: PageBreakPlanOptions): PageBreakPlanResult {
  const {
    canvasWidth,
    canvasHeight,
    domWidth = 0,
    rawRanges = [],
    pageWidthPx = A4_PORTRAIT_WIDTH_PX,
    pageHeightPx = A4_PORTRAIT_HEIGHT_PX,
    marginXPx = Math.round((A4_MARGIN_MM / A4_WIDTH_MM) * pageWidthPx),
    marginYPx = Math.round((A4_MARGIN_MM / A4_HEIGHT_MM) * pageHeightPx),
    minProgressPx = 8,
  } = options;

  const destContentWidth = Math.max(1, pageWidthPx - marginXPx * 2);
  const destContentHeight = Math.max(1, pageHeightPx - marginYPx * 2);

  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return {
      marginXPx,
      marginYPx,
      destContentWidth,
      destContentHeight,
      maxSrcSliceHeight: 0,
      srcToDestRatio: 0,
      domToCanvasScale: 3,
      pages: [],
    };
  }

  const srcToDestRatio = destContentWidth / canvasWidth;
  const maxSrcSliceHeight = Math.max(1, Math.floor(destContentHeight / srcToDestRatio));
  const domToCanvasScale = domWidth > 0 ? canvasWidth / domWidth : 3;

  const canvasRanges = rawRanges
    .filter((r) => Number.isFinite(r.top) && Number.isFinite(r.bottom) && r.bottom > r.top && r.bottom > 0)
    .map((r) => ({
      top: r.top * domToCanvasScale,
      bottom: r.bottom * domToCanvasScale,
    }))
    .sort((a, b) => a.top - b.top);

  const pages: PlannedPageSlice[] = [];
  let y = 0;

  while (y < canvasHeight) {
    const idealEnd = Math.min(y + maxSrcSliceHeight, canvasHeight);
    let nextY = idealEnd;

    if (idealEnd < canvasHeight) {
      // Avoid cutting through any tr or .avoid-break element
      const crossingBlocks = canvasRanges.filter(
        (range) => range.top < idealEnd && range.bottom > idealEnd && range.top > y + minProgressPx
      );
      if (crossingBlocks.length > 0) {
        const earliestBoundary = Math.floor(Math.min(...crossingBlocks.map((b) => b.top)));
        if (earliestBoundary > y + minProgressPx) {
          nextY = earliestBoundary;
        }
      }
    }

    if (nextY <= y) {
      nextY = idealEnd;
    }

    const sliceHeight = nextY - y;
    const destDrawHeight = Math.min(destContentHeight, Math.round(sliceHeight * srcToDestRatio));

    pages.push({
      pageNumber: pages.length + 1,
      startY: y,
      endY: nextY,
      height: sliceHeight,
      destDrawHeight,
    });

    y = nextY;
  }

  return {
    marginXPx,
    marginYPx,
    destContentWidth,
    destContentHeight,
    maxSrcSliceHeight,
    srcToDestRatio,
    domToCanvasScale,
    pages,
  };
}

/**
 * Formats any caught error into a readable user-facing message.
 */
export function formatPrintErrorMessage(err: unknown, fallback = 'Unexpected error during print/PDF preparation'): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'string' && err.trim()) {
    return err.trim();
  }
  return fallback;
}

/**
 * Renders an accessible, non-blocking in-app toast notification banner.
 */
export function showPrintToast(
  message: string,
  type: 'error' | 'info' | 'warning' = 'error'
): void {
  if (typeof document === 'undefined') return;

  let container = document.getElementById('juwei-print-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'juwei-print-toast-container';
    container.setAttribute('aria-live', 'assertive');
    container.style.cssText =
      'position:fixed;top:20px;right:20px;z-index:999999;max-width:460px;pointer-events:auto;display:flex;flex-direction:column;gap:10px;';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.setAttribute('role', 'alert');
  const isErr = type === 'error';
  const isWarn = type === 'warning';
  toast.style.cssText = `
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    background: ${isErr ? '#7f1d1d' : isWarn ? '#78350f' : '#1e1b4b'};
    color: #ffffff;
    border: 1.5px solid ${isErr ? '#ef4444' : isWarn ? '#f59e0b' : '#818cf8'};
    border-radius: 12px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.45;
    opacity: 1;
    transform: translateY(0);
    transition: opacity 0.25s ease, transform 0.25s ease;
  `;

  const icon = document.createElement('div');
  icon.style.cssText = 'flex-shrink:0;margin-top:1px;';
  icon.innerHTML = isErr
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
    : isWarn
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

  const text = document.createElement('div');
  text.style.cssText = 'flex:1;word-break:break-word;';
  text.innerText = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close notification');
  closeBtn.style.cssText =
    'flex-shrink:0;background:transparent;border:none;color:#ffffff;opacity:0.75;cursor:pointer;padding:2px;font-size:18px;line-height:1;margin-left:4px;';
  closeBtn.innerHTML = '&times;';
  closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
  closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.75'; };

  const removeToast = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 250);
  };

  closeBtn.onclick = removeToast;
  toast.appendChild(icon);
  toast.appendChild(text);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  setTimeout(removeToast, 8000);
}

const UNSUPPORTED_COLOR_FN_REGEX = /(?:^|[^a-zA-Z0-9_-])(oklch|oklab|lab|lch|color-mix|color)\s*\(/i;

/**
 * Expands CSS custom property references (`var(--...)`) across multiple passes so nested
 * theme variables (e.g. Tailwind v4 `--color-*` or `--tw-*`) can be color-resolved cleanly.
 */
function expandCssVariables(
  input: string,
  rootStyles?: CSSStyleDeclaration | null
): string {
  if (!input || !rootStyles || !input.includes('var(')) {
    return input;
  }

  let current = input;
  for (let pass = 0; pass < 4; pass++) {
    if (!current.includes('var(')) break;
    const next = current.replace(
      /var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*([^()]+))?\s*\)/g,
      (_m, varName: string, fallback?: string) => {
        const val = rootStyles.getPropertyValue(varName)?.trim();
        if (val) return val;
        return fallback ? fallback.trim() : 'transparent';
      }
    );
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Resolves a single CSS color expression (e.g. oklch(...), color-mix(...)) to rgba(...)
 * using a 2D canvas context. Returns null if the browser cannot parse the expression.
 */
function resolveSingleColorExpr(
  expr: string,
  samplerCtx: CanvasRenderingContext2D,
  cache: Map<string, string | null>
): string | null {
  const key = expr.trim();
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  let resolved: string | null = null;
  try {
    samplerCtx.fillStyle = '#010203';
    samplerCtx.fillStyle = key;
    let accepted = samplerCtx.fillStyle !== '#010203';
    if (!accepted) {
      samplerCtx.fillStyle = '#040506';
      samplerCtx.fillStyle = key;
      accepted = samplerCtx.fillStyle !== '#040506';
    }
    if (accepted) {
      samplerCtx.clearRect(0, 0, 1, 1);
      samplerCtx.fillRect(0, 0, 1, 1);
      const data = samplerCtx.getImageData(0, 0, 1, 1).data;
      const alpha = Math.round((data[3] / 255) * 1000) / 1000;
      resolved = `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${alpha})`;
    }
  } catch {
    resolved = null;
  }

  cache.set(key, resolved);
  return resolved;
}

/**
 * Replaces every modern CSS color function (oklch, oklab, lab, lch, color-mix, color)
 * inside arbitrary CSS text (computed values, gradients, shadows, stylesheet rules)
 * using balanced parenthesis matching so nested calls are converted cleanly.
 */
function sanitizeCssColorText(
  input: string,
  samplerCtx: CanvasRenderingContext2D | null,
  cache: Map<string, string | null>,
  rootStyles?: CSSStyleDeclaration | null
): string {
  if (!input || !samplerCtx) {
    return input;
  }
  const hasVar = input.includes('var(');
  if (!hasVar && !UNSUPPORTED_COLOR_FN_REGEX.test(input)) {
    return input;
  }

  const working = hasVar ? expandCssVariables(input, rootStyles) : input;
  if (!UNSUPPORTED_COLOR_FN_REGEX.test(working)) {
    return input;
  }

  const fnStartRegex = /(?:^|[^a-zA-Z0-9_-])(oklch|oklab|color-mix|color|lab|lch)\s*\(/gi;
  let result = '';
  let lastIndex = 0;

  while (true) {
    fnStartRegex.lastIndex = lastIndex;
    const match = fnStartRegex.exec(working);
    if (!match) {
      result += working.slice(lastIndex);
      break;
    }

    const fnNameOffset = match[0].toLowerCase().indexOf(match[1].toLowerCase());
    const start = match.index + (fnNameOffset >= 0 ? fnNameOffset : 0);
    const openParenIdx = match.index + match[0].length - 1;

    let depth = 0;
    let end = openParenIdx;
    for (let i = openParenIdx; i < working.length; i++) {
      const ch = working[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (depth !== 0) {
      result += working.slice(lastIndex);
      break;
    }

    result += working.slice(lastIndex, start);
    const fullExpr = working.slice(start, end + 1);

    const resolved = resolveSingleColorExpr(fullExpr, samplerCtx, cache);
    if (resolved) {
      result += resolved;
    } else if (/var\(/i.test(fullExpr)) {
      result += 'rgba(15, 23, 42, 0.15)';
    } else {
      result += 'rgba(15, 23, 42, 1)';
    }

    lastIndex = end + 1;
  }

  // Final guard against any unbalanced/malformed residual tokens
  if (UNSUPPORTED_COLOR_FN_REGEX.test(result)) {
    result = result.replace(/(^|[^a-zA-Z0-9_-])(oklch|oklab|color-mix|color|lab|lch)\s*\([^)]*\)?/gi, '$1rgba(15, 23, 42, 1)');
  }

  return result;
}

/**
 * Wraps CSSStyleDeclaration returned by getComputedStyle so any property accessed by
 * html2canvas (including webkitTextStrokeColor, textDecorationColor, borders, shadows,
 * gradients, getPropertyValue, etc.) never surfaces oklch/oklab/color-mix/lab/lch/color().
 */
function createSanitizedComputedStyleProxy(
  styleDecl: CSSStyleDeclaration,
  samplerCtx: CanvasRenderingContext2D | null,
  cache: Map<string, string | null>,
  rootStyles?: CSSStyleDeclaration | null
): CSSStyleDeclaration {
  if (!samplerCtx) return styleDecl;

  return new Proxy(styleDecl, {
    get(target, prop) {
      const raw = (target as any)[prop];
      if (typeof raw === 'function') {
        if (prop === 'getPropertyValue') {
          return (name: string) => {
            const val = target.getPropertyValue(name);
            if (typeof val === 'string' && val && UNSUPPORTED_COLOR_FN_REGEX.test(val)) {
              return sanitizeCssColorText(val, samplerCtx, cache, rootStyles);
            }
            return val;
          };
        }
        return raw.bind(target);
      }
      if (typeof raw === 'string' && raw && UNSUPPORTED_COLOR_FN_REGEX.test(raw)) {
        return sanitizeCssColorText(raw, samplerCtx, cache, rootStyles);
      }
      return raw;
    },
  });
}

const COLOR_STYLE_PROPS: Array<[string, keyof CSSStyleDeclaration]> = [
  ['color', 'color'],
  ['background-color', 'backgroundColor'],
  ['background-image', 'backgroundImage'],
  ['border-top-color', 'borderTopColor'],
  ['border-right-color', 'borderRightColor'],
  ['border-bottom-color', 'borderBottomColor'],
  ['border-left-color', 'borderLeftColor'],
  ['border-image-source', 'borderImageSource'],
  ['outline-color', 'outlineColor'],
  ['text-decoration-color', 'textDecorationColor'],
  ['-webkit-text-stroke-color', 'webkitTextStrokeColor'],
  ['list-style-image', 'listStyleImage'],
  ['caret-color', 'caretColor'],
  ['accent-color', 'accentColor'],
  ['column-rule-color', 'columnRuleColor'],
  ['box-shadow', 'boxShadow'],
  ['text-shadow', 'textShadow'],
  ['fill', 'fill' as keyof CSSStyleDeclaration],
  ['stroke', 'stroke' as keyof CSSStyleDeclaration],
  ['stop-color', 'stopColor' as keyof CSSStyleDeclaration],
];

/**
 * Strips unsupported CSS color functions across stylesheets and computed styles of a document subtree.
 */
function normalizeDocumentColorsForHtml2Canvas(
  targetDoc: Document,
  targetRoot: HTMLElement,
  samplerCtx: CanvasRenderingContext2D | null,
  cache: Map<string, string | null>
): void {
  if (!samplerCtx) return;
  const win = targetDoc.defaultView || window;
  const rootStyles = win.getComputedStyle(targetDoc.documentElement);

  // 1. Rewrite inline <style> blocks (using both textContent and CSSOM rules) and accessible <link> sheets
  const styleElements = Array.from(targetDoc.querySelectorAll('style'));
  styleElements.forEach((styleEl) => {
    let cssText = styleEl.textContent || '';
    if (!cssText) {
      try {
        const sheet = styleEl.sheet as CSSStyleSheet | null;
        if (sheet && sheet.cssRules) {
          cssText = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
        }
      } catch {
        // Ignore
      }
    }
    if (cssText && UNSUPPORTED_COLOR_FN_REGEX.test(cssText)) {
      styleEl.textContent = sanitizeCssColorText(cssText, samplerCtx, cache, rootStyles);
    }
  });

  try {
    const parentCssByHref = new Map<string, string>();
    Array.from(document.styleSheets || []).forEach((s) => {
      try {
        if (s.href) {
          const css = Array.from(s.cssRules || []).map((r) => r.cssText).join('\n');
          if (css) parentCssByHref.set(s.href, css);
        }
      } catch {
        // Ignore cross-origin parent stylesheet
      }
    });

    const linkElements = Array.from(targetDoc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
    linkElements.forEach((linkEl) => {
      let combinedCss = '';
      try {
        const sheet = linkEl.sheet as CSSStyleSheet | null;
        if (sheet && sheet.cssRules) {
          combinedCss = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
        }
      } catch {
        // Fallback below
      }
      if (!combinedCss && linkEl.href && parentCssByHref.has(linkEl.href)) {
        combinedCss = parentCssByHref.get(linkEl.href) || '';
      }
      if (combinedCss && UNSUPPORTED_COLOR_FN_REGEX.test(combinedCss)) {
        const replacementStyle = targetDoc.createElement('style');
        replacementStyle.textContent = sanitizeCssColorText(combinedCss, samplerCtx, cache, rootStyles);
        linkEl.parentNode?.replaceChild(replacementStyle, linkEl);
      }
    });
  } catch {
    // Ignore stylesheet traversal errors
  }

  // 2. Neutralize root html/body dark theme oklch classes inside clonedDoc
  if (targetDoc.documentElement) {
    targetDoc.documentElement.style.setProperty('background', '#ffffff', 'important');
    targetDoc.documentElement.style.setProperty('background-color', '#ffffff', 'important');
    targetDoc.documentElement.style.setProperty('color', '#0f172a', 'important');
    targetDoc.documentElement.style.setProperty('-webkit-text-stroke-color', '#0f172a', 'important');
  }
  if (targetDoc.body) {
    targetDoc.body.style.setProperty('background', '#ffffff', 'important');
    targetDoc.body.style.setProperty('background-color', '#ffffff', 'important');
    targetDoc.body.style.setProperty('color', '#0f172a', 'important');
    targetDoc.body.style.setProperty('-webkit-text-stroke-color', '#0f172a', 'important');
    targetDoc.body.style.setProperty('box-shadow', 'none', 'important');
  }

  // 3. Normalize CSS custom properties and computed color properties on every element in cloned document
  const elementsToNormalize: Element[] = [
    ...(targetDoc.documentElement ? [targetDoc.documentElement] : []),
    ...(targetDoc.body ? [targetDoc.body] : []),
    targetRoot,
    ...Array.from(targetRoot.querySelectorAll('*')),
  ];

  const visited = new Set<Element>();
  elementsToNormalize.forEach((el) => {
    if (visited.has(el)) return;
    visited.add(el);
    const htmlOrSvg = el as HTMLElement | SVGElement;
    if (!htmlOrSvg.style) return;

    const computed = win.getComputedStyle(el);
    COLOR_STYLE_PROPS.forEach(([kebabProp, camelProp]) => {
      const val = String((computed as any)[camelProp] || '');
      if (val && UNSUPPORTED_COLOR_FN_REGEX.test(val)) {
        const sanitized = sanitizeCssColorText(val, samplerCtx, cache, rootStyles);
        htmlOrSvg.style.setProperty(kebabProp, sanitized, 'important');
      }
    });
  });
}

/**
 * Copies live canvas bitmaps from the source subtree into the cloned subtree.
 */
function syncCanvases(sourceRoot: HTMLElement, cloneRoot: HTMLElement): void {
  const srcCanvases = sourceRoot.querySelectorAll('canvas');
  const dstCanvases = cloneRoot.querySelectorAll('canvas');
  srcCanvases.forEach((srcCanvas, idx) => {
    const dstCanvas = dstCanvases[idx];
    if (!dstCanvas) return;
    try {
      dstCanvas.width = srcCanvas.width;
      dstCanvas.height = srcCanvas.height;
      const ctx = dstCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(srcCanvas, 0, 0);
      }
    } catch {
      // Ignore tainted source canvas
    }
  });
}

/**
 * Replaces form controls (input, textarea, select) inside the off-screen clone with plain text nodes
 * matching their live DOM values and typography.
 */
function replaceFormFieldsWithText(sourceRoot: HTMLElement, cloneRoot: HTMLElement): void {
  const srcFields = Array.from(sourceRoot.querySelectorAll('input, textarea, select')) as Array<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >;
  const dstFields = Array.from(cloneRoot.querySelectorAll('input, textarea, select')) as Array<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >;

  dstFields.forEach((dstField, idx) => {
    const srcField = srcFields[idx];
    const parent = dstField.parentElement;
    if (!parent) return;

    const computed = window.getComputedStyle(dstField);
    const replacement = document.createElement('span');

    let displayValue = '';
    if (dstField instanceof HTMLInputElement) {
      const liveChecked = srcField instanceof HTMLInputElement ? srcField.checked : dstField.checked;
      const liveValue = srcField instanceof HTMLInputElement ? srcField.value : dstField.value;
      if (dstField.type === 'checkbox' || dstField.type === 'radio') {
        displayValue = liveChecked ? '☑' : '☐';
      } else {
        displayValue = liveValue || '';
      }
    } else if (dstField instanceof HTMLTextAreaElement) {
      displayValue = (srcField instanceof HTMLTextAreaElement ? srcField.value : dstField.value) || '';
    } else if (dstField instanceof HTMLSelectElement) {
      const selectedIdx = srcField instanceof HTMLSelectElement ? srcField.selectedIndex : dstField.selectedIndex;
      const selectedOpt = dstField.options[selectedIdx];
      displayValue = selectedOpt ? selectedOpt.text : dstField.value || '';
    }

    replacement.textContent = displayValue;
    replacement.style.fontFamily = computed.fontFamily;
    replacement.style.fontSize = computed.fontSize;
    replacement.style.fontWeight = computed.fontWeight;
    replacement.style.lineHeight = computed.lineHeight;
    replacement.style.letterSpacing = computed.letterSpacing;
    replacement.style.textAlign = computed.textAlign;
    replacement.style.textTransform = computed.textTransform;
    replacement.style.color = computed.color || '#0f172a';
    replacement.style.display = dstField.classList.contains('w-full') ? 'block' : 'inline-block';
    if (dstField.classList.contains('w-full')) {
      replacement.style.width = '100%';
    }
    replacement.style.minHeight = computed.fontSize || '12px';
    replacement.style.whiteSpace = dstField instanceof HTMLTextAreaElement ? 'pre-wrap' : 'normal';
    replacement.style.wordBreak = 'break-word';
    replacement.style.border = 'none';
    replacement.style.background = 'transparent';
    replacement.style.padding = '0';
    replacement.style.margin = '0';

    parent.replaceChild(replacement, dstField);
  });
}

/**
 * Waits for all fonts and images within a root element to finish loading.
 */
async function waitForFontsAndImages(root: HTMLElement): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed even if custom webfont check fails
    }
  }

  const images = Array.from(root.querySelectorAll('img'));
  if (images.length === 0) return;

  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const timer = setTimeout(resolve, 4000);
          const done = () => {
            clearTimeout(timer);
            resolve();
          };
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        })
    )
  );
}

/**
 * Renders any DOM element into an array of crisp A4 PNG data URLs (2480x3508px, white background, 10mm margins).
 * Captures an off-screen 718px-wide clone with no transforms/zoom/overflow limits,
 * replaces inputs with text, awaits fonts and images, uses html2canvas scale 3 with allowTaint: false,
 * and respects table-row (tr) and .avoid-break page break boundaries.
 */
export async function renderDocumentPages(el: HTMLElement | null | undefined): Promise<string[]> {
  if (!el || typeof document === 'undefined') {
    throw new Error('Printable document element reference is not mounted.');
  }

  const offscreenHost = document.createElement('div');
  offscreenHost.setAttribute('aria-hidden', 'true');
  offscreenHost.style.cssText = [
    'position: fixed',
    'left: -100000px',
    'top: 0',
    `width: ${CLONE_WIDTH_PX}px`,
    `min-width: ${CLONE_WIDTH_PX}px`,
    `max-width: ${CLONE_WIDTH_PX}px`,
    'margin: 0',
    'padding: 0',
    'background: #ffffff',
    'color: #0f172a',
    'overflow: visible',
    'max-height: none',
    'height: auto',
    'transform: none',
    'zoom: 1',
    'pointer-events: none',
    'z-index: -9999',
  ].join(';');

  const clonedEl = el.cloneNode(true) as HTMLElement;
  clonedEl.style.width = `${CLONE_WIDTH_PX}px`;
  clonedEl.style.minWidth = `${CLONE_WIDTH_PX}px`;
  clonedEl.style.maxWidth = `${CLONE_WIDTH_PX}px`;
  clonedEl.style.height = 'auto';
  clonedEl.style.minHeight = '0';
  clonedEl.style.maxHeight = 'none';
  clonedEl.style.overflow = 'visible';
  clonedEl.style.overflowX = 'visible';
  clonedEl.style.overflowY = 'visible';
  clonedEl.style.transform = 'none';
  clonedEl.style.zoom = '1';
  clonedEl.style.margin = '0';
  clonedEl.style.padding = '0';
  clonedEl.style.backgroundColor = '#ffffff';
  clonedEl.style.color = '#0f172a';
  clonedEl.style.boxShadow = 'none';
  clonedEl.style.borderRadius = '0';

  offscreenHost.appendChild(clonedEl);
  document.body.appendChild(offscreenHost);

  try {
    // Strip UI-only & margin guide elements
    clonedEl
      .querySelectorAll('.no-print, [aria-label*="Margin Guide"], [title*="Margin"], .margin-guide-overlay')
      .forEach((node) => node.remove());

    // Handle Tailwind print-only visibility classes cleanly in off-screen clone
    clonedEl.querySelectorAll('.print\\:hidden').forEach((node) => node.remove());
    clonedEl.querySelectorAll<HTMLElement>('.hidden.print\\:inline, .hidden.print\\:block, .hidden.print\\:inline-block').forEach((node) => {
      node.classList.remove('hidden');
      if (node.classList.contains('print:inline')) node.style.display = 'inline';
      else if (node.classList.contains('print:inline-block')) node.style.display = 'inline-block';
      else node.style.display = 'block';
    });

    // Sync canvas & replace inputs/textarea/select with live text
    syncCanvases(el, clonedEl);
    replaceFormFieldsWithText(el, clonedEl);

    // Strip transforms, zoom, overflow and max-height restrictions across all descendants
    const samplerCanvas = document.createElement('canvas');
    samplerCanvas.width = 1;
    samplerCanvas.height = 1;
    const samplerCtx = samplerCanvas.getContext('2d', { willReadFrequently: true });
    const colorCache = new Map<string, string | null>();
    const rootComputedStyles = window.getComputedStyle(document.documentElement);

    const allNodes = [clonedEl, ...Array.from(clonedEl.querySelectorAll<HTMLElement>('*'))];
    allNodes.forEach((node) => {
      const style = window.getComputedStyle(node);

      if (style.transform && style.transform !== 'none') {
        node.style.transform = 'none';
      }
      if ((node.style as any).zoom && (node.style as any).zoom !== '1') {
        (node.style as any).zoom = '1';
      }
      if (style.overflow !== 'visible' || style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        // Keep SVGs & fixed small badges intact, unwrap scrollable/clipped layout containers
        if (!(node instanceof SVGElement)) {
          node.style.overflow = 'visible';
          node.style.overflowX = 'visible';
          node.style.overflowY = 'visible';
        }
      }
      if (style.maxHeight && style.maxHeight !== 'none') {
        node.style.maxHeight = 'none';
      }
      if ((style as any).backdropFilter && (style as any).backdropFilter !== 'none') {
        (node.style as any).backdropFilter = 'none';
        (node.style as any).webkitBackdropFilter = 'none';
      }

      // Allow table cells & truncated labels to wrap neatly inside 718px A4 printable width
      if (node.classList.contains('truncate')) {
        node.style.whiteSpace = 'normal';
        node.style.textOverflow = 'clip';
        node.style.overflow = 'visible';
      }

      // Normalize all computed modern CSS color functions on clone nodes beforehand
      COLOR_STYLE_PROPS.forEach(([kebabProp, camelProp]) => {
        const val = String((style as any)[camelProp] || '');
        if (val && UNSUPPORTED_COLOR_FN_REGEX.test(val)) {
          node.style.setProperty(
            kebabProp,
            sanitizeCssColorText(val, samplerCtx, colorCache, rootComputedStyles),
            'important'
          );
        }
      });
    });

    await waitForFontsAndImages(clonedEl);

    // Measure element boundaries before rasterizing so page breaks occur cleanly at tr / .avoid-break edges
    const rootRect = clonedEl.getBoundingClientRect();
    const keepTogetherElements = Array.from(clonedEl.querySelectorAll<HTMLElement>('tr, .avoid-break'));
    const rawRanges = keepTogetherElements
      .map((item) => {
        const r = item.getBoundingClientRect();
        return {
          top: r.top - rootRect.top,
          bottom: r.bottom - rootRect.top,
        };
      })
      .filter((r) => r.bottom > r.top && r.bottom > 0);

    const origGetComputedStyle = window.getComputedStyle.bind(window);
    const wrappedGetComputedStyle: typeof window.getComputedStyle = (targetElt: Element, pseudoElt?: string | null) => {
      const decl = origGetComputedStyle(targetElt, pseudoElt);
      return createSanitizedComputedStyleProxy(decl, samplerCtx, colorCache, rootComputedStyles);
    };

    let canvas: HTMLCanvasElement;
    window.getComputedStyle = wrappedGetComputedStyle;
    try {
      canvas = await html2canvas(clonedEl, {
        scale: 3,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: false,
        logging: false,
        width: CLONE_WIDTH_PX,
        windowWidth: CLONE_WIDTH_PX,
        onclone: (clonedDoc, clonedNode) => {
          normalizeDocumentColorsForHtml2Canvas(clonedDoc, clonedNode, samplerCtx, colorCache);
        },
      });
    } finally {
      window.getComputedStyle = origGetComputedStyle;
    }

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Rendered document canvas is empty.');
    }

    const plan = planDocumentPageBreaks({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      domWidth: rootRect.width,
      rawRanges,
    });

    const pages: string[] = plan.pages.map((slice) => {
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = A4_PORTRAIT_WIDTH_PX;
      pageCanvas.height = A4_PORTRAIT_HEIGHT_PX;

      const ctx = pageCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not initialize 2D canvas context for A4 page composition.');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, A4_PORTRAIT_WIDTH_PX, A4_PORTRAIT_HEIGHT_PX);

      ctx.drawImage(
        canvas,
        0,
        slice.startY,
        canvas.width,
        slice.height,
        plan.marginXPx,
        plan.marginYPx,
        plan.destContentWidth,
        slice.destDrawHeight
      );

      return pageCanvas.toDataURL('image/png');
    });

    if (pages.length === 0) {
      throw new Error('No A4 pages were produced from the document.');
    }

    return pages;
  } finally {
    if (offscreenHost.parentElement) {
      offscreenHost.parentElement.removeChild(offscreenHost);
    }
  }
}

/**
 * Renders a jsPDF document into crisp A4 PNG page data URLs using pdfjs-dist.
 */
export async function renderPdfDocToPages(doc: jsPDF): Promise<string[]> {
  if (!doc || typeof document === 'undefined') {
    throw new Error('Valid jsPDF document instance is required.');
  }

  const [pdfjsLib, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;

  const arrayBuffer = doc.output('arraybuffer');
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdfDoc = await loadingTask.promise;

  try {
    const pages: string[] = [];
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const isLandscape = baseViewport.width > baseViewport.height;
      const targetWidth = isLandscape ? A4_LANDSCAPE_WIDTH_PX : A4_PORTRAIT_WIDTH_PX;
      const targetHeight = isLandscape ? A4_LANDSCAPE_HEIGHT_PX : A4_PORTRAIT_HEIGHT_PX;

      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error(`Could not obtain canvas context for PDF page ${pageNum}.`);
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        intent: 'print',
      }).promise;

      pages.push(canvas.toDataURL('image/png'));
    }

    if (pages.length === 0) {
      throw new Error('PDF document rendered zero pages.');
    }

    return pages;
  } finally {
    await pdfDoc.cleanup();
    await loadingTask.destroy();
  }
}

/**
 * Inspects a page image data URL to determine its pixel dimensions.
 */
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || A4_PORTRAIT_WIDTH_PX, height: img.naturalHeight || A4_PORTRAIT_HEIGHT_PX });
    img.onerror = () => reject(new Error('Failed to decode rendered page image.'));
    img.src = dataUrl;
  });
}

/**
 * Prints an array of A4 page PNG data URLs via a hidden off-screen iframe.
 * Uses CSS @page { size: A4; margin: 0 } and img { display: block; width: 210mm; height: 297mm; page-break-after: always },
 * awaits all image loads, calls iframe.contentWindow.print(), and removes the iframe afterward.
 */
export async function printPages(pages: string[]): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('Printing requires a browser document environment.');
  }
  if (!pages || pages.length === 0) {
    throw new Error('No pages available to print.');
  }

  const firstDims = await getImageDimensions(pages[0]);
  const isLandscape = firstDims.width > firstDims.height;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;left:-99999px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;visibility:hidden;';

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (iframe.parentElement) {
      iframe.parentElement.removeChild(iframe);
    }
  };

  document.body.appendChild(iframe);

  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    const iframeWin = iframe.contentWindow;
    if (!iframeDoc || !iframeWin) {
      throw new Error('Could not initialize hidden print frame.');
    }

    const pageCss = isLandscape
      ? `
        @page { size: A4 landscape; margin: 0; }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        img { display: block; width: 297mm; height: 210mm; page-break-after: always; break-after: page; }
        img:last-child { page-break-after: auto; break-after: auto; }
      `
      : `
        @page { size: A4; margin: 0; }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        img { display: block; width: 210mm; height: 297mm; page-break-after: always; break-after: page; }
        img:last-child { page-break-after: auto; break-after: auto; }
      `;

    const imgTags = pages
      .map((src, idx) => `<img src="${src}" alt="Page ${idx + 1}" />`)
      .join('');

    iframeDoc.open();
    iframeDoc.write(`<!DOCTYPE html><html><head><style>${pageCss}</style></head><body>${imgTags}</body></html>`);
    iframeDoc.close();

    // Wait for every image inside the iframe to decode and load completely
    const imgs = Array.from(iframeDoc.querySelectorAll('img'));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve, reject) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }
            const timer = setTimeout(() => resolve(), 8000);
            img.addEventListener(
              'load',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true }
            );
            img.addEventListener(
              'error',
              () => {
                clearTimeout(timer);
                reject(new Error('Failed to load printable page image inside print frame.'));
              },
              { once: true }
            );
          })
      )
    );

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      iframeWin.addEventListener('afterprint', finish, { once: true });
      iframeWin.focus();
      iframeWin.print();

      // Fallback cleanup in environments where afterprint does not fire reliably
      setTimeout(finish, 15000);
    });
  } catch (err) {
    cleanup();
    throw err;
  }
}

/**
 * Builds a timestamped PDF filename ending in .pdf.
 */
function buildTimestampedPdfFilename(filename: string): string {
  const safeBase = (filename || 'JUWEI-WMS-Document')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\.pdf$/i, '');

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${safeBase}_${timestamp}.pdf`;
}

/**
 * Generates an A4 jsPDF containing full-page images and downloads it as a Blob
 * with a timestamped filename.
 */
export async function savePagesAsPdf(pages: string[], filename: string = 'JUWEI-WMS-Document.pdf'): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('PDF download requires a browser document environment.');
  }
  if (!pages || pages.length === 0) {
    throw new Error('No pages available to save as PDF.');
  }

  const firstDims = await getImageDimensions(pages[0]);
  const firstIsLandscape = firstDims.width > firstDims.height;

  const pdf = new jsPDF({
    orientation: firstIsLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  for (let i = 0; i < pages.length; i++) {
    const dims = i === 0 ? firstDims : await getImageDimensions(pages[i]);
    const isLandscape = dims.width > dims.height;
    const pageW = isLandscape ? A4_HEIGHT_MM : A4_WIDTH_MM;
    const pageH = isLandscape ? A4_WIDTH_MM : A4_HEIGHT_MM;

    if (i > 0) {
      pdf.addPage('a4', isLandscape ? 'landscape' : 'portrait');
    }
    pdf.addImage(pages[i], 'PNG', 0, 0, pageW, pageH);
  }

  const finalFilename = buildTimestampedPdfFilename(filename);
  const blob = pdf.output('blob');
  const blobUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = finalFilename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 2000);
}
