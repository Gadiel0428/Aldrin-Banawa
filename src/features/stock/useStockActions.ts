/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MaterialStockItem } from '../../types';
import { syncManager } from '../../sync/syncManager';
import { showPrintToast } from '../../utils/printDocument';
import { formatQuantityWithUnit, normalizeUnitCode } from '../../../shared/units';

export interface UseStockActionsParams {
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

export function useStockActions({
  stocks,
  setStocks,
  currentUser,
  currentPermission,
  upsertRecordLocallyAndRemotely,
  deleteRecordLocallyAndRemotely,
  sendSystemActivity
}: UseStockActionsParams) {
  const handleAddStock = (item: MaterialStockItem) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const normUnit = normalizeUnitCode(item.unit);
    const normalizedItem: MaterialStockItem = {
      ...item,
      unit: normUnit,
      ...(normUnit ? { unitMissing: false } : { unitMissing: true }),
    };
    const next = [normalizedItem, ...stocks];
    setStocks(next);
    upsertRecordLocallyAndRemotely('stocks', normalizedItem, `Added stock batch ${normalizedItem.partCode}`);
    const qty = Number(normalizedItem.quantity) || 0;
    if (qty !== 0) {
      syncManager.executeMovement({
        productId: normalizedItem.id,
        warehouseId: normalizedItem.warehouseId || 'wh-main',
        type: qty >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        quantity: Math.abs(qty),
        delta: qty,
        lotNumber: normalizedItem.lotNumber,
        location: normalizedItem.location,
        unit: normalizedItem.unit || undefined,
        notes: `Initial stock batch added (${normalizedItem.partCode})`,
        userName: currentUser,
        idempotencyKey: `STK-ADD:${normalizedItem.id}`,
        preventNegativeStock: false,
      }).catch((err) => console.warn('Add stock movement sync note:', err));
    }
    sendSystemActivity(`${currentUser} added stock batch ${normalizedItem.partCode} (${formatQuantityWithUnit(normalizedItem.quantity, normalizedItem.unit)}).`);
  };

  const handleUpdateStockQty = (id: string, qty: number) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    const existingItem = stocks.find(s => s.id === id);
    const currentQty = Number(existingItem?.quantity) || 0;
    const delta = (Number(qty) || 0) - currentQty;
    const unit = normalizeUnitCode(existingItem?.unit);

    const next = stocks.map(s => (s.id === id ? { ...s, quantity: qty } : s));
    setStocks(next);

    if (delta !== 0) {
      syncManager.executeMovement({
        productId: id,
        warehouseId: existingItem?.warehouseId || 'wh-main',
        type: delta >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        quantity: Math.abs(delta),
        delta,
        lotNumber: existingItem?.lotNumber,
        location: existingItem?.location,
        unit: unit || undefined,
        notes: `Manual quantity adjustment (${currentQty} -> ${qty}${unit ? ` ${unit}` : ''})`,
        userName: currentUser,
        idempotencyKey: `STK-ADJ:${id}:${Date.now()}:${Math.random().toString(36).substring(2, 6)}`,
        preventNegativeStock: true,
      }).catch((err) => console.warn('Update stock quantity movement note:', err));
    }
    sendSystemActivity(`${currentUser} updated stock ${id} quantity to ${formatQuantityWithUnit(qty, unit)}.`);
  };

  const handleUpdateStockStatus = (id: string, status: MaterialStockItem['status']) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: ACTIONS ARE RESTRICTED TO VIEW ONLY UNDER YOUR ACCESS LEVEL.", 'error');
      return;
    }
    let updatedItem: MaterialStockItem | null = null;
    const next = stocks.map(s => {
      if (s.id === id) {
        updatedItem = { ...s, status };
        return updatedItem;
      }
      return s;
    });
    setStocks(next);
    if (updatedItem) {
      upsertRecordLocallyAndRemotely('stocks', updatedItem, `Updated stock ${id} status to ${status}`);
    }
    sendSystemActivity(`${currentUser} updated stock ${id} status to ${status}.`);
  };

  const handleEditStock = (item: MaterialStockItem) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast("PERMISSION DENIED: OPERATORS IN VIEW ONLY MODE CANNOT EDIT STOCK ITEMS.", 'error');
      return;
    }
    const existingItem = stocks.find(s => s.id === item.id);
    const prevQty = Number(existingItem?.quantity) || 0;
    const nextQty = Number(item.quantity) || 0;
    const delta = nextQty - prevQty;
    const normUnit = normalizeUnitCode(item.unit || existingItem?.unit);
    const normalizedItem: MaterialStockItem = {
      ...item,
      unit: normUnit,
      ...(normUnit ? { unitMissing: false } : { unitMissing: true }),
    };

    const next = stocks.map(s => s.id === item.id ? normalizedItem : s);
    setStocks(next);
    upsertRecordLocallyAndRemotely('stocks', normalizedItem, `Updated stock record ${normalizedItem.id}`);

    if (delta !== 0) {
      const nextVer = (Number(existingItem?.version) || 1) + 1;
      syncManager.executeMovement({
        productId: normalizedItem.id,
        warehouseId: normalizedItem.warehouseId || existingItem?.warehouseId || 'wh-main',
        type: delta >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        quantity: Math.abs(delta),
        delta,
        lotNumber: normalizedItem.lotNumber,
        location: normalizedItem.location,
        unit: normUnit || undefined,
        notes: `Stock record edit adjustment (${prevQty} -> ${nextQty}${normUnit ? ` ${normUnit}` : ''})`,
        userName: currentUser,
        idempotencyKey: `STK-EDIT:${normalizedItem.id}:v${nextVer}:${nextQty}`,
        preventNegativeStock: true,
      }).catch((err) => console.warn('Edit stock movement sync note:', err));
    }

    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated stock record ${item.id} (${item.partCode}).`);
  };

  const handleDeleteStock = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      showPrintToast("PERMISSION DENIED: ONLY SUPER ADMIN (FULL ACCESS) CAN DELETE LIVE STOCK TRANSACTIONS.", 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('stocks', id);
    const next = stocks.filter(s => s.id !== id);
    setStocks(next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted stock record ${id}.`);
  };

  return {
    handleAddStock,
    handleUpdateStockQty,
    handleUpdateStockStatus,
    handleEditStock,
    handleDeleteStock
  };
}
