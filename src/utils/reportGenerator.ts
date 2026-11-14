import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ReceivingRecord, IssuanceRecord, MaterialStockItem } from '../types';
import { renderPdfDocToPages } from './printDocument';

export interface ReportFilterOptions {
  dateRange: 'today' | '7days' | '30days' | 'all' | 'custom';
  startDate?: string;
  endDate?: string;
  customerFilter?: string;
  partFilter?: string;
  generatedBy?: string;
  userRole?: string;
  employeeId?: string;
  preparedByName?: string;
  preparedByTitle?: string;
  preparedByDate?: string;
  auditorName?: string;
  auditorTitle?: string;
  auditorDate?: string;
  approvedByName?: string;
  approvedByTitle?: string;
  approvedByDate?: string;
}

export interface MaterialFlowSummary {
  totalReceivedQty: number;
  totalReceivedTxCount: number;
  totalIssuedQty: number;
  totalIssuedTxCount: number;
  netDelta: number;
  filteredReceiving: ReceivingRecord[];
  filteredIssuances: IssuanceRecord[];
  skuBreakdown: {
    partCode: string;
    description: string;
    receivedQty: number;
    issuedQty: number;
    netDelta: number;
    currentStock: number;
    unit: string;
  }[];
  startDateStr: string;
  endDateStr: string;
}

export function filterReceivingAndIssuanceData(
  receiving: ReceivingRecord[],
  issuances: IssuanceRecord[],
  stocks: MaterialStockItem[],
  options: ReportFilterOptions
): MaterialFlowSummary {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  let startIso = '1970-01-01';
  let endIso = '2099-12-31';

  if (options.dateRange === 'today') {
    startIso = todayStr;
    endIso = todayStr;
  } else if (options.dateRange === '7days') {
    const past7 = new Date(today);
    past7.setDate(past7.getDate() - 6);
    startIso = past7.toISOString().split('T')[0];
    endIso = todayStr;
  } else if (options.dateRange === '30days') {
    const past30 = new Date(today);
    past30.setDate(past30.getDate() - 29);
    startIso = past30.toISOString().split('T')[0];
    endIso = todayStr;
  } else if (options.dateRange === 'custom') {
    if (options.startDate) startIso = options.startDate;
    if (options.endDate) endIso = options.endDate;
  }

  // Filter receiving
  const filteredReceiving = receiving.filter(r => {
    const rDate = r.date || r.receivedDate || '';
    if (rDate && (rDate < startIso || rDate > endIso)) return false;
    if (options.customerFilter && r.customer && r.customer !== options.customerFilter) return false;
    if (options.partFilter && !r.partCode.toLowerCase().includes(options.partFilter.toLowerCase()) && !r.itemDescription.toLowerCase().includes(options.partFilter.toLowerCase())) return false;
    return true;
  });

  // Filter issuances
  const filteredIssuances = issuances.filter(i => {
    const iDate = i.date || '';
    if (iDate && (iDate < startIso || iDate > endIso)) return false;
    if (options.partFilter && !i.partCode.toLowerCase().includes(options.partFilter.toLowerCase()) && !i.description.toLowerCase().includes(options.partFilter.toLowerCase())) return false;
    return true;
  });

  // Calculate totals
  const totalReceivedQty = filteredReceiving.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const totalIssuedQty = filteredIssuances.reduce((sum, i) => sum + (Number(i.quantityIssued) || 0), 0);
  const netDelta = totalReceivedQty - totalIssuedQty;

  // SKU Map
  const skuMap: Record<string, {
    partCode: string;
    description: string;
    receivedQty: number;
    issuedQty: number;
    currentStock: number;
    unit: string;
  }> = {};

  filteredReceiving.forEach(r => {
    const key = r.partCode;
    if (!skuMap[key]) {
      skuMap[key] = {
        partCode: r.partCode,
        description: r.itemDescription,
        receivedQty: 0,
        issuedQty: 0,
        currentStock: 0,
        unit: r.unit || 'PCS'
      };
    }
    skuMap[key].receivedQty += Number(r.quantity) || 0;
  });

  filteredIssuances.forEach(i => {
    const key = i.partCode;
    if (!skuMap[key]) {
      skuMap[key] = {
        partCode: i.partCode,
        description: i.description,
        receivedQty: 0,
        issuedQty: 0,
        currentStock: 0,
        unit: 'PCS'
      };
    }
    skuMap[key].issuedQty += Number(i.quantityIssued) || 0;
  });

  // Populate current approved stock for each SKU
  stocks.forEach(s => {
    if (s.status === 'APPROVED') {
      if (skuMap[s.partCode]) {
        skuMap[s.partCode].currentStock += Number(s.quantity) || 0;
        if (s.unit) skuMap[s.partCode].unit = s.unit;
      }
    }
  });

  const skuBreakdown = Object.values(skuMap)
    .map(item => ({
      ...item,
      netDelta: item.receivedQty - item.issuedQty
    }))
    .sort((a, b) => (b.receivedQty + b.issuedQty) - (a.receivedQty + a.issuedQty));

  return {
    totalReceivedQty,
    totalReceivedTxCount: filteredReceiving.length,
    totalIssuedQty,
    totalIssuedTxCount: filteredIssuances.length,
    netDelta,
    filteredReceiving,
    filteredIssuances,
    skuBreakdown,
    startDateStr: startIso === '1970-01-01' ? 'Earliest Recorded' : startIso,
    endDateStr: endIso === '2099-12-31' ? 'Latest' : endIso
  };
}

