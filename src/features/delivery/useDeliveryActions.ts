/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  DeliveryRecord,
  EnvironmentalLog,
  ForkliftChecklist,
  MaterialStockItem
} from '../../types';
import { syncManager } from '../../sync/syncManager';
import { showPrintToast } from '../../utils/printDocument';
import { formatQuantityWithUnit, normalizeUnitCode } from '../../../shared/units';
import { translate } from '../../i18n';

export interface UseDeliveryActionsParams {
  deliveries: DeliveryRecord[];
  setDeliveries: React.Dispatch<React.SetStateAction<DeliveryRecord[]>>;
  stocks: MaterialStockItem[];
  setStocks: React.Dispatch<React.SetStateAction<MaterialStockItem[]>>;
  envLogs: EnvironmentalLog[];
  setEnvLogs: React.Dispatch<React.SetStateAction<EnvironmentalLog[]>>;
  forkliftChecks: ForkliftChecklist[];
  setForkliftChecks: React.Dispatch<React.SetStateAction<ForkliftChecklist[]>>;
  currentUser: string;
  currentRole: string;
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
  syncCollection: (collection: string, data: any[]) => void;
  sendSystemActivity: (text: string) => void;
}

export function useDeliveryActions({
  deliveries,
  setDeliveries,
  stocks,
  setStocks,
  envLogs,
  setEnvLogs,
  forkliftChecks,
  setForkliftChecks,
  currentUser,
  currentRole,
  currentPermission,
  upsertRecordLocallyAndRemotely,
  deleteRecordLocallyAndRemotely,
  syncCollection,
  sendSystemActivity
}: UseDeliveryActionsParams) {
  const handleAddDelivery = (record: DeliveryRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast(translate('toasts.viewOnlyDenied'), 'error');
      return;
    }
    const matchedStock = stocks.find(s => s.partCode === record.partCode && s.status === 'APPROVED') || stocks.find(s => s.partCode === record.partCode);
    const resolvedUnit = normalizeUnitCode(record.unit || matchedStock?.unit);
    const enrichedDelivery: DeliveryRecord = {
      ...record,
      unit: resolvedUnit,
      ...(resolvedUnit ? { unitMissing: false } : { unitMissing: true }),
    };
    const nextDeliveries = [enrichedDelivery, ...deliveries];
    setDeliveries(nextDeliveries);
    upsertRecordLocallyAndRemotely('deliveries', enrichedDelivery, `Created delivery request ${enrichedDelivery.id}`);

    sendSystemActivity(`${currentUser} created Delivery request ${enrichedDelivery.id} for model ${enrichedDelivery.modelName} (${formatQuantityWithUnit(enrichedDelivery.quantity, resolvedUnit)}).`);
  };

  const handleUpdateDeliveryStatus = (
    id: string,
    status: DeliveryRecord['status'],
    extDoc?: { drNumber?: string; salesInvoice?: string; wayBill?: string }
  ) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast(translate('toasts.viewOnlyDenied'), 'error');
      return;
    }
    const existingDel = deliveries.find(d => d.id === id);
    const matchingStock =
      status === 'RELEASED' && existingDel
        ? stocks.find(
            s =>
              s.partCode === existingDel.partCode &&
              s.status === 'APPROVED' &&
              s.quantity >= existingDel.quantity
          )
        : undefined;
    const deliveryIdempotencyKey =
      status === 'RELEASED' && matchingStock ? `DEL:${id}:${matchingStock.id}` : undefined;

    let updatedRecord: DeliveryRecord | null = null;
    const nextDeliveries = deliveries.map(d => {
      if (d.id === id) {
        updatedRecord = {
          ...d,
          status,
          ...extDoc,
          ...(matchingStock ? { stockId: matchingStock.id } : {}),
          ...(deliveryIdempotencyKey ? { movementIdempotencyKey: deliveryIdempotencyKey } : {}),
        };
        return updatedRecord;
      }
      return d;
    });
    setDeliveries(nextDeliveries);
    if (updatedRecord) {
      upsertRecordLocallyAndRemotely('deliveries', updatedRecord, `Updated delivery status to ${status}`);
    }

    if (status === 'RELEASED') {
      if (existingDel && matchingStock) {
        const nextStocks = stocks.map(s =>
          s.id === matchingStock.id
            ? { ...s, quantity: s.quantity - existingDel.quantity }
            : s
        );
        setStocks(nextStocks);

        const resolvedUnit = normalizeUnitCode(updatedRecord?.unit || matchingStock.unit);
        syncManager.executeMovement({
          productId: matchingStock.id,
          warehouseId: matchingStock.warehouseId || 'wh-main',
          type: 'SALE',
          quantity: existingDel.quantity,
          delta: -Math.abs(existingDel.quantity),
          referenceId: id,
          referenceNumber:
            updatedRecord?.gatePassNumber ||
            updatedRecord?.drNumber ||
            existingDel.pickingListNumber ||
            id,
          lotNumber: matchingStock.lotNumber,
          location: matchingStock.location,
          unit: resolvedUnit || undefined,
          notes: `Delivery released for ${existingDel.partCode} (PO: ${existingDel.poNumber || 'N/A'})`,
          userName: currentUser,
          idempotencyKey: deliveryIdempotencyKey,
          preventNegativeStock: true,
        }).catch((err) => console.warn('Delivery release stock movement sync note:', err));

        sendSystemActivity(`${currentUser} released Delivery Request ${id} & Gate Pass to gate guards.`);
      }
    } else {
      sendSystemActivity(`${currentUser} marked Delivery Request ${id} as ${status}.`);
    }
  };

  const handleEditDelivery = (record: DeliveryRecord) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast(translate('toasts.viewOnlyEditDeliveryDenied'), 'error');
      return;
    }
    const next = deliveries.map(d => d.id === record.id ? record : d);
    setDeliveries(next);
    upsertRecordLocallyAndRemotely('deliveries', record, `Updated delivery record ${record.id}`);
    const actorRole = currentPermission === 'FULL_ACCESS' ? 'SUPER ADMIN' : 'OPERATOR';
    sendSystemActivity(`${actorRole} ${currentUser} updated delivery record ${record.id} (${record.gatePassNumber}).`);
  };

  const handleDeleteDelivery = (id: string) => {
    if (currentPermission !== 'FULL_ACCESS') {
      showPrintToast(translate('toasts.superAdminDeleteDeliveryDenied'), 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('deliveries', id);
    const next = deliveries.filter(d => d.id !== id);
    setDeliveries(next);
    sendSystemActivity(`SUPER ADMIN ${currentUser} deleted delivery record ${id}.`);
  };

  const handleAddEnvLog = (log: EnvironmentalLog) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast(translate('toasts.viewOnlyDenied'), 'error');
      return;
    }
    const nextEnvLogs = [...envLogs, log];
    setEnvLogs(nextEnvLogs);
    upsertRecordLocallyAndRemotely('envLogs', log, `Logged space utilization for ${log.zone}`);

    const pct = ((log.occupiedSlots / log.totalSlots) * 100).toFixed(1);
    sendSystemActivity(`${currentUser} logged space utilization audit for ${log.zone}: ${log.occupiedSlots}/${log.totalSlots} slots occupied (${pct}%).`);
  };

  const handleClearEnvLogs = () => {
    const normRole = (currentRole || '').toUpperCase();
    const normUser = (currentUser || '').toUpperCase();
    const isSuperOrSystem = normRole.includes('SUPER') || normRole.includes('SYSTEM') || normUser.includes('SUPER') || normUser.includes('SYSTEM') || currentPermission === 'FULL_ACCESS';

    if (!isSuperOrSystem) {
      showPrintToast(translate('toasts.superAdminClearEnvDenied'), 'error');
      return;
    }
    setEnvLogs([]);
    syncCollection('envLogs', []);
    sendSystemActivity(`ADMIN ${currentUser} cleared all historical space audit sheet logs.`);
  };

  const handleDeleteEnvLog = (id: string) => {
    const normRole = (currentRole || '').toUpperCase();
    const normUser = (currentUser || '').toUpperCase();
    const isSuperOrSystem = normRole.includes('SUPER') || normRole.includes('SYSTEM') || normUser.includes('SUPER') || normUser.includes('SYSTEM') || currentPermission === 'FULL_ACCESS';

    if (!isSuperOrSystem) {
      showPrintToast(translate('toasts.superAdminDeleteEnvDenied'), 'error');
      return;
    }
    deleteRecordLocallyAndRemotely('envLogs', id);
    const next = envLogs.filter(l => l.id !== id);
    setEnvLogs(next);
    sendSystemActivity(`ADMIN ${currentUser} deleted space audit log record ${id}.`);
  };

  const handleAddForkliftCheck = (check: ForkliftChecklist) => {
    if (currentPermission === 'VIEW_ONLY') {
      showPrintToast(translate('toasts.viewOnlyDenied'), 'error');
      return;
    }
    const nextForkliftChecks = [check, ...forkliftChecks];
    setForkliftChecks(nextForkliftChecks);
    upsertRecordLocallyAndRemotely('forkliftChecks', check, `Logged Forklift ${check.forkliftId} pre-op inspection`);

    const isForkliftOk = check.brakesOk && check.lightsOk && check.hydraulicOk && check.steeringOk && check.tiresOk && check.batteryFluidOk;
    sendSystemActivity(`${currentUser} logged Forklift ${check.forkliftId} pre-op check. Passed: ${isForkliftOk}.`);
  };

  return {
    handleAddDelivery,
    handleUpdateDeliveryStatus,
    handleEditDelivery,
    handleDeleteDelivery,
    handleAddEnvLog,
    handleClearEnvLogs,
    handleDeleteEnvLog,
    handleAddForkliftCheck
  };
}
