/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * Renders an accessible on-screen toast notification banner and alert prompt
 * so the user is never left without visible feedback when PDF opening or generation fails.
 */
export function showPrintToast(
  message: string,
  type: 'error' | 'info' | 'warning' = 'error'
): void {
  if (typeof document !== 'undefined') {
    let container = document.getElementById('juwei-print-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'juwei-print-toast-container';
      container.setAttribute('aria-live', 'assertive');
      container.style.cssText =
        'position:fixed;top:20px;right:20px;z-index:999999;max-width:440px;pointer-events:auto;display:flex;flex-direction:column;gap:10px;';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.setAttribute('role', 'alert');
    const isErr = type === 'error';
    toast.style.cssText = `
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      background: ${isErr ? '#7f1d1d' : '#1e1b4b'};
      color: #ffffff;
      border: 1.5px solid ${isErr ? '#ef4444' : '#818cf8'};
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

    // Auto-dismiss after 8 seconds
    setTimeout(removeToast, 8000);
  }

  // Also trigger window.alert if available (e.g. standard browser or Electron host)
  try {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message);
    }
  } catch (_) {
    // Suppressed in sandboxed frames
  }
}

/**
 * High-resolution A4 PDF generator using html2canvas and jsPDF.
 * Renders the printable DOM element into a crisp canvas (scale: 2) on a clean white background,
 * formats it into an A4 page (210 x 297mm) with 10mm margins on all sides,
 * handles multi-page content automatically, and opens it directly in the system's default PDF viewer (Electron)
 * or a new tab via Blob URL (Web).
 */
export async function exportElementAsPDF(
  el: HTMLElement | null | undefined,
  filename: string = 'JUWEI-WMS-Document.pdf'
): Promise<void> {
  const genericFailureMsg = 'Could not open the PDF — check that you have a PDF viewer installed, or check your Downloads folder';

  if (!el || typeof document === 'undefined') {
    console.warn('[exportElementAsPDF] Valid HTMLElement is required for PDF export');
    showPrintToast(genericFailureMsg, 'error');
    return;
  }

  const safeFilename = (filename || 'JUWEI-WMS-Document.pdf').replace(/[/\\?%*:|"<>]/g, '_');
  const cleanFilename = safeFilename.endsWith('.pdf') ? safeFilename : `${safeFilename}.pdf`;

  try {
    // 1. High-resolution canvas via html2canvas (scale: 2 for print-quality sharpness, plain white background)
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      allowTaint: true,
      windowWidth: el.scrollWidth || 1024,
      onclone: (clonedDoc, clonedEl) => {
        clonedEl.style.backgroundColor = '#ffffff';
        clonedEl.style.color = '#000000';
        // Strip UI controls, guides, and no-print elements
        clonedEl.querySelectorAll(
          '.no-print, [aria-label*="Margin Guide"], [title*="Margin"], .margin-guide-overlay'
        ).forEach((node) => node.remove());
      }
    });

    // 2. jsPDF document sized to standard A4 (210 x 297mm)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10; // 10mm margins on all sides matching @page { size: A4; margin: 10mm; }
    const printWidth = pageWidth - (margin * 2); // 190mm
    const printHeight = pageHeight - (margin * 2); // 277mm

    const imgWidth = printWidth;
    const totalImgHeight = (canvas.height * imgWidth) / canvas.width;

    if (totalImgHeight <= printHeight) {
      // Fits on a single A4 page
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', margin, margin, imgWidth, totalImgHeight);
    } else {
      // Taller than one A4 page: slice cleanly into A4-height pages
      const pageCanvasHeight = Math.floor((printHeight / imgWidth) * canvas.width);
      let yOffset = 0;
      let pageIndex = 0;

      while (yOffset < canvas.height) {
        const sliceHeight = Math.min(pageCanvasHeight, canvas.height - yOffset);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeight;

        const ctx = sliceCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(
            canvas,
            0,
            yOffset,
            canvas.width,
            sliceHeight,
            0,
            0,
            canvas.width,
            sliceHeight
          );
        }

        const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.95);
        const slicePdfHeight = (sliceHeight * imgWidth) / canvas.width;

        if (pageIndex > 0) {
          pdf.addPage('a4', 'portrait');
        }
        pdf.addImage(sliceData, 'JPEG', margin, margin, imgWidth, slicePdfHeight);

        yOffset += sliceHeight;
        pageIndex++;
      }
    }

    // 3. Electron vs Browser dispatch
    let electronSucceeded = false;
    if (typeof window !== 'undefined' && window.electronAPI?.openGeneratedPDF) {
      try {
        const arrayBuffer = pdf.output('arraybuffer');
        const res = await window.electronAPI.openGeneratedPDF(arrayBuffer, cleanFilename);
        if (res && res.success) {
          electronSucceeded = true;
          if (res.fallback === 'shown_in_folder') {
            showPrintToast(
              'PDF file saved and revealed in File Explorer. Please open it with your PDF viewer.',
              'info'
            );
          }
          return;
        } else {
          console.warn('[exportElementAsPDF] Electron openGeneratedPDF reported failure:', res?.error);
        }
      } catch (err) {
        console.warn('[exportElementAsPDF] Electron openGeneratedPDF failed, falling back to browser methods:', err);
      }
    }

    // Browser / Web fallback: open generated PDF as a blob URL in a new tab
    let browserWindowOpened = false;
    try {
      const blob = pdf.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      const newTab = window.open(blobUrl, '_blank');
      if (newTab) {
        browserWindowOpened = true;
        return;
      }
      console.warn('[exportElementAsPDF] window.open returned null or was blocked by popup blocker');
    } catch (e) {
      console.warn('[exportElementAsPDF] Failed to open blob URL in new window/tab:', e);
    }

    // Browser popup blocker fallback: save the PDF file directly via pdf.save()
    let saveSucceeded = false;
    try {
      pdf.save(cleanFilename);
      saveSucceeded = true;
    } catch (saveErr) {
      console.error('[exportElementAsPDF] pdf.save() fallback failed:', saveErr);
    }

    // If every method failed (Electron IPC failed AND browser window.open is blocked AND pdf.save() somehow fails)
    if (!electronSucceeded && !browserWindowOpened && !saveSucceeded) {
      console.error(`[exportElementAsPDF] ${genericFailureMsg}`);
      showPrintToast(genericFailureMsg, 'error');
    }
  } catch (fatalErr) {
    console.error('[exportElementAsPDF] Critical error generating PDF:', fatalErr);
    showPrintToast(genericFailureMsg, 'error');
  }
}

/**
 * Convenience helper to find the active .printable-area and dispatch exportElementAsPDF
 */
export async function executePrint(targetElement?: HTMLElement | null, filename?: string): Promise<void> {
  const el = targetElement || (document.querySelector('.printable-area') as HTMLElement | null);
  if (el) {
    await exportElementAsPDF(el, filename || 'JUWEI-WMS-Document.pdf');
  }
}

/**
 * Replaces old printElementAsA4 for backward-compatibility while routing to new PDF flow
 */
export async function printElementAsA4(el: HTMLElement | null | undefined, filename?: string): Promise<void> {
  await exportElementAsPDF(el, filename);
}

export default exportElementAsPDF;
