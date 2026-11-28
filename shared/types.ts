/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Authoritative Record Types
 * Single source of truth imported by both server (server.ts) and client (src/).
 */

export type UOM =
  | 'PCS'
  | 'KG'
  | 'SET'
  | 'BOX'
  | 'UNITS'
  | 'LITERS'
  | 'ROLLS'
  | 'PACKS'
  | 'TUBES'
  | 'BAGS'
  | 'MTRS'
  | 'LOT';
export const UOM_OPTIONS: UOM[] = [
  'PCS',
  'KG',
  'SET',
  'BOX',
  'UNITS',
  'LITERS',
  'ROLLS',
  'PACKS',
  'TUBES',
  'BAGS',
  'MTRS',
  'LOT',
];

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

export interface FifoMonthColor {
  name: string;
  colorClass: string;
  textClass: string;
  hex?: string;
}

export type FifoColorsMap = Record<number, FifoMonthColor>;

export interface MaterialStockItem extends BaseRecordAudit {
  id: string;
  partCode: string;
  description: string;
  type: MaterialType;
  location: string;
  quantity: number;
  unit: string;
  unitMissing?: boolean;
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
  expirationDate?: string;
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
  unitMissing?: boolean;
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
  stockId?: string;
  movementIdempotencyKey?: string;
}

export interface ReturnRecord extends BaseRecordAudit {
  id: string;
  date: string;
  category?: string;
  materialDescription: string;
  partCode: string;
  quantity: number;
  unit: string;
  unitMissing?: boolean;
  lotNumber: string;
  department: string;
  reason: string;
  condition: 'Good' | 'Damaged' | 'Contaminated' | 'Unidentified';
  iqcEvaluation: 'APPROVED_IQC' | 'REJECTED_IQC' | 'PENDING_IQC';
  status: 'PENDING' | 'APPROVED' | 'QUARANTINED';
  returnSlipFormNumber: string;
  stockId?: string;
  movementIdempotencyKey?: string;
}

export interface RecyclingRecord extends BaseRecordAudit {
  id: string;
  date: string;
  itemType: 'Carton Box' | 'Pallet' | 'Partition';
  quantity: number;
  unit?: string;
  unitMissing?: boolean;
  condition: 'Reusable' | 'Non-Reusable' | 'Contaminated' | 'Damaged';
  reuseCycleCount: number; // Max 5 cycles
  disposition: 'Re-used' | 'For Re-sorting' | 'Scrap Disposal';
  logSheetNumber: string;
  stockId?: string;
  movementIdempotencyKey?: string;
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
  unit?: string;
  unitMissing?: boolean;
  lotNumber: string;
  fifoVerified: boolean;
  issuedBy: string;
  receivedBy: string;
  stockId?: string;
  movementIdempotencyKey?: string;
  overrideReason?: string;
  superAdminApproved?: boolean;
  superAdminApprover?: string;
}

export interface DeliveryRecord extends BaseRecordAudit {
  id: string;
  date: string;
  pickingListNumber: string;
  poNumber: string;
  modelName: string;
  partCode: string;
  quantity: number;
  unit?: string;
  unitMissing?: boolean;
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
  stockId?: string;
  movementIdempotencyKey?: string;
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
  boundEmployeeId?: string;
  employeeId?: string;
  username?: string;
  role?: string;
  permission?: string;
  boundAt?: string;
}

export interface RegisteredAccount {
  id?: string;
  username: string;
  role: string;
  employeeId: string;
  phoneNumber?: string;
  permission?: string;
  maxDevices?: number;
  pin?: string;
  pinHash?: string;
  pinSalt?: string;
  status?: 'ACTIVE' | 'PENDING' | 'INACTIVE';
  lastActive?: string;
  registeredBy?: string;
  registeredBySuperAdmin?: boolean;
  registeredAt?: string;
  stationId?: string;
  deviceId?: string;
  isPrimaryAdminDevice?: boolean;
  authorizedDevices?: string[];
  hasPin?: boolean;
  mustChangePin?: boolean;
  isPinCompromised?: boolean;
  pinChangedAt?: string;
  pinChangedBy?: string;
  version?: number;
  updated_at?: string;
  reset_version?: number;
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

export type StockMovementType =
  | 'PURCHASE'          // Receiving incoming goods (+qty)
  | 'SALE'              // Material issuance / outbound (-qty)
  | 'SALE_RETURN'       // Customer / Production return to warehouse (+qty)
  | 'PURCHASE_RETURN'   // Reject / Return to supplier (-qty)
  | 'ADJUSTMENT_IN'     // Physical count surplus / stock correction (+qty)
  | 'ADJUSTMENT_OUT'    // Scrap / damage / cycle count deficit (-qty)
  | 'TRANSFER_IN'       // Inter-warehouse or Inter-bin inbound (+qty)
  | 'TRANSFER_OUT'      // Inter-warehouse or Inter-bin outbound (-qty)
  | 'RECYCLING';        // Packaging recycling reuse (+/- qty)

export interface StockMovement {
  id: string;
  product_id: string;
  warehouse_id: string;
  type: StockMovementType;
  quantity: number; // Signed or absolute depending on RPC, signed in storage (+/-)
  previous_quantity?: number;
  new_quantity?: number;
  reference_id?: string | null;
  reference_number?: string | null; // e.g., PO-1029, ISS-9921, DEL-3301
  notes?: string | null;
  user_id?: string | null;
  user_name?: string;
  device_id?: string;
  idempotency_key?: string | null;
  created_at: string;
  reset_version?: number;

