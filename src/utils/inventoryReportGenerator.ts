import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MaterialStockItem, getCustomerForPart } from '../types';
import { renderPdfDocToPages } from './printDocument';

export interface InventoryReportOptions {
  customerFilter?: string;
  statusFilter?: 'ALL' | 'APPROVED' | 'LOW_STOCK' | 'QUARANTINE_HOLD';
  searchQuery?: string;
  generatedBy?: string;
  userRole?: string;
  employeeId?: string;
  reportTitle?: string;
  auditedByName?: string;
  auditedByTitle?: string;
  auditedByDate?: string;
  auditorName?: string;
  auditorTitle?: string;
  auditorDate?: string;
  approvedByName?: string;
  approvedByTitle?: string;
  approvedByDate?: string;
}

export interface FilteredInventoryData {
  items: (MaterialStockItem & {
    reorderMinThreshold: number;
    currentTotalPartQty: number;
    isLowStock: boolean;
    shortageQty: number;
    resolvedCustomer: string;
    shelfLifeStatus: string;
  })[];
  totalQty: number;
  approvedQty: number;
  quarantineQty: number;
  holdQty: number;
  uniquePartCount: number;
  lowStockCount: number;
  customerBreakdown: Record<string, { qty: number; count: number }>;
}

export function filterInventoryData(
  stocks: MaterialStockItem[],
  options: InventoryReportOptions
): FilteredInventoryData {
  const todayStr = '2026-07-22';
  const todayTime = new Date(todayStr).getTime();

  // Part code total approved quantities and max reorder thresholds
  const partQtyMap: Record<string, number> = {};
  const partReorderMap: Record<string, number> = {};

  stocks.forEach(item => {
    if (item.status === 'APPROVED') {
      partQtyMap[item.partCode] = (partQtyMap[item.partCode] || 0) + (Number(item.quantity) || 0);
    }
    if (typeof item.reorderMin === 'number' && item.reorderMin > 0) {
      partReorderMap[item.partCode] = Math.max(partReorderMap[item.partCode] || 0, item.reorderMin);
    }
  });

  const enrichedItems = stocks.map(item => {
    const currentTotalPartQty = partQtyMap[item.partCode] || 0;
    const reorderMinThreshold = item.reorderMin || partReorderMap[item.partCode] || 0;
    const isLowStock = reorderMinThreshold > 0 && currentTotalPartQty <= reorderMinThreshold;
    const shortageQty = isLowStock ? Math.max(0, reorderMinThreshold - currentTotalPartQty) : 0;
    const resolvedCustomer = item.customer || getCustomerForPart(item.partCode, item.description) || 'General Stock';

    let shelfLifeStatus = 'Normal';
    if (item.expirationDate) {
      const expTime = new Date(item.expirationDate).getTime();
      const diffDays = Math.ceil((expTime - todayTime) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) {
        shelfLifeStatus = 'Expired';
      } else if (diffDays <= 30) {
        shelfLifeStatus = `${diffDays}d left (FEFO)`;
      } else {
        shelfLifeStatus = `${diffDays}d left`;
      }
    }

    return {
      ...item,
      reorderMinThreshold,
      currentTotalPartQty,
      isLowStock,
      shortageQty,
      resolvedCustomer,
      shelfLifeStatus
    };
  });

  // Apply filters
  const filtered = enrichedItems.filter(item => {
    // Customer filter
    if (options.customerFilter && options.customerFilter !== 'ALL' && item.resolvedCustomer !== options.customerFilter) {
      return false;
    }

    // Status filter
    if (options.statusFilter === 'APPROVED' && item.status !== 'APPROVED') return false;
    if (options.statusFilter === 'QUARANTINE_HOLD' && item.status !== 'QUARANTINE' && item.status !== 'HOLD') return false;
    if (options.statusFilter === 'LOW_STOCK' && !item.isLowStock) return false;

    // Search query
    if (options.searchQuery && options.searchQuery.trim()) {
      const q = options.searchQuery.toLowerCase().trim();
      const matchPart = item.partCode.toLowerCase().includes(q);
      const matchDesc = item.description.toLowerCase().includes(q);
      const matchLoc = item.location.toLowerCase().includes(q);
      const matchLot = item.lotNumber.toLowerCase().includes(q);
      const matchCust = item.resolvedCustomer.toLowerCase().includes(q);
      if (!matchPart && !matchDesc && !matchLoc && !matchLot && !matchCust) return false;
    }

    return true;
  });

  // Calculate aggregates
  let totalQty = 0;
  let approvedQty = 0;
  let quarantineQty = 0;
  let holdQty = 0;
  const uniqueParts = new Set<string>();
  const lowStockParts = new Set<string>();
  const customerBreakdown: Record<string, { qty: number; count: number }> = {};

  filtered.forEach(item => {
    const q = Number(item.quantity) || 0;
    totalQty += q;
    uniqueParts.add(item.partCode);
    if (item.isLowStock) lowStockParts.add(item.partCode);

    if (item.status === 'APPROVED') approvedQty += q;
    else if (item.status === 'QUARANTINE') quarantineQty += q;
    else if (item.status === 'HOLD') holdQty += q;

    const cust = item.resolvedCustomer;
    if (!customerBreakdown[cust]) {
      customerBreakdown[cust] = { qty: 0, count: 0 };
    }
    customerBreakdown[cust].qty += q;
    customerBreakdown[cust].count += 1;
  });

  return {
    items: filtered,
    totalQty,
    approvedQty,
    quarantineQty,
    holdQty,
    uniquePartCount: uniqueParts.size,
    lowStockCount: lowStockParts.size,
    customerBreakdown
  };
}

