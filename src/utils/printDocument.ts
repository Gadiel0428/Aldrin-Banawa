/**
 * Utility for printing A4 documents with exact parity between screen preview and paper output.
 * 
 * Creates a hidden, isolated iframe (width: 210mm, off-screen, NOT display:none)
 * populated with document stylesheets, font resources, and standard @page { size: A4; margin: 10mm; }
 * rules. Renders a clean clone of the printable element without modal backdrops, screen zoom transforms,
 * or UI controls.
 */

export function printElementAsA4(el: HTMLElement | null | undefined): void {
  if (!el || typeof document === 'undefined') {
    console.warn('[printElementAsA4] Valid HTMLElement is required for printing');
    return;
  }

  // 1. Build hidden iframe: position fixed, off-screen, width 210mm, border 0; NOT display:none
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = '210mm';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.style.margin = '0';
  iframe.style.padding = '0';
  iframe.style.visibility = 'hidden';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');

  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    return;
  }

  // 2. Copy every <style> and <link rel="stylesheet"> from document.head (so Tailwind classes still work)
  const headElements: string[] = [];
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    headElements.push(node.outerHTML);
  });

  const extraStyles = `
    @page { size: A4; margin: 10mm; }
    html, body { margin:0; padding:0; background:#fff !important; color:#000; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-shadow:none !important; }
    .no-print { display:none !important; }
    table { width:100%; table-layout:fixed; border-collapse:collapse; }
    thead { display: table-header-group; } tr, .avoid-break { page-break-inside: avoid; }
  `;

  // 3. Put in the body ONLY a deep clone of el
  const clone = el.cloneNode(true) as HTMLElement;

  // On the clone root remove inline transform, zoom, width, min-width, max-width, height, position, padding and overflow, and set width:100%
  clone.style.removeProperty('transform');
  clone.style.removeProperty('zoom');
  clone.style.removeProperty('width');
  clone.style.removeProperty('min-width');
  clone.style.removeProperty('max-width');
  clone.style.removeProperty('height');
  clone.style.removeProperty('min-height');
  clone.style.removeProperty('max-height');
  clone.style.removeProperty('position');
  clone.style.removeProperty('padding');
  clone.style.removeProperty('padding-top');
  clone.style.removeProperty('padding-bottom');
  clone.style.removeProperty('padding-left');
  clone.style.removeProperty('padding-right');
  clone.style.removeProperty('overflow');
  clone.style.removeProperty('overflow-x');
  clone.style.removeProperty('overflow-y');
  clone.style.removeProperty('box-shadow');
  clone.style.width = '100%';
  clone.style.margin = '0';
  clone.style.background = '#ffffff';

  // 4. Remove from the clone everything with .no-print, plus the zoom/fit/guide controls and the dashed "10MM PRINT MARGIN GUIDE" overlay
  clone.querySelectorAll('.no-print').forEach((node) => node.remove());
  clone.querySelectorAll('[aria-label*="Margin Guide"], [title*="Margin"], .margin-guide-overlay').forEach((node) => node.remove());

  // Write content into iframe document
  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${document.title || 'JUWEI WMS Document'}</title>
  ${headElements.join('\n')}
  <style>
    ${extraStyles}
  </style>
</head>
<body>
</body>
</html>`);
  doc.close();

  doc.body.appendChild(clone);

  // 5. Wait for stylesheets and document.fonts.ready in the iframe, then call iframe.contentWindow.focus() and print(); remove on afterprint
  const contentWin = iframe.contentWindow;
  if (!contentWin) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    return;
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    } catch (e) {}
  };

  const executeIframePrint = () => {
    try {
      contentWin.addEventListener('afterprint', cleanup);
      // Fallback cleanup in case afterprint does not fire
      setTimeout(cleanup, 120000);

      contentWin.focus();
      contentWin.print();
    } catch (err) {
      console.error('[printElementAsA4] Error printing document in iframe:', err);
      cleanup();
    }
  };

  const linkElements = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
  const linkPromises = linkElements.map((link) => {
    if ((link as any).sheet) return Promise.resolve();
    return new Promise<void>((resolve) => {
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => resolve());
      setTimeout(resolve, 500); // 500ms safety fallback
    });
  });

  const fontPromise = doc.fonts ? doc.fonts.ready.catch(() => {}) : Promise.resolve();

  Promise.all([...linkPromises, fontPromise])
    .then(() => {
      setTimeout(executeIframePrint, 50);
    })
    .catch(() => {
      setTimeout(executeIframePrint, 100);
    });
}

/**
 * Convenience helper to find the active .printable-area and dispatch printElementAsA4
 */
export function executePrint(targetElement?: HTMLElement | null): void {
  const el = targetElement || (document.querySelector('.printable-area') as HTMLElement | null);
  if (el) {
    printElementAsA4(el);
  } else if (typeof window !== 'undefined') {
    window.print();
  }
}