export function generateReceivingVsIssuancePDF(
  receiving: ReceivingRecord[],
  issuances: IssuanceRecord[],
  stocks: MaterialStockItem[],
  options: ReportFilterOptions
): jsPDF {
  const summary = filterReceivingAndIssuanceData(receiving, issuances, stocks, options);
  
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const generatedTimestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  // Primary Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Accent Line
  doc.setFillColor(79, 70, 229); // indigo-600
  doc.rect(0, 28, pageWidth, 2, 'F');

  // Header Titles
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('JUWEI PLASTIC MOULDING PHILIPPINES INC.', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text('WAREHOUSE MANAGEMENT SYSTEM • INVENTORY & MATERIAL CONTROL', 14, 17);

  doc.setFont('courier', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(165, 180, 252); // indigo-200
  doc.text('DOC REF: JPM-WMS-REP-008 | ISO 9001:2015 AUDIT COMPLIANT', 14, 23);

  // Facility Badge on Right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text('PHILIPPINES PLANT', pageWidth - 14, 12, { align: 'right' });
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`PRINTED: ${generatedTimestamp}`, pageWidth - 14, 18, { align: 'right' });
  doc.text(`OPERATOR: ${options.generatedBy || 'SUPER ADMIN'} (${options.employeeId || 'JPMP-002'})`, pageWidth - 14, 23, { align: 'right' });

  // Document Title & Metadata Section
  let yPos = 36;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text('RECEIVING VS ISSUANCE AUDIT SNAPSHOT', 14, yPos);

  yPos += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139); // slate-500
  const periodLabel = options.dateRange === 'today' ? 'Today' :
    options.dateRange === '7days' ? 'Past 7 Calendar Days' :
    options.dateRange === '30days' ? 'Past 30 Calendar Days' :
    options.dateRange === 'custom' ? `Custom Range (${summary.startDateStr} to ${summary.endDateStr})` :
    'All-Time Historical Operations';
  doc.text(`Audit Period: ${periodLabel}   |   Inflow Source: External & Internal Receipts   |   Outflow: Production Lines & Departments`, 14, yPos);

  // Executive KPI Summary Cards
  yPos += 6;
  const cardWidth = (pageWidth - 28 - 9) / 4;
  const cardHeight = 16;

  // Card 1: Total Received
  doc.setFillColor(240, 253, 244); // emerald-50
  doc.setDrawColor(187, 247, 208); // emerald-200
  doc.roundedRect(14, yPos, cardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(22, 101, 52); // emerald-800
  doc.text('TOTAL INBOUND RECEIVED', 16, yPos + 4.5);
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(5, 150, 105); // emerald-600
  doc.text(`${summary.totalReceivedQty.toLocaleString()}`, 16, yPos + 10.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(21, 128, 61);
  doc.text(`${summary.totalReceivedTxCount} Lot Receipt(s)`, 16, yPos + 14);

  // Card 2: Total Issued
  const card2X = 14 + cardWidth + 3;
  doc.setFillColor(239, 246, 255); // blue-50
  doc.setDrawColor(191, 219, 254); // blue-200
  doc.roundedRect(card2X, yPos, cardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(30, 64, 175); // blue-800
  doc.text('TOTAL OUTBOUND ISSUED', card2X + 2, yPos + 4.5);
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(37, 99, 235); // blue-600
  doc.text(`${summary.totalIssuedQty.toLocaleString()}`, card2X + 2, yPos + 10.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(29, 78, 216);
  doc.text(`${summary.totalIssuedTxCount} Requisition(s)`, card2X + 2, yPos + 14);

  // Card 3: Net Material Delta
  const card3X = card2X + cardWidth + 3;
  const isNetPositive = summary.netDelta >= 0;
  if (isNetPositive) {
    doc.setFillColor(245, 243, 255); // indigo-50
    doc.setDrawColor(221, 214, 254);
    doc.setTextColor(76, 29, 149);
  } else {
    doc.setFillColor(255, 241, 242); // rose-50
    doc.setDrawColor(254, 205, 211);
    doc.setTextColor(159, 18, 57);
  }
  doc.roundedRect(card3X, yPos, cardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('NET INVENTORY DELTA', card3X + 2, yPos + 4.5);
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  if (isNetPositive) {
    doc.setTextColor(79, 70, 229);
  } else {
    doc.setTextColor(225, 29, 72);
  }
  const sign = summary.netDelta > 0 ? '+' : '';
  doc.text(`${sign}${summary.netDelta.toLocaleString()}`, card3X + 2, yPos + 10.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  if (isNetPositive) {
    doc.setTextColor(109, 40, 217);
  } else {
    doc.setTextColor(190, 18, 60);
  }
  doc.text(isNetPositive ? 'Net Inflow Surplus' : 'Net Outflow Deficit', card3X + 2, yPos + 14);

  // Card 4: Active SKUs
  const card4X = card3X + cardWidth + 3;
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.roundedRect(card4X, yPos, cardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85); // slate-700
  doc.text('ACTIVE MATERIAL SKUS', card4X + 2, yPos + 4.5);
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text(`${summary.skuBreakdown.length}`, card4X + 2, yPos + 10.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Transacted Part Codes', card4X + 2, yPos + 14);

  yPos += cardHeight + 4;

  // TABLE 1: SKU Material Velocity Matrix (Top SKUs Flow)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. TOP MATERIAL SKUS INFLOW VS OUTFLOW MATRIX', 14, yPos);

  const skuTableData = summary.skuBreakdown.slice(0, 10).map((sku, index) => {
    const netFormatted = (sku.netDelta > 0 ? '+' : '') + sku.netDelta.toLocaleString();
    const velocityStatus = sku.receivedQty > sku.issuedQty ? 'REPLENISHED' :
      sku.issuedQty > sku.receivedQty ? 'HIGH CONSUMPTION' : 'BALANCED';
    return [
      (index + 1).toString(),
      sku.partCode,
      sku.description,
      sku.receivedQty.toLocaleString(),
      sku.issuedQty.toLocaleString(),
      netFormatted,
      sku.currentStock.toLocaleString() + ' ' + sku.unit,
      velocityStatus
    ];
  });

  autoTable(doc, {
    startY: yPos + 1.5,
    head: [['#', 'Part Code', 'Material Description', 'Total Received', 'Total Issued', 'Net Delta', 'Current Stock', 'Flow Status']],
    body: skuTableData.length > 0 ? skuTableData : [['-', 'No transacted SKUs found in selected timeframe', '', '', '', '', '', '']],
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59], // slate-800
      textColor: [255, 255, 255],
      fontSize: 7,
      fontStyle: 'bold',
      halign: 'left',
      cellPadding: 1.5
    },
    styles: {
      fontSize: 7,
      cellPadding: 1.5,
      textColor: [30, 41, 59],
      font: 'helvetica'
    },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center' },
      1: { cellWidth: 26, font: 'courier', fontStyle: 'bold' },
      2: { cellWidth: 48 },
      3: { cellWidth: 22, halign: 'right', font: 'courier', fontStyle: 'bold', textColor: [5, 150, 105] },
      4: { cellWidth: 22, halign: 'right', font: 'courier', fontStyle: 'bold', textColor: [37, 99, 235] },
      5: { cellWidth: 20, halign: 'right', font: 'courier', fontStyle: 'bold' },
      6: { cellWidth: 24, halign: 'right', font: 'courier' },
      7: { cellWidth: 23, halign: 'center', fontStyle: 'bold' }
    },
    didDrawPage: () => {
      // Add footer on each page
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text('JUWEI PLASTIC MOULDING WMS • CONFIDENTIAL INTERNAL WAREHOUSE AUDIT', 14, pageHeight - 8);
      const pageCount = (doc.internal as any).getNumberOfPages ? (doc.internal as any).getNumberOfPages() : 1;
      doc.text(`Page ${(doc as any).internal.getCurrentPageInfo().pageNumber} of ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
    }
  });

  // Table 2: Itemized Inbound Receiving Records
  let finalY = (doc as any).lastAutoTable?.finalY || (yPos + 40);
  
  if (finalY > pageHeight - 65) {
    doc.addPage();
    finalY = 20;
  } else {
    finalY += 6;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('2. RECENT INBOUND RECEIVING AUDIT LOGS (SAMPLE TRANSACTIONS)', 14, finalY);

  const rxTableData = summary.filteredReceiving.slice(0, 8).map(r => [
    r.date || r.receivedDate || 'N/A',
    r.drNumber || r.rrNumber || r.transferFormNumber || r.poNumber || 'N/A',
    r.partCode,
    r.itemDescription,
    r.lotNumber || 'N/A',
    `${r.quantity.toLocaleString()} ${r.unit || 'PCS'}`,
    r.supplierOrDept || r.vendorSupplier || 'N/A',
    r.iqcStatus === 'APPROVED_IQC' ? 'APPROVED' : r.iqcStatus === 'PENDING_IQC' ? 'PENDING' : 'REJECTED'
  ]);

  autoTable(doc, {
    startY: finalY + 1.5,
    head: [['Date', 'DR / PO #', 'Part Code', 'Description', 'Lot #', 'Qty Received', 'Supplier / Dept', 'IQC Status']],
    body: rxTableData.length > 0 ? rxTableData : [['-', 'No receiving transactions found in period', '', '', '', '', '', '']],
    theme: 'grid',
    headStyles: {
      fillColor: [5, 150, 105], // emerald-600
      textColor: [255, 255, 255],
      fontSize: 7,
      fontStyle: 'bold',
      cellPadding: 1.5
    },
    styles: {
      fontSize: 6.8,
      cellPadding: 1.5,
      textColor: [30, 41, 59],
      font: 'helvetica'
    },
    columnStyles: {
      0: { cellWidth: 18, font: 'courier' },
      1: { cellWidth: 22, font: 'courier' },
      2: { cellWidth: 24, font: 'courier', fontStyle: 'bold' },
      3: { cellWidth: 44 },
      4: { cellWidth: 20, font: 'courier' },
      5: { cellWidth: 22, halign: 'right', font: 'courier', fontStyle: 'bold' },
      6: { cellWidth: 26 },
      7: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }
    }
  });

  // Table 3: Itemized Outbound Issuance Records
  finalY = (doc as any).lastAutoTable?.finalY || (finalY + 40);
  if (finalY > pageHeight - 65) {
    doc.addPage();
    finalY = 20;
  } else {
    finalY += 6;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('3. RECENT OUTBOUND ISSUANCE AUDIT LOGS (SAMPLE TRANSACTIONS)', 14, finalY);

  const issTableData = summary.filteredIssuances.slice(0, 8).map(i => [
    i.date || 'N/A',
    i.requisitionNumber || 'N/A',
    i.partCode,
    i.description,
    i.lotNumber || 'N/A',
    `${i.quantityIssued.toLocaleString()} PCS`,
    i.department || 'N/A',
    i.issuedBy || 'Warehouse Clerk',
    i.receivedBy || 'Line Operator'
  ]);

  autoTable(doc, {
    startY: finalY + 1.5,
    head: [['Date', 'Req #', 'Part Code', 'Description', 'Lot #', 'Qty Issued', 'Department', 'Issued By', 'Received By']],
    body: issTableData.length > 0 ? issTableData : [['-', 'No issuance transactions found in period', '', '', '', '', '', '', '']],
    theme: 'grid',
    headStyles: {
      fillColor: [37, 99, 235], // blue-600
      textColor: [255, 255, 255],
      fontSize: 7,
      fontStyle: 'bold',
      cellPadding: 1.5
    },
    styles: {
      fontSize: 6.8,
      cellPadding: 1.5,
      textColor: [30, 41, 59],
      font: 'helvetica'
    },
    columnStyles: {
      0: { cellWidth: 17, font: 'courier' },
      1: { cellWidth: 20, font: 'courier' },
      2: { cellWidth: 24, font: 'courier', fontStyle: 'bold' },
      3: { cellWidth: 42 },
      4: { cellWidth: 18, font: 'courier' },
      5: { cellWidth: 20, halign: 'right', font: 'courier', fontStyle: 'bold' },
      6: { cellWidth: 22 },
      7: { cellWidth: 20 },
      8: { cellWidth: 20 }
    }
  });

  // Signatures & Manager Sign-off Block
  finalY = (doc as any).lastAutoTable?.finalY || (finalY + 40);
  if (finalY > pageHeight - 38) {
    doc.addPage();
    finalY = 20;
  } else {
    finalY += 8;
  }

  // Draw Sign-off Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, finalY, pageWidth - 28, 24, 1.5, 1.5, 'FD');

  const signColWidth = (pageWidth - 28) / 3;

  // Sign-off 1: Prepared By
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text('PREPARED & GENERATED BY:', 18, finalY + 4.5);
  doc.line(18, finalY + 16, 18 + signColWidth - 8, finalY + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const prepName = options.preparedByName || options.generatedBy || 'Aldrin Banawa';
  const prepEmp = options.employeeId || 'JPMP-002';
  const prepTitle = options.preparedByTitle || `Warehouse Super Administrator • ${prepEmp}`;
  const prepDate = options.preparedByDate || generatedTimestamp;
  doc.text(prepName, 18, finalY + 19.5);
  doc.text(`${prepTitle} • ${prepDate}`, 18, finalY + 22.5);

  // Sign-off 2: Quality Verification
  const sign2X = 14 + signColWidth;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('IQC & QUALITY AUDITOR:', sign2X + 4, finalY + 4.5);
  doc.line(sign2X + 4, finalY + 16, sign2X + signColWidth - 4, finalY + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const auditName = options.auditorName || 'Quality Assurance / IQC Inspector';
  const auditTitle = options.auditorTitle || 'IQC Section • Material Compliance';
  const auditDate = options.auditorDate || 'ISO 9001:2015 Physical Check Endorsed';
  doc.text(auditName, sign2X + 4, finalY + 19.5);
  doc.text(`${auditTitle} • ${auditDate}`, sign2X + 4, finalY + 22.5);

  // Sign-off 3: Operations Manager
  const sign3X = sign2X + signColWidth;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('APPROVED BY OPERATIONS MANAGER:', sign3X + 4, finalY + 4.5);
  doc.line(sign3X + 4, finalY + 16, sign3X + signColWidth - 8, finalY + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const appName = options.approvedByName || 'Warehouse Operations Head';
  const appTitle = options.approvedByTitle || 'Warehouse Operations & Logistics Head';
  const appDate = options.approvedByDate || 'Juwei Plastic Moulding Corp Plant';
  doc.text(appName, sign3X + 4, finalY + 19.5);
  doc.text(`${appTitle} • ${appDate}`, sign3X + 4, finalY + 22.5);

  return doc;
}

export async function generateReceivingVsIssuanceReportPages(
  receiving: ReceivingRecord[],
  issuances: IssuanceRecord[],
  stocks: MaterialStockItem[],
  options: ReportFilterOptions
): Promise<{ doc: jsPDF; pages: string[]; filename: string }> {
  const doc = generateReceivingVsIssuancePDF(receiving, issuances, stocks, options);
  const dateStamp = new Date().toISOString().split('T')[0];
  const filename = `Juwei_Receiving_vs_Issuance_Report_${options.dateRange}_${dateStamp}.pdf`;
  const pages = await renderPdfDocToPages(doc);
  return { doc, pages, filename };
}

export function downloadReceivingVsIssuancePDF(
  receiving: ReceivingRecord[],
  issuances: IssuanceRecord[],
  stocks: MaterialStockItem[],
  options: ReportFilterOptions
): void {
  const doc = generateReceivingVsIssuancePDF(receiving, issuances, stocks, options);
  const dateStamp = new Date().toISOString().split('T')[0];
  const filename = `Juwei_Receiving_vs_Issuance_Report_${options.dateRange}_${dateStamp}.pdf`;
  doc.save(filename);
}
