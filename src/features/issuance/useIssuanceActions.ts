/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { IssuanceRecord, MaterialStockItem } from '../../types';
import { syncManager } from '../../sync/syncManager';
import { showPrintToast } from '../../utils/printDocument';
import { formatQuantityWithUnit, normalizeUnitCode } from '../../../shared/units';

export interface UseIssuanceActionsParams {
  issuances: IssuanceRecord[];
  setIssuances: React.Dispatch<React.SetStateAction<IssuanceRecord[]>>;
  stocks: MaterialStockItem[];
  setStocks: React.Dispatch<React.SetStateAction<MaterialStockItem[]>>;
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

export function useIssuanceActions({
  issuances,
  setIssuances,
  stocks,
  setStocks,
  currentUser,
  currentPermission,
  upsertRecordLocallyAndRemotely,
  deleteRecordLocallyAndRemotely,
  sendSystemActivity
}: UseIssuanceActionsParams) {
  const lastDeductedMovementRef = React.useRef<{
    partCode: string;
    lotNumber: string;
    stockId: string;
    idempotencyKey: string;
  } | null>(null);

  const handleAddIssuance = (record: IssuanceRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const lastDeducted = lastDeductedMovementRef.current;
    const matchesPending =
      lastDeducted &&
      lastDeducted.partCode === record.partCode &&
      lastDeducted.lotNumber === record.lotNumber;
    const matchedStock = matchesPending
      ? undefined
      : stocks.find(s => s.partCode === record.partCode && s.lotNumber === record.lotNumber && s.status === 'APPROVED') ||
        stocks.find(s => s.partCode === record.partCode && s.lotNumber === record.lotNumber);

    const resolvedUnit = normalizeUnitCode(record.unit || matchedStock?.unit);
    const enrichedRecord: IssuanceRecord = {
      ...record,
      unit: resolvedUnit,
      ...(resolvedUnit ? { unitMissing: false } : { unitMissing: true }),
      stockId: record.stockId || (matchesPending ? lastDeducted.stockId : matchedStock?.id),
      movementIdempotencyKey:
        record.movementIdempotencyKey ||
        (matchesPending ? lastDeducted.idempotencyKey : `ISS:${record.id}`),
    };
    if (matchesPending) {
      lastDeductedMovementRef.current = null;
    }

    const nextIssuances = [enrichedRecord, ...issuances];
    setIssuances(nextIssuances);
    upsertRecordLocallyAndRemotely('issuances', enrichedRecord, `Issued ${formatQuantityWithUnit(record.quantityIssued, resolvedUnit)} for Requisition: ${record.requisitionNumber}`);

    sendSystemActivity(`${currentUser} logged materials issuance of ${formatQuantityWithUnit(record.quantityIssued, resolvedUnit)} for Requisition: ${record.requisitionNumber}.`);
  };

  const handleDeductStock = (partCode: string, lotNumber: string, quantity: number): boolean => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return false;
    }
    const stockIdx = stocks.findIndex(s => s.partCode === partCode && s.lotNumber === lotNumber && s.status === 'APPROVED');
    if (stockIdx === -1 || stocks[stockIdx].quantity < quantity) {
      return false;
    }
    const targetStock = stocks[stockIdx];
    const idempotencyKey = `ISS-DEDUCT:${targetStock.id}:${Date.now()}:${Math.random().toString(36).substring(2, 6)}`;
    lastDeductedMovementRef.current = {
      partCode,
      lotNumber,
      stockId: targetStock.id,
      idempotencyKey,
    };

    const updatedItem = { ...targetStock, quantity: targetStock.quantity - quantity };
    const nextStocks = stocks.map((s, idx) => (idx === stockIdx ? updatedItem : s));
    setStocks(nextStocks);

    syncManager.executeMovement({
      productId: targetStock.id,
      warehouseId: targetStock.warehouseId || 'wh-main',
      type: 'SALE',
      quantity,
      delta: -Math.abs(quantity),
      referenceNumber: lotNumber,
      lotNumber,
      location: targetStock.location,
      unit: normalizeUnitCode(targetStock.unit) || undefined,
      notes: `Stock deducted for part ${partCode} (Lot: ${lotNumber})`,
      userName: currentUser,
      idempotencyKey,
      preventNegativeStock: true
    }).catch((err) => console.warn('Stock movement async record note:', err));

    return true;
  };

  const handleEditIssuance = (record: IssuanceRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT ISSUANCE RECORDS.", 'error');
      return;
    }
    const next = issuances.map(i => i.id === record.id ? record : i);
    setIssuances(next);
    upsertRecordLocallyAndRemotely('issuances', record, `Updated issuance record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated issuance record ${record.id} (${record.partCode}).`);
  };

  const handleDeleteIssuance = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE ISSUANCE TRANSACTIONS.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('issuances', id);
    const next = issuances.filter(i => i.id !== id);
    setIssuances(next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted issuance record ${id}.`);
  };

  return {
    handleAddIssuance,
    handleDeductStock,
    handleEditIssuance,
    handleDeleteIssuance
  };
}
