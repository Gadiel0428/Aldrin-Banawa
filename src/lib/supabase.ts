/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import {
  MaterialStockItem,
  ReceivingRecord,
  ReturnRecord,
  RecyclingRecord,
  IssuanceRecord,
  DeliveryRecord,
  EnvironmentalLog,
  ForkliftChecklist,
  MasterRegistryItem
} from '../types';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

// Key names for storage
const STORAGE_KEY_URL = 'juwei_wms_supabase_url';
const STORAGE_KEY_KEY = 'juwei_wms_supabase_key';
const STORAGE_PENDING_QUEUE = 'juwei_wms_supabase_pending_queue';

export function getStoredSupabaseConfig(): SupabaseConfig {
  const metaEnv = (import.meta as any).env || {};
  const envUrl = metaEnv.VITE_SUPABASE_URL || '';
  const envKey = metaEnv.VITE_SUPABASE_ANON_KEY || '';

  let storedUrl = (localStorage.getItem(STORAGE_KEY_URL) || envUrl).trim();
  let storedKey = (localStorage.getItem(STORAGE_KEY_KEY) || envKey).trim();

  // Normalize URL protocol
  if (storedUrl && !storedUrl.startsWith('http://') && !storedUrl.startsWith('https://')) {
    storedUrl = `https://${storedUrl}`;
  }

  return {
    url: storedUrl,
    anonKey: storedKey
  };
}

export function saveStoredSupabaseConfig(config: SupabaseConfig) {
  let cleanUrl = config.url ? config.url.trim() : '';
  if (cleanUrl && !cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = `https://${cleanUrl}`;
  }
  let cleanKey = config.anonKey ? config.anonKey.trim() : '';

  if (cleanUrl) localStorage.setItem(STORAGE_KEY_URL, cleanUrl);
  if (cleanKey) localStorage.setItem(STORAGE_KEY_KEY, cleanKey);
  
  // Reset client instance on config change so next getSupabase() re-initializes
  if (activeRealtimeChannel && typeof activeRealtimeChannel.unsubscribe === 'function') {
    try {
      activeRealtimeChannel.unsubscribe();
    } catch (e) {}
  }
  activeRealtimeChannel = null;
  supabaseClientInstance = null;
}

let supabaseClientInstance: SupabaseClient | null = null;
let activeRealtimeChannel: RealtimeChannel | null = null;

export function isSupabaseConfigured(): boolean {
  const config = getStoredSupabaseConfig();
  if (!config || !config.url || !config.anonKey) return false;
  const isPlaceholder = (config.url || '').toLowerCase().includes('your-project-id') || (config.anonKey || '').toLowerCase().includes('eyjhbgcioijiuzi1niisinr5cci6ikpxvcj9');
  return Boolean((config.url.includes('supabase.co') || config.url.startsWith('http')) && !isPlaceholder);
}

export function getSupabase(): SupabaseClient | null {
  if (supabaseClientInstance) return supabaseClientInstance;

  const config = getStoredSupabaseConfig();
  if (!config || !config.url || !config.anonKey) return null;

  // Don't instantiate if URL contains placeholder domain
  if ((config.url || '').toLowerCase().includes('your-project-id')) return null;

  try {
    supabaseClientInstance = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      },
      realtime: {
        params: {
          eventsPerSecond: 20
        }
      }
    });
    return supabaseClientInstance;
  } catch (err) {
    console.warn('Supabase client creation failed:', err);
    return null;
  }
}

