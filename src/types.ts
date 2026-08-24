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

export interface MaterialStockItem {
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
}

export type PresetSourceType = 
  | 'WIP/BOM/FG(Internal)'
  | 'Resin(External)'
  | 'Consumables'
  | 'Production Supplies'
  | 'Office Supplies'
  | 'EXTERNAL'
  | 'INTERNAL';

export interface ReceivingRecord {
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

export interface ReturnRecord {
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

export interface RecyclingRecord {
  id: string;
  date: string;
  itemType: 'Carton Box' | 'Pallet' | 'Partition';
  quantity: number;
  condition: 'Reusable' | 'Non-Reusable' | 'Contaminated' | 'Damaged';
  reuseCycleCount: number; // Max 5 cycles
  disposition: 'Re-used' | 'For Re-sorting' | 'Scrap Disposal';
  logSheetNumber: string;
}

export interface IssuanceRecord {
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

export interface DeliveryRecord {
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

export interface EnvironmentalLog {
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

export interface ForkliftChecklist {
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

export interface RegisteredAccount {
  username: string;
  role: string;
  employeeId: string;
  phoneNumber?: string;
  permission?: string;
  pin?: string;
  status?: 'ACTIVE' | 'PENDING' | 'INACTIVE';
  lastActive?: string;
}

export type RegistryType = 'LOCATION' | 'CATEGORY' | 'CUSTOMER' | 'SUPPLIER' | 'BARCODE_PRESET';

export interface MasterRegistryItem {
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
  stationId?: string;
  username: string;
  employeeId?: string;
  role?: string;
  activeView?: string;
  connectedAt?: string;
  lastPing?: number;
  terminalName?: string;
  source?: 'websocket' | 'supabase' | 'local' | 'self';
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
}

export function getCustomerForPart(partCode?: string, description?: string): string {
  const code = (partCode || '').toUpperCase();
  const desc = (description || '').toUpperCase();
  
  if (code.includes('NISSAN') || desc.includes('NISSAN')) return 'NISSAN Motors';
  if (code.includes('SN') || desc.includes('ROUTER') || desc.includes('GATEWAY') || desc.includes('PCB') || code.includes('WP-MD')) return 'CISCO Systems';
  if (code.includes('COP') || desc.includes('COPPER') || code.includes('RE') || desc.includes('RESIN') || desc.includes('PELLET')) return 'EPSON Precision';
  if (code.includes('CB') || desc.includes('CARTON') || desc.includes('BOX')) return 'NISSAN Motors';
  if (code.includes('CS') || desc.includes('SOLVENT') || desc.includes('CLEANING')) return 'General / Internal';
  
  return 'General / Internal';
}
