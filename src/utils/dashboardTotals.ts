/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Dashboard KPI & Totals Aggregation Utilities
 */

import type {
  DeliveryRecord,
  ForkliftChecklist,
  IssuanceRecord,
  MasterRegistryItem,
  MaterialStockItem,
  ReceivingRecord,
} from '../types';
import {
  MISSING_UNIT_KEY,
  MISSING_UNIT_LABEL,
  compareUnitKeys,
  groupQuantitiesByUnit,
  resolveMasterDataUnit,
  type GroupedUnitTotalsResult,
} from '../../shared/units';
import { computeStockAlerts, type StockAlertsSummary } from './stockAlerts';

export interface FlowVelocityBucket {
  key: string;
  displayUnit: string;
  isMissing: boolean;
  rx: number;
  iss: number;
  rxPct: number;
  issPct: number;
}

export interface TopFlowSkuSummary {
  partCode: string;
  description: string;
  rx: number;
  iss: number;
  currentStock: number;
  unit: string;
  unitMissing: boolean;
}

export interface DashboardTotalsResult {
  resolvedReceiving: Array<ReceivingRecord & { unit: string; unitMissing: boolean }>;
  resolvedIssuances: Array<IssuanceRecord & { unit: string; unitMissing: boolean }>;
  resolvedDeliveries: Array<DeliveryRecord & { unit: string; unitMissing: boolean }>;
  receivedGrouped: GroupedUnitTotalsResult;
  issuedGrouped: GroupedUnitTotalsResult;
  flowVelocityByUnit: FlowVelocityBucket[];
  topFlowSkus: TopFlowSkuSummary[];
  quarantineCount: number;
  pendingIqcCount: number;
  brokenResinSacks: MaterialStockItem[];
  forkliftDoneToday: boolean;
  operationalMissingUnitCount: number;
  alerts: StockAlertsSummary;
}

export interface ComputeDashboardTotalsInput {
  stocks: MaterialStockItem[];
  receiving: ReceivingRecord[];
  issuances: IssuanceRecord[];
  deliveries: DeliveryRecord[];
  forkliftChecks?: ForkliftChecklist[];
  registries?: MasterRegistryItem[];
  referenceDateStr?: string;
}

export function computeDashboardTotals({
  stocks,
  receiving,
  issuances,
  deliveries,
  forkliftChecks = [],
  registries = [],
  referenceDateStr,
}: ComputeDashboardTotalsInput): DashboardTotalsResult {
  const resolvedReceiving = receiving.map((r) => {
    const res = resolveMasterDataUnit(r, registries, stocks);
    return { ...r, unit: res.unit, unitMissing: res.isMissing };
  });

  const resolvedIssuances = issuances.map((i) => {
    const res = resolveMasterDataUnit(i, registries, stocks);
    return { ...i, unit: res.unit, unitMissing: res.isMissing };
  });

  const resolvedDeliveries = deliveries.map((d) => {
    const res = resolveMasterDataUnit({ ...d, description: d.modelName }, registries, stocks);
    return { ...d, unit: res.unit, unitMissing: res.isMissing };
  });

  const receivedGrouped = groupQuantitiesByUnit(
    resolvedReceiving,
    (r) => Number(r.quantity) || 0,
    (r) => r.unit
  );

  const issuedGrouped = groupQuantitiesByUnit(
    resolvedIssuances,
    (i) => Number(i.quantityIssued) || 0,
    (i) => i.unit
  );

  const rxMap = new Map(receivedGrouped.buckets.map((b) => [b.key, b.total]));
  const issMap = new Map(issuedGrouped.buckets.map((b) => [b.key, b.total]));
  const keys = Array.from(new Set([...rxMap.keys(), ...issMap.keys()])).sort(compareUnitKeys);

  const flowVelocityByUnit: FlowVelocityBucket[] = keys.map((key) => {
    const rx = rxMap.get(key) || 0;
    const iss = issMap.get(key) || 0;
    const total = rx + iss;
    const isMissing = key === MISSING_UNIT_KEY;
    return {
      key,
      displayUnit: isMissing ? MISSING_UNIT_LABEL : key,
      isMissing,
      rx,
      iss,
      rxPct: total > 0 ? Math.round((rx / total) * 100) : 50,
      issPct: total > 0 ? Math.round((iss / total) * 100) : 50,
    };
  });

  const skuMap: Record<string, TopFlowSkuSummary> = {};
  resolvedReceiving.forEach((r) => {
    if (!skuMap[r.partCode]) {
      skuMap[r.partCode] = {
        partCode: r.partCode,
        description: r.itemDescription,
        rx: 0,
        iss: 0,
        currentStock: 0,
        unit: r.unit,
        unitMissing: r.unitMissing,
      };
    } else if (!skuMap[r.partCode].unit && r.unit) {
      skuMap[r.partCode].unit = r.unit;
      skuMap[r.partCode].unitMissing = false;
    }
    skuMap[r.partCode].rx += Number(r.quantity) || 0;
  });

  resolvedIssuances.forEach((i) => {
    if (!skuMap[i.partCode]) {
      skuMap[i.partCode] = {
        partCode: i.partCode,
        description: i.description,
        rx: 0,
        iss: 0,
        currentStock: 0,
        unit: i.unit,
        unitMissing: i.unitMissing,
      };
    } else if (!skuMap[i.partCode].unit && i.unit) {
      skuMap[i.partCode].unit = i.unit;
      skuMap[i.partCode].unitMissing = false;
    }
    skuMap[i.partCode].iss += Number(i.quantityIssued) || 0;
  });

  stocks.forEach((s) => {
    if (s.status === 'APPROVED' && skuMap[s.partCode]) {
      skuMap[s.partCode].currentStock += Number(s.quantity) || 0;
      const stockUnit = resolveMasterDataUnit(s, registries, stocks);
      if (!stockUnit.isMissing) {
        skuMap[s.partCode].unit = stockUnit.unit;
        skuMap[s.partCode].unitMissing = false;
      }
    }
  });

  const topFlowSkus = Object.values(skuMap)
    .sort((a, b) => b.rx + b.iss - (a.rx + a.iss))
    .slice(0, 5);

  const quarantineCount = stocks.filter(
    (item) => item.status === 'QUARANTINE' || item.status === 'HOLD'
  ).length;
  const pendingIqcCount = receiving.filter((item) => item.iqcStatus === 'PENDING_IQC').length;

  const alerts = computeStockAlerts(stocks, referenceDateStr, registries);

  const operationalMissingUnitCount =
    alerts.missingUnitCount +
    resolvedReceiving.filter((r) => r.unitMissing).length +
    resolvedIssuances.filter((i) => i.unitMissing).length +
    resolvedDeliveries.filter((d) => d.unitMissing).length;

  const brokenResinSacks = stocks.filter(
    (item) => item.resinSackRisk && item.status === 'QUARANTINE'
  );

  const forkliftDoneToday = forkliftChecks.some((check) => check.date === alerts.todayStr);

  return {
    resolvedReceiving,
    resolvedIssuances,
    resolvedDeliveries,
    receivedGrouped,
    issuedGrouped,
    flowVelocityByUnit,
    topFlowSkus,
    quarantineCount,
    pendingIqcCount,
    brokenResinSacks,
    forkliftDoneToday,
    operationalMissingUnitCount,
    alerts,
  };
}