export async function testSupabaseConnection(): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return {
      success: false,
      message: 'Supabase URL or API Key is missing or default placeholder. Please enter your project credentials.'
    };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return {
      success: false,
      message: 'Failed to create Supabase client instance.'
    };
  }

  try {
    const { error } = await supabase.from('stocks').select('id').limit(1);
    if (error) {
      if (error.code === 'PGRST301' || error.message.includes('JWT') || error.message.includes('API key')) {
        return {
          success: false,
          message: 'Invalid Anon Public API Key. Please verify the "anon / public" key in your Supabase Dashboard (Project Settings > API).'
        };
      }
      if (error.message.includes('relation') || error.message.includes('does not exist')) {
        return {
          success: false,
          message: 'Connected to Supabase, but the WMS tables do not exist yet. Please copy the SQL below and run it in the Supabase SQL Editor!'
        };
      }
      return {
        success: false,
        message: `Connected to Supabase, but query returned: "${error.message}". Please ensure Schema SQL below is executed in Supabase SQL Editor.`
      };
    }

    return {
      success: true,
      message: 'Connection Successful! Supabase PostgreSQL database is active and responding.'
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Connection test failed: ${err?.message || 'Network error'}`
    };
  }
}

// --------------------------------------------------------------------
// DB COLUMN MAPPER HELPERS (CamelCase JS <-> snake_case Postgres)
// --------------------------------------------------------------------

export function mapStockToRow(stock: MaterialStockItem) {
  return {
    id: stock.id,
    part_code: stock.partCode,
    description: stock.description,
    type: stock.type || 'RAW',
    location: stock.location,
    quantity: stock.quantity || 0,
    unit: stock.unit || 'PCS',
    lot_number: stock.lotNumber,
    model_name: stock.modelName || null,
    color: stock.color || null,
    received_date: stock.receivedDate,
    expiration_date: stock.expirationDate || null,
    fifo_color: stock.fifoColor || 'Dark Green',
    status: stock.status || 'APPROVED',
    resin_sack_risk: stock.resinSackRisk || false,
    shelf_life_days: stock.shelfLifeDays || null,
    customer: stock.customer || null,
    reorder_min: stock.reorderMin || 0,
    remarks: stock.remarks || null,
    bom: stock.bom || [],
    updated_at: new Date().toISOString()
  };
}

export function mapRowToStock(row: any): MaterialStockItem {
  return {
    id: row.id,
    partCode: row.part_code || row.partCode || '',
    description: row.description || '',
    type: row.type || 'RAW',
    location: row.location || 'Zone A',
    quantity: Number(row.quantity) || 0,
    unit: row.unit || 'PCS',
    lotNumber: row.lot_number || row.lotNumber || '',
    modelName: row.model_name || row.modelName,
    color: row.color,
    receivedDate: row.received_date || row.receivedDate || new Date().toISOString().split('T')[0],
    expirationDate: row.expiration_date || row.expirationDate,
    fifoColor: row.fifo_color || row.fifoColor || 'Dark Green',
    status: row.status || 'APPROVED',
    resinSackRisk: Boolean(row.resin_sack_risk || row.resinSackRisk),
    shelfLifeDays: row.shelf_life_days ? Number(row.shelf_life_days) : undefined,
    customer: row.customer,
    reorderMin: row.reorder_min ? Number(row.reorder_min) : undefined,
    remarks: row.remarks,
    bom: row.bom || []
  };
}

export function mapReceivingToRow(r: ReceivingRecord) {
  return {
    id: r.id,
    date: r.date,
    received_date: r.receivedDate || r.date,
    location: r.location || null,
    vendor_supplier: r.vendorSupplier || null,
    reorder_min: r.reorderMin || 0,
    remarks: r.remarks || null,
    source: r.source,
    item_description: r.itemDescription,
    part_code: r.partCode,
    model_name: r.modelName || null,
    color: r.color || null,
    quantity: r.quantity || 0,
    unit: r.unit || 'PCS',
    lot_number: r.lotNumber,
    physical_condition: r.physicalCondition || {},
    rr_number: r.rrNumber || null,
    po_number: r.poNumber || null,
    dr_number: r.drNumber || null,
    si_number: r.siNumber || null,
    way_bill: r.wayBill || null,
    transfer_form_number: r.transferFormNumber || null,
    supplier_or_dept: r.supplierOrDept || 'Internal',
    iqc_status: r.iqcStatus || 'PENDING_IQC',
    status: r.status || 'DRAFT',
    fifo_color_code: r.fifoColorCode || 'Dark Green',
    bom: r.bom || [],
    auto_deduct_bom: r.autoDeductBom || false,
    customer: r.customer || null,
    updated_at: new Date().toISOString()
  };
}

export function mapRowToReceiving(row: any): ReceivingRecord {
  return {
    id: row.id,
    date: row.date || new Date().toISOString().split('T')[0],
    receivedDate: row.received_date || row.date,
    location: row.location,
    vendorSupplier: row.vendor_supplier,
    reorderMin: row.reorder_min ? Number(row.reorder_min) : undefined,
    remarks: row.remarks,
    source: row.source || 'Resin(External)',
    itemDescription: row.item_description || row.itemDescription || '',
    partCode: row.part_code || row.partCode || '',
    modelName: row.model_name,
    color: row.color,
    quantity: Number(row.quantity) || 0,
    unit: row.unit || 'PCS',
    lotNumber: row.lot_number || row.lotNumber || '',
    physicalCondition: row.physical_condition || row.physicalCondition || {},
    rrNumber: row.rr_number,
    poNumber: row.po_number,
    drNumber: row.dr_number,
    siNumber: row.si_number,
    wayBill: row.way_bill,
    transferFormNumber: row.transfer_form_number,
    supplierOrDept: row.supplier_or_dept || 'Internal',
    iqcStatus: row.iqc_status || 'PENDING_IQC',
    status: row.status || 'DRAFT',
    fifoColorCode: row.fifo_color_code || 'Dark Green',
    bom: row.bom || [],
    autoDeductBom: Boolean(row.auto_deduct_bom),
    customer: row.customer
  };
}

export function mapReturnToRow(r: ReturnRecord) {
  return {
    id: r.id,
    date: r.date,
    category: r.category || null,
    material_description: r.materialDescription,
    part_code: r.partCode,
    quantity: r.quantity || 0,
    unit: r.unit || 'PCS',
    lot_number: r.lotNumber,
    department: r.department,
    reason: r.reason,
    condition: r.condition || 'Good',
    iqc_evaluation: r.iqcEvaluation || 'PENDING_IQC',
    status: r.status || 'PENDING',
    return_slip_form_number: r.returnSlipFormNumber,
    updated_at: new Date().toISOString()
  };
}

export function mapRowToReturn(row: any): ReturnRecord {
  return {
    id: row.id,
    date: row.date || new Date().toISOString().split('T')[0],
    category: row.category,
    materialDescription: row.material_description || row.materialDescription || '',
    partCode: row.part_code || row.partCode || '',
    quantity: Number(row.quantity) || 0,
    unit: row.unit || 'PCS',
    lotNumber: row.lot_number || row.lotNumber || '',
    department: row.department || 'Production',
    reason: row.reason || 'Excess Material',
    condition: row.condition || 'Good',
    iqcEvaluation: row.iqc_evaluation || 'PENDING_IQC',
    status: row.status || 'PENDING',
    returnSlipFormNumber: row.return_slip_form_number || row.returnSlipFormNumber || ''
  };
}

export function mapRecyclingToRow(r: RecyclingRecord) {
  return {
    id: r.id,
    date: r.date,
    item_type: r.itemType,
    quantity: r.quantity || 0,
    condition: r.condition || 'Reusable',
    reuse_cycle_count: r.reuseCycleCount || 1,
    disposition: r.disposition || 'Re-used',
    log_sheet_number: r.logSheetNumber,
    updated_at: new Date().toISOString()
  };
}

export function mapRowToRecycling(row: any): RecyclingRecord {
  return {
    id: row.id,
    date: row.date,
    itemType: row.item_type || row.itemType || 'Carton Box',
    quantity: Number(row.quantity) || 0,
    condition: row.condition || 'Reusable',
    reuseCycleCount: Number(row.reuse_cycle_count || row.reuseCycleCount) || 1,
    disposition: row.disposition || 'Re-used',
    logSheetNumber: row.log_sheet_number || row.logSheetNumber || ''
  };
}

export function mapIssuanceToRow(r: IssuanceRecord) {
  return {
    id: r.id,
    date: r.date,
    requisition_number: r.requisitionNumber,
    department: r.department,
    part_code: r.partCode,
    description: r.description,
    quantity_requested: r.quantityRequested || 0,
    quantity_issued: r.quantityIssued || 0,
    lot_number: r.lotNumber,
    fifo_verified: r.fifoVerified || false,
    issued_by: r.issuedBy,
    received_by: r.receivedBy,
    updated_at: new Date().toISOString()
  };
}

export function mapRowToIssuance(row: any): IssuanceRecord {
  return {
    id: row.id,
    date: row.date,
    requisitionNumber: row.requisition_number || row.requisitionNumber || '',
    department: row.department || 'Assembly',
    partCode: row.part_code || row.partCode || '',
    description: row.description || '',
    quantityRequested: Number(row.quantity_requested || row.quantityRequested) || 0,
    quantityIssued: Number(row.quantity_issued || row.quantityIssued) || 0,
    lotNumber: row.lot_number || row.lotNumber || '',
    fifoVerified: Boolean(row.fifo_verified || row.fifoVerified),
    issuedBy: row.issued_by || row.issuedBy || 'Storekeeper',
    receivedBy: row.received_by || row.receivedBy || 'Line Operator'
  };
}

export function mapDeliveryToRow(d: DeliveryRecord) {
  return {
    id: d.id,
    date: d.date,
    picking_list_number: d.pickingListNumber,
    po_number: d.poNumber,
    model_name: d.modelName,
    part_code: d.partCode,
    quantity: d.quantity || 0,
    packaging_condition_ok: d.packagingConditionOk ?? true,
    fifo_verified: d.fifoVerified ?? false,
    forklift_checklist_signed: d.forkliftChecklistSigned ?? false,
    gate_pass_number: d.gatePassNumber,
    dr_number: d.drNumber || null,
    sales_invoice: d.salesInvoice || null,
    way_bill: d.wayBill || null,
    status: d.status || 'PREPARING',
    prepared_by: d.preparedBy,
    loaded_by: d.loadedBy || null,
    updated_at: new Date().toISOString()
  };
}

export function mapRowToDelivery(row: any): DeliveryRecord {
  return {
    id: row.id,
    date: row.date,
    pickingListNumber: row.picking_list_number || row.pickingListNumber || '',
    poNumber: row.po_number || row.poNumber || '',
    modelName: row.model_name || row.modelName || '',
    partCode: row.part_code || row.partCode || '',
    quantity: Number(row.quantity) || 0,
    packagingConditionOk: Boolean(row.packaging_condition_ok ?? true),
    fifoVerified: Boolean(row.fifo_verified ?? false),
    forkliftChecklistSigned: Boolean(row.forklift_checklist_signed ?? false),
    gatePassNumber: row.gate_pass_number || row.gatePassNumber || '',
    drNumber: row.dr_number,
    salesInvoice: row.sales_invoice,
    wayBill: row.way_bill,
    status: row.status || 'PREPARING',
    preparedBy: row.prepared_by || row.preparedBy || 'Dispatch Supervisor',
    loadedBy: row.loaded_by
  };
}

export function mapEnvLogToRow(e: EnvironmentalLog) {
  return {
    id: e.id,
    timestamp: e.timestamp,
    zone: e.zone,
    occupied_slots: e.occupiedSlots || 0,
    total_slots: e.totalSlots || 150,
    cleanliness_ok: e.cleanlinessOk ?? true,
    ventilation_ok: e.ventilationOk ?? true,
    pest_free: e.pestFree ?? true,
    recorded_by: e.recordedBy,
    updated_at: new Date().toISOString()
  };
}

export function mapRowToEnvLog(row: any): EnvironmentalLog {
  return {
    id: row.id,
    timestamp: row.timestamp,
    zone: row.zone,
    occupiedSlots: Number(row.occupied_slots || row.occupiedSlots) || 0,
    totalSlots: Number(row.total_slots || row.totalSlots) || 150,
    cleanlinessOk: Boolean(row.cleanliness_ok ?? true),
    ventilationOk: Boolean(row.ventilation_ok ?? true),
    pestFree: Boolean(row.pest_free ?? true),
    recordedBy: row.recorded_by || row.recordedBy || 'Inspector'
  };
}

export function mapForkliftToRow(f: ForkliftChecklist) {
  return {
    id: f.id,
    date: f.date,
    operator: f.operator,
    forklift_id: f.forkliftId,
    brakes_ok: f.brakesOk ?? true,
    lights_ok: f.lightsOk ?? true,
    hydraulic_ok: f.hydraulicOk ?? true,
    steering_ok: f.steeringOk ?? true,
    tires_ok: f.tiresOk ?? true,
    battery_fluid_ok: f.batteryFluidOk ?? true,
    remarks: f.remarks || null,
    updated_at: new Date().toISOString()
  };
}

export function mapRowToForklift(row: any): ForkliftChecklist {
  return {
    id: row.id,
    date: row.date,
    operator: row.operator,
    forkliftId: row.forklift_id || row.forkliftId || 'FL-01',
    brakesOk: Boolean(row.brakes_ok ?? true),
    lightsOk: Boolean(row.lights_ok ?? true),
    hydraulicOk: Boolean(row.hydraulic_ok ?? true),
    steeringOk: Boolean(row.steering_ok ?? true),
    tiresOk: Boolean(row.tires_ok ?? true),
    batteryFluidOk: Boolean(row.battery_fluid_ok ?? true),
    remarks: row.remarks
  };
}

export function mapRegistryToRow(reg: MasterRegistryItem) {
  return {
    id: reg.id,
    type: reg.type,
    code: reg.code,
    name: reg.name,
    description: reg.description || null,
    status: reg.status || 'ACTIVE',
    date_registered: reg.dateRegistered,
    preset_source: reg.presetSource || null,
    category: reg.category || null,
    vendor_supplier: reg.vendorSupplier || null,
    unit: reg.unit || null,
    location: reg.location || null,
    updated_at: new Date().toISOString()
  };
}

export function mapRowToRegistry(row: any): MasterRegistryItem {
  return {
    id: row.id,
    type: row.type,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status || 'ACTIVE',
    dateRegistered: row.date_registered || row.dateRegistered || new Date().toISOString().split('T')[0],
    presetSource: row.preset_source,
    category: row.category,
    vendorSupplier: row.vendor_supplier,
    unit: row.unit,
    location: row.location
  };
}

// --------------------------------------------------------------------
// FULL DATA SYNC & SUBSCRIPTION ENGINE
// --------------------------------------------------------------------

export async function fetchCollectionFromSupabase(collection: string): Promise<any[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const tableMap: Record<string, { table: string; mapper: (r: any) => any }> = {
      stocks: { table: 'stocks', mapper: mapRowToStock },
      receiving: { table: 'receiving', mapper: mapRowToReceiving },
      returns: { table: 'returns', mapper: mapRowToReturn },
      recycling: { table: 'recycling', mapper: mapRowToRecycling },
      issuances: { table: 'issuances', mapper: mapRowToIssuance },
      deliveries: { table: 'deliveries', mapper: mapRowToDelivery },
      envLogs: { table: 'env_logs', mapper: mapRowToEnvLog },
      forkliftChecks: { table: 'forklift_checks', mapper: mapRowToForklift },
      registries: { table: 'registries', mapper: mapRowToRegistry },
      registeredUsers: {
        table: 'registered_users',
        mapper: (r) => {
          const empId = (r.employee_id || r.employeeId || '').toUpperCase();
          const cleanPin = r.pin ? String(r.pin).trim() : (r.pin_hash ? String(r.pin_hash).trim() : (empId === 'JPMP-002' ? '0423' : '1234'));
          return {
            username: r.username || 'OPERATOR',
            role: r.role || 'WAREHOUSE CLERK',
            employeeId: empId,
            phoneNumber: r.phone_number || r.phoneNumber || '',
            permission: r.permission || 'LIMITED_ACCESS',
            pin: cleanPin
          };
        }
      },
      chatMessages: {
        table: 'chat_messages',
        mapper: (r) => ({
          id: r.id,
          sender: r.sender,
          text: r.text,
          timestamp: r.timestamp,
          isSystem: Boolean(r.is_system)
        })
      }
    };

    const target = tableMap[collection];
    if (!target) return null;

    const { data, error } = await supabase.from(target.table).select('*');
    if (error) {
      console.warn(`Supabase fetch error for ${collection}:`, error.message);
      return null;
    }

    if (Array.isArray(data)) {
      return data.map(target.mapper);
    }
    return [];
  } catch (err) {
    console.warn(`Supabase fetch exception for ${collection}:`, err);
    return null;
  }
}

export async function syncCollectionToSupabase(collection: string, items: any[]): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase || !Array.isArray(items)) return false;

  try {
    let tableName = collection;
    let mappedRows: any[] = [];

    switch (collection) {
      case 'stocks':
        tableName = 'stocks';
        mappedRows = items.map(mapStockToRow);
        break;
      case 'receiving':
        tableName = 'receiving';
        mappedRows = items.map(mapReceivingToRow);
        break;
      case 'returns':
        tableName = 'returns';
        mappedRows = items.map(mapReturnToRow);
        break;
      case 'recycling':
        tableName = 'recycling';
        mappedRows = items.map(mapRecyclingToRow);
        break;
      case 'issuances':
        tableName = 'issuances';
        mappedRows = items.map(mapIssuanceToRow);
        break;
      case 'deliveries':
        tableName = 'deliveries';
        mappedRows = items.map(mapDeliveryToRow);
        break;
      case 'envLogs':
        tableName = 'env_logs';
        mappedRows = items.map(mapEnvLogToRow);
        break;
      case 'forkliftChecks':
        tableName = 'forklift_checks';
        mappedRows = items.map(mapForkliftToRow);
        break;
      case 'registries':
        tableName = 'registries';
        mappedRows = items.map(mapRegistryToRow);
        break;
      case 'registeredUsers':
        tableName = 'registered_users';
        mappedRows = items.map((u) => {
          const empId = (u.employeeId || u.employee_id || '').toUpperCase();
          const cleanPin = u.pin ? String(u.pin).trim() : (empId === 'JPMP-002' ? '0423' : '1234');
          return {
            employee_id: empId,
            username: (u.username || 'OPERATOR').toUpperCase(),
            role: (u.role || 'WAREHOUSE CLERK').toUpperCase(),
            phone_number: u.phoneNumber || u.phone_number || '',
            permission: u.permission || 'LIMITED_ACCESS',
            pin: cleanPin,
            pin_hash: cleanPin,
            updated_at: new Date().toISOString()
          };
        });
        break;
      case 'chatMessages':
        tableName = 'chat_messages';
        mappedRows = items.map((m) => ({
          id: m.id,
          sender: m.sender,
          text: m.text,
          timestamp: m.timestamp,
          is_system: m.isSystem || false,
          created_at: new Date().toISOString()
        }));
        break;
      default:
        return false;
    }

    if (mappedRows.length === 0) {
      try {
        if (collection === 'registeredUsers') {
          // Keep super admin
          await supabase.from('registered_users').delete().neq('employee_id', 'JPMP-002');
        } else if (collection === 'chatMessages') {
          await supabase.from('chat_messages').delete().neq('id', '___NEVER___');
        } else {
          await supabase.from(tableName).delete().neq('id', '___NEVER___');
        }
      } catch (clearErr) {
        console.warn(`Supabase clear table failed for ${collection}:`, clearErr);
      }
      return true;
    }

    const { error } = await supabase.from(tableName).upsert(mappedRows);
    if (error) {
      console.warn(`Supabase upsert error for ${collection}:`, error.message);
      savePendingMutation(collection, items);
      return false;
    }

    // Purge records that were removed from this collection
    try {
      if (collection === 'registeredUsers') {
        const activeEmpIds = mappedRows.map((r: any) => r.employee_id).filter(Boolean);
        if (activeEmpIds.length > 0) {
          const inListStr = `(${activeEmpIds.map((id: string) => `"${id}"`).join(',')})`;
          await supabase.from('registered_users').delete().not('employee_id', 'in', inListStr);
        }
      } else if (collection !== 'chatMessages') {
        const activeIds = mappedRows.map((r: any) => r.id).filter(Boolean);
        if (activeIds.length > 0) {
          const inListStr = `(${activeIds.map((id: string) => `"${id}"`).join(',')})`;
          await supabase.from(tableName).delete().not('id', 'in', inListStr);
        }
      }
    } catch (delErr) {
      console.warn(`Supabase cleanup removed items failed for ${collection}:`, delErr);
    }

    return true;
  } catch (err) {
    console.warn(`Supabase sync exception for ${collection}:`, err);
    savePendingMutation(collection, items);
    return false;
  }
}

// Dedicated helper to immediately delete an account from Supabase database
export async function deleteAccountFromSupabase(employeeId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const cleanId = employeeId.trim().toUpperCase();
    if (cleanId === 'JPMP-002' || cleanId.endsWith('-002') || cleanId.includes('002')) return false; // Prevent deleting super admin
    const { error } = await supabase
      .from('registered_users')
      .delete()
      .eq('employee_id', cleanId)
      .not('employee_id', 'eq', 'JPMP-002')
      .not('username', 'ilike', '%ALDRIN BANAWA%');
    if (error) {
      console.warn(`Supabase delete account error for ${cleanId}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`Supabase delete account exception for ${employeeId}:`, err);
    return false;
  }
}

