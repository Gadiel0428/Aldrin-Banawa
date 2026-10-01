/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

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
  if (!el || typeof document === 'undefined') {
    console.warn('[exportElementAsPDF] Valid HTMLElement is required for PDF export');
    return;
  }

  const safeFilename = (filename || 'JUWEI-WMS-Document.pdf').replace(/[/\\?%*:|"<>]/g, '_');
  const cleanFilename = safeFilename.endsWith('.pdf') ? safeFilename : `${safeFilename}.pdf`;

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
  if (typeof window !== 'undefined' && window.electronAPI?.openGeneratedPDF) {
    try {
      const arrayBuffer = pdf.output('arraybuffer');
      const res = await window.electronAPI.openGeneratedPDF(arrayBuffer, cleanFilename);
      if (res && res.success) {
        return;
      }
    } catch (err) {
      console.warn('[exportElementAsPDF] Electron openGeneratedPDF failed, falling back to browser blob URL:', err);
    }
  }

  // Browser / Web fallback: open generated PDF as a blob URL in a new tab
  try {
    const blob = pdf.output('blob');
    const blobUrl = URL.createObjectURL(blob);
    const newTab = window.open(blobUrl, '_blank');
    if (!newTab) {
      // If popup blocker intervened, save the PDF file directly
      pdf.save(cleanFilename);
    }
  } catch (e) {
    pdf.save(cleanFilename);
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
