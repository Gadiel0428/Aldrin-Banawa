/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UOM = 'PCS' | 'KG' | 'SET' | 'BOX' | 'UNITS' | 'LITERS';
export const UOM_OPTIONS: UOM[] = ['PCS', 'KG', 'SET', 'BOX', 'UNITS', 'LITERS'];

export type MaterialType = 'RAW' | 'PACKAGING' | 'CONSUMABLE' | 'WIP' | 'FG' | 'SUB_PART';

export type StorageZone = 
  | 'Zone A - Raw Materials'
  | 'Zone B - Packagings'
  | 'Zone C - WIP / Sub-parts'
  | 'Zone D - Finished Goods'
  | 'Zone E - Consumables'
  | 'Quarantine Area';

export interface BOMItem {
  partCode: string;
  description: string;
  quantityRequired: number;
  unit: string;
}

export interface BaseRecordAudit {
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
  version?: number;
  reset_version?: number;
}

export interface SystemResetInfo {
  systemResetVersion: number;
  systemResetTimestamp: string;
  systemResetId: string;
  resetBy?: string;
}

export interface MaterialStockItem extends BaseRecordAudit {
  id: string;
  partCode: string;
  description: string;
  type: MaterialType;
  location: string;
  quantity: number;
  unit: string;
  lotNumber: string;
  modelName?: string;
  color?: string;
  receivedDate: string; // YYYY-MM-DD
  expirationDate?: string; // YYYY-MM-DD
  fifoColor: string; // e.g. Magenta, Orange, Dark Green
  status: 'APPROVED' | 'QUARANTINE' | 'HOLD';
  resinSackRisk?: boolean; // True to alert on potential mixing/broken resin sack risk
  shelfLifeDays?: number;
  bom?: BOMItem[];
  customer?: string;
  reorderMin?: number;
  remarks?: string;
  warehouseId?: string;
  accountId?: string;
}

export type PresetSourceType = 
  | 'WIP/BOM/FG(Internal)'
  | 'Resin(External)'
  | 'Consumables'
  | 'Production Supplies'
  | 'Office Supplies'
  | 'EXTERNAL'
  | 'INTERNAL';

export interface ReceivingRecord extends BaseRecordAudit {
  id: string;
  date: string;
  receivedDate?: string;
  location?: string;
  vendorSupplier?: string;
  reorderMin?: number;
  remarks?: string;
  source: PresetSourceType;
  itemDescription: string;
  partCode: string;
  modelName?: string;
  color?: string;
  quantity: number;
  unit: string;
  lotNumber: string;
  physicalCondition: {
    boxIntact?: boolean;
    noWaterDamage?: boolean;
    noPestSign?: boolean;
    noContamination?: boolean;
    receivingInspection?: boolean;
    materialTraceability?: boolean;
    quantityAccuracy?: boolean;
    materialConditionCheck?: boolean;
    systemRecording?: boolean;
  };
  rrNumber?: string;
  poNumber?: string;
  drNumber?: string;
  siNumber?: string;
  wayBill?: string;
  transferFormNumber?: string; // For internal WIP / FG (Transfer Slip / FG Transfer Form)
  supplierOrDept: string;
  iqcStatus: 'PENDING_IQC' | 'APPROVED_IQC' | 'REJECTED_IQC' | 'NA';
  status: 'DRAFT' | 'VERIFIED' | 'QUARANTINED';
  fifoColorCode: string;
  bom?: BOMItem[];
  autoDeductBom?: boolean;
  customer?: string;
}

export interface ReturnRecord extends BaseRecordAudit {
  id: string;
  date: string;
  category?: string;
  materialDescription: string;
  partCode: string;
  quantity: number;
  unit: string;
  lotNumber: string;
  department: string;
  reason: string;
  condition: 'Good' | 'Damaged' | 'Contaminated' | 'Unidentified';
  iqcEvaluation: 'APPROVED_IQC' | 'REJECTED_IQC' | 'PENDING_IQC';
  status: 'PENDING' | 'APPROVED' | 'QUARANTINED';
  returnSlipFormNumber: string;
}

export interface RecyclingRecord extends BaseRecordAudit {
  id: string;
  date: string;
  itemType: 'Carton Box' | 'Pallet' | 'Partition';
  quantity: number;
  condition: 'Reusable' | 'Non-Reusable' | 'Contaminated' | 'Damaged';
  reuseCycleCount: number; // Max 5 cycles
  disposition: 'Re-used' | 'For Re-sorting' | 'Scrap Disposal';
  logSheetNumber: string;
}