// Offline queue caching
function savePendingMutation(collection: string, items: any[]) {
  try {
    const raw = localStorage.getItem(STORAGE_PENDING_QUEUE);
    const queue = raw ? JSON.parse(raw) : {};
    queue[collection] = items;
    localStorage.setItem(STORAGE_PENDING_QUEUE, JSON.stringify(queue));
  } catch (e) {}
}

export async function processPendingSupabaseMutations() {
  try {
    const raw = localStorage.getItem(STORAGE_PENDING_QUEUE);
    if (!raw) return;

    const queue = JSON.parse(raw);
    const collections = Object.keys(queue);

    for (const col of collections) {
      const items = queue[col];
      if (Array.isArray(items) && items.length > 0) {
        const ok = await syncCollectionToSupabase(col, items);
        if (ok) {
          delete queue[col];
        }
      }
    }

    localStorage.setItem(STORAGE_PENDING_QUEUE, JSON.stringify(queue));
  } catch (e) {}
}

// Batch Snapshot Fetcher for all 10 collections
export async function fetchFullSupabaseSnapshot(): Promise<{
  stocks?: MaterialStockItem[];
  receiving?: ReceivingRecord[];
  returns?: ReturnRecord[];
  recycling?: RecyclingRecord[];
  issuances?: IssuanceRecord[];
  deliveries?: DeliveryRecord[];
  envLogs?: EnvironmentalLog[];
  forkliftChecks?: ForkliftChecklist[];
  registries?: MasterRegistryItem[];
  registeredUsers?: any[];
  chatMessages?: any[];
} | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const collections = ['stocks', 'receiving', 'returns', 'recycling', 'issuances', 'deliveries', 'envLogs', 'forkliftChecks', 'registries', 'registeredUsers', 'chatMessages'];
    const results = await Promise.all(collections.map(col => fetchCollectionFromSupabase(col)));
    
    const snapshot: any = {};
    let hasData = false;

    collections.forEach((col, idx) => {
      const data = results[idx];
      if (Array.isArray(data)) {
        snapshot[col] = data;
        if (data.length > 0) hasData = true;
      }
    });

    return hasData ? snapshot : snapshot;
  } catch (err) {
    console.warn('fetchFullSupabaseSnapshot exception:', err);
    return null;
  }
}

