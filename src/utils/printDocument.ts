/**
 * Utility for printing documents with exact parity between the Print Preview and physical paper.
 * 
 * In the Electron desktop environment:
 * Invokes window.electronAPI.printDocument() which calls webContents.printToPDF({
 *   pageSize: 'A4',
 *   printBackground: true,
 *   preferCSSPageSize: true,
 *   margins: { marginType: 'default' }
 * }), saves the PDF to a temporary file, and opens it via shell.openPath() in the
 * system default PDF reader. This allows users to print at 100% / Actual Size without
 * driver scaling discrepancies.
 * 
 * In a standard web browser:
 * Falls back seamlessly to window.print().
 */

export async function executePrint(customHtml?: string): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.printDocument) {
      const result = await window.electronAPI.printDocument(customHtml);
      if (result) return true;
    }
  } catch (err) {
    console.warn('[JUWEI WMS] Electron printToPDF failed, falling back to window.print():', err);
  }

  if (typeof window !== 'undefined') {
    window.print();
    return true;
  }
  return false;
}