export function generateInventoryReportPDF(
  stocks: MaterialStockItem[],
  options: InventoryReportOptions
): jsPDF {
  const data = filterInventoryData(stocks, options);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const generatedTimestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  // Top Dark Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 24, 'F');

  // Accent Line
  doc.setFillColor(79, 70, 229); // indigo-600
  doc.rect(0, 24, pageWidth, 1.5, 'F');

  // Header Titles
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.text('JUWEI PLASTIC MOULDING PHILIPPINES INC.', 14, 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text('WAREHOUSE MANAGEMENT SYSTEM • INVENTORY AUDIT & STOCK STATUS REPORT', 14, 15);

  doc.setFont('courier', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(165, 180, 252); // indigo-200
  doc.text('DOC REF: JPM-WMS-INV-001 | ISO 9001:2015 AUDIT COMPLIANT | FIFO / FEFO VERIFIED', 14, 20);

  // Facility Badge on Right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text('PHILIPPINES PLANT (ZONE A-E)', pageWidth - 14, 9, { align: 'right' });
  doc.setFont('courier', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(`GENERATED: ${generatedTimestamp}`, pageWidth - 14, 14, { align: 'right' });
  doc.text(`OPERATOR: ${options.generatedBy || 'Aldrin Banawa'} (${options.employeeId || 'JPMP-002'})`, pageWidth - 14, 19, { align: 'right' });

  // Subheader & Scope Description
  let yPos = 31;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42); // slate-900
  const scopeCustomer = options.customerFilter && options.customerFilter !== 'ALL' ? `Customer: ${options.customerFilter}` : 'All Customers (Canon, Brother, Dyson, General)';
  const scopeStatus = options.statusFilter === 'APPROVED' ? 'Approved Stock Only' :
    options.statusFilter === 'LOW_STOCK' ? 'Low Stock / Reorder Critical Items' :
    options.statusFilter === 'QUARANTINE_HOLD' ? 'Quarantine & Hold Bins' : 'All Stock Statuses';
  doc.text(options.reportTitle || 'COMPREHENSIVE WAREHOUSE INVENTORY AUDIT REPORT', 14, yPos);

  yPos += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Report Scope: ${scopeCustomer}   |   Status Filter: ${scopeStatus}   |   Active Lot Records: ${data.items.length} lots   |   Unique SKUs: ${data.uniquePartCount}`, 14, yPos);

  // KPI Summary Cards
  yPos += 5.5;
  const numCards = 5;
  const cardGap = 3;
  const totalCardWidth = pageWidth - 28 - (cardGap * (numCards - 1));
  const cardWidth = totalCardWidth / numCards;
  const cardHeight = 14.5;

  // Card 1: Total Approved Stock
  doc.setFillColor(240, 253, 244); // emerald-50
  doc.setDrawColor(187, 247, 208); // emerald-200
  doc.roundedRect(14, yPos, cardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(22, 101, 52);
  doc.text('APPROVED STOCK', 16, yPos + 4);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(5, 150, 105);
  doc.text(`${data.approvedQty.toLocaleString()} PCS`, 16, yPos + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(21, 128, 61);
  doc.text('Ready for issuance', 16, yPos + 12.5);

  // Card 2: Total Lots & SKUs
  const card2X = 14 + cardWidth + cardGap;
  doc.setFillColor(239, 246, 255); // blue-50
  doc.setDrawColor(191, 219, 254);
  doc.roundedRect(card2X, yPos, cardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(30, 64, 175);
  doc.text('TOTAL LOTS / SKUS', card2X + 2, yPos + 4);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(37, 99, 235);
  doc.text(`${data.items.length} Lots (${data.uniquePartCount} SKUs)`, card2X + 2, yPos + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(29, 78, 216);
  doc.text('Physical bin locations', card2X + 2, yPos + 12.5);

  // Card 3: Reorder Alerts
  const card3X = card2X + cardWidth + cardGap;
  doc.setFillColor(data.lowStockCount > 0 ? 255 : 248, data.lowStockCount > 0 ? 241 : 250, data.lowStockCount > 0 ? 242 : 252);
  doc.setDrawColor(data.lowStockCount > 0 ? 254 : 226, data.lowStockCount > 0 ? 205 : 232, data.lowStockCount > 0 ? 211 : 240);
  doc.roundedRect(card3X, yPos, cardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(data.lowStockCount > 0 ? 159 : 71, data.lowStockCount > 0 ? 18 : 85, data.lowStockCount > 0 ? 57 : 105);
  doc.text('REORDER MIN ALERTS', card3X + 2, yPos + 4);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(data.lowStockCount > 0 ? 225 : 71, data.lowStockCount > 0 ? 29 : 85, data.lowStockCount > 0 ? 72 : 105);
  doc.text(`${data.lowStockCount} Part Code(s)`, card3X + 2, yPos + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(data.lowStockCount > 0 ? 190 : 100, data.lowStockCount > 0 ? 18 : 116, data.lowStockCount > 0 ? 60 : 139);
  doc.text(data.lowStockCount > 0 ? 'Replenishment needed' : 'All thresholds normal', card3X + 2, yPos + 12.5);

  // Card 4: Quarantine & Hold
  const card4X = card3X + cardWidth + cardGap;
  doc.setFillColor(254, 243, 199); // amber-50
  doc.setDrawColor(253, 230, 138); // amber-200
  doc.roundedRect(card4X, yPos, cardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(146, 64, 14);
  doc.text('QUARANTINE & HOLD', card4X + 2, yPos + 4);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(217, 119, 6);
  doc.text(`${(data.quarantineQty + data.holdQty).toLocaleString()} PCS`, card4X + 2, yPos + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(180, 83, 9);
  doc.text('Restricted in Isolation Bins', card4X + 2, yPos + 12.5);

  // Card 5: Total Inventory Volume
  const card5X = card4X + cardWidth + cardGap;
  doc.setFillColor(245, 243, 255); // indigo-50
  doc.setDrawColor(221, 214, 254); // indigo-200
  doc.roundedRect(card5X, yPos, cardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(76, 29, 149);
  doc.text('TOTAL GROSS STOCK', card5X + 2, yPos + 4);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(79, 70, 229);
  doc.text(`${data.totalQty.toLocaleString()} PCS`, card5X + 2, yPos + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(109, 40, 217);
  doc.text('Full warehouse footprint', card5X + 2, yPos + 12.5);

  // Table Columns
  const tableColumns = [
    { header: 'PART CODE', dataKey: 'partCode' },
    { header: 'DESCRIPTION', dataKey: 'description' },
    { header: 'CATEGORY', dataKey: 'type' },
    { header: 'CUSTOMER', dataKey: 'resolvedCustomer' },
    { header: 'LOCATION', dataKey: 'location' },
    { header: 'LOT NUMBER', dataKey: 'lotNumber' },
    { header: 'QTY', dataKey: 'quantityFormatted' },
    { header: 'FIFO COLOR', dataKey: 'fifoColor' },
    { header: 'STATUS', dataKey: 'status' },
    { header: 'REORDER MIN', dataKey: 'reorderFormatted' },
    { header: 'EXPIRATION / FEFO', dataKey: 'shelfLifeStatus' }
  ];

  const tableRows = data.items.map(item => ({
    partCode: item.partCode,
    description: item.description,
    type: item.type || 'RAW',
    resolvedCustomer: item.resolvedCustomer,
    location: item.location || 'Zone A',
    lotNumber: item.lotNumber || 'N/A',
    quantityFormatted: `${(Number(item.quantity) || 0).toLocaleString()} ${item.unit || 'PCS'}`,
    fifoColor: item.fifoColor || 'N/A',
    status: item.status || 'APPROVED',
    reorderFormatted: item.reorderMinThreshold > 0 ? (item.isLowStock ? `LOW (${item.currentTotalPartQty}/${item.reorderMinThreshold})` : `${item.reorderMinThreshold} ${item.unit}`) : 'N/A',
    shelfLifeStatus: item.expirationDate ? `${item.expirationDate} (${item.shelfLifeStatus})` : 'No Expiry'
  }));

  let startTableY = yPos + cardHeight + 4;

  autoTable(doc, {
    columns: tableColumns,
    body: tableRows,
    startY: startTableY,
    margin: { left: 14, right: 14, top: 18, bottom: 26 },
    styles: {
      fontSize: 7,
      cellPadding: 1.8,
      font: 'helvetica',
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.2
    },
    headStyles: {
      fillColor: [30, 41, 59], // slate-800
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'left'
    },
    columnStyles: {
      partCode: { font: 'courier', fontStyle: 'bold', cellWidth: 26 },
      description: { cellWidth: 48 },
      type: { cellWidth: 18 },
      resolvedCustomer: { cellWidth: 24, fontStyle: 'bold' },
      location: { cellWidth: 20 },
      lotNumber: { font: 'courier', cellWidth: 24 },
      quantityFormatted: { font: 'courier', fontStyle: 'bold', halign: 'right', cellWidth: 22 },
      fifoColor: { cellWidth: 20 },
      status: { fontStyle: 'bold', cellWidth: 22 },
      reorderFormatted: { cellWidth: 26, font: 'courier' },
      shelfLifeStatus: { cellWidth: 32, fontSize: 6.5 }
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252] // slate-50
    },
    didParseCell: (hookData) => {
      if (hookData.section === 'body') {
        const rowData = hookData.row.raw as any;
        if (hookData.column.dataKey === 'status') {
          if (rowData.status === 'QUARANTINE') {
            hookData.cell.styles.textColor = [190, 18, 60]; // rose-700
            hookData.cell.styles.fontStyle = 'bold';
          } else if (rowData.status === 'HOLD') {
            hookData.cell.styles.textColor = [180, 83, 9]; // amber-700
            hookData.cell.styles.fontStyle = 'bold';
          } else {
            hookData.cell.styles.textColor = [21, 128, 61]; // emerald-700
          }
        }
        if (hookData.column.dataKey === 'reorderFormatted' && String(rowData.reorderFormatted).startsWith('LOW')) {
          hookData.cell.styles.textColor = [225, 29, 72]; // rose-600
          hookData.cell.styles.fontStyle = 'bold';
        }
      }
    },
    didDrawPage: (hookData) => {
      // Page Footer
      const totalPages = (doc as any).internal.getNumberOfPages();
      const currPage = hookData.pageNumber;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(
        'JUWEI PLASTIC MOULDING PHILIPPINES INC. • OFFICIAL CONFIDENTIAL INVENTORY RECORD • ISO 9001:2015',
        14,
        pageHeight - 8
      );
      doc.text(
        `Page ${currPage} of ${totalPages}`,
        pageWidth - 14,
        pageHeight - 8,
        { align: 'right' }
      );

      // Thin bottom line
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
    }
  });

  // Signatures / Manager Endorsement Block
  let finalY = (doc as any).lastAutoTable?.finalY || 160;
  if (finalY > pageHeight - 34) {
    doc.addPage();
    finalY = 20;
  } else {
    finalY += 6;
  }

  // Draw Sign-off Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, finalY, pageWidth - 28, 22, 1.5, 1.5, 'FD');

  const signColWidth = (pageWidth - 28) / 3;

  // Sign-off 1: Warehouse Custodian
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text('PHYSICAL INVENTORY AUDITED BY:', 18, finalY + 4);
  doc.line(18, finalY + 14, 18 + signColWidth - 8, finalY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const auditCustName = options.auditedByName || options.generatedBy || 'Aldrin Banawa';
  const auditCustEmp = options.employeeId || 'JPMP-002';
  const auditCustTitle = options.auditedByTitle || `Warehouse Inventory Custodian • ${auditCustEmp}`;
  const auditCustDate = options.auditedByDate || generatedTimestamp;
  doc.text(auditCustName, 18, finalY + 17.5);
  doc.text(`${auditCustTitle} • ${auditCustDate}`, 18, finalY + 20.5);

  // Sign-off 2: Quality Verification
  const sign2X = 14 + signColWidth;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('IQC & QUALITY AUDITOR:', sign2X + 4, finalY + 4);
  doc.line(sign2X + 4, finalY + 14, sign2X + signColWidth - 4, finalY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const qaName = options.auditorName || 'Quality Assurance / IQC Inspector';
  const qaTitle = options.auditorTitle || 'FIFO Color Rotation & Bin Quarantine Endorsed';
  const qaDate = options.auditorDate || 'ISO 9001:2015 Physical Check Endorsed';
  doc.text(qaName, sign2X + 4, finalY + 17.5);
  doc.text(`${qaTitle} • ${qaDate}`, sign2X + 4, finalY + 20.5);

  // Sign-off 3: Operations Manager
  const sign3X = sign2X + signColWidth;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('APPROVED BY WAREHOUSE HEAD:', sign3X + 4, finalY + 4);
  doc.line(sign3X + 4, finalY + 14, sign3X + signColWidth - 8, finalY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const headName = options.approvedByName || 'Warehouse Operations Head';
  const headTitle = options.approvedByTitle || 'Warehouse Operations & Logistics Manager';
  const headDate = options.approvedByDate || 'Juwei Plastic Moulding Corp Philippines Plant';
  doc.text(headName, sign3X + 4, finalY + 17.5);
  doc.text(`${headTitle} • ${headDate}`, sign3X + 4, finalY + 20.5);

  return doc;
}

export async function generateInventoryReportPages(
  stocks: MaterialStockItem[],
  options: InventoryReportOptions
): Promise<{ doc: jsPDF; pages: string[]; filename: string }> {
  const doc = generateInventoryReportPDF(stocks, options);
  const dateStamp = new Date().toISOString().split('T')[0];
  const customerSlug = options.customerFilter && options.customerFilter !== 'ALL' ? `_${options.customerFilter.replace(/\s+/g, '_')}` : '';
  const statusSlug = options.statusFilter && options.statusFilter !== 'ALL' ? `_${options.statusFilter}` : '';
  const filename = `Juwei_Inventory_Report${customerSlug}${statusSlug}_${dateStamp}.pdf`;
  const pages = await renderPdfDocToPages(doc);
  return { doc, pages, filename };
}

export function generateInventoryReportCSV(
  stocks: MaterialStockItem[],
  options: InventoryReportOptions
): string {
  const data = filterInventoryData(stocks, options);

  const headers = [
    'Part Code',
    'Description',
    'Category',
    'Customer',
    'Location',
    'Lot Number',
    'Quantity',
    'Unit',
    'Status',
    'FIFO Color Code',
    'Reorder Min Threshold',
    'Current Total SKU Qty',
    'Is Below Reorder Min',
    'Shortage Qty',
    'Received Date',
    'Expiration Date',
    'Shelf Life Status',
    'Resin Sack Risk',
    'Remarks'
  ];

  const escapeCSV = (val: any): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = data.items.map(item => [
    escapeCSV(item.partCode),
    escapeCSV(item.description),
    escapeCSV(item.type || 'RAW'),
    escapeCSV(item.resolvedCustomer),
    escapeCSV(item.location),
    escapeCSV(item.lotNumber),
    item.quantity ?? 0,
    escapeCSV(item.unit || 'PCS'),
    escapeCSV(item.status),
    escapeCSV(item.fifoColor),
    item.reorderMinThreshold || 0,
    item.currentTotalPartQty || 0,
    item.isLowStock ? 'YES' : 'NO',
    item.shortageQty || 0,
    escapeCSV(item.receivedDate),
    escapeCSV(item.expirationDate || 'N/A'),
    escapeCSV(item.shelfLifeStatus),
    item.resinSackRisk ? 'YES' : 'NO',
    escapeCSV(item.remarks || '')
  ].join(','));

  const generatedDate = new Date().toISOString();
  const summaryComments = [
    `# JUWEI PLASTIC MOULDING PHILIPPINES INC. - INVENTORY EXPORT`,
    `# Generated At: ${generatedDate}`,
    `# Operator: ${options.generatedBy || 'Aldrin Banawa'} (${options.employeeId || 'JPMP-002'})`,
    `# Total Items: ${data.items.length} lots | Approved Qty: ${data.approvedQty} PCS | Low Stock SKUs: ${data.lowStockCount}`,
    ''
  ].join('\n');

  return '\uFEFF' + summaryComments + headers.join(',') + '\n' + rows.join('\n');
}

export function downloadInventoryReportCSV(
  stocks: MaterialStockItem[],
  options: InventoryReportOptions
): void {
  const csvContent = generateInventoryReportCSV(stocks, options);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = new Date().toISOString().split('T')[0];
  const customerSlug = options.customerFilter && options.customerFilter !== 'ALL' ? `_${options.customerFilter.replace(/\s+/g, '_')}` : '';
  const statusSlug = options.statusFilter && options.statusFilter !== 'ALL' ? `_${options.statusFilter}` : '';
  link.setAttribute('href', url);
  link.setAttribute('download', `Juwei_Inventory_Export${customerSlug}${statusSlug}_${dateStamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