  // Relational details
  product_sku?: string;
  product_name?: string;
  warehouse_name?: string;
  unit?: string;
  unitMissing?: boolean;
  lot_number?: string;
  location?: string;
}

export interface CreateStockMovementInput {
  productId: string;
  warehouseId: string;
  type: StockMovementType;
  quantity: number; // Absolute quantity or delta
  delta?: number;   // Signed delta change amount
  preventNegativeStock?: boolean;
  referenceId?: string;
  referenceNumber?: string;
  notes?: string;
  userId?: string;
  userName?: string;
  deviceId?: string;
  idempotencyKey?: string;
  lotNumber?: string;
  location?: string;
  unit?: string;
}

export interface StockMovementResult {
  success: boolean;
  movementId?: string;
  productId: string;
  warehouseId: string;
  previousQuantity: number;
  newQuantity?: number;
  delta: number;
  timestamp: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
  isSystem: boolean;
}

export interface BackupAuditEntry {
  id: string;
  action: 'BACKUP_CREATED' | 'DATABASE_RESTORED' | 'PRUNE';
  filename: string;
  author: string;
  timestamp: string;
  details?: string;
  fileSizeBytes?: number;
}

export interface BackupItemRecord {
  filename: string;
  filePath?: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  mtime: number;
}

export interface PinAuditEntry {
  id: string;
  action: 'PIN_CHANGED' | 'PIN_RESET' | 'COMPROMISED_PIN_RESOLVED';
  targetEmployeeId: string;
  targetUsername: string;
  changedBy: string;
  changedByEmployeeId: string;
  timestamp: string;
  ip?: string;
  reason?: string;
  previousPinWasCompromised: boolean;
}

export interface AuditTrailEntry {
  id: string;
  timestamp: string;
  actor: string;
  actorId: string;
  action: string;
  recordType: string;
  recordId: string;
  summary: string;
  details?: string;
  deviceId?: string;
}

export interface FifoRepairAuditEntry {
  id: string;
  collection: 'stocks' | 'receiving';
  recordId: string;
  partCode?: string;
  receivedDate?: string;
  oldFifoColor: unknown;
  newFifoColor: string;
  timestamp: string;
  reason: string;
}

export interface ReconcileMismatch {
  stockId: string;
  partCode: string;
  description?: string;
  lotNumber: string;
  location?: string;
  unit?: string;
  unitMissing?: boolean;
  storedQuantity: number;
  movementTotal: number;
  difference: number;
  movementCount: number;
}

export interface ReconcileOrphanMovementSummary {
  productId: string;
  movementTotal: number;
  movementCount: number;
}

export interface ReconcileMissingUnitItem {
  collection: string;
  id: string;
  partCode?: string;
  description?: string;
}

export interface ReconcileReport {
  generatedAt: string;
  serverInstanceId: string;
  dataDir: string;
  reportPath: string;
  totalStocksChecked: number;
  totalMovements: number;
  matchedCount: number;
  mismatchCount: number;
  mismatches: ReconcileMismatch[];
  orphanMovementProductsCount: number;
  orphanMovementProducts: ReconcileOrphanMovementSummary[];
  missingUnitStocksCount?: number;
  missingUnitRecordsCount?: number;
  missingUnitItems?: ReconcileMissingUnitItem[];
}

export interface RebuildMovementsResult {
  success: boolean;
  createdMovements: number;
  baselineMovements: number;
  repairedBalances: number;
  totalMovements: number;
  totalStocks: number;
}

export type PrintCheckDocumentType =
  | 'REQUISITION'
  | 'PICKING_LIST'
  | 'GATE_PASS'
  | 'QR_BADGE';

export interface PrintCheckDocVerification {
  docType: PrintCheckDocumentType;
  expectedCode: string;
  scannedCode: string;
  confirmedMatch: boolean;
  scannedAt?: string;
}

export interface PrintCheckLogEntry {
  id: string;
  checkedDate: string;
  checkedAt: string;
  printer: string;
  operatorName: string;
  operatorEmployeeId: string;
  stationId?: string;
  deviceId?: string;
  overallStatus: 'PASS' | 'FAIL';
  matchedCount: number;
  totalCount: number;
  documents: PrintCheckDocVerification[];
  notes?: string;
}

export interface CentralDatabaseState {
  stocks: MaterialStockItem[];
  receiving: ReceivingRecord[];
  returns: ReturnRecord[];
  recycling: RecyclingRecord[];
  issuances: IssuanceRecord[];
  deliveries: DeliveryRecord[];
  envLogs: EnvironmentalLog[];
  forkliftChecks: ForkliftChecklist[];
  registries: MasterRegistryItem[];
  registeredUsers: RegisteredAccount[];
  stockMovements: StockMovement[];
  operationalRoles: string[];
  receivingCategories: string[];
  fifoColorsByMonth: FifoColorsMap;
}
