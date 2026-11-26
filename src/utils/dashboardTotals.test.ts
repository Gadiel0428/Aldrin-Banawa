/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Dashboard KPI and Totals aggregation (computeDashboardTotals)
 */

import { describe, it, expect } from 'vitest';
import type {
  DeliveryRecord,
  ForkliftChecklist,
  IssuanceRecord,
  MasterRegistryItem,
  MaterialStockItem,
  ReceivingRecord,
} from '../types';
import { computeDashboardTotals } from './dashboardTotals';
import { MISSING_UNIT_KEY, MISSING_UNIT_LABEL } from '../../shared/units';

const registries: MasterRegistryItem[] = [
  {
    id: 'REG-1',
    type: 'BARCODE_PRESET',
    code: 'RM-001',
    name: 'ABS Resin',
    unit: 'KG',
    status: 'ACTIVE',
    dateRegistered: '2026-10-01',
  },
  {
    id: 'REG-2',
    type: 'BARCODE_PRESET',
    code: 'FG-001',
    name: 'Sensor Housing',
    unit: 'PCS',
    status: 'ACTIVE',
    dateRegistered: '2026-10-01',
  },
];

describe('computeDashboardTotals', () => {
  it('groups inbound received and outbound issued quantities by unit without mixing KG and PCS', () => {
    const stocks: MaterialStockItem[] = [
      {
        id: 'STK-1',
        partCode: 'RM-001',
        description: 'ABS Resin',
        type: 'RAW',
        location: 'Zone A',
        quantity: 400,
        unit: 'KG',
        lotNumber: 'L1',
        receivedDate: '2026-11-01',
        fifoColor: 'Grey',
        status: 'APPROVED',
      },
      {
        id: 'STK-2',
        partCode: 'FG-001',
        description: 'Sensor Housing',
        type: 'FG',
        location: 'Zone D',
        quantity: 250,
        unit: 'PCS',
        lotNumber: 'L2',
        receivedDate: '2026-11-02',
        fifoColor: 'Grey',
        status: 'APPROVED',
      },
    ];

    const receiving: ReceivingRecord[] = [
      {
        id: 'RCV-1',
        date: '2026-11-01',
        source: 'EXTERNAL',
        itemDescription: 'ABS Resin',
        partCode: 'RM-001',
        quantity: 300,
        unit: 'KGS', // normalizes to KG
        lotNumber: 'L1',
        physicalCondition: {},
        supplierOrDept: 'SABIC',
        iqcStatus: 'APPROVED_IQC',
        status: 'VERIFIED',
        fifoColorCode: 'Grey',
      },
      {
        id: 'RCV-2',
        date: '2026-11-02',
        source: 'INTERNAL',
        itemDescription: 'Sensor Housing',
        partCode: 'FG-001',
        quantity: 100,
        unit: '', // resolved from registry -> PCS
        lotNumber: 'L2',
        physicalCondition: {},
        supplierOrDept: 'Line 1',
        iqcStatus: 'NA',
        status: 'VERIFIED',
        fifoColorCode: 'Grey',
      },
    ];

    const issuances: IssuanceRecord[] = [
      {
        id: 'ISS-1',
        date: '2026-11-03',
        requisitionNumber: 'REQ-1',
        department: 'Molding',
        partCode: 'RM-001',
        description: 'ABS Resin',
        quantityRequested: 100,
        quantityIssued: 100,
        unit: 'KG',
        lotNumber: 'L1',
        fifoVerified: true,
        issuedBy: 'Staff',
        receivedBy: 'Op',
      },
    ];

    const result = computeDashboardTotals({
      stocks,
      receiving,
      issuances,
      deliveries: [],
      registries,
      referenceDateStr: '2026-11-05',
    });

    expect(result.receivedGrouped.hasMultipleUnits).toBe(true);
    expect(result.receivedGrouped.buckets.map((b) => ({ unit: b.unit, total: b.total }))).toEqual([
      { unit: 'KG', total: 300 },
      { unit: 'PCS', total: 100 },
    ]);

    expect(result.issuedGrouped.buckets.map((b) => ({ unit: b.unit, total: b.total }))).toEqual([
      { unit: 'KG', total: 100 },
    ]);

    expect(result.flowVelocityByUnit).toEqual([
      { key: 'KG', displayUnit: 'KG', isMissing: false, rx: 300, iss: 100, rxPct: 75, issPct: 25 },
      { key: 'PCS', displayUnit: 'PCS', isMissing: false, rx: 100, iss: 0, rxPct: 100, issPct: 0 },
    ]);
  });

  it('ranks topFlowSkus by combined rx + iss and counts only APPROVED stock in currentStock', () => {
    const stocks: MaterialStockItem[] = [
      {
        id: 'STK-A',
        partCode: 'RM-001',
        description: 'ABS Resin',
        type: 'RAW',
        location: 'Zone A',
        quantity: 120,
        unit: 'KG',
        lotNumber: 'L1',
        receivedDate: '2026-11-01',
        fifoColor: 'Grey',
        status: 'APPROVED',
      },
      {
        id: 'STK-Q',
        partCode: 'RM-001',
        description: 'ABS Resin',
        type: 'RAW',
        location: 'Quarantine',
        quantity: 80,
        unit: 'KG',
        lotNumber: 'L2',
        receivedDate: '2026-11-02',
        fifoColor: 'Grey',
        status: 'QUARANTINE',
        resinSackRisk: true,
      },
      {
        id: 'STK-H',
        partCode: 'FG-001',
        description: 'Sensor Housing',
        type: 'FG',
        location: 'Hold',
        quantity: 50,
        unit: 'PCS',
        lotNumber: 'L3',
        receivedDate: '2026-11-02',
        fifoColor: 'Grey',
        status: 'HOLD',
      },
    ];

    const receiving: ReceivingRecord[] = [
      {
        id: 'R1',
        date: '2026-11-01',
        source: 'EXTERNAL',
        itemDescription: 'ABS Resin',
        partCode: 'RM-001',
        quantity: 200,
        unit: 'KG',
        lotNumber: 'L1',
        physicalCondition: {},
        supplierOrDept: 'Vendor',
        iqcStatus: 'PENDING_IQC',
        status: 'DRAFT',
        fifoColorCode: 'Grey',
      },
      {
        id: 'R2',
        date: '2026-11-02',
        source: 'INTERNAL',
        itemDescription: 'Sensor Housing',
        partCode: 'FG-001',
        quantity: 500,
        unit: 'PCS',
        lotNumber: 'L3',
        physicalCondition: {},
        supplierOrDept: 'Assembly',
        iqcStatus: 'APPROVED_IQC',
        status: 'VERIFIED',
        fifoColorCode: 'Grey',
      },
    ];

    const issuances: IssuanceRecord[] = [
      {
        id: 'I1',
        date: '2026-11-03',
        requisitionNumber: 'REQ-1',
        department: 'Prod',
        partCode: 'RM-001',
        description: 'ABS Resin',
        quantityRequested: 50,
        quantityIssued: 50,
        unit: 'KG',
        lotNumber: 'L1',
        fifoVerified: true,
        issuedBy: 'Staff',
        receivedBy: 'Op',
      },
    ];

    const deliveries: DeliveryRecord[] = [
      {
        id: 'D1',
        date: '2026-11-04',
        pickingListNumber: 'PK-1',
        poNumber: 'PO-1',
        modelName: 'Unknown Model',
        partCode: 'NO-UNIT-PART',
        quantity: 10,
        unit: '',
        packagingConditionOk: true,
        fifoVerified: true,
        forkliftChecklistSigned: true,
        gatePassNumber: 'GP-1',
        status: 'PREPARING',
        preparedBy: 'Staff',
      },
    ];

    const forkliftChecks: ForkliftChecklist[] = [
      {
        id: 'FC-1',
        date: '2026-11-05',
        operator: 'Juan',
        forkliftId: 'FL-01',
        brakesOk: true,
        lightsOk: true,
        hydraulicOk: true,
        steeringOk: true,
        tiresOk: true,
        batteryFluidOk: true,
      },
    ];

    const totals = computeDashboardTotals({
      stocks,
      receiving,
      issuances,
      deliveries,
      forkliftChecks,
      registries,
      referenceDateStr: '2026-11-05',
    });

    expect(totals.quarantineCount).toBe(2); // 1 QUARANTINE + 1 HOLD
    expect(totals.pendingIqcCount).toBe(1);
    expect(totals.brokenResinSacks).toHaveLength(1);
    expect(totals.forkliftDoneToday).toBe(true);
    expect(totals.operationalMissingUnitCount).toBe(1); // D1 has missing unit

    expect(totals.topFlowSkus.map((s) => ({ partCode: s.partCode, totalFlow: s.rx + s.iss, currentStock: s.currentStock }))).toEqual([
      { partCode: 'FG-001', totalFlow: 500, currentStock: 0 }, // STK-H is HOLD so not in APPROVED currentStock
      { partCode: 'RM-001', totalFlow: 250, currentStock: 120 }, // STK-Q is QUARANTINE so excluded from currentStock
    ]);
  });

  it('tracks missing units cleanly in flowVelocityByUnit and operationalMissingUnitCount', () => {
    const receiving: ReceivingRecord[] = [
      {
        id: 'R-MISS',
        date: '2026-11-01',
        source: 'EXTERNAL',
        itemDescription: 'Mystery Item',
        partCode: 'UNK-01',
        quantity: 15,
        unit: '',
        lotNumber: 'L1',
        physicalCondition: {},
        supplierOrDept: 'Vendor',
        iqcStatus: 'NA',
        status: 'VERIFIED',
        fifoColorCode: 'Grey',
      },
    ];

    const totals = computeDashboardTotals({
      stocks: [],
      receiving,
      issuances: [],
      deliveries: [],
      referenceDateStr: '2026-11-05',
    });

    expect(totals.operationalMissingUnitCount).toBe(1);
    expect(totals.flowVelocityByUnit).toEqual([
      {
        key: MISSING_UNIT_KEY,
        displayUnit: MISSING_UNIT_LABEL,
        isMissing: true,
        rx: 15,
        iss: 0,
        rxPct: 100,
        issPct: 0,
      },
    ]);
    expect(totals.forkliftDoneToday).toBe(false);
  });
});
