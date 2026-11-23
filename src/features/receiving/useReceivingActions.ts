/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  MaterialStockItem,
  MaterialType,
  ReceivingRecord,
  ReturnRecord,
  RecyclingRecord,
  FifoColorsMap
} from '../../types';
import { getFifoColorForDate, normalizeFifoColor } from '../../data';
import { generateAuthoritativeId } from '../../lib/idGenerator';
import { syncManager } from '../../sync/syncManager';
import { showPrintToast } from '../../utils/printDocument';
import { formatQuantityWithUnit, normalizeUnitCode } from '../../../shared/units';

export interface UseReceivingActionsParams {
  receiving: ReceivingRecord[];
  setReceiving: React.Dispatch<React.SetStateAction<ReceivingRecord[]>>;
  returns: ReturnRecord[];
  setReturns: React.Dispatch<React.SetStateAction<ReturnRecord[]>>;
  recycling: RecyclingRecord[];
  setRecycling: React.Dispatch<React.SetStateAction<RecyclingRecord[]>>;
  stocks: MaterialStockItem[];
  setStocks: React.Dispatch<React.SetStateAction<MaterialStockItem[]>>;
  fifoColorsByMonth: FifoColorsMap;
  currentUser: string;
  currentPermission: string;
  upsertRecordLocallyAndRemotely: (
    collection: string,
    record: any,
    actionDesc?: string,
    options?: { overrideExpectedVersion?: number; existingMutationId?: string }
  ) => void;
  deleteRecordLocallyAndRemotely: (
    collection: string,
    id: string,
    options?: { overrideExpectedVersion?: number; existingMutationId?: string }
  ) => void;
  sendSystemActivity: (text: string) => void;
}

