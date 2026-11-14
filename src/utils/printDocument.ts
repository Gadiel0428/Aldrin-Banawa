/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure pdfjs-dist worker via Vite ?url import
if (typeof window !== 'undefined' && pdfjsLib) {
  try {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfjsWorker;
  } catch (e) {
    console.warn('[pdfjs-dist] Failed to assign workerSrc:', e);
  }
}

// Module-level lock to ensure two exports cannot run concurrently
let isExportRunning = false;

export function acquireExportLock(): boolean {
  if (isExportRunning) return false;
  isExportRunning = true;
  return true;
}

export function releaseExportLock(): void {
  isExportRunning = false;
}

export function isExportInProgress(): boolean {
  return isExportRunning;
}

/**
 * On-screen toast banner so errors or status updates are never silent.
 */
export function showPrintToast(
  message: string,
  type: 'error' | 'info' | 'warning' | 'success' = 'error'
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
  const isSuccess = type === 'success';

  let bg = '#1e1b4b';
  let border = '#818cf8';
  if (isErr) {
    bg = '#7f1d1d';
    border = '#ef4444';
  } else if (isSuccess) {
    bg = '#064e3b';
    border = '#10b981';
  }

  toast.style.cssText = `
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    background: ${bg};
    color: #ffffff;
    border: 1.5px solid ${border};
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
  if (isErr) {
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
  } else if (isSuccess) {
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
  } else {
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="8"></line></svg>';
  }

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

/**
 * Capture an off-screen clone (718px wide, no transform/zoom/overflow limits,
 * input fields replaced by their text, fonts and images awaited, html2canvas scale 3, allowTaint false).
 * Cut pages only at table-row and .avoid-break boundaries; scale to one page if a single-page document
 * is up to 10% too tall. Draw each page onto a white 210x297mm canvas (2480x3508px) with 10mm margins baked in.
 * Returns PNG data URLs.
 */
export async function renderDocumentPages(el: HTMLElement | null | undefined): Promise<string[]> {
  if (!el || typeof document === 'undefined') {
    throw new Error('Valid HTMLElement is required for document rendering');
  }

  if (!acquireExportLock()) {
    throw new Error('A document export or print operation is already in progress. Please wait.');
  }

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-99999px';
  container.style.left = '-99999px';
  container.style.width = '718px';
  container.style.minWidth = '718px';
  container.style.maxWidth = '718px';
  container.style.margin = '0';
  container.style.padding = '0';
  container.style.border = 'none';
  container.style.background = '#ffffff';
  container.style.color = '#000000';
  container.style.overflow = 'visible';
  container.style.transform = 'none';
  container.style.zoom = '1';
  container.style.zIndex = '-9999';
  container.setAttribute('aria-hidden', 'true');

  try {
    const clone = el.cloneNode(true) as HTMLElement;

    // 1. Remove non-print elements and overlays
    clone.querySelectorAll(
      '.no-print, [aria-label*="Margin Guide"], [title*="Margin"], .margin-guide-overlay'
    ).forEach((node) => node.remove());

    // 2. Set root clone styles: 718px width, no transform, no overflow restrictions
    clone.style.width = '718px';
    clone.style.minWidth = '718px';
    clone.style.maxWidth = '718px';
    clone.style.margin = '0';
    clone.style.transform = 'none';
    clone.style.zoom = '1';
    clone.style.overflow = 'visible';
    clone.style.maxHeight = 'none';
    clone.style.height = 'auto';
    clone.style.boxSizing = 'border-box';
    clone.style.backgroundColor = '#ffffff';
    clone.style.color = '#000000';

    // 3. Clear overflow/transform limits on all descendants
    clone.querySelectorAll('*').forEach((node) => {
      const elem = node as HTMLElement;
      if (elem.style) {
        if (elem.style.transform && elem.style.transform !== 'none') elem.style.transform = 'none';
        if (elem.style.zoom && elem.style.zoom !== '1') elem.style.zoom = '1';
        if (
          elem.style.overflow === 'hidden' ||
          elem.style.overflow === 'auto' ||
          elem.style.overflow === 'scroll'
        ) {
          elem.style.overflow = 'visible';
        }
        if (elem.style.maxHeight && elem.style.maxHeight !== 'none') {
          elem.style.maxHeight = 'none';
        }
      }
    });

    // 4. Replace input fields, textareas, and selects with their actual text
    clone.querySelectorAll('input, textarea, select').forEach((control) => {
      const input = control as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const replacement = document.createElement('span');
      replacement.className = input.className;
      replacement.style.border = 'none';
      replacement.style.background = 'transparent';
      replacement.style.display = 'inline-block';
      replacement.style.color = '#000000';

      if (input instanceof HTMLInputElement && (input.type === 'checkbox' || input.type === 'radio')) {
        replacement.textContent = input.checked ? '☑' : '☐';
        replacement.style.fontSize = '12px';
      } else if (input instanceof HTMLSelectElement) {
        replacement.textContent = input.options[input.selectedIndex]?.text || input.value || '';
      } else {
        replacement.textContent = input.value || input.getAttribute('placeholder') || '';
      }
      input.parentNode?.replaceChild(replacement, input);
    });

    container.appendChild(clone);
    document.body.appendChild(container);

    // 5. Await fonts
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (_) {}
    }

    // 6. Await all images
    const images = Array.from(clone.querySelectorAll('img'));
    await Promise.all(
      images.map((img) => {
        if (img.complete && img.naturalHeight > 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
          setTimeout(resolve, 3000);
        });
      })
    );

    // 7. Measure break boundaries (table rows and .avoid-break elements)
    const cloneRect = clone.getBoundingClientRect();
    const cloneTop = cloneRect.top;

    interface Boundary {
      top: number;
      bottom: number;
    }
    const boundaries: Boundary[] = [];

    // Table rows
    clone.querySelectorAll('tr').forEach((tr) => {
      const rect = tr.getBoundingClientRect();
      const top = rect.top - cloneTop;
      const bottom = rect.bottom - cloneTop;
      if (bottom > top) {
        boundaries.push({ top, bottom });
      }
    });

    // Elements explicitly requesting break avoidance
    clone.querySelectorAll('.avoid-break, .page-break-inside-avoid, [style*="break-inside: avoid"], thead, tfoot').forEach((node) => {
      const elNode = node as HTMLElement;
      const rect = elNode.getBoundingClientRect();
      const top = rect.top - cloneTop;
      const bottom = rect.bottom - cloneTop;
      if (bottom > top) {
        boundaries.push({ top, bottom });
      }
    });

    // 8. High-resolution rasterization via html2canvas (scale: 3, allowTaint: false)
    const rawCanvas = await html2canvas(clone, {
      scale: 3,
      allowTaint: false,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: 718,
      windowWidth: 718
    });

    // Standard A4 at 300 DPI: 2480 x 3508 px
    const PAGE_WIDTH = 2480;
    const PAGE_HEIGHT = 3508;
    // 10mm margins on 210mm x 297mm sheet
    const MARGIN_X = Math.round((PAGE_WIDTH * 10) / 210); // 118 px
    const MARGIN_Y = Math.round((PAGE_HEIGHT * 10) / 297); // 118 px
    const PRINTABLE_WIDTH = PAGE_WIDTH - 2 * MARGIN_X; // 2244 px
    const PRINTABLE_HEIGHT = PAGE_HEIGHT - 2 * MARGIN_Y; // 3272 px

    // Target printable height in 718px coordinate system: 718 * (277 / 190) ≈ 1047px
    const TARGET_HEIGHT_CSS = (718 * 277) / 190;
    const canvasScale = rawCanvas.width / 718; // scale 3
    const targetCanvasPageHeight = TARGET_HEIGHT_CSS * canvasScale;

    // Single-page tolerance check: scale to 1 page if document is up to 10% too tall
    const totalCanvasHeight = rawCanvas.height;
    if (totalCanvasHeight <= targetCanvasPageHeight * 1.10) {
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = PAGE_WIDTH;
      pageCanvas.height = PAGE_HEIGHT;
      const ctx = pageCanvas.getContext('2d')!;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

      const drawScale = Math.min(
        PRINTABLE_WIDTH / rawCanvas.width,
        PRINTABLE_HEIGHT / rawCanvas.height
      );
      const drawWidth = rawCanvas.width * drawScale;
      const drawHeight = rawCanvas.height * drawScale;
      const drawX = MARGIN_X + (PRINTABLE_WIDTH - drawWidth) / 2;
      const drawY = MARGIN_Y;

      ctx.drawImage(rawCanvas, 0, 0, rawCanvas.width, rawCanvas.height, drawX, drawY, drawWidth, drawHeight);
      return [pageCanvas.toDataURL('image/png')];
    }

    // Multi-page document: slice cleanly at table-row and .avoid-break boundaries
    const totalCssHeight = rawCanvas.height / canvasScale;
    let currentYCss = 0;
    const pages: string[] = [];

    while (currentYCss < totalCssHeight - 2) {
      const remainingCss = totalCssHeight - currentYCss;

      let cutYCss: number;
      if (remainingCss <= TARGET_HEIGHT_CSS * 1.05) {
        cutYCss = totalCssHeight;
      } else {
        cutYCss = currentYCss + TARGET_HEIGHT_CSS;

        // Check if cutYCss cuts through any boundary
        const straddling = boundaries.filter((b) => b.top < cutYCss && b.bottom > cutYCss);
        if (straddling.length > 0) {
          const minTop = Math.min(...straddling.map((b) => b.top));
          // If minTop allows a reasonable slice height, cut before the element
          if (minTop > currentYCss + TARGET_HEIGHT_CSS * 0.35) {
            cutYCss = minTop;
          } else {
            // Find the latest valid bottom boundary before cutYCss
            const prevBottoms = boundaries
              .filter((b) => b.bottom <= cutYCss && b.bottom > currentYCss + TARGET_HEIGHT_CSS * 0.5)
              .map((b) => b.bottom);
            if (prevBottoms.length > 0) {
              cutYCss = Math.max(...prevBottoms);
            }
          }
        } else {
          // No direct straddle, but snap to nearest bottom boundary right before cutYCss
          const nearBottoms = boundaries
            .filter((b) => b.bottom <= cutYCss && b.bottom >= cutYCss - TARGET_HEIGHT_CSS * 0.25)
            .map((b) => b.bottom);
          if (nearBottoms.length > 0) {
            cutYCss = Math.max(...nearBottoms);
          }
        }
      }

      // Ensure positive progress
      if (cutYCss <= currentYCss) {
        cutYCss = Math.min(totalCssHeight, currentYCss + TARGET_HEIGHT_CSS);
      }

      const sliceTopCanvas = Math.round(currentYCss * canvasScale);
      const sliceHeightCanvas = Math.min(
        rawCanvas.height - sliceTopCanvas,
        Math.round((cutYCss - currentYCss) * canvasScale)
      );

      if (sliceHeightCanvas <= 0) break;

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = PAGE_WIDTH;
      pageCanvas.height = PAGE_HEIGHT;
      const ctx = pageCanvas.getContext('2d')!;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

      const destScale = PRINTABLE_WIDTH / rawCanvas.width;
      const destHeight = sliceHeightCanvas * destScale;

      ctx.drawImage(
        rawCanvas,
        0,
        sliceTopCanvas,
        rawCanvas.width,
        sliceHeightCanvas,
        MARGIN_X,
        MARGIN_Y,
        PRINTABLE_WIDTH,
        destHeight
      );

      pages.push(pageCanvas.toDataURL('image/png'));
      currentYCss = cutYCss;
    }

    return pages;
  } finally {
    if (container.parentElement) {
      container.parentElement.removeChild(container);
    }
    releaseExportLock();
  }
}

/**
 * Print rendered page images using a hidden off-screen iframe.
 * Uses exact @page { size: A4; margin: 0 } rules and cleans up upon afterprint or 60s timeout.
 */
export async function printPages(pages: string[]): Promise<void> {
  if (!pages || pages.length === 0) {
    throw new Error('No pages provided to print');
  }

  return new Promise<void>((resolve, reject) => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.top = '-10000px';
      iframe.style.left = '-10000px';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      iframe.setAttribute('aria-hidden', 'true');

      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        throw new Error('Unable to create print iframe context');
      }

      let isCleanedUp = false;
      const cleanup = () => {
        if (isCleanedUp) return;
        isCleanedUp = true;
        try {
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
        } catch (_) {}
        resolve();
      };

      const timeoutId = setTimeout(cleanup, 60000);

      if (iframe.contentWindow) {
        iframe.contentWindow.addEventListener('afterprint', () => {
          clearTimeout(timeoutId);
          cleanup();
        });
      }

      const imgElements = pages
        .map((p, idx) => `<img src="${p}" alt="Page ${idx + 1}" />`)
        .join('');

      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Print Document</title>
  <style>
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; background: #ffffff; }
    img { display: block; width: 210mm; height: 297mm; page-break-after: always; }
    img:last-child { page-break-after: auto; }
  </style>
</head>
<body>
  ${imgElements}
</body>
</html>`;

      doc.open();
      doc.write(htmlContent);
      doc.close();

      const imgs = Array.from(doc.querySelectorAll('img'));
      const loadPromises = imgs.map((img) => {
        if (img.complete && img.naturalHeight > 0) return Promise.resolve();
        return new Promise<void>((res) => {
          img.onload = () => res();
          img.onerror = () => res();
          setTimeout(res, 5000);
        });
      });

      Promise.all(loadPromises).then(() => {
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch (err) {
            clearTimeout(timeoutId);
            cleanup();
            reject(err);
          }
        }, 200);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Save rendered page images as standard A4 PDF (210x297mm full-page at 0,0)
 * and trigger client-side download with unique timestamped filename.
 */
export async function savePagesAsPdf(pages: string[], filename: string = 'document.pdf'): Promise<void> {
  if (!pages || pages.length === 0) {
    throw new Error('No pages provided to save');
  }

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) {
      pdf.addPage('a4', 'portrait');
    }
    pdf.addImage(pages[i], 'PNG', 0, 0, 210, 297);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = (filename || 'document')
    .replace(/\.pdf$/i, '')
    .replace(/[/\\?%*:|"<>]/g, '_');
  const finalFilename = `${safeName}-${timestamp}.pdf`;

  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Convert a jsPDF document into high-resolution PNG page images via pdfjs-dist.
 */
export async function renderPdfDocToPages(pdfDoc: jsPDF): Promise<string[]> {
  const arrayBuffer = pdfDoc.output('arraybuffer');
  return renderPdfBufferToPages(arrayBuffer);
}

/**
 * Convert a PDF ArrayBuffer or Uint8Array to PNG page images via pdfjs-dist.
 */
export async function renderPdfBufferToPages(pdfData: ArrayBuffer | Uint8Array): Promise<string[]> {
  const loadingTask = (pdfjsLib as any).getDocument({
    data: new Uint8Array(pdfData)
  });
  const pdf = await loadingTask.promise;
  const pageImages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    // Scale 3.0 produces ~300 DPI sharpness matching print output
    const viewport = page.getViewport({ scale: 3.0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    pageImages.push(canvas.toDataURL('image/png'));
  }

  return pageImages;
}

/**
 * Backwards compatibility helper for existing legacy callers.
 */
export async function exportElementAsPDF(
  el: HTMLElement | null | undefined,
  filename: string = 'JUWEI-WMS-Document.pdf'
): Promise<void> {
  try {
    const pages = await renderDocumentPages(el);
    await savePagesAsPdf(pages, filename);
  } catch (err: any) {
    showPrintToast(err?.message || 'Failed to export document PDF', 'error');
    throw err;
  }
}

export async function executePrint(targetElement?: HTMLElement | null, filename?: string): Promise<void> {
  if (targetElement) {
    const pages = await renderDocumentPages(targetElement);
    await printPages(pages);
  }
}

export async function printElementAsA4(el: HTMLElement | null | undefined, filename?: string): Promise<void> {
  if (el) {
    const pages = await renderDocumentPages(el);
    await printPages(pages);
  }
}

export default renderDocumentPages;