export interface IssuanceRecord extends BaseRecordAudit {
  id: string;
  date: string;
  requisitionNumber: string;
  department: string;
  partCode: string;
  description: string;
  quantityRequested: number;
  quantityIssued: number;
  lotNumber: string;
  fifoVerified: boolean;
  issuedBy: string;
  receivedBy: string;
}

export interface DeliveryRecord extends BaseRecordAudit {
  id: string;
  date: string;
  pickingListNumber: string;
  poNumber: string;
  modelName: string;
  partCode: string;
  quantity: number;
  packagingConditionOk: boolean;
  fifoVerified: boolean;
  forkliftChecklistSigned: boolean;
  gatePassNumber: string;
  drNumber?: string;
  salesInvoice?: string;
  wayBill?: string;
  status: 'PREPARING' | 'LOADED' | 'RELEASED';
  preparedBy: string;
  loadedBy?: string;
}

export interface EnvironmentalLog extends BaseRecordAudit {
  id: string;
  timestamp: string;
  zone: StorageZone;
  occupiedSlots: number; // e.g. 120
  totalSlots: number; // e.g. 150
  cleanlinessOk: boolean; // Aisles & Fire Exits Clear
  ventilationOk: boolean; // Stack Heights Correct
  pestFree: boolean; // Labels & QR Codes Visible
  recordedBy: string;
}

export interface ForkliftChecklist extends BaseRecordAudit {
  id: string;
  date: string;
  operator: string;
  forkliftId: string;
  brakesOk: boolean;
  lightsOk: boolean;
  hydraulicOk: boolean;
  steeringOk: boolean;
  tiresOk: boolean;
  batteryFluidOk: boolean;
  remarks?: string;
}

export interface AuthorizedDevice {
  deviceId: string;
  deviceName: string;
  isPrimaryAdminDevice?: boolean;
  status: 'AUTHORIZED' | 'PENDING' | 'REVOKED';
  authorizedBy?: string;
  authorizedAt?: string;
}

export interface RegisteredAccount {
  username: string;
  role: string;
  employeeId: string;
  phoneNumber?: string;
  permission?: string;
  pin?: string;
  status?: 'ACTIVE' | 'PENDING' | 'INACTIVE';
  lastActive?: string;
  registeredBy?: string;
  registeredBySuperAdmin?: boolean;
  registeredAt?: string;
  stationId?: string;
  deviceId?: string;
  isPrimaryAdminDevice?: boolean;
  authorizedDevices?: string[];
  isPinCompromised?: boolean;
  pinChangedAt?: string;
  pinChangedBy?: string;
}

export type RegistryType = 'LOCATION' | 'CATEGORY' | 'CUSTOMER' | 'SUPPLIER' | 'BARCODE_PRESET';

export interface MasterRegistryItem extends BaseRecordAudit {
  id: string;
  type: RegistryType;
  code: string;
  name: string;
  description?: string;
  status: 'ACTIVE' | 'INACTIVE';
  dateRegistered: string;
  presetSource?: PresetSourceType;
  category?: string;
  vendorSupplier?: string;
  unit?: string;
  location?: string;
}

export interface ActivePresenceUser {
  connection_id?: string;
  connectionId?: string;
  user_id?: string;
  userId?: string;
  session_id?: string;
  sessionId?: string;
  device_id?: string;
  deviceId?: string;
  stationId?: string;
  username: string;
  employeeId?: string;
  role?: string;
  permission?: string;
  platform?: string;
  deviceName?: string;
  activeView?: string;
  connectedAt?: string;
  lastPing?: number;
  terminalName?: string;
  warehouseId?: string;
  accountId?: string;
  source?: 'websocket' | 'central' | 'local' | 'self';
}

export interface QueuedMutation {
  id: string;
  type: 'upsert' | 'delete';
  collection: string;
  record?: any;
  recordId?: string;
  author?: string;
  actionDesc?: string;
  timestamp: number;
  reset_version?: number;
}

export function getCustomerForPart(partCode?: string, description?: string): string {
  // No hardcoded placeholder entries (CISCO Systems, NISSAN Motors, EPSON Precision, General / Internal removed).
  // Return empty string; customer assignments are sourced strictly from registered master records.
  return '';
}

// Re-export modular types for single source of truth
export * from './types/index';