export function useReceivingActions({
  receiving,
  setReceiving,
  returns,
  setReturns,
  recycling,
  setRecycling,
  stocks,
  setStocks,
  fifoColorsByMonth,
  currentUser,
  currentPermission,
  upsertRecordLocallyAndRemotely,
  deleteRecordLocallyAndRemotely,
  sendSystemActivity
}: UseReceivingActionsParams) {
  const handleAddReceiving = (record: ReceivingRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const newStockId = generateAuthoritativeId('STK');
    const receiptIdempotencyKey = record.movementIdempotencyKey || `RCV:${record.id}`;
    const resolvedUnit = normalizeUnitCode(record.unit);
    const enrichedRecord: ReceivingRecord = {
      ...record,
      unit: resolvedUnit,
      ...(resolvedUnit ? { unitMissing: false } : { unitMissing: true }),
      stockId: newStockId,
      movementIdempotencyKey: receiptIdempotencyKey,
    };

    const nextReceiving = [enrichedRecord, ...receiving];
    setReceiving(nextReceiving);

    const newStockItem: MaterialStockItem = {
      id: newStockId,
      partCode: record.partCode,
      description: record.itemDescription,
      modelName: record.modelName,
      type: record.partCode.startsWith('RM') ? 'RAW' :
            record.partCode.startsWith('PM') ? 'PACKAGING' :
            record.partCode.startsWith('WP') ? 'WIP' :
            record.partCode.startsWith('FG') ? 'FG' : 'CONSUMABLE',
      location: record.location || (record.status === 'QUARANTINED' ? 'Quarantine Area' : 'Designated Storage Bin'),
      quantity: record.quantity,
      unit: resolvedUnit,
      ...(resolvedUnit ? { unitMissing: false } : { unitMissing: true }),
      lotNumber: record.lotNumber,
      receivedDate: record.receivedDate || record.date,
      color: record.color,
      fifoColor: normalizeFifoColor(record.fifoColorCode || (record as any).fifoColor, record.receivedDate || record.date, fifoColorsByMonth),
      status: record.status === 'QUARANTINED' ? 'QUARANTINE' : (record.iqcStatus === 'PENDING_IQC' ? 'HOLD' : 'APPROVED'),
      bom: record.bom,
      customer: record.customer,
      reorderMin: record.reorderMin,
      remarks: record.remarks
    };

    let nextStocks = [newStockItem, ...stocks];

    const isInternal = record.source === 'INTERNAL' || record.source === 'WIP/BOM/FG(Internal)';
    const bomDeductions: Array<{ stockItem: MaterialStockItem; deductAmount: number }> = [];

    if (isInternal && record.bom && record.bom.length > 0 && record.autoDeductBom) {
      record.bom.forEach(bomItem => {
        let remainingToDeduct = bomItem.quantityRequired;

        const matchingStockItems = nextStocks
          .filter(s => s.partCode === bomItem.partCode && s.status === 'APPROVED' && s.quantity > 0)
          .sort((a, b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());

        matchingStockItems.forEach(stockItem => {
          if (remainingToDeduct <= 0) return;

          const deductAmount = Math.min(stockItem.quantity, remainingToDeduct);
          remainingToDeduct -= deductAmount;

          const updatedStock = { ...stockItem, quantity: stockItem.quantity - deductAmount };
          nextStocks = nextStocks.map(s => s.id === stockItem.id ? updatedStock : s);
          bomDeductions.push({ stockItem, deductAmount });
        });
      });
    }

    setStocks(nextStocks);
    upsertRecordLocallyAndRemotely('stocks', newStockItem, `Created stock item for ${record.partCode}`);
    upsertRecordLocallyAndRemotely('receiving', enrichedRecord, `Received ${record.quantity} of ${record.partCode}`);

    const receiptQty = Math.abs(Number(record.quantity) || 0);
    syncManager.executeMovement({
      productId: newStockId,
      warehouseId: newStockItem.warehouseId || 'wh-main',
      type: 'PURCHASE',
      quantity: receiptQty,
      delta: receiptQty,
      referenceId: record.id,
      referenceNumber: record.rrNumber || record.poNumber || record.id,
      lotNumber: record.lotNumber,
      location: newStockItem.location,
      unit: resolvedUnit || undefined,
      notes: `Receipt of ${record.partCode} (Lot: ${record.lotNumber})`,
      userName: currentUser,
      idempotencyKey: receiptIdempotencyKey,
      preventNegativeStock: false,
    }).catch((err) => console.warn('Receipt stock movement sync note:', err));

    bomDeductions.forEach(({ stockItem, deductAmount }) => {
      syncManager.executeMovement({
        productId: stockItem.id,
        warehouseId: stockItem.warehouseId || 'wh-main',
        type: 'ADJUSTMENT_OUT',
        quantity: deductAmount,
        delta: -Math.abs(deductAmount),
        referenceId: record.id,
        referenceNumber: record.transferFormNumber || record.rrNumber || record.id,
        lotNumber: stockItem.lotNumber,
        location: stockItem.location,
        unit: normalizeUnitCode(stockItem.unit) || undefined,
        notes: `Auto-BOM deduction for ${record.partCode} (Receipt: ${record.id})`,
        userName: currentUser,
        idempotencyKey: `RCV-BOM:${record.id}:${stockItem.id}`,
        preventNegativeStock: false,
      }).catch((err) => console.warn('BOM deduction movement sync note:', err));
    });

    if (isInternal && record.bom && record.bom.length > 0 && record.autoDeductBom) {
      const deductedSummary = record.bom.map(b => `${formatQuantityWithUnit(b.quantityRequired, b.unit)} of ${b.partCode}`).join(', ');
      sendSystemActivity(`${currentUser} registered internal WIP/FG ${record.partCode} (Lot: ${record.lotNumber}) and auto-deducted BOM components: ${deductedSummary}`);
    } else {
      sendSystemActivity(`${currentUser} received ${formatQuantityWithUnit(record.quantity, resolvedUnit)} of ${record.partCode} (Lot: ${record.lotNumber}).`);
    }
  };

  const handleUpdateIqc = (id: string, iqcStatus: ReceivingRecord['iqcStatus']) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const updatedReceivingRecord = receiving.find(r => r.id === id);
    const nextReceiving: ReceivingRecord[] = receiving.map(r => r.id === id ? { ...r, iqcStatus, status: (iqcStatus === 'APPROVED_IQC' ? 'VERIFIED' : 'QUARANTINED') as ReceivingRecord['status'] } : r);
    setReceiving(nextReceiving);
    if (updatedReceivingRecord) {
      upsertRecordLocallyAndRemotely('receiving', { ...updatedReceivingRecord, iqcStatus, status: (iqcStatus === 'APPROVED_IQC' ? 'VERIFIED' : 'QUARANTINED') as ReceivingRecord['status'] }, `Updated IQC status to ${iqcStatus}`);
    }

    const targetRec = receiving.find(r => r.id === id);
    if (targetRec) {
      const nextStocks: MaterialStockItem[] = stocks.map(s => {
        if (s.lotNumber === targetRec.lotNumber && s.partCode === targetRec.partCode) {
          const updatedStock = {
            ...s,
            status: (iqcStatus === 'APPROVED_IQC' ? 'APPROVED' : 'QUARANTINE') as MaterialStockItem['status'],
            location: iqcStatus === 'APPROVED_IQC' ? 'Designated Storage Bin' : 'Quarantine Area'
          };
          upsertRecordLocallyAndRemotely('stocks', updatedStock, `Updated stock status for ${targetRec.partCode}`);
          return updatedStock;
        }
        return s;
      });
      setStocks(nextStocks);

      sendSystemActivity(`${currentUser} updated IQC evaluation for ${targetRec.partCode} (Lot: ${targetRec.lotNumber}) to ${iqcStatus}.`);
    }
  };

  const handleEditReceiving = (record: ReceivingRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT RECEIVING RECORDS.", 'error');
      return;
    }
    const next = receiving.map(r => r.id === record.id ? record : r);
    setReceiving(next);
    upsertRecordLocallyAndRemotely('receiving', record, `Updated receiving record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated receiving record ${record.id} (${record.partCode}).`);
  };

  const handleDeleteReceiving = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE RECEIVING TRANSACTIONS.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('receiving', id);
    const next = receiving.filter(r => r.id !== id);
    setReceiving(next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted receiving record ${id}.`);
  };

  const handleAddReturn = (record: ReturnRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const newStockId = generateAuthoritativeId('STK');
    const returnIdempotencyKey = record.movementIdempotencyKey || `RET:${record.id}`;
    const resolvedUnit = normalizeUnitCode(record.unit);
    const enrichedReturn: ReturnRecord = {
      ...record,
      unit: resolvedUnit,
      ...(resolvedUnit ? { unitMissing: false } : { unitMissing: true }),
      stockId: newStockId,
      movementIdempotencyKey: returnIdempotencyKey,
    };

    const nextReturns = [enrichedReturn, ...returns];
    setReturns(nextReturns);

    const catUpper = (record.category || '').toUpperCase();
    let derivedStockType: MaterialType = 'RAW';
    if (catUpper.includes('PACKAGING')) derivedStockType = 'PACKAGING';
    else if (catUpper.includes('CONSUMABLE') || catUpper.includes('OFFICE')) derivedStockType = 'CONSUMABLE';
    else if (catUpper.includes('WIP') || catUpper.includes('SUB-PART')) derivedStockType = 'WIP';
    else if (catUpper.includes('FG') || catUpper.includes('FINISHED')) derivedStockType = 'FG';
    else if ((record.partCode || '').startsWith('RM')) derivedStockType = 'RAW';

    const newStockItem: MaterialStockItem = {
      id: newStockId,
      partCode: record.partCode,
      description: record.materialDescription,
      type: derivedStockType,
      location: record.status === 'QUARANTINED' ? 'Quarantine Area' : 'Designated Storage Bin',
      quantity: record.quantity,
      unit: resolvedUnit,
      ...(resolvedUnit ? { unitMissing: false } : { unitMissing: true }),
      lotNumber: record.lotNumber,
      receivedDate: record.date,
      fifoColor: getFifoColorForDate(record.date, fifoColorsByMonth),
      status: record.status === 'QUARANTINED' ? 'QUARANTINE' : 'APPROVED'
    };
    const nextStocks = [newStockItem, ...stocks];
    setStocks(nextStocks);
    upsertRecordLocallyAndRemotely('stocks', newStockItem, `Created stock item from return for ${record.partCode}`);
    upsertRecordLocallyAndRemotely('returns', enrichedReturn, `Returned ${formatQuantityWithUnit(record.quantity, resolvedUnit)} of ${record.partCode}`);

    const returnQty = Math.abs(Number(record.quantity) || 0);
    syncManager.executeMovement({
      productId: newStockId,
      warehouseId: newStockItem.warehouseId || 'wh-main',
      type: 'SALE_RETURN',
      quantity: returnQty,
      delta: returnQty,
      referenceId: record.id,
      referenceNumber: record.returnSlipFormNumber || record.id,
      lotNumber: record.lotNumber,
      location: newStockItem.location,
      unit: resolvedUnit || undefined,
      notes: `Shop-floor return: ${record.partCode} (${record.reason || 'Return'})`,
      userName: currentUser,
      idempotencyKey: returnIdempotencyKey,
      preventNegativeStock: false,
    }).catch((err) => console.warn('Return stock movement sync note:', err));

    sendSystemActivity(`${currentUser} registered shop-floor return of ${formatQuantityWithUnit(record.quantity, resolvedUnit)} for ${record.partCode} (Lot: ${record.lotNumber}).`);
  };

  const handleUpdateReturnStatus = (id: string, status: ReturnRecord['status']) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const existingRet = returns.find(r => r.id === id);
    const nextReturns: ReturnRecord[] = returns.map(r => r.id === id ? { ...r, status, iqcEvaluation: 'APPROVED_IQC' as const } : r);
    setReturns(nextReturns);
    if (existingRet) {
      upsertRecordLocallyAndRemotely('returns', { ...existingRet, status, iqcEvaluation: 'APPROVED_IQC' as const }, `Updated return status to ${status}`);
    }

    const targetRet = existingRet;
    if (targetRet) {
      const nextStocks: MaterialStockItem[] = stocks.map(s => {
        if (s.lotNumber === targetRet.lotNumber && s.partCode === targetRet.partCode) {
          const updatedStock = { ...s, status: 'APPROVED' as const, location: 'Designated Storage Bin' };
          upsertRecordLocallyAndRemotely('stocks', updatedStock, `Approved returned stock for ${targetRet.partCode}`);
          return updatedStock;
        }
        return s;
      });
      setStocks(nextStocks);

      sendSystemActivity(`${currentUser} approved returned item ${targetRet.partCode} back to active inventory.`);
    }
  };

  const handleEditReturn = (record: ReturnRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT RETURN RECORDS.", 'error');
      return;
    }
    const next = returns.map(r => r.id === record.id ? record : r);
    setReturns(next);
    upsertRecordLocallyAndRemotely('returns', record, `Updated return record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated return record ${record.id} (${record.partCode}).`);
  };

  const handleDeleteReturn = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE RETURN TRANSACTIONS.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('returns', id);
    const next = returns.filter(r => r.id !== id);
    setReturns(next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted return record ${id}.`);
  };

  const handleAddRecycling = (record: RecyclingRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const keyword = (record.itemType || '').trim().toUpperCase();
    const matchingPkgStock = stocks.find(
      (s) =>
        s.type === 'PACKAGING' &&
        ((s.description || '').toUpperCase().includes(keyword) ||
          (s.partCode || '').toUpperCase().includes(keyword))
    );
    const recIdempotencyKey = record.movementIdempotencyKey || `REC:${record.id}`;
    const resolvedUnit = normalizeUnitCode(record.unit || matchingPkgStock?.unit);
    const enrichedRecycling: RecyclingRecord = {
      ...record,
      unit: resolvedUnit,
      ...(resolvedUnit ? { unitMissing: false } : { unitMissing: true }),
      ...(matchingPkgStock ? { stockId: matchingPkgStock.id } : {}),
      movementIdempotencyKey: recIdempotencyKey,
    };

    const nextRecycling = [enrichedRecycling, ...recycling];
    setRecycling(nextRecycling);
    upsertRecordLocallyAndRemotely('recycling', enrichedRecycling, `Recycled ${formatQuantityWithUnit(record.quantity, resolvedUnit)} ${record.itemType}(s)`);

    const qty = Math.abs(Number(record.quantity) || 0);
    const signedDelta = matchingPkgStock
      ? record.disposition === 'Scrap Disposal'
        ? -qty
        : record.disposition === 'Re-used'
          ? qty
          : 0
      : 0;
    const slug = (record.itemType || 'PACKAGING').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-');

    syncManager.executeMovement({
      productId: matchingPkgStock ? matchingPkgStock.id : `PKG-${slug}`,
      warehouseId: matchingPkgStock?.warehouseId || 'wh-main',
      type: 'RECYCLING',
      quantity: signedDelta,
      delta: signedDelta,
      referenceId: record.id,
      referenceNumber: record.logSheetNumber || record.id,
      unit: resolvedUnit || undefined,
      notes: `Packaging recycling: ${formatQuantityWithUnit(qty, resolvedUnit)} x ${record.itemType} (${record.disposition}, Condition: ${record.condition})`,
      userName: currentUser,
      idempotencyKey: recIdempotencyKey,
      preventNegativeStock: false,
    }).catch((err) => console.warn('Recycling stock movement sync note:', err));

    sendSystemActivity(`${currentUser} recorded recycling of ${formatQuantityWithUnit(record.quantity, resolvedUnit)} ${record.itemType}(s) under Log Sheet: ${record.logSheetNumber}.`);
  };

  const handleDeleteRecycling = (id: string) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('recycling', id);
    const nextRecycling = recycling.filter(r => r.id !== id);
    setRecycling(nextRecycling);
  };

  return {
    handleAddReceiving,
    handleUpdateIqc,
    handleEditReceiving,
    handleDeleteReceiving,
    handleAddReturn,
    handleUpdateReturnStatus,
    handleEditReturn,
    handleDeleteReturn,
    handleAddRecycling,
    handleDeleteRecycling
  };
}