// Realtime Channel Subscription with explicit multi-table listeners & auto-reconnect
export function setupSupabaseRealtimeSubscriptions(
  onCollectionChange: (collection: string) => void,
  onChatMessage: (msg: any) => void,
  onStatusChange: (status: 'connected' | 'connecting' | 'disconnected') => void
): RealtimeChannel | null {
  const supabase = getSupabase();
  if (!supabase) {
    onStatusChange('disconnected');
    return null;
  }

  // Clean up any existing active subscription channel
  if (activeRealtimeChannel && typeof activeRealtimeChannel.unsubscribe === 'function') {
    try {
      activeRealtimeChannel.unsubscribe();
    } catch (e) {}
  }

  onStatusChange('connecting');

  const channelName = `juwei-wms-realtime-${Date.now()}`;
  let channel = supabase.channel(channelName);

  const tableList: { table: string; collection: string }[] = [
    { table: 'stocks', collection: 'stocks' },
    { table: 'receiving', collection: 'receiving' },
    { table: 'returns', collection: 'returns' },
    { table: 'recycling', collection: 'recycling' },
    { table: 'issuances', collection: 'issuances' },
    { table: 'deliveries', collection: 'deliveries' },
    { table: 'env_logs', collection: 'envLogs' },
    { table: 'forklift_checks', collection: 'forkliftChecks' },
    { table: 'registries', collection: 'registries' },
    { table: 'registered_users', collection: 'registeredUsers' },
    { table: 'chat_messages', collection: 'chatMessages' }
  ];

  // Subscribe to each table explicitly for 100% reliable PostgreSQL Change Broadcasts
  tableList.forEach(({ table, collection }) => {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        if (collection === 'chatMessages' && payload.new) {
          const newRow = payload.new as any;
          onChatMessage({
            id: newRow.id,
            sender: newRow.sender,
            text: newRow.text,
            timestamp: newRow.timestamp,
            isSystem: Boolean(newRow.is_system)
          });
        }
        onCollectionChange(collection);
      }
    );
  });

  // Also subscribe to schema wildcard as additional safety net
  channel = channel.on(
    'postgres_changes',
    { event: '*', schema: 'public' },
    (payload) => {
      const tableToCollectionMap: Record<string, string> = {
        stocks: 'stocks',
        receiving: 'receiving',
        returns: 'returns',
        recycling: 'recycling',
        issuances: 'issuances',
        deliveries: 'deliveries',
        env_logs: 'envLogs',
        forklift_checks: 'forkliftChecks',
        registries: 'registries',
        registered_users: 'registeredUsers',
        chat_messages: 'chatMessages'
      };
      const col = tableToCollectionMap[payload.table];
      if (col) {
        onCollectionChange(col);
      }
    }
  );

  channel.subscribe((status, err) => {
    if (status === 'SUBSCRIBED') {
      onStatusChange('connected');
      processPendingSupabaseMutations();
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn('Supabase Realtime channel status:', status, err);
      onStatusChange('disconnected');
    }
  });

  activeRealtimeChannel = channel;
  return channel;
}
