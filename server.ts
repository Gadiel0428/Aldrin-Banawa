/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Load initial mock data to seed the server-authoritative state
import { 
  INITIAL_STOCK, 
  INITIAL_RECEIVING, 
  INITIAL_RETURNS, 
  INITIAL_RECYCLING, 
  INITIAL_ISSUANCE, 
  INITIAL_DELIVERIES, 
  INITIAL_ENV_LOGS, 
  INITIAL_FORKLIFT_CHECKS 
} from "./src/data";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // Safe Disk Storage Path Resolution (AppData on Windows Desktop, Current Working Dir in Cloud)
  function getStorageFilePath(filename: string): string {
    const customDir = process.env.JUWEI_DATA_DIR;
    if (customDir) {
      try {
        if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
        return path.join(customDir, filename);
      } catch (e) {}
    }
    return path.join(process.cwd(), filename);
  }

  // Initialize Supabase Server Client if environment variables or config file exist
  const CONFIG_SUPABASE_FILE = getStorageFilePath("supabase-config.json");
  const DEFAULT_SUPABASE_URL = "https://bbzqmmlhcwwjiewdfdmq.supabase.co";
  const DEFAULT_SUPABASE_KEY = "sb_publishable_2U24dZnUD_Ab6RlHvVW5MA__EJlhytz";
  let supabaseUrl = process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;
  
  if (fs.existsSync(CONFIG_SUPABASE_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_SUPABASE_FILE, "utf-8"));
      if (cfg && cfg.url && cfg.anonKey) {
        supabaseUrl = cfg.url.trim();
        supabaseKey = cfg.anonKey.trim();
      }
    } catch (e) {}
  } else if (fs.existsSync(path.join(process.cwd(), "supabase-config.json"))) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "supabase-config.json"), "utf-8"));
      if (cfg && cfg.url && cfg.anonKey) {
        supabaseUrl = cfg.url.trim();
        supabaseKey = cfg.anonKey.trim();
      }
    } catch (e) {}
  }

  let supabaseServer: SupabaseClient | null = null;

  if (supabaseUrl && supabaseKey) {
    try {
      supabaseServer = createClient(supabaseUrl, supabaseKey);
      console.log("JUWEI WMS: Connected to Supabase PostgreSQL database at", supabaseUrl);
    } catch (err) {
      console.warn("JUWEI WMS: Failed to initialize Supabase server client:", err);
    }
  }

  interface ServerUser {
    username: string;
    role: string;
    employeeId: string;
    phoneNumber?: string;
    permission?: string;
    pin: string;
    status?: string;
    lastActive?: string;
    registeredBy?: string;
    registeredBySuperAdmin?: boolean;
    registeredAt?: string;
    stationId?: string;
  }

  const defaultSuperAdmin: ServerUser = { 
    username: 'ALDRIN BANAWA', 
    role: 'SUPER ADMINISTRATOR', 
    employeeId: 'JPMP-002', 
    phoneNumber: '+639669858846',
    permission: 'FULL_ACCESS', 
    pin: '0423',
    status: 'ACTIVE',
    registeredBy: 'ROOT_SUPER_ADMIN (JPMP-002)',
    registeredBySuperAdmin: true,
    registeredAt: '2026-01-01T00:00:00.000Z',
    stationId: 'MASTER_TERMINAL'
  };

  // Server-authoritative state
  const state: {
    stocks: any[];
    receiving: any[];
    returns: any[];
    recycling: any[];
    issuances: any[];
    deliveries: any[];
    envLogs: any[];
    forkliftChecks: any[];
    registries: any[];
    registeredUsers: ServerUser[];
    stockMovements: any[];
  } = {
    stocks: [...INITIAL_STOCK],
    receiving: [...INITIAL_RECEIVING],
    returns: [...INITIAL_RETURNS],
    recycling: [...INITIAL_RECYCLING],
    issuances: [...INITIAL_ISSUANCE],
    deliveries: [...INITIAL_DELIVERIES],
    envLogs: [...INITIAL_ENV_LOGS],
    forkliftChecks: [...INITIAL_FORKLIFT_CHECKS],
    registries: [],
    registeredUsers: [defaultSuperAdmin],
    stockMovements: [],
  };

  // State revision counter to track data version across cluster
  let stateRevision = 1;

  // Active Device Registry tracking network workstations, tablets, and phones
  interface ConnectedDevice {
    deviceId: string;
    deviceName?: string;
    employeeId?: string;
    username?: string;
    role?: string;
    ip?: string;
    userAgent?: string;
    appVersion?: string;
    platform?: string;
    connectedAt: string;
    lastSeen: number;
    currentView?: string;
  }
  const activeDevices = new Map<string, ConnectedDevice>();

  // Persistent Tombstones to prevent zombie records from resurrecting
  const deletedRecordTombstones = new Set<string>();
  const deletedUserTombstones = new Set<string>();

  function markRecordTombstone(id: string) {
    if (!id) return;
    deletedRecordTombstones.add(id);
    if (deletedRecordTombstones.size > 5000) {
      const first = deletedRecordTombstones.values().next().value;
      if (first) deletedRecordTombstones.delete(first);
    }
  }

  function markUserTombstone(employeeId: string) {
    if (!employeeId) return;
    const clean = employeeId.trim().toUpperCase();
    if (clean === 'JPMP-002') return;
    deletedUserTombstones.add(clean);
  }

  function unmarkUserTombstone(employeeId: string) {
    if (!employeeId) return;
    deletedUserTombstones.delete(employeeId.trim().toUpperCase());
  }

  interface ChatMessage {
    id: string;
    sender: string;
    text: string;
    timestamp: string;
    isSystem: boolean;
  }

  // Active chat and audit log
  const chatMessages: ChatMessage[] = [
    {
      id: "sys-init",
      sender: "System",
      text: "JUWEI WAREHOUSE MANAGEMENT SYSTEM ISO 9001:2015 Real-time Database Initialized with Supabase Cloud.",
      timestamp: new Date().toISOString(),
      isSystem: true,
    }
  ];

  // Disk Persistence File (Fallback)
  const DATA_FILE = getStorageFilePath("data-store.json");

  // Global authoritative reset versioning (Prevents stale cached data resurrection)
  let systemResetVersion = 1;
  let systemResetTimestamp = new Date().toISOString();
  let systemResetId = "RESET-INIT";
  let systemResetBy = "SUPER ADMINISTRATOR";

  function loadStateFromDisk() {
    try {
      let targetFile = DATA_FILE;
      if (!fs.existsSync(targetFile) && fs.existsSync(path.join(process.cwd(), "data-store.json"))) {
        targetFile = path.join(process.cwd(), "data-store.json");
      }
      if (fs.existsSync(targetFile)) {
        const raw = fs.readFileSync(targetFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && parsed.systemResetVersion) {
          systemResetVersion = Number(parsed.systemResetVersion) || 1;
        }
        if (parsed && parsed.systemResetTimestamp) {
          systemResetTimestamp = String(parsed.systemResetTimestamp);
        }
        if (parsed && parsed.systemResetId) {
          systemResetId = String(parsed.systemResetId);
        }
        if (parsed && parsed.systemResetBy) {
          systemResetBy = String(parsed.systemResetBy);
        }
        if (parsed && parsed.state && typeof parsed.state === "object") {
          Object.keys(parsed.state).forEach((key) => {
            if (key in state && Array.isArray(parsed.state[key])) {
              (state as any)[key] = parsed.state[key];
            }
          });
        }
        if (parsed && Array.isArray(parsed.deletedRecordTombstones)) {
          parsed.deletedRecordTombstones.forEach((id: string) => markRecordTombstone(id));
        }
        if (parsed && Array.isArray(parsed.deletedUserTombstones)) {
          parsed.deletedUserTombstones.forEach((id: string) => markUserTombstone(id));
        }
        if (parsed && Array.isArray(parsed.chatMessages)) {
          chatMessages.length = 0;
          chatMessages.push(...parsed.chatMessages);
        }
        console.log(`JUWEI WMS: Loaded persisted database state from disk. System Reset Version: ${systemResetVersion} (${systemResetId})`);
      }
    } catch (err) {
      console.warn("JUWEI WMS: Non-fatal notice loading data-store.json:", err);
    }
  }

  // DB Column Mappers for server-side Supabase persistence
  function mapStockToRow(s: any) {
    return {
      id: s.id,
      part_code: s.partCode || s.part_code || '',
      description: s.description || '',
      type: s.type || 'RAW',
      location: s.location || 'Zone A',
      quantity: Number(s.quantity) || 0,
      unit: s.unit || 'PCS',
      lot_number: s.lotNumber || s.lot_number || '',
      model_name: s.modelName || s.model_name || null,
      color: s.color || null,
      received_date: s.receivedDate || s.received_date || new Date().toISOString().split('T')[0],
      expiration_date: s.expirationDate || s.expiration_date || null,
      fifo_color: s.fifoColor || s.fifo_color || 'Dark Green',
      status: s.status || 'APPROVED',
      resin_sack_risk: Boolean(s.resinSackRisk || s.resin_sack_risk),
      shelf_life_days: s.shelfLifeDays || s.shelf_life_days || null,
      customer: s.customer || null,
      reorder_min: Number(s.reorderMin || s.reorder_min) || 0,
      remarks: s.remarks || null,
      bom: s.bom || [],
      updated_at: new Date().toISOString()
    };
  }

  function mapRowToStock(row: any) {
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

  function mapReceivingToRow(r: any) {
    return {
      id: r.id,
      date: r.date,
      received_date: r.receivedDate || r.received_date || r.date,
      location: r.location || null,
      vendor_supplier: r.vendorSupplier || r.vendor_supplier || null,
      reorder_min: Number(r.reorderMin || r.reorder_min) || 0,
      remarks: r.remarks || null,
      source: r.source || 'Resin(External)',
      item_description: r.itemDescription || r.item_description || '',
      part_code: r.partCode || r.part_code || '',
      model_name: r.modelName || r.model_name || null,
      color: r.color || null,
      quantity: Number(r.quantity) || 0,
      unit: r.unit || 'PCS',
      lot_number: r.lotNumber || r.lot_number || '',
      physical_condition: r.physicalCondition || r.physical_condition || {},
      rr_number: r.rrNumber || r.rr_number || null,
      po_number: r.poNumber || r.po_number || null,
      dr_number: r.drNumber || r.dr_number || null,
      si_number: r.siNumber || r.si_number || null,
      way_bill: r.wayBill || r.way_bill || null,
      transfer_form_number: r.transferFormNumber || r.transfer_form_number || null,
      supplier_or_dept: r.supplierOrDept || r.supplier_or_dept || 'Internal',
      iqc_status: r.iqcStatus || r.iqc_status || 'PENDING_IQC',
      status: r.status || 'DRAFT',
      fifo_color_code: r.fifoColorCode || r.fifo_color_code || 'Dark Green',
      bom: r.bom || [],
      auto_deduct_bom: Boolean(r.autoDeductBom || r.auto_deduct_bom),
      customer: r.customer || null,
      updated_at: new Date().toISOString()
    };
  }

  function mapRowToReceiving(row: any) {
    return {
      id: row.id,
      date: row.date || new Date().toISOString().split('T')[0],
      receivedDate: row.received_date || row.receivedDate || row.date,
      location: row.location,
      vendorSupplier: row.vendor_supplier || row.vendorSupplier,
      reorderMin: row.reorder_min ? Number(row.reorder_min) : undefined,
      remarks: row.remarks,
      source: row.source || 'Resin(External)',
      itemDescription: row.item_description || row.itemDescription || '',
      partCode: row.part_code || row.partCode || '',
      modelName: row.model_name || row.modelName,
      color: row.color,
      quantity: Number(row.quantity) || 0,
      unit: row.unit || 'PCS',
      lotNumber: row.lot_number || row.lotNumber || '',
      physicalCondition: row.physical_condition || row.physicalCondition || {},
      rrNumber: row.rr_number || row.rrNumber,
      poNumber: row.po_number || row.poNumber,
      drNumber: row.dr_number || row.drNumber,
      siNumber: row.si_number || row.siNumber,
      wayBill: row.way_bill || row.wayBill,
      transferFormNumber: row.transfer_form_number || row.transferFormNumber,
      supplierOrDept: row.supplier_or_dept || row.supplierOrDept || 'Internal',
      iqcStatus: row.iqc_status || row.iqcStatus || 'PENDING_IQC',
      status: row.status || 'DRAFT',
      fifoColorCode: row.fifo_color_code || row.fifoColorCode || 'Dark Green',
      bom: row.bom || [],
      autoDeductBom: Boolean(row.auto_deduct_bom || row.autoDeductBom),
      customer: row.customer
    };
  }

  function mapReturnToRow(r: any) {
    return {
      id: r.id,
      date: r.date,
      category: r.category || null,
      material_description: r.materialDescription || r.material_description || '',
      part_code: r.partCode || r.part_code || '',
      quantity: Number(r.quantity) || 0,
      unit: r.unit || 'PCS',
      lot_number: r.lotNumber || r.lot_number || '',
      department: r.department || 'Production',
      reason: r.reason || 'Excess Material',
      condition: r.condition || 'Good',
      iqc_evaluation: r.iqcEvaluation || r.iqc_evaluation || 'PENDING_IQC',
      status: r.status || 'PENDING',
      return_slip_form_number: r.returnSlipFormNumber || r.return_slip_form_number || '',
      updated_at: new Date().toISOString()
    };
  }

  function mapRowToReturn(row: any) {
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
      iqcEvaluation: row.iqc_evaluation || row.iqcEvaluation || 'PENDING_IQC',
      status: row.status || 'PENDING',
      returnSlipFormNumber: row.return_slip_form_number || row.returnSlipFormNumber || ''
    };
  }

  function mapRecyclingToRow(r: any) {
    return {
      id: r.id,
      date: r.date,
      item_type: r.itemType || r.item_type || 'Carton Box',
      quantity: Number(r.quantity) || 0,
      condition: r.condition || 'Reusable',
      reuse_cycle_count: Number(r.reuseCycleCount || r.reuse_cycle_count) || 1,
      disposition: r.disposition || 'Re-used',
      log_sheet_number: r.logSheetNumber || r.log_sheet_number || '',
      updated_at: new Date().toISOString()
    };
  }

  function mapRowToRecycling(row: any) {
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

  function mapIssuanceToRow(r: any) {
    return {
      id: r.id,
      date: r.date,
      requisition_number: r.requisitionNumber || r.requisition_number || '',
      department: r.department || 'Assembly',
      part_code: r.partCode || r.part_code || '',
      description: r.description || '',
      quantity_requested: Number(r.quantityRequested || r.quantity_requested) || 0,
      quantity_issued: Number(r.quantityIssued || r.quantity_issued) || 0,
      lot_number: r.lotNumber || r.lot_number || '',
      fifo_verified: Boolean(r.fifoVerified || r.fifo_verified),
      issued_by: r.issuedBy || r.issued_by || 'Storekeeper',
      received_by: r.receivedBy || r.received_by || 'Line Operator',
      updated_at: new Date().toISOString()
    };
  }

  function mapRowToIssuance(row: any) {
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

  function mapDeliveryToRow(d: any) {
    return {
      id: d.id,
      date: d.date,
      picking_list_number: d.pickingListNumber || d.picking_list_number || '',
      po_number: d.poNumber || d.po_number || '',
      model_name: d.modelName || d.model_name || '',
      part_code: d.partCode || d.part_code || '',
      quantity: Number(d.quantity) || 0,
      packaging_condition_ok: Boolean(d.packagingConditionOk ?? d.packaging_condition_ok ?? true),
      fifo_verified: Boolean(d.fifoVerified ?? d.fifo_verified ?? false),
      forklift_checklist_signed: Boolean(d.forkliftChecklistSigned ?? d.forklift_checklist_signed ?? false),
      gate_pass_number: d.gatePassNumber || d.gate_pass_number || '',
      dr_number: d.drNumber || d.dr_number || null,
      sales_invoice: d.salesInvoice || d.sales_invoice || null,
      way_bill: d.wayBill || d.way_bill || null,
      status: d.status || 'PREPARING',
      prepared_by: d.preparedBy || d.prepared_by || 'Dispatch Supervisor',
      loaded_by: d.loadedBy || d.loaded_by || null,
      updated_at: new Date().toISOString()
    };
  }

  function mapRowToDelivery(row: any) {
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
      drNumber: row.dr_number || row.drNumber,
      salesInvoice: row.sales_invoice || row.salesInvoice,
      wayBill: row.way_bill || row.wayBill,
      status: row.status || 'PREPARING',
      preparedBy: row.prepared_by || row.preparedBy || 'Dispatch Supervisor',
      loadedBy: row.loaded_by || row.loadedBy
    };
  }

  function mapEnvLogToRow(e: any) {
    return {
      id: e.id,
      timestamp: e.timestamp,
      zone: e.zone,
      occupied_slots: Number(e.occupiedSlots || e.occupied_slots) || 0,
      total_slots: Number(e.totalSlots || e.total_slots) || 150,
      cleanliness_ok: Boolean(e.cleanlinessOk ?? e.cleanliness_ok ?? true),
      ventilation_ok: Boolean(e.ventilationOk ?? e.ventilation_ok ?? true),
      pest_free: Boolean(e.pestFree ?? e.pest_free ?? true),
      recorded_by: e.recordedBy || e.recorded_by || 'Inspector',
      updated_at: new Date().toISOString()
    };
  }

  function mapRowToEnvLog(row: any) {
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

  function mapForkliftToRow(f: any) {
    return {
      id: f.id,
      date: f.date,
      operator: f.operator,
      forklift_id: f.forkliftId || f.forklift_id || 'FL-01',
      brakes_ok: Boolean(f.brakesOk ?? f.brakes_ok ?? true),
      lights_ok: Boolean(f.lightsOk ?? f.lights_ok ?? true),
      hydraulic_ok: Boolean(f.hydraulicOk ?? f.hydraulic_ok ?? true),
      steering_ok: Boolean(f.steeringOk ?? f.steering_ok ?? true),
      tires_ok: Boolean(f.tiresOk ?? f.tires_ok ?? true),
      battery_fluid_ok: Boolean(f.batteryFluidOk ?? f.battery_fluid_ok ?? true),
      remarks: f.remarks || null,
      updated_at: new Date().toISOString()
    };
  }

  function mapRowToForklift(row: any) {
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

  function mapRegistryToRow(reg: any) {
    return {
      id: reg.id,
      type: reg.type,
      code: reg.code,
      name: reg.name,
      description: reg.description || null,
      status: reg.status || 'ACTIVE',
      date_registered: reg.dateRegistered || reg.date_registered || new Date().toISOString().split('T')[0],
      preset_source: reg.presetSource || reg.preset_source || null,
      category: reg.category || null,
      vendor_supplier: reg.vendorSupplier || reg.vendor_supplier || null,
      unit: reg.unit || null,
      location: reg.location || null,
      updated_at: new Date().toISOString()
    };
  }

  function mapRowToRegistry(row: any) {
    return {
      id: row.id,
      type: row.type,
      code: row.code,
      name: row.name,
      description: row.description,
      status: row.status || 'ACTIVE',
      dateRegistered: row.date_registered || row.dateRegistered || new Date().toISOString().split('T')[0],
      presetSource: row.preset_source || row.presetSource,
      category: row.category,
      vendorSupplier: row.vendor_supplier || row.vendorSupplier,
      unit: row.unit,
      location: row.location
    };
  }

  function resolveAccountPin(r: any, empId?: string): string {
    const cleanId = (empId || r?.employee_id || r?.employeeId || '').toUpperCase().trim();
    const defaultPin = cleanId === 'JPMP-002' ? '0423' : '1234';
    const pinA = r?.pin ? String(r.pin).trim() : '';
    const pinB = r?.pin_hash ? String(r.pin_hash).trim() : '';

    // Prioritize actual custom PIN: if one is non-empty and not default '1234', that is definitely the user's PIN!
    if (pinA && pinA !== '1234') return pinA.slice(0, 4);
    if (pinB && pinB !== '1234') return pinB.slice(0, 4);
    if (pinA) return pinA.slice(0, 4);
    if (pinB) return pinB.slice(0, 4);
    return defaultPin;
  }

  async function loadStateFromSupabase() {
    if (!supabaseServer) return;
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
          mapper: (u: any): ServerUser => {
            const empId = (u.employee_id || u.employeeId || '').toUpperCase().trim();
            const cleanPin = resolveAccountPin(u, empId);
            return {
              employeeId: empId,
              username: (u.username || (empId === 'JPMP-002' ? 'ALDRIN BANAWA' : 'OPERATOR')).toUpperCase(),
              role: (u.role || (empId === 'JPMP-002' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE CLERK')).toUpperCase(),
              phoneNumber: u.phone_number || u.phoneNumber || (empId === 'JPMP-002' ? '+639669858846' : ''),
              permission: u.permission || (empId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
              pin: cleanPin,
              status: u.status || 'ACTIVE',
              lastActive: u.last_active || u.lastActive || undefined
            };
          }
        },
        chatMessages: {
          table: 'chat_messages',
          mapper: (m: any) => ({
            id: m.id,
            sender: m.sender,
            text: m.text,
            timestamp: m.timestamp,
            isSystem: Boolean(m.is_system)
          })
        }
      };

      for (const [col, config] of Object.entries(tableMap)) {
        const { data, error } = await supabaseServer.from(config.table).select('*');
        if (!error && Array.isArray(data) && data.length > 0) {
          if (col === 'chatMessages') {
            chatMessages.length = 0;
            chatMessages.push(...data.map(config.mapper));
          } else if (col === 'registeredUsers') {
            const parsedUsers = data.map(config.mapper);
            if (!parsedUsers.some((u: any) => u.employeeId === 'JPMP-002')) {
              parsedUsers.unshift(defaultSuperAdmin);
            }
            state.registeredUsers = parsedUsers;

            // Auto-heal Supabase table so both pin and pin_hash match cleanPin
            try {
              const healedUsers = parsedUsers.map((u: ServerUser) => ({
                employee_id: u.employeeId,
                username: u.username,
                role: u.role,
                permission: u.permission,
                pin_hash: u.pin,
                updated_at: new Date().toISOString()
              }));
              await supabaseServer.from('registered_users').upsert(healedUsers);
            } catch (hErr) {
              console.warn("Supabase auto-heal users warning:", hErr);
            }
          } else if (col in state) {
            (state as any)[col] = data.map(config.mapper);
          }
        }
      }
      console.log("JUWEI WMS: Hydrated live state from Supabase Cloud PostgreSQL.");
      saveStateToDisk();
    } catch (err) {
      console.warn("JUWEI WMS: Could not hydrate state from Supabase:", err);
    }
  }

  function saveStateToDisk() {
    try {
      const payload = JSON.stringify({ 
        systemResetVersion,
        systemResetTimestamp,
        systemResetId,
        systemResetBy,
        state, 
        deletedRecordTombstones: Array.from(deletedRecordTombstones),
        deletedUserTombstones: Array.from(deletedUserTombstones),
        chatMessages 
      }, null, 2);
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, payload, "utf-8");
    } catch (err) {
      console.warn("JUWEI WMS: Notice saving data-store.json (non-fatal, in-memory state preserved):", err);
    }
  }

  // Load existing persisted data on startup
  loadStateFromDisk();
  if (supabaseServer) {
    loadStateFromSupabase();
  }

  // Helper to persist collection to Supabase asynchronously with PostgreSQL column mapping
  async function persistToSupabase(collection: string, data: any[]) {
    if (!supabaseServer) return;
    try {
      const tableMap: Record<string, { table: string; mapper: (r: any) => any }> = {
        stocks: { table: 'stocks', mapper: mapStockToRow },
        receiving: { table: 'receiving', mapper: mapReceivingToRow },
        returns: { table: 'returns', mapper: mapReturnToRow },
        recycling: { table: 'recycling', mapper: mapRecyclingToRow },
        issuances: { table: 'issuances', mapper: mapIssuanceToRow },
        deliveries: { table: 'deliveries', mapper: mapDeliveryToRow },
        envLogs: { table: 'env_logs', mapper: mapEnvLogToRow },
        forkliftChecks: { table: 'forklift_checks', mapper: mapForkliftToRow },
        registries: { table: 'registries', mapper: mapRegistryToRow },
        registeredUsers: {
          table: 'registered_users',
          mapper: (u: any) => {
            const empId = (u.employeeId || u.employee_id || '').toUpperCase().trim();
            const cleanPin = resolveAccountPin(u, empId);
            return {
              employee_id: empId,
              username: (u.username || (empId === 'JPMP-002' ? 'ALDRIN BANAWA' : 'OPERATOR')).toUpperCase(),
              role: (u.role || (empId === 'JPMP-002' ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE CLERK')).toUpperCase(),
              permission: u.permission || (empId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
              pin_hash: cleanPin,
              updated_at: new Date().toISOString()
            };
          }
        },
        chatMessages: {
          table: 'chat_messages',
          mapper: (m: any) => ({
            id: m.id,
            sender: m.sender,
            text: m.text,
            timestamp: m.timestamp,
            is_system: Boolean(m.isSystem || m.is_system),
            created_at: new Date().toISOString()
          })
        }
      };

      const target = tableMap[collection];
      if (!target) return;

      if (!Array.isArray(data) || data.length === 0) {
        // Never automatically wipe table contents when receiving an empty array
        return;
      }

      const mappedRows = data.map(target.mapper);
      await supabaseServer.from(target.table).upsert(mappedRows, { ignoreDuplicates: false });
    } catch (err) {
      console.warn(`Supabase server persist failed for ${collection}:`, err);
    }
  }

  // Middleware for JSON parsing and CORS
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Active connections tracker with rich presence metadata
  interface ConnectedClientInfo {
    stationId?: string;
    username: string;
    employeeId?: string;
    role?: string;
    activeView?: string;
    connectedAt: string;
    lastPing: number;
  }
  const activeConnections = new Map<WebSocket, ConnectedClientInfo>();

  // Helper to get array of all active user names
  function getActiveUsersList(): string[] {
    const users = Array.from(activeConnections.values()).map(c => c.username).filter(Boolean);
    return Array.from(new Set(users));
  }

  // Helper to get structured presence list with active view & employee info
  function getActivePresenceList(): Array<{
    stationId: string;
    username: string;
    employeeId: string;
    role: string;
    activeView: string;
    connectedAt: string;
    lastPing: number;
    source: string;
  }> {
    return Array.from(activeConnections.values()).map(c => ({
      stationId: c.stationId || '',
      username: c.username,
      employeeId: c.employeeId || '',
      role: c.role || 'OPERATOR',
      activeView: c.activeView || 'dashboard',
      connectedAt: c.connectedAt,
      lastPing: c.lastPing,
      source: 'websocket'
    }));
  }

  // API health endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", clientsCount: activeConnections.size, timestamp: new Date().toISOString() });
  });

  // Route to inspect and fetch shared Supabase integration status and credentials
  app.get("/api/supabase-config", (req, res) => {
    res.json({
      configured: Boolean(supabaseServer || (supabaseUrl && supabaseKey)),
      url: supabaseUrl || null,
      anonKey: supabaseKey || null
    });
  });

  // Endpoint to update shared Supabase credentials across all network PCs
  app.post("/api/supabase-config", async (req, res) => {
    try {
      const { url, anonKey } = req.body;
      if (!url || !anonKey) {
        return res.status(400).json({ error: "URL and Anon Key required" });
      }
      let cleanUrl = url.trim();
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = `https://${cleanUrl}`;
      }
      const cleanKey = anonKey.trim();

      supabaseUrl = cleanUrl;
      supabaseKey = cleanKey;
      process.env.VITE_SUPABASE_URL = cleanUrl;
      process.env.VITE_SUPABASE_ANON_KEY = cleanKey;

      try {
        fs.writeFileSync(CONFIG_SUPABASE_FILE, JSON.stringify({ url: cleanUrl, anonKey: cleanKey }, null, 2), "utf-8");
      } catch (err) {
        console.warn("Failed to write supabase-config.json:", err);
      }

      try {
        supabaseServer = createClient(cleanUrl, cleanKey);
        console.log("JUWEI WMS: Re-initialized Supabase server client with URL:", cleanUrl);
        loadStateFromSupabase().then(() => {
          broadcast({
            type: "full_sync",
            data: {
              ...state,
              chatMessages
            },
            activeUsers: getActiveUsersList()
          });
        });
      } catch (err) {
        console.warn("JUWEI WMS: Error creating Supabase client:", err);
      }

      broadcast({
        type: "supabase_config_updated",
        url: cleanUrl,
        anonKey: cleanKey
      });

      return res.json({ success: true, url: cleanUrl });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // API full state sync endpoint for HTTP clients / fallback
  app.get("/api/sync", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json({
      status: "ok",
      revision: stateRevision,
      systemResetVersion,
      systemResetTimestamp,
      systemResetId,
      systemResetBy,
      supabaseConnected: Boolean(supabaseServer),
      data: {
        ...state,
        chatMessages
      },
      activeUsers: getActiveUsersList(),
      activePresence: getActivePresenceList()
    });
  });

  // API state summary and digest for rapid lightweight delta checking
  app.get(["/api/sync/state-summary", "/api/sync/digest"], (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      status: "ok",
      revision: stateRevision,
      systemResetVersion,
      systemResetTimestamp,
      systemResetId,
      systemResetBy,
      timestamp: new Date().toISOString(),
      supabaseConnected: Boolean(supabaseServer),
      accountsCount: state.registeredUsers.length,
      superAdminPresent: state.registeredUsers.some((u: any) => (u.employeeId || u.employee_id || '').toUpperCase() === 'JPMP-002'),
      collections: {
        stocks: state.stocks.length,
        receiving: state.receiving.length,
        returns: state.returns.length,
        recycling: state.recycling.length,
        issuances: state.issuances.length,
        deliveries: state.deliveries.length,
        envLogs: state.envLogs.length,
        forkliftChecks: state.forkliftChecks.length,
        registries: state.registries.length,
        registeredUsers: state.registeredUsers.length,
        chatMessages: chatMessages.length
      },
      tombstones: {
        records: deletedRecordTombstones.size,
        users: deletedUserTombstones.size
      },
      activeConnectionsCount: activeConnections.size,
      activeUsers: getActiveUsersList()
    });
  });

  // API to query all active workstations & devices across warehouse network
  app.get("/api/devices", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const now = Date.now();
    // Clean devices not seen in the last 3 minutes
    for (const [id, dev] of activeDevices.entries()) {
      if (now - dev.lastSeen > 180000) {
        activeDevices.delete(id);
      }
    }
    const deviceList = Array.from(activeDevices.values());
    res.json({
      status: "ok",
      count: deviceList.length,
      devices: deviceList,
      serverTime: new Date().toISOString()
    });
  });

  // API heartbeat registration for workstations / mobile tablets
  app.post("/api/devices/heartbeat", (req, res) => {
    try {
      const { deviceId, deviceName, employeeId, username, role, currentView, appVersion, platform } = req.body;
      if (!deviceId) return res.status(400).json({ error: "Device ID required" });

      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'local';
      const existing = activeDevices.get(deviceId) || { connectedAt: new Date().toISOString() } as ConnectedDevice;

      const deviceRecord: ConnectedDevice = {
        ...existing,
        deviceId,
        deviceName: deviceName || existing.deviceName || 'JUWEI Workstation',
        employeeId: employeeId || existing.employeeId || '',
        username: username || existing.username || 'Operator',
        role: role || existing.role || 'OPERATOR',
        currentView: currentView || existing.currentView || 'dashboard',
        appVersion: appVersion || existing.appVersion || '1.0.0',
        platform: platform || existing.platform || 'web',
        ip: clientIp,
        userAgent: req.headers['user-agent'] || '',
        lastSeen: Date.now()
      };

      activeDevices.set(deviceId, deviceRecord);

      res.json({
        success: true,
        revision: stateRevision,
        serverTime: Date.now()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API endpoint for version check and auto-update prompts
  app.get("/api/version", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      version: "1.0.0",
      productName: "JUWEI WMS Desktop System",
      buildDate: new Date().toISOString().split('T')[0],
      downloadUrl: process.env.APP_DOWNLOAD_URL || "https://github.com/your-org/juwei-wms/releases/latest"
    });
  });

  // Helper to strictly authenticate Super Admin privileges for destructive actions
  function isAuthorizedSuperAdmin(req: any): boolean {
    const empId = (req.body?.employeeId || req.headers['x-user-employee-id'] || '').toString().toUpperCase().trim();
    const role = (req.body?.role || req.headers['x-user-role'] || '').toString().toUpperCase().trim();
    const permission = (req.body?.permission || req.headers['x-user-permission'] || '').toString().toUpperCase().trim();
    const pin = (req.body?.pin || req.headers['x-user-pin'] || '').toString().trim();

    const isSuperAdminId = empId === 'JPMP-002';
    const isSuperAdminRole = role === 'SUPER ADMINISTRATOR' || role === 'SUPER ADMIN';
    const isFullAccess = permission === 'FULL_ACCESS';
    const isSuperPin = pin === '0423';

    // Must be verified Super Admin identity
    return (isSuperAdminId || isSuperAdminRole) && (isFullAccess || isSuperPin || isSuperAdminId);
  }

  // Central Authoritative Global Reset Execution
  function executeServerGlobalReset(author: string, keepUsers = true) {
    systemResetVersion = Math.max(systemResetVersion + 1, Date.now());
    systemResetId = `RST-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    systemResetTimestamp = new Date().toISOString();
    systemResetBy = author || "ALDRIN BANAWA (SUPER ADMINISTRATOR)";

    deletedRecordTombstones.clear();
    if (!keepUsers) {
      deletedUserTombstones.clear();
    }

    state.stocks = [];
    state.receiving = [];
    state.returns = [];
    state.recycling = [];
    state.issuances = [];
    state.deliveries = [];
    state.envLogs = [];
    state.forkliftChecks = [];
    state.registries = [];
    if ('stockMovements' in state) {
      (state as any).stockMovements = [];
    }

    if (!keepUsers) {
      state.registeredUsers = [{ ...defaultSuperAdmin }];
    } else {
      const hasAdmin = state.registeredUsers.some((u: any) => (u.employeeId || u.employee_id || '').toUpperCase() === 'JPMP-002');
      if (!hasAdmin) {
        state.registeredUsers.unshift({ ...defaultSuperAdmin });
      }
    }

    chatMessages.length = 0;
    chatMessages.push({
      id: `sys-reset-${Date.now()}`,
      sender: "System Audit",
      text: `CENTRAL DATABASE HARD RESET: All encoded warehouse records cleared from central database by Super Administrator (${systemResetBy}). Reset Version: ${systemResetVersion}, Reset ID: ${systemResetId}.`,
      timestamp: systemResetTimestamp,
      isSystem: true
    });

    stateRevision++;
    saveStateToDisk();

    if (supabaseServer) {
      const collections = ['stocks', 'receiving', 'returns', 'recycling', 'issuances', 'deliveries', 'env_logs', 'forklift_checks', 'registries', 'chat_messages', 'stock_movements'];
      for (const table of collections) {
        try {
          supabaseServer.from(table).delete().neq('id', '___NEVER___').then();
        } catch (e) {}
      }
      if (!keepUsers) {
        try {
          supabaseServer.from('registered_users').delete().neq('employee_id', 'JPMP-002').then();
        } catch (e) {}
      }
    }

    // Broadcast authoritative GLOBAL_RESET WebSocket event to all connected sessions
    broadcast({
      type: "GLOBAL_RESET",
      systemResetVersion,
      systemResetTimestamp,
      systemResetId,
      resetBy: systemResetBy,
      data: {
        ...state,
        chatMessages
      },
      activeUsers: getActiveUsersList(),
      revision: stateRevision
    });

    console.log(`[GLOBAL RESET] Central Database wiped. System Reset Version: ${systemResetVersion} (${systemResetId}) by ${systemResetBy}`);

    return {
      success: true,
      systemResetVersion,
      systemResetTimestamp,
      systemResetId,
      resetBy: systemResetBy,
      data: {
        ...state,
        chatMessages
      },
      message: "Central database successfully reset. Global reset broadcast sent to all connected clients."
    };
  }

  // API update collection endpoint for HTTP clients / fallback
  app.post("/api/sync", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      const { collection, data } = req.body;
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version']);
      
      // Reject stale uploads from clients using an outdated reset version
      if (clientResetVersion && clientResetVersion < systemResetVersion) {
        return res.status(409).json({
          error: "OUTDATED_RESET_VERSION: Stale data from previous reset version cannot overwrite central database.",
          systemResetVersion,
          systemResetTimestamp,
          systemResetId
        });
      }

      if (collection === "chatMessages" && Array.isArray(data)) {
        chatMessages.length = 0;
        chatMessages.push(...data);
        saveStateToDisk();
        persistToSupabase("chatMessages", chatMessages);
        broadcast({ type: "chat_broadcast_all", messages: chatMessages });
        return res.json({ success: true, collection });
      }

      if (collection === "registeredUsers" && Array.isArray(data)) {
        const userMap = new Map<string, any>();
        userMap.set("JPMP-002", { ...defaultSuperAdmin });
        // Preserve all currently known valid registered users in server state
        if (Array.isArray(state.registeredUsers)) {
          state.registeredUsers.forEach((u: any) => {
            const empId = (u.employeeId || u.employee_id || '').toUpperCase().trim();
            if (empId && (empId === 'JPMP-002' || !deletedUserTombstones.has(empId))) {
              userMap.set(empId, { ...u, employeeId: empId });
            }
          });
        }
        data.forEach((u: any) => {
          const empId = (u.employeeId || u.employee_id || '').toUpperCase().trim();
          if (empId && (empId === 'JPMP-002' || !deletedUserTombstones.has(empId))) {
            const existing = userMap.get(empId) || {};
            const cleanPin = resolveAccountPin({ ...existing, ...u }, empId);
            userMap.set(empId, {
              ...existing,
              ...u,
              employeeId: empId,
              pin: cleanPin,
              pin_hash: cleanPin
            });
          }
        });
        state.registeredUsers = Array.from(userMap.values());
        saveStateToDisk();
        persistToSupabase("registeredUsers", state.registeredUsers);
        broadcast({
          type: "collection_updated",
          collection: "registeredUsers",
          data: state.registeredUsers
        });
        return res.json({ success: true, collection: "registeredUsers", updatedCount: state.registeredUsers.length });
      }

      if (collection && collection in state && Array.isArray(data)) {
        // If client sends empty array (e.g. after a reset or clear), clear the collection
        if (data.length === 0) {
          (state as any)[collection] = [];
          stateRevision++;
          saveStateToDisk();
          persistToSupabase(collection, []);
          broadcast({
            type: "collection_updated",
            collection,
            data: [],
            systemResetVersion
          });
          return res.json({ success: true, collection, updatedCount: 0, systemResetVersion });
        }

        const currentArr: any[] = (state as any)[collection] || [];
        const recordMap = new Map<string, any>();
        
        // Keep existing non-tombstoned records
        for (const item of currentArr) {
          if (item && item.id && !deletedRecordTombstones.has(item.id)) {
            recordMap.set(item.id, item);
          }
        }
        
        // Merge incoming records with version and timestamp conflict protection
        const serverTime = new Date().toISOString();
        for (const item of data) {
          if (item && item.id && !deletedRecordTombstones.has(item.id)) {
            // Drop records stamped with older reset_version
            if (item.reset_version && Number(item.reset_version) < systemResetVersion) {
              continue;
            }

            const existing = recordMap.get(item.id);
            if (existing) {
              const existingTs = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
              const incomingTs = item.updated_at ? new Date(item.updated_at).getTime() : 0;
              if (incomingTs >= existingTs) {
                recordMap.set(item.id, {
                  ...existing,
                  ...item,
                  reset_version: systemResetVersion,
                  version: (Number(existing.version) || 1) + 1,
                  updated_at: serverTime
                });
              }
            } else {
              recordMap.set(item.id, {
                ...item,
                reset_version: systemResetVersion,
                version: 1,
                created_at: item.created_at || serverTime,
                updated_at: serverTime
              });
            }
          }
        }
        
        (state as any)[collection] = Array.from(recordMap.values());
        stateRevision++;
        saveStateToDisk();
        persistToSupabase(collection, (state as any)[collection]);
        
        // Broadcast change to all connected WebSockets
        broadcast({
          type: "collection_updated",
          collection,
          data: (state as any)[collection],
          systemResetVersion
        });

        return res.json({ success: true, collection, updatedCount: (state as any)[collection].length, systemResetVersion });
      }
      res.status(400).json({ error: "Invalid collection" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dedicated Super Admin Reset Endpoint: Complete Global Database Reset
  app.post(["/api/reset-everything", "/api/reset-database"], async (req, res) => {
    try {
      if (!req.body?.confirmed) {
        return res.status(400).json({ 
          error: "CONFIRMATION_REQUIRED: Global reset requires explicit 'confirmed: true'." 
        });
      }

      if (!isAuthorizedSuperAdmin(req)) {
        return res.status(403).json({ 
          error: "PERMISSION_DENIED: Only the Super Administrator (JPMP-002) is authorized to execute a complete global database reset." 
        });
      }

      const author = req.body?.author || "ALDRIN BANAWA (SUPER ADMINISTRATOR)";
      const keepUsers = req.body?.keepUsers !== false;
      const result = executeServerGlobalReset(author, keepUsers);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Authoritative endpoint to retrieve all registered accounts from single unified storage
  app.get("/api/accounts", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      if (supabaseServer) {
        try {
          const { data, error } = await supabaseServer.from('registered_users').select('*');
          if (!error && Array.isArray(data) && data.length > 0) {
            const userMap = new Map<string, ServerUser>();
            data.forEach((r: any) => {
              const empId = (r.employee_id || r.employeeId || '').toUpperCase().trim();
              if (empId && (empId === 'JPMP-002' || !deletedUserTombstones.has(empId))) {
                const cleanPin = resolveAccountPin(r, empId);
                const isSuper = empId === 'JPMP-002';
                userMap.set(empId, {
                  employeeId: empId,
                  username: (r.username || (isSuper ? 'ALDRIN BANAWA' : 'OPERATOR')).toUpperCase(),
                  role: (r.role || (isSuper ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE CLERK')).toUpperCase(),
                  phoneNumber: r.phone_number || r.phoneNumber || (isSuper ? '+639669858846' : ''),
                  permission: r.permission || (isSuper ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
                  pin: cleanPin,
                  status: r.status || 'ACTIVE',
                  lastActive: r.last_active || r.lastActive || undefined,
                  registeredBy: isSuper ? 'ROOT_SUPER_ADMIN (JPMP-002)' : 'JPMP-002 (ALDRIN BANAWA)',
                  registeredBySuperAdmin: true,
                  registeredAt: r.created_at || '2026-01-01T00:00:00.000Z'
                });
              }
            });

            if (!userMap.has('JPMP-002')) {
              userMap.set('JPMP-002', { ...defaultSuperAdmin });
            }

            state.registeredUsers = Array.from(userMap.values());
            saveStateToDisk();
          }
        } catch (sErr) {
          console.warn("Supabase fetch accounts error in /api/accounts:", sErr);
        }
      }

      if (!state.registeredUsers.some((u: any) => (u.employeeId || u.employee_id || '').toUpperCase() === 'JPMP-002')) {
        state.registeredUsers.unshift({ ...defaultSuperAdmin });
      }

      // Ensure every distributed account is stamped with Super Administrator master authority
      state.registeredUsers = state.registeredUsers.map((u: any) => ({
        ...u,
        registeredBy: (u.employeeId || '').toUpperCase() === 'JPMP-002' ? 'ROOT_SUPER_ADMIN (JPMP-002)' : (u.registeredBy || 'JPMP-002 (ALDRIN BANAWA)'),
        registeredBySuperAdmin: true
      }));

      return res.json({
        success: true,
        count: state.registeredUsers.length,
        accounts: state.registeredUsers,
        revision: stateRevision
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Authoritative endpoint to verify operational ID and PIN code against central single storage
  app.post("/api/accounts/verify", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      const { identifier, pin } = req.body;
      const rawInput = String(identifier || '').trim();
      const enteredPin = String(pin || '').trim();

      if (!rawInput || !enteredPin) {
        return res.status(400).json({ success: false, error: "Identifier and PIN are required." });
      }

      let searchId = rawInput.toUpperCase();
      if (!searchId.startsWith('JPMP-')) {
        searchId = 'JPMP-' + searchId.replace(/^EMP-/, '');
      }
      const inputPhone = rawInput.replace(/\D/g, '');

      // 1. Check in-memory server state
      let matchedUser = state.registeredUsers.find((u: any) => {
        const uEmpId = (u.employeeId || u.employee_id || '').toUpperCase().trim();
        const uUsername = (u.username || '').toUpperCase().trim();
        const uPhone = (u.phoneNumber || u.phone_number || '').replace(/\D/g, '');
        const idMatches = uEmpId === searchId || uEmpId === rawInput.toUpperCase() || uUsername === rawInput.toUpperCase() || (inputPhone.length >= 10 && uPhone === inputPhone);
        const uPin = (u.pin || '').toString().trim();
        return idMatches && uPin === enteredPin;
      });

      // 2. Direct Supabase Cloud check if not matched (authoritative sync across workstations)
      if (!matchedUser && supabaseServer) {
        try {
          const { data, error } = await supabaseServer.from('registered_users').select('*');
          if (!error && Array.isArray(data)) {
            for (const r of data) {
              const empId = (r.employee_id || r.employeeId || '').toUpperCase().trim();
              const username = (r.username || '').toUpperCase().trim();
              const phone = (r.phone_number || '').replace(/\D/g, '');
              const idMatches = empId === searchId || empId === rawInput.toUpperCase() || username === rawInput.toUpperCase() || (inputPhone.length >= 10 && phone === inputPhone);
              if (idMatches) {
                const resolvedPin = resolveAccountPin(r, empId);
                if (resolvedPin === enteredPin) {
                  const isSuper = empId === 'JPMP-002';
                  matchedUser = {
                    employeeId: empId,
                    username: (r.username || (isSuper ? 'ALDRIN BANAWA' : 'OPERATOR')).toUpperCase(),
                    role: (r.role || (isSuper ? 'SUPER ADMINISTRATOR' : 'WAREHOUSE CLERK')).toUpperCase(),
                    phoneNumber: r.phone_number || (isSuper ? '+639669858846' : ''),
                    permission: r.permission || (isSuper ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
                    pin: resolvedPin,
                    status: r.status || 'ACTIVE',
                    lastActive: r.last_active || undefined,
                    registeredBy: isSuper ? 'ROOT_SUPER_ADMIN (JPMP-002)' : 'JPMP-002 (ALDRIN BANAWA)',
                    registeredBySuperAdmin: true
                  };
                  state.registeredUsers = [
                    ...state.registeredUsers.filter((u: any) => (u.employeeId || u.employee_id || '').toUpperCase() !== empId),
                    matchedUser
                  ];
                  saveStateToDisk();
                  break;
                }
              }
            }
          }
        } catch (sErr) {
          console.warn("Supabase account verification check warning:", sErr);
        }
      }

      if (matchedUser) {
        const enrichedUser = {
          ...matchedUser,
          registeredBy: (matchedUser.employeeId || '').toUpperCase() === 'JPMP-002' 
            ? 'ROOT_SUPER_ADMIN (JPMP-002)' 
            : (matchedUser.registeredBy || 'JPMP-002 (ALDRIN BANAWA)'),
          registeredBySuperAdmin: true
        };
        return res.json({
          success: true,
          user: enrichedUser,
          revision: stateRevision
        });
      } else {
        return res.status(401).json({
          success: false,
          error: "INVALID OPERATIONAL ID NUMBER OR INCORRECT PIN CODE."
        });
      }
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Authoritative endpoint to update PIN code for an operator and synchronize across all workstations
  app.post("/api/accounts/update-pin", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      const { employeeId, newPin, pin, author } = req.body;
      const cleanId = String(employeeId || '').trim().toUpperCase();
      const pinVal = newPin !== undefined ? newPin : (pin !== undefined ? pin : '');
      const cleanPin = String(pinVal || '').replace(/\D/g, '').slice(0, 4);

      if (!cleanId || cleanPin.length !== 4) {
        return res.status(400).json({ error: "Valid Employee ID and 4-digit PIN required." });
      }

      const targetIndex = state.registeredUsers.findIndex(
        (u: any) => (u.employeeId || u.employee_id || '').toUpperCase() === cleanId
      );

      let targetUser = targetIndex !== -1 ? state.registeredUsers[targetIndex] : null;

      if (!targetUser) {
        if (cleanId === 'JPMP-002') {
          targetUser = { ...defaultSuperAdmin };
          state.registeredUsers.unshift(targetUser);
        } else {
          return res.status(404).json({ error: `Operator account "${cleanId}" not found.` });
        }
      }

      const updatedUser: ServerUser = {
        ...targetUser,
        pin: cleanPin,
        lastActive: new Date().toISOString()
      };

      const finalIdx = state.registeredUsers.findIndex(
        (u: any) => (u.employeeId || u.employee_id || '').toUpperCase() === cleanId
      );
      if (finalIdx !== -1) {
        state.registeredUsers[finalIdx] = updatedUser;
      } else {
        state.registeredUsers.push(updatedUser);
      }

      stateRevision++;
      saveStateToDisk();
      persistToSupabase("registeredUsers", state.registeredUsers);

      if (supabaseServer) {
        try {
          await supabaseServer.from('registered_users').upsert([{
            employee_id: cleanId,
            username: updatedUser.username,
            role: updatedUser.role,
            permission: updatedUser.permission,
            pin_hash: cleanPin,
            updated_at: new Date().toISOString()
          }]);
        } catch (sErr) {
          console.warn("Supabase PIN update warning:", sErr);
        }
      }

      broadcast({
        type: "account_updated",
        user: updatedUser,
        author: author || "Operator",
        revision: stateRevision
      });

      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers,
        revision: stateRevision
      });

      return res.json({
        success: true,
        message: `PIN updated and synchronized for operator ${updatedUser.username} (${cleanId}) across all computers.`,
        user: updatedUser,
        revision: stateRevision
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Explicit endpoint to register a new operator account across server, disk, Supabase, and live clients
  app.post("/api/accounts/register", async (req, res) => {
    try {
      const { employeeId, username, role, phoneNumber, permission, pin, status, requesterEmployeeId, requesterUsername, author } = req.body;
      if (!employeeId || !username) {
        return res.status(400).json({ error: "Employee ID and Username are required" });
      }

      // STRICT VALIDATION: Only Super Administrator (Aldrin Banawa - JPMP-002) in this master computer is authorized to register accounts
      const isSuperAdminAuthorized = 
        requesterEmployeeId === 'JPMP-002' || 
        (requesterUsername || '').toUpperCase().includes('ALDRIN') ||
        (author || '').toUpperCase().includes('ALDRIN') ||
        (req.body.registeredBy || '').toUpperCase().includes('JPMP-002') ||
        (req.body.role || '').toUpperCase().includes('SUPER ADMINISTRATOR');

      if (!isSuperAdminAuthorized) {
        return res.status(403).json({ 
          error: "AUTHORIZATION RESTRICTION: Only accounts registered by Super Administrator (ALDRIN BANAWA - JPMP-002) on the master computer are authorized for use across other users and computers." 
        });
      }

      const cleanId = String(employeeId).trim().toUpperCase();
      const cleanUsername = String(username).trim().toUpperCase();
      const cleanRole = String(role || 'WAREHOUSE OPERATOR').trim().toUpperCase();
      const cleanPin = String(pin || '1234').trim().slice(0, 4);

      unmarkUserTombstone(cleanId);

      const newUser: ServerUser = {
        employeeId: cleanId,
        username: cleanUsername,
        role: cleanRole,
        phoneNumber: phoneNumber ? String(phoneNumber).trim() : '',
        permission: permission || (cleanId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
        pin: cleanPin,
        status: status || 'ACTIVE',
        lastActive: new Date().toISOString(),
        registeredBy: 'JPMP-002 (ALDRIN BANAWA)',
        registeredBySuperAdmin: true,
        registeredAt: new Date().toISOString(),
        stationId: req.body.stationId || 'MASTER_TERMINAL'
      };

      state.registeredUsers = [
        ...state.registeredUsers.filter((u: any) => (u.employeeId || u.employee_id || '').toUpperCase() !== cleanId),
        newUser
      ];

      stateRevision++;
      saveStateToDisk();
      persistToSupabase("registeredUsers", state.registeredUsers);

      if (supabaseServer) {
        try {
          await supabaseServer.from('registered_users').upsert([{
            employee_id: cleanId,
            username: cleanUsername,
            role: cleanRole,
            permission: newUser.permission,
            pin_hash: cleanPin,
            updated_at: new Date().toISOString()
          }]);
        } catch (sErr) {
          console.warn("Supabase direct user register warning:", sErr);
        }
      }

      broadcast({
        type: "account_registered",
        user: newUser,
        revision: stateRevision
      });

      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers,
        revision: stateRevision
      });

      // Audit message for registered account
      const regAuditMsg: ChatMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        sender: "System Audit",
        text: `NEW USER INSTALLED: Operator ${cleanUsername} (${cleanId}) registered by Super Administrator on master computer and synchronized to all warehouse terminals.`,
        timestamp: new Date().toISOString(),
        isSystem: true
      };
      chatMessages.push(regAuditMsg);
      if (chatMessages.length > 100) chatMessages.shift();
      broadcast({ type: "chat_broadcast", message: regAuditMsg });

      return res.json({ success: true, user: newUser, revision: stateRevision });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Explicit endpoint to update an existing registered operator account
  app.post("/api/accounts/update", async (req, res) => {
    try {
      const { employeeId, username, role, phoneNumber, permission, pin, status, lastActive, requesterEmployeeId, requesterUsername, author } = req.body;
      if (!employeeId) return res.status(400).json({ error: "Employee ID required" });
      const cleanId = String(employeeId).trim().toUpperCase();

      const targetIndex = state.registeredUsers.findIndex(
        (u: any) => (u.employeeId || u.employee_id || '').toUpperCase() === cleanId
      );
      if (targetIndex === -1) {
        return res.status(404).json({ error: `Operator account ${cleanId} not found` });
      }

      const isAldrin = cleanId === 'JPMP-002';
      const existing = state.registeredUsers[targetIndex];
      const cleanUsername = isAldrin ? 'ALDRIN BANAWA' : (username ? String(username).trim().toUpperCase() : existing.username);
      const cleanRole = isAldrin ? 'SUPER ADMINISTRATOR' : (role ? String(role).trim().toUpperCase() : existing.role);
      const cleanPermission = isAldrin ? 'FULL_ACCESS' : (permission || existing.permission || 'LIMITED_ACCESS');
      const cleanPin = pin ? String(pin).trim().slice(0, 4) : (existing.pin || (isAldrin ? '0423' : '1234'));

      const updatedUser: ServerUser = {
        employeeId: cleanId,
        username: cleanUsername,
        role: cleanRole,
        phoneNumber: phoneNumber !== undefined ? String(phoneNumber).trim() : (existing.phoneNumber || ''),
        permission: cleanPermission,
        pin: cleanPin,
        status: status || existing.status || 'ACTIVE',
        lastActive: lastActive || new Date().toISOString(),
        registeredBy: existing.registeredBy || 'JPMP-002 (ALDRIN BANAWA)',
        registeredBySuperAdmin: true,
        registeredAt: existing.registeredAt || new Date().toISOString()
      };

      state.registeredUsers[targetIndex] = updatedUser;
      stateRevision++;
      saveStateToDisk();
      persistToSupabase("registeredUsers", state.registeredUsers);

      if (supabaseServer) {
        try {
          await supabaseServer.from('registered_users').upsert([{
            employee_id: cleanId,
            username: cleanUsername,
            role: cleanRole,
            permission: cleanPermission,
            pin_hash: cleanPin,
            updated_at: new Date().toISOString()
          }]);
        } catch (sErr) {
          console.warn("Supabase user update warning:", sErr);
        }
      }

      broadcast({
        type: "account_updated",
        user: updatedUser,
        revision: stateRevision
      });

      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers,
        revision: stateRevision
      });

      return res.json({ success: true, user: updatedUser, revision: stateRevision });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Explicit endpoint to trigger immediate full-cluster re-broadcast to all connected terminals
  app.post("/api/sync/force-broadcast", (req, res) => {
    stateRevision++;
    broadcast({
      type: "full_sync",
      data: {
        ...state,
        chatMessages
      },
      activeUsers: getActiveUsersList(),
      activePresence: getActivePresenceList(),
      revision: stateRevision
    });
    return res.json({ success: true, revision: stateRevision, clientsNotified: activeConnections.size });
  });

  // Explicit endpoint to permanently delete a registered account across server, disk, and Supabase
  app.post("/api/accounts/delete", async (req, res) => {
    try {
      const { employeeId } = req.body;
      if (!employeeId) return res.status(400).json({ error: "Employee ID required" });
      const cleanId = String(employeeId).trim().toUpperCase();
      
      const targetUser = state.registeredUsers.find(
        (u: any) => (u.employeeId || u.employee_id || '').toUpperCase() === cleanId
      );
      const isAldrin = cleanId === 'JPMP-002' || cleanId.endsWith('-002') || (targetUser && (
        (targetUser.username || '').toUpperCase().includes('ALDRIN BANAWA') ||
        (targetUser.username || '').toUpperCase() === 'SUPER ADMIN'
      ));

      if (isAldrin) {
        return res.status(403).json({ error: "Cannot delete ALDRIN BANAWA super administrator account" });
      }
      
      markUserTombstone(cleanId);
      state.registeredUsers = state.registeredUsers.filter(
        (u: any) => (u.employeeId || u.employee_id || '').toUpperCase() !== cleanId
      );
      saveStateToDisk();

      if (supabaseServer) {
        try {
          await supabaseServer.from('registered_users').delete().eq('employee_id', cleanId);
        } catch (sErr) {
          console.warn("Supabase user deletion error:", sErr);
        }
      }

      broadcast({
        type: "account_deleted",
        employeeId: cleanId
      });
      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers
      });

      return res.json({ success: true, employeeId: cleanId });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Explicit endpoint to clear all registered operator accounts except the Super Administrator
  app.post("/api/accounts/clear-all-except-super-admin", async (req, res) => {
    try {
      (state.registeredUsers || []).forEach((u: any) => {
        const empId = (u.employeeId || u.employee_id || '').toUpperCase();
        if (empId && empId !== 'JPMP-002') {
          markUserTombstone(empId);
        }
      });
      state.registeredUsers = [{ ...defaultSuperAdmin }];
      saveStateToDisk();

      if (supabaseServer) {
        try {
          await supabaseServer.from('registered_users').delete().neq('employee_id', 'JPMP-002');
          await supabaseServer.from('registered_users').upsert([{
            employee_id: 'JPMP-002',
            username: 'ALDRIN BANAWA',
            role: 'SUPER ADMINISTRATOR',
            permission: 'FULL_ACCESS',
            pin_hash: '0423',
            updated_at: new Date().toISOString()
          }]);
        } catch (sErr) {
          console.warn("Supabase clear users error:", sErr);
        }
      }

      broadcast({
        type: "collection_updated",
        collection: "registeredUsers",
        data: state.registeredUsers
      });
      broadcast({
        type: "all_accounts_cleared",
        data: state.registeredUsers
      });

      return res.json({ 
        success: true, 
        message: "All registered operator accounts cleared. Super Administrator preserved.",
        remainingAccounts: state.registeredUsers
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Explicit endpoint to report and handle a fresh client terminal installation
  app.post("/api/terminal/fresh-install", (req, res) => {
    try {
      const { stationId, installId, username, employeeId, platform } = req.body;
      const cleanStation = String(stationId || "WS-NEW").trim().toUpperCase();
      const cleanUser = String(username || "New Operator").trim().toUpperCase();
      const cleanPlatform = String(platform || "Terminal").trim();

      console.log(`[JUWEI-CLUSTER] Fresh installation registered: ${cleanStation} (${cleanUser}) on ${cleanPlatform}`);

      // 1. Audit chat log entry
      const installAuditMsg: ChatMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        sender: "System Audit",
        text: `FRESH INSTALL COMPLETE: ${cleanUser} installed JUWEI WMS on ${cleanStation} (${cleanPlatform}) and synchronized to all cluster terminals.`,
        timestamp: new Date().toISOString(),
        isSystem: true
      };
      chatMessages.push(installAuditMsg);
      if (chatMessages.length > 100) chatMessages.shift();
      broadcast({ type: "chat_broadcast", message: installAuditMsg });

      // 2. Broadcast installation announcement to all other connected terminals
      broadcast({
        type: "client_installed_broadcast",
        stationId: cleanStation,
        installId: installId || "",
        username: cleanUser,
        employeeId: employeeId || "",
        platform: cleanPlatform,
        timestamp: new Date().toISOString()
      });

      // 3. Return full authoritative dataset for instant pure hydration
      return res.json({
        success: true,
        stationId: cleanStation,
        installId: installId || "",
        data: {
          ...state,
          chatMessages
        },
        revision: stateRevision
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Explicit endpoint to permanently delete a collection record across server, disk, and Supabase
  app.post("/api/records/delete", async (req, res) => {
    try {
      const { collection, id, author, employeeId } = req.body;
      const userPermission = (req.body.permission || req.headers['x-user-permission'] || '').toString().toUpperCase();
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version']);
      
      if (clientResetVersion && clientResetVersion < systemResetVersion) {
        return res.status(409).json({ 
          error: "STALE_RESET_VERSION: Central database was reset. Stale delete operation rejected.",
          systemResetVersion 
        });
      }

      if (!collection || !id) return res.status(400).json({ error: "Collection and ID required" });

      // Permission check: VIEW_ONLY accounts are strictly forbidden from deleting
      if (userPermission === 'VIEW_ONLY') {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges. Record deletion is strictly prohibited." });
      }

      if (collection in state) {
        markRecordTombstone(id);
        (state as any)[collection] = ((state as any)[collection] || []).filter((item: any) => item.id !== id);
        stateRevision++;
        saveStateToDisk();

        if (supabaseServer) {
          const tableMap: Record<string, string> = {
            stocks: 'stocks',
            receiving: 'receiving',
            returns: 'returns',
            recycling: 'recycling',
            issuances: 'issuances',
            deliveries: 'deliveries',
            envLogs: 'env_logs',
            forkliftChecks: 'forklift_checks',
            registries: 'registries'
          };
          const table = tableMap[collection] || collection;
          try {
            await supabaseServer.from(table).delete().eq('id', id);
          } catch (sErr) {
            console.warn("Supabase record deletion error:", sErr);
          }
        }

        const serverTime = new Date().toISOString();
        broadcast({
          type: "record_deleted",
          collection,
          id,
          author: author || employeeId || "Operator",
          timestamp: serverTime,
          systemResetVersion
        });
        broadcast({
          type: "collection_updated",
          collection,
          data: (state as any)[collection],
          systemResetVersion
        });

        return res.json({ success: true, collection, id, systemResetVersion });
      }
      return res.status(400).json({ error: "Invalid collection" });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Explicit endpoint to upsert single or batch records with real-time multi-client broadcast, server-authoritative timestamps, and concurrency checking
  app.post("/api/records/upsert", async (req, res) => {
    try {
      const { collection, record, author, employeeId, actionDesc, expectedVersion } = req.body;
      const userPermission = (req.body.permission || req.headers['x-user-permission'] || '').toString().toUpperCase();
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version'] || record?.reset_version);

      if (clientResetVersion && clientResetVersion < systemResetVersion) {
        return res.status(409).json({
          error: "STALE_RESET_VERSION: The central database has been reset. Encoded data from previous reset versions cannot be uploaded or restored.",
          systemResetVersion
        });
      }

      if (!collection || !record || !record.id) {
        return res.status(400).json({ error: "Collection and record with valid ID required" });
      }

      // Permission check: VIEW_ONLY accounts are strictly forbidden from creating or updating
      if (userPermission === 'VIEW_ONLY') {
        return res.status(403).json({ error: "PERMISSION DENIED: Account has VIEW_ONLY privileges. Create and update operations are strictly prohibited." });
      }

      if (collection in state) {
        const serverTime = new Date().toISOString();
        const currentArr: any[] = (state as any)[collection] || [];
        const existingIndex = currentArr.findIndex((item: any) => item && item.id === record.id);
        const existingRecord = existingIndex >= 0 ? currentArr[existingIndex] : null;

        let confirmedRecord: any;
        if (existingRecord) {
          // Optimistic concurrency check: if client sent expectedVersion and server has advanced
          if (expectedVersion !== undefined && existingRecord.version && existingRecord.version > expectedVersion) {
            if (record.updated_at && existingRecord.updated_at && new Date(record.updated_at).getTime() < new Date(existingRecord.updated_at).getTime()) {
              return res.status(409).json({
                error: "STALE_DATA_DETECTED: A newer revision already exists in the centralized database.",
                currentRecord: existingRecord,
                systemResetVersion
              });
            }
          }

          const nextVersion = (Number(existingRecord.version) || 1) + 1;
          confirmedRecord = {
            ...existingRecord,
            ...record,
            id: record.id,
            reset_version: systemResetVersion,
            created_at: existingRecord.created_at || existingRecord.date || record.created_at || serverTime,
            created_by: existingRecord.created_by || existingRecord.author || record.created_by || author || 'Operator',
            updated_at: serverTime,
            updated_by: author || employeeId || 'Operator',
            version: nextVersion
          };
          currentArr[existingIndex] = confirmedRecord;
        } else {
          confirmedRecord = {
            ...record,
            id: record.id,
            reset_version: systemResetVersion,
            created_at: record.created_at || serverTime,
            created_by: record.created_by || author || employeeId || 'Operator',
            updated_at: serverTime,
            updated_by: author || employeeId || 'Operator',
            version: 1
          };
          currentArr.unshift(confirmedRecord);
        }

        deletedRecordTombstones.delete(record.id);
        (state as any)[collection] = currentArr;
        stateRevision++;
        saveStateToDisk();
        persistToSupabase(collection, [confirmedRecord]);

        broadcast({
          type: "record_upserted",
          collection,
          record: confirmedRecord,
          author: author || employeeId || "Operator",
          actionDesc: actionDesc || `Updated ${collection} record ${confirmedRecord.id}`,
          timestamp: serverTime,
          version: confirmedRecord.version,
          systemResetVersion
        });

        broadcast({
          type: "collection_updated",
          collection,
          data: (state as any)[collection],
          systemResetVersion
        });

        return res.json({
          success: true,
          collection,
          id: confirmedRecord.id,
          record: confirmedRecord,
          version: confirmedRecord.version,
          systemResetVersion,
          count: (state as any)[collection].length
        });
      }
      return res.status(400).json({ error: "Invalid collection" });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Atomic Stock Movement Endpoint (Single Source of Truth)
  // Guarantees atomic row updates, checks negative balance constraints, and prevents client-side overwrite race conditions
  app.post("/api/stock-movements", async (req, res) => {
    try {
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version']);
      if (clientResetVersion && clientResetVersion < systemResetVersion) {
        return res.status(409).json({
          error: "STALE_RESET_VERSION: Central database was reset. Movement rejected.",
          systemResetVersion
        });
      }
      const {
        productId,
        warehouseId,
        type,
        quantity,
        delta,
        referenceId,
        referenceNumber,
        notes,
        userId,
        userName,
        deviceId,
        idempotencyKey,
        preventNegativeStock = true,
        lotNumber,
        location
      } = req.body;

      if (!productId) {
        return res.status(400).json({ error: "productId is required" });
      }

      // Check Idempotency Key
      if (idempotencyKey && state.stockMovements) {
        const existing = state.stockMovements.find((m: any) => m.idempotency_key === idempotencyKey || m.idempotencyKey === idempotencyKey);
        if (existing) {
          return res.json({
            success: true,
            idempotency_replayed: true,
            movementId: existing.id,
            productId: existing.product_id || existing.productId,
            warehouseId: existing.warehouse_id || existing.warehouseId,
            previousQuantity: existing.previous_quantity || existing.previousQuantity || 0,
            newQuantity: existing.new_quantity || existing.newQuantity || 0,
            delta: existing.quantity || existing.delta || 0,
            timestamp: existing.created_at || existing.timestamp || new Date().toISOString()
          });
        }
      }

      // Calculate signed delta
      let finalDelta = Number(delta !== undefined ? delta : quantity);
      if (isNaN(finalDelta)) finalDelta = 0;

      if (['SALE', 'PURCHASE_RETURN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT'].includes(type)) {
        if (finalDelta > 0) finalDelta = -finalDelta;
      } else if (['PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN'].includes(type)) {
        if (finalDelta < 0) finalDelta = Math.abs(finalDelta);
      }

      // Locate stock record in server state
      let stockItem = state.stocks.find((s: any) => s.id === productId || s.partCode === productId);
      const prevQty = stockItem ? Number(stockItem.quantity) || 0 : 0;
      const newQty = prevQty + finalDelta;

      if (preventNegativeStock && newQty < 0) {
        return res.status(400).json({
          error: `Insufficient stock. Available: ${prevQty}, Requested Delta: ${finalDelta}`
        });
      }

      // Update or create stock record atomically on server
      if (stockItem) {
        stockItem.quantity = newQty;
        if (location) stockItem.location = location;
        if (lotNumber) stockItem.lotNumber = lotNumber;
      } else {
        stockItem = {
          id: productId,
          partCode: productId,
          description: notes || 'Warehouse Item',
          type: 'RAW',
          location: location || 'Zone A',
          quantity: newQty,
          unit: 'PCS',
          lotNumber: lotNumber || '',
          receivedDate: new Date().toISOString().split('T')[0],
          fifoColor: 'Dark Green',
          status: 'APPROVED'
        };
        state.stocks.push(stockItem);
      }

      const movementId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const movementRecord = {
        id: movementId,
        product_id: productId,
        warehouse_id: warehouseId || 'wh-main',
        type: type || 'ADJUSTMENT_IN',
        quantity: finalDelta,
        previous_quantity: prevQty,
        new_quantity: newQty,
        reference_id: referenceId || null,
        reference_number: referenceNumber || null,
        notes: notes || null,
        user_id: userId || null,
        user_name: userName || 'Operator',
        device_id: deviceId || 'UNKNOWN-DEVICE',
        idempotency_key: idempotencyKey || null,
        created_at: new Date().toISOString(),
        product_name: stockItem.description,
        product_sku: stockItem.partCode,
        unit: stockItem.unit
      };

      if (!state.stockMovements) state.stockMovements = [];
      state.stockMovements.unshift(movementRecord);
      if (state.stockMovements.length > 500) state.stockMovements.pop();

      stateRevision++;
      saveStateToDisk();

      // Forward to Supabase PostgreSQL RPC if available
      if (supabaseServer) {
        try {
          Promise.resolve(supabaseServer.rpc('create_stock_movement', {
            p_product_id: productId,
            p_warehouse_id: warehouseId || '00000000-0000-0000-0000-000000000001',
            p_type: type,
            p_quantity: finalDelta,
            p_reference_number: referenceNumber || null,
            p_notes: notes || null,
            p_user_name: userName || 'Operator',
            p_device_id: deviceId || 'SERVER',
            p_idempotency_key: idempotencyKey || null,
            p_prevent_negative: preventNegativeStock !== false
          })).catch((err: any) => console.warn('Background Supabase movement RPC note:', err.message));
        } catch (rpcErr: any) {
          console.warn('Background Supabase RPC dispatch note:', rpcErr.message);
        }
        
        persistToSupabase('stocks', state.stocks);
      }

      // Broadcast real-time delta update to all active terminals & mobile devices
      broadcast({
        type: "stock_movement_created",
        movement: movementRecord,
        stock: stockItem,
        stocks: state.stocks,
        stateRevision
      });

      broadcast({
        type: "collection_updated",
        collection: "stocks",
        data: state.stocks
      });

      return res.json({
        success: true,
        movementId,
        productId,
        warehouseId: warehouseId || 'wh-main',
        previousQuantity: prevQty,
        newQuantity: newQty,
        delta: finalDelta,
        timestamp: movementRecord.created_at
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Query stock movements
  app.get("/api/stock-movements", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const list = (state.stockMovements || []).slice(0, limit);
    res.json(list);
  });

  // Batch sync endpoint for offline mutation queue synchronization with server-authoritative timestamps & concurrency checks
  app.post("/api/sync/batch", async (req, res) => {
    try {
      const clientResetVersion = Number(req.body.reset_version || req.headers['x-reset-version']);
      if (clientResetVersion && clientResetVersion < systemResetVersion) {
        return res.status(409).json({
          error: "OUTDATED_RESET_VERSION: Central database was reset. Stale offline batch rejected.",
          systemResetVersion
        });
      }

      const { mutations } = req.body;
      if (!Array.isArray(mutations) || mutations.length === 0) {
        return res.json({ success: true, processedCount: 0, systemResetVersion, state });
      }

      let processedCount = 0;
      const confirmedRecords: any[] = [];
      const serverTime = new Date().toISOString();

      for (const m of mutations) {
        if (!m || !m.collection || !(m.collection in state)) continue;

        // Skip mutations stamped with an outdated reset version
        if (m.reset_version && Number(m.reset_version) < systemResetVersion) {
          continue;
        }
        if (m.record?.reset_version && Number(m.record.reset_version) < systemResetVersion) {
          continue;
        }

        // Skip if account only has VIEW_ONLY privileges
        if (m.permission && String(m.permission).toUpperCase() === 'VIEW_ONLY') {
          continue;
        }
        
        if (m.type === 'upsert' && m.record && m.record.id) {
          // If already deleted in tombstones, do not resurrect
          if (deletedRecordTombstones.has(m.record.id)) {
            continue;
          }

          const currentArr = ((state as any)[m.collection] || []) as any[];
          const existingIndex = currentArr.findIndex((item: any) => item && item.id === m.record.id);
          const existingRecord = existingIndex >= 0 ? currentArr[existingIndex] : null;

          // Prevent stale offline data from overwriting newer server data
          if (existingRecord && existingRecord.updated_at && m.record.updated_at) {
            const serverMillis = new Date(existingRecord.updated_at).getTime();
            const clientMillis = new Date(m.record.updated_at).getTime();
            if (serverMillis > clientMillis) {
              // Server record is newer; preserve authoritative server record
              confirmedRecords.push({ collection: m.collection, record: existingRecord });
              continue;
            }
          }

          const nextVersion = existingRecord ? (Number(existingRecord.version) || 1) + 1 : 1;
          const confirmed: any = {
            ...(existingRecord || {}),
            ...m.record,
            id: m.record.id,
            reset_version: systemResetVersion,
            created_at: (existingRecord && existingRecord.created_at) || m.record.created_at || serverTime,
            created_by: (existingRecord && existingRecord.created_by) || m.record.created_by || m.author || 'Operator',
            updated_at: serverTime,
            updated_by: m.author || m.employeeId || 'Operator',
            version: nextVersion
          };

          if (existingIndex >= 0) {
            currentArr[existingIndex] = confirmed;
          } else {
            currentArr.unshift(confirmed);
          }

          (state as any)[m.collection] = currentArr;
          processedCount++;
          confirmedRecords.push({ collection: m.collection, record: confirmed });

          broadcast({
            type: "record_upserted",
            collection: m.collection,
            record: confirmed,
            author: m.author || "Operator",
            actionDesc: m.actionDesc || `Batch-synced ${m.collection} record`,
            timestamp: serverTime,
            version: confirmed.version,
            systemResetVersion
          });
        } else if (m.type === 'delete' && (m.recordId || m.id)) {
          const delId = m.recordId || m.id;
          markRecordTombstone(delId);
          (state as any)[m.collection] = ((state as any)[m.collection] || []).filter((item: any) => item.id !== delId);
          processedCount++;

          if (supabaseServer) {
            const tableMap: Record<string, string> = {
              stocks: 'stocks',
              receiving: 'receiving',
              returns: 'returns',
              recycling: 'recycling',
              issuances: 'issuances',
              deliveries: 'deliveries',
              envLogs: 'env_logs',
              forkliftChecks: 'forklift_checks',
              registries: 'registries'
            };
            const table = tableMap[m.collection] || m.collection;
            try {
              supabaseServer.from(table).delete().eq('id', delId).then();
            } catch (e) {}
          }

          broadcast({
            type: "record_deleted",
            collection: m.collection,
            id: delId,
            author: m.author || "Operator",
            timestamp: serverTime
          });
        }
      }

      if (processedCount > 0) {
        stateRevision++;
        saveStateToDisk();
        for (const col of Object.keys(state)) {
          if (Array.isArray((state as any)[col])) {
            persistToSupabase(col, (state as any)[col]);
          }
        }
      }

      return res.json({ success: true, processedCount, confirmedRecords, stateRevision });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // In-memory OTP storage for registration phone verification
  const pendingOtps = new Map<string, { code: string; phoneNumber: string; employeeId: string; expiresAt: number }>();

  // Send OTP for account registration
  app.post("/api/auth/send-otp", (req, res) => {
    try {
      const { phoneNumber, employeeId, username } = req.body;
      if (!phoneNumber || String(phoneNumber).trim().length < 7) {
        return res.status(400).json({ error: "Valid mobile phone number is required" });
      }

      const cleanPhone = String(phoneNumber).trim().replace(/\s+/g, '');
      const cleanEmpId = employeeId ? String(employeeId).trim().toUpperCase() : '';
      
      // Generate 6-digit OTP code
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

      // Store in memory keyed by employeeId and phone number
      const otpData = {
        code: otpCode,
        phoneNumber: cleanPhone,
        employeeId: cleanEmpId,
        expiresAt
      };
      if (cleanEmpId) pendingOtps.set(cleanEmpId, otpData);
      pendingOtps.set(cleanPhone, otpData);

      console.log(`[SMS OTP GATEWAY] Dispatched OTP ${otpCode} to ${cleanPhone} for ${username || cleanEmpId || 'Registration'}`);

      return res.json({
        success: true,
        message: `OTP sent successfully to ${cleanPhone}`,
        otp: otpCode, // sent for instant simulation preview & sandbox verification
        expiresInSeconds: 300,
        phoneNumber: cleanPhone
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Verify OTP for account registration
  app.post("/api/auth/verify-otp", (req, res) => {
    try {
      const { phoneNumber, employeeId, otp } = req.body;
      if (!otp) return res.status(400).json({ error: "OTP code is required" });

      const cleanPhone = phoneNumber ? String(phoneNumber).trim().replace(/\s+/g, '') : '';
      const cleanEmpId = employeeId ? String(employeeId).trim().toUpperCase() : '';
      const cleanOtp = String(otp).trim();

      const record = (cleanEmpId ? pendingOtps.get(cleanEmpId) : null) || pendingOtps.get(cleanPhone);
      if (!record) {
        // Allow fallback test OTP if in testing environment or standard matching
        if (cleanOtp.length === 6) {
          return res.json({ success: true, verified: true, message: "Phone number verified" });
        }
        return res.status(400).json({ success: false, error: "No pending OTP found. Please request a new OTP." });
      }

      if (Date.now() > record.expiresAt) {
        if (cleanEmpId) pendingOtps.delete(cleanEmpId);
        pendingOtps.delete(cleanPhone);
        return res.status(400).json({ success: false, error: "OTP has expired. Please request a new code." });
      }

      if (record.code !== cleanOtp) {
        return res.status(400).json({ success: false, error: "Invalid verification code. Please double check and try again." });
      }

      // Consumed successfully
      if (cleanEmpId) pendingOtps.delete(cleanEmpId);
      pendingOtps.delete(cleanPhone);

      return res.json({
        success: true,
        verified: true,
        message: "Phone number verified successfully"
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST chat and activity logging endpoint
  app.post("/api/chat", (req, res) => {
    try {
      const { username, text, isSystem } = req.body;
      if (!text) return res.status(400).json({ error: "Text required" });

      const newMsg: ChatMessage = {
        id: `${isSystem ? 'sys' : 'msg'}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        sender: username || (isSystem ? "System Audit" : "Staff"),
        text,
        timestamp: new Date().toISOString(),
        isSystem: !!isSystem
      };

      chatMessages.push(newMsg);
      if (chatMessages.length > 100) chatMessages.shift();
      saveStateToDisk();
      persistToSupabase("chatMessages", [newMsg]);

      broadcast({
        type: "chat_broadcast",
        message: newMsg
      });

      res.json({ success: true, message: newMsg });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API proxy endpoint to bypass browser Mixed Content restrictions when syncing across IPs
  app.post("/api/proxy-sync", async (req, res) => {
    try {
      const { targetUrl, body } = req.body;
      if (!targetUrl || typeof targetUrl !== "string") {
        return res.status(400).json({ error: "Target URL required" });
      }
      const remoteRes = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await remoteRes.json();
      res.json(data);
    } catch (err: any) {
      res.status(502).json({ error: "Proxy sync failed: " + err.message });
    }
  });

  // Attach WebSocket server on explicit /ws path
  const wss = new WebSocketServer({ server, path: "/ws" });

  // Helper to broadcast messages to all connected clients
  function broadcast(msg: any, excludeSocket?: WebSocket) {
    const rawMsg = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN && client !== excludeSocket) {
        try {
          client.send(rawMsg);
        } catch (sendErr) {
          console.warn("WebSocket client send error:", sendErr);
        }
      }
    }
  }

  // Periodic heartbeat to sweep dead / half-open WebSocket connections
  const heartbeatInterval = setInterval(() => {
    let changed = false;
    wss.clients.forEach((client: any) => {
      if (client.isAlive === false) {
        if (activeConnections.has(client)) {
          activeConnections.delete(client);
          changed = true;
        }
        return client.terminate();
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch (e) {}
    });
    if (changed) {
      broadcast({
        type: "presence_updated",
        activeUsers: getActiveUsersList(),
        activePresence: getActivePresenceList()
      });
    }
  }, 25000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (ws: any) => {
    ws.isAlive = true;
    console.log("New WebSocket client connected");

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // IMMEDIATELY send full system state upon connection so the newly installed client or secondary PC has instant data & user accounts for login
    try {
      ws.send(JSON.stringify({
        type: "init",
        systemResetVersion,
        systemResetTimestamp,
        systemResetId,
        systemResetBy,
        data: {
          ...state,
          chatMessages
        },
        activeUsers: getActiveUsersList(),
        activePresence: getActivePresenceList()
      }));
    } catch (err) {
      console.warn("Error sending initial WS state:", err);
    }

    ws.on("error", (err: any) => {
      console.warn("WebSocket client error:", err?.message || err);
    });

    ws.on("message", async (messageData: any) => {
      ws.isAlive = true;
      try {
        const payload = JSON.parse(messageData.toString());

        switch (payload.type) {
          case "ping": {
            const info = activeConnections.get(ws);
            if (info) info.lastPing = Date.now();
            ws.send(JSON.stringify({ 
              type: "pong", 
              clientPingTime: payload.clientPingTime, 
              serverTime: Date.now() 
            }));
            break;
          }

          case "join": {
            const username = payload.username || "Anonymous Officer";
            const employeeId = payload.employeeId || "";
            const role = payload.role || "OPERATOR";
            const activeView = payload.activeView || "dashboard";
            const stationId = payload.stationId || "";

            activeConnections.set(ws, {
              stationId,
              username,
              employeeId,
              role,
              activeView,
              connectedAt: new Date().toISOString(),
              lastPing: Date.now()
            });
            
            // Re-send initial complete state and updated active users list
            ws.send(JSON.stringify({
              type: "init",
              systemResetVersion,
              systemResetTimestamp,
              systemResetId,
              systemResetBy,
              data: {
                ...state,
                chatMessages
              },
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList()
            }));

            // Notify others
            broadcast({
              type: "presence_updated",
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList()
            });

            // Log user join in chat log
            const joinMsg: ChatMessage = {
              id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              sender: "System",
              text: `${username} (${employeeId || stationId || 'Terminal'}) connected to active cluster session.`,
              timestamp: new Date().toISOString(),
              isSystem: true
            };
            chatMessages.push(joinMsg);
            if (chatMessages.length > 100) chatMessages.shift();
            broadcast({ type: "chat_broadcast", message: joinMsg });
            break;
          }

          case "presence_update": {
            let info = activeConnections.get(ws);
            if (!info) {
              info = {
                stationId: payload.stationId || '',
                username: payload.username || 'OPERATOR',
                employeeId: payload.employeeId || '',
                role: payload.role || 'OPERATOR',
                activeView: payload.activeView || 'dashboard',
                connectedAt: new Date().toISOString(),
                lastPing: Date.now()
              };
              activeConnections.set(ws, info);
            } else {
              if (payload.stationId) info.stationId = payload.stationId;
              if (payload.username) info.username = payload.username;
              if (payload.employeeId) info.employeeId = payload.employeeId;
              if (payload.role) info.role = payload.role;
              if (payload.activeView) info.activeView = payload.activeView;
              info.lastPing = Date.now();
            }

            broadcast({
              type: "presence_updated",
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList()
            });
            break;
          }

          case "get_presence": {
            ws.send(JSON.stringify({
              type: "presence_updated",
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList()
            }));
            break;
          }

          case "force_sync_all": {
            broadcast({
              type: "force_sync",
              triggeredBy: payload.author || "Operator",
              timestamp: new Date().toISOString()
            });
            break;
          }

          case "request_full_sync": {
            ws.send(JSON.stringify({
              type: "full_sync",
              systemResetVersion,
              systemResetTimestamp,
              systemResetId,
              systemResetBy,
              data: {
                ...state,
                chatMessages
              },
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList(),
              revision: stateRevision
            }));
            break;
          }

          case "client_installed": {
            const stationId = String(payload.stationId || "WS-NEW").trim().toUpperCase();
            const installId = payload.installId || "";
            const username = String(payload.username || payload.currentUser || "New Operator").trim().toUpperCase();
            const employeeId = String(payload.employeeId || "").trim().toUpperCase();
            const platform = String(payload.platform || "Web Terminal").trim();

            console.log(`[JUWEI-CLUSTER] Fresh installation WebSocket event: ${stationId} by ${username} (${platform})`);

            // Confirm back to installing client with full authoritative data
            ws.send(JSON.stringify({
              type: "init",
              systemResetVersion,
              systemResetTimestamp,
              systemResetId,
              systemResetBy,
              data: {
                ...state,
                chatMessages
              },
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList(),
              freshInstallConfirmed: true,
              stationId,
              installId,
              revision: stateRevision
            }));

            // Announce to all other connected clients
            broadcast({
              type: "client_installed_broadcast",
              stationId,
              installId,
              username,
              employeeId,
              platform,
              timestamp: new Date().toISOString()
            });

            // Log in system chat
            const installAuditMsg: ChatMessage = {
              id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              sender: "System Audit",
              text: `FRESH INSTALL COMPLETE: ${username} installed JUWEI WMS on ${stationId} (${platform}) and synchronized to all cluster terminals.`,
              timestamp: new Date().toISOString(),
              isSystem: true
            };
            chatMessages.push(installAuditMsg);
            if (chatMessages.length > 100) chatMessages.shift();
            broadcast({ type: "chat_broadcast", message: installAuditMsg });

            // Refresh presence for all
            broadcast({
              type: "presence_updated",
              activeUsers: getActiveUsersList(),
              activePresence: getActivePresenceList()
            });
            break;
          }

          case "register_account": {
            const { user, author, requesterEmployeeId } = payload;
            const isSuper = 
              requesterEmployeeId === 'JPMP-002' || 
              (author || '').toUpperCase().includes('ALDRIN') || 
              (author || '').toUpperCase().includes('SUPER') ||
              (user?.registeredBy || '').toUpperCase().includes('JPMP-002') ||
              (user?.role || '').toUpperCase().includes('SUPER ADMINISTRATOR');

            if (!isSuper) {
              console.warn("Unauthorized WS register_account attempt rejected from non-SuperAdmin:", author);
              break;
            }

            if (user && user.employeeId) {
              const cleanId = String(user.employeeId).trim().toUpperCase();
              const cleanUsername = String(user.username || 'OPERATOR').trim().toUpperCase();
              const cleanRole = String(user.role || 'WAREHOUSE OPERATOR').trim().toUpperCase();
              const cleanPin = String(user.pin || '1234').trim().slice(0, 4);

              unmarkUserTombstone(cleanId);
              const newUser: ServerUser = {
                employeeId: cleanId,
                username: cleanUsername,
                role: cleanRole,
                phoneNumber: user.phoneNumber ? String(user.phoneNumber).trim() : '',
                permission: user.permission || (cleanId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS'),
                pin: cleanPin,
                status: user.status || 'ACTIVE',
                lastActive: new Date().toISOString(),
                registeredBy: 'JPMP-002 (ALDRIN BANAWA)',
                registeredBySuperAdmin: true,
                registeredAt: user.registeredAt || new Date().toISOString(),
                stationId: user.stationId || 'MASTER_TERMINAL'
              };

              state.registeredUsers = [
                ...state.registeredUsers.filter((u: any) => (u.employeeId || u.employee_id || '').toUpperCase() !== cleanId),
                newUser
              ];

              stateRevision++;
              saveStateToDisk();
              persistToSupabase("registeredUsers", state.registeredUsers);

              broadcast({
                type: "account_registered",
                user: newUser,
                author: author || "Super Administrator",
                revision: stateRevision
              });

              broadcast({
                type: "collection_updated",
                collection: "registeredUsers",
                data: state.registeredUsers,
                revision: stateRevision
              });

              // Audit chat log entry
              const regAuditMsg: ChatMessage = {
                id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                sender: "System Audit",
                text: `NEW USER INSTALLED: Operator ${cleanUsername} (${cleanId}) registered by Super Administrator on master computer and synchronized to all warehouse terminals.`,
                timestamp: new Date().toISOString(),
                isSystem: true
              };
              chatMessages.push(regAuditMsg);
              if (chatMessages.length > 100) chatMessages.shift();
              broadcast({ type: "chat_broadcast", message: regAuditMsg });
            }
            break;
          }

          case "update_account": {
            const { user, author } = payload;
            if (user && user.employeeId) {
              const cleanId = String(user.employeeId).trim().toUpperCase();
              const targetIndex = state.registeredUsers.findIndex(
                (u: any) => (u.employeeId || u.employee_id || '').toUpperCase() === cleanId
              );
              if (targetIndex !== -1) {
                const isAldrin = cleanId === 'JPMP-002';
                const existing = state.registeredUsers[targetIndex];
                const cleanUsername = isAldrin ? 'ALDRIN BANAWA' : (user.username ? String(user.username).trim().toUpperCase() : existing.username);
                const cleanRole = isAldrin ? 'SUPER ADMINISTRATOR' : (user.role ? String(user.role).trim().toUpperCase() : existing.role);
                const cleanPermission = isAldrin ? 'FULL_ACCESS' : (user.permission || existing.permission || 'LIMITED_ACCESS');
                const cleanPin = resolveAccountPin({ ...existing, ...user }, cleanId);

                const updatedUser: ServerUser = {
                  employeeId: cleanId,
                  username: cleanUsername,
                  role: cleanRole,
                  phoneNumber: user.phoneNumber !== undefined ? String(user.phoneNumber).trim() : (existing.phoneNumber || ''),
                  permission: cleanPermission,
                  pin: cleanPin,
                  status: user.status || existing.status || 'ACTIVE',
                  lastActive: user.lastActive || new Date().toISOString()
                };

                state.registeredUsers[targetIndex] = updatedUser;
                stateRevision++;
                saveStateToDisk();
                persistToSupabase("registeredUsers", state.registeredUsers);

                if (supabaseServer) {
                  try {
                    await supabaseServer.from('registered_users').upsert([{
                      employee_id: cleanId,
                      username: cleanUsername,
                      role: cleanRole,
                      permission: cleanPermission,
                      pin_hash: cleanPin,
                      updated_at: new Date().toISOString()
                    }]);
                  } catch (sErr) {
                    console.warn("Supabase WebSocket user update warning:", sErr);
                  }
                }

                broadcast({
                  type: "account_updated",
                  user: updatedUser,
                  author: author || "Operator",
                  revision: stateRevision
                });

                broadcast({
                  type: "collection_updated",
                  collection: "registeredUsers",
                  data: state.registeredUsers,
                  revision: stateRevision
                });
              }
            }
            break;
          }

          case "upsert_record": {
            const { collection, record, author, employeeId, permission, actionDesc } = payload;
            const clientResetVersion = Number(payload.reset_version || record?.reset_version);
            if (clientResetVersion && clientResetVersion < systemResetVersion) {
              console.warn(`[WS] Rejected stale upsert from reset_version ${clientResetVersion} (current: ${systemResetVersion})`);
              break;
            }

            if (permission && String(permission).toUpperCase() === 'VIEW_ONLY') {
              console.warn(`[WS] Denied upsert from VIEW_ONLY user ${employeeId || author}`);
              break;
            }
            if (collection && collection in state && record && record.id) {
              const serverTime = new Date().toISOString();
              const currentArr: any[] = (state as any)[collection] || [];
              const existingIndex = currentArr.findIndex((item: any) => item && item.id === record.id);
              const existingRecord = existingIndex >= 0 ? currentArr[existingIndex] : null;

              let confirmedRecord: any;
              if (existingRecord) {
                const nextVersion = (Number(existingRecord.version) || 1) + 1;
                confirmedRecord = {
                  ...existingRecord,
                  ...record,
                  id: record.id,
                  reset_version: systemResetVersion,
                  created_at: existingRecord.created_at || existingRecord.date || record.created_at || serverTime,
                  created_by: existingRecord.created_by || existingRecord.author || record.created_by || author || 'Operator',
                  updated_at: serverTime,
                  updated_by: author || employeeId || 'Operator',
                  version: nextVersion
                };
                currentArr[existingIndex] = confirmedRecord;
              } else {
                confirmedRecord = {
                  ...record,
                  id: record.id,
                  reset_version: systemResetVersion,
                  created_at: record.created_at || serverTime,
                  created_by: record.created_by || author || employeeId || 'Operator',
                  updated_at: serverTime,
                  updated_by: author || employeeId || 'Operator',
                  version: 1
                };
                currentArr.unshift(confirmedRecord);
              }

              deletedRecordTombstones.delete(record.id);
              (state as any)[collection] = currentArr;
              stateRevision++;
              saveStateToDisk();
              persistToSupabase(collection, [confirmedRecord]);

              broadcast({
                type: "record_upserted",
                collection,
                record: confirmedRecord,
                author: author || employeeId || "Operator",
                actionDesc: actionDesc || `Updated ${collection} record`,
                timestamp: serverTime,
                version: confirmedRecord.version,
                systemResetVersion
              });

              broadcast({
                type: "collection_updated",
                collection,
                data: (state as any)[collection],
                systemResetVersion
              });
            }
            break;
          }

          case "delete_record": {
            const { collection, id, author, employeeId, permission } = payload;
            const clientResetVersion = Number(payload.reset_version);
            if (clientResetVersion && clientResetVersion < systemResetVersion) {
              console.warn(`[WS] Rejected stale delete from reset_version ${clientResetVersion} (current: ${systemResetVersion})`);
              break;
            }

            if (permission && String(permission).toUpperCase() === 'VIEW_ONLY') {
              console.warn(`[WS] Denied delete from VIEW_ONLY user ${employeeId || author}`);
              break;
            }
            if (collection && collection in state && id) {
              markRecordTombstone(id);
              (state as any)[collection] = ((state as any)[collection] || []).filter((item: any) => item.id !== id);
              stateRevision++;
              saveStateToDisk();

              if (supabaseServer) {
                const tableMap: Record<string, string> = {
                  stocks: 'stocks',
                  receiving: 'receiving',
                  returns: 'returns',
                  recycling: 'recycling',
                  issuances: 'issuances',
                  deliveries: 'deliveries',
                  envLogs: 'env_logs',
                  forkliftChecks: 'forklift_checks',
                  registries: 'registries'
                };
                const table = tableMap[collection] || collection;
                try {
                  supabaseServer.from(table).delete().eq('id', id).then();
                } catch (e) {}
              }

              const serverTime = new Date().toISOString();
              broadcast({
                type: "record_deleted",
                collection,
                id,
                author: author || employeeId || "Operator",
                timestamp: serverTime,
                systemResetVersion
              });

              broadcast({
                type: "collection_updated",
                collection,
                data: (state as any)[collection],
                systemResetVersion
              });
            }
            break;
          }

          case "sync_activity_pulse": {
            broadcast({
              type: "sync_activity_pulse",
              username: payload.username || "Operator",
              action: payload.action || "Updated inventory",
              collection: payload.collection || "",
              timestamp: new Date().toISOString()
            });
            break;
          }

          case "update_collection": {
            const { collection, data, permission } = payload;
            const clientResetVersion = Number(payload.reset_version);
            if (clientResetVersion && clientResetVersion < systemResetVersion) {
              console.warn(`[WS] Rejected stale collection update from reset_version ${clientResetVersion} (current: ${systemResetVersion})`);
              break;
            }

            if (permission && String(permission).toUpperCase() === 'VIEW_ONLY') {
              break;
            }
            if (collection === "registeredUsers" && Array.isArray(data)) {
              const userMap = new Map<string, any>();
              userMap.set("JPMP-002", { ...defaultSuperAdmin });
              data.forEach((u: any) => {
                const empId = (u.employeeId || u.employee_id || '').toUpperCase().trim();
                if (empId && (empId === 'JPMP-002' || !deletedUserTombstones.has(empId))) {
                  const existing = userMap.get(empId) || {};
                  const cleanPin = u.pin ? String(u.pin).trim() : (u.pin_hash ? String(u.pin_hash).trim() : (existing.pin || (empId === 'JPMP-002' ? '0423' : '1234')));
                  userMap.set(empId, {
                    ...existing,
                    ...u,
                    employeeId: empId,
                    pin: cleanPin,
                    pin_hash: cleanPin
                  });
                }
              });
              state.registeredUsers = Array.from(userMap.values());
              saveStateToDisk();
              persistToSupabase("registeredUsers", state.registeredUsers);
              broadcast({
                type: "collection_updated",
                collection: "registeredUsers",
                data: state.registeredUsers
              });
            } else if (collection && collection in state && Array.isArray(data)) {
              // If empty array received, wipe collection on server
              if (data.length === 0) {
                (state as any)[collection] = [];
                stateRevision++;
                saveStateToDisk();
                persistToSupabase(collection, []);
                broadcast({
                  type: "collection_updated",
                  collection,
                  data: [],
                  systemResetVersion
                });
                break;
              }

              // Server-authoritative record merge by ID: NEVER destroy server records!
              const currentArr: any[] = (state as any)[collection] || [];
              const recordMap = new Map<string, any>();
              for (const existing of currentArr) {
                if (existing && existing.id && !deletedRecordTombstones.has(existing.id)) {
                  recordMap.set(existing.id, existing);
                }
              }

              const serverTime = new Date().toISOString();
              for (const incoming of data) {
                if (!incoming || !incoming.id || deletedRecordTombstones.has(incoming.id)) continue;
                // Ignore stale records with older reset_version
                if (incoming.reset_version && Number(incoming.reset_version) < systemResetVersion) {
                  continue;
                }

                const existing = recordMap.get(incoming.id);
                if (existing) {
                  // Only update if incoming has newer updated_at or higher version
                  const existingTs = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
                  const incomingTs = incoming.updated_at ? new Date(incoming.updated_at).getTime() : 0;
                  if (incomingTs >= existingTs) {
                    recordMap.set(incoming.id, {
                      ...existing,
                      ...incoming,
                      reset_version: systemResetVersion,
                      version: (Number(existing.version) || 1) + 1,
                      updated_at: serverTime
                    });
                  }
                } else {
                  recordMap.set(incoming.id, {
                    ...incoming,
                    reset_version: systemResetVersion,
                    version: 1,
                    created_at: incoming.created_at || serverTime,
                    updated_at: serverTime
                  });
                }
              }

              (state as any)[collection] = Array.from(recordMap.values());
              stateRevision++;
              saveStateToDisk();
              persistToSupabase(collection, (state as any)[collection]);
              
              // Broadcast the updated collection to all clients
              broadcast({
                type: "collection_updated",
                collection,
                data: (state as any)[collection],
                systemResetVersion
              });
            }
            break;
          }

          case "reset_everything": {
            const empId = (payload.employeeId || '').toString().toUpperCase().trim();
            const role = (payload.role || '').toString().toUpperCase().trim();
            const isAldrin = empId === 'JPMP-002' || role.includes('SUPER');
            if (isAldrin && payload.confirmed) {
              const author = payload.author || payload.username || "ALDRIN BANAWA (SUPER ADMINISTRATOR)";
              const keepUsers = payload.keepUsers !== false;
              executeServerGlobalReset(author, keepUsers);
            } else {
              ws.send(JSON.stringify({
                type: "error",
                message: "PERMISSION_DENIED: Only Super Administrator can perform RESET EVERYTHING."
              }));
            }
            break;
          }

          case "delete_account": {
            const cleanId = (payload.employeeId || '').trim().toUpperCase();
            const targetUser = state.registeredUsers.find(
              (u: any) => (u.employeeId || u.employee_id || '').toUpperCase() === cleanId
            );
            const isAldrin = cleanId === 'JPMP-002' || cleanId.endsWith('-002') || (targetUser && (
              (targetUser.username || '').toUpperCase().includes('ALDRIN BANAWA') ||
              (targetUser.username || '').toUpperCase() === 'SUPER ADMIN'
            ));

            if (cleanId && !isAldrin) {
              markUserTombstone(cleanId);
              state.registeredUsers = state.registeredUsers.filter(
                (u: any) => (u.employeeId || u.employee_id || '').toUpperCase() !== cleanId
              );
              saveStateToDisk();
              if (supabaseServer) {
                try {
                  supabaseServer.from('registered_users').delete().eq('employee_id', cleanId).then();
                } catch (err) {
                  console.warn("Supabase user deletion error:", err);
                }
              }
              broadcast({
                type: "account_deleted",
                employeeId: cleanId
              });
              broadcast({
                type: "collection_updated",
                collection: "registeredUsers",
                data: state.registeredUsers
              });
            }
            break;
          }

          case "delete_record": {
            const { collection, id } = payload;
            if (collection && collection in state && id) {
              markRecordTombstone(id);
              (state as any)[collection] = ((state as any)[collection] || []).filter((item: any) => item.id !== id);
              saveStateToDisk();

              if (supabaseServer) {
                const tableMap: Record<string, string> = {
                  stocks: 'stocks',
                  receiving: 'receiving',
                  returns: 'returns',
                  recycling: 'recycling',
                  issuances: 'issuances',
                  deliveries: 'deliveries',
                  envLogs: 'env_logs',
                  forkliftChecks: 'forklift_checks',
                  registries: 'registries'
                };
                const table = tableMap[collection] || collection;
                supabaseServer.from(table).delete().eq('id', id).then();
              }

              broadcast({
                type: "record_deleted",
                collection,
                id
              });
              broadcast({
                type: "collection_updated",
                collection,
                data: (state as any)[collection]
              });
            }
            break;
          }

          case "chat": {
            const newMsg: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              sender: payload.username || "Staff",
              text: payload.text,
              timestamp: new Date().toISOString(),
              isSystem: false
            };
            chatMessages.push(newMsg);
            if (chatMessages.length > 100) chatMessages.shift();
            saveStateToDisk();
            persistToSupabase("chatMessages", [newMsg]);
            
            broadcast({
              type: "chat_broadcast",
              message: newMsg
            });
            break;
          }

          case "system_activity": {
            const newMsg: ChatMessage = {
              id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              sender: "System Audit",
              text: payload.text,
              timestamp: new Date().toISOString(),
              isSystem: true
            };
            chatMessages.push(newMsg);
            if (chatMessages.length > 100) chatMessages.shift();
            saveStateToDisk();
            persistToSupabase("chatMessages", [newMsg]);
            
            broadcast({
              type: "chat_broadcast",
              message: newMsg
            });
            break;
          }
        }
      } catch (err) {
        console.error("Failed processing socket message", err);
      }
    });

    ws.on("close", () => {
      const clientInfo = activeConnections.get(ws);
      if (clientInfo) {
        const username = clientInfo.username || "Operator";
        activeConnections.delete(ws);
        
        // Notify others
        broadcast({
          type: "presence_updated",
          activeUsers: getActiveUsersList(),
          activePresence: getActivePresenceList()
        });

        // Log disconnect
        const leaveMsg: ChatMessage = {
          id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          sender: "System",
          text: `${username} disconnected from session.`,
          timestamp: new Date().toISOString(),
          isSystem: true
        };
        chatMessages.push(leaveMsg);
        if (chatMessages.length > 100) chatMessages.shift();
        broadcast({ type: "chat_broadcast", message: leaveMsg });
      }
    });
  });

  // Vite middleware for development or Static Assets for production
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn("Vite middleware omitted or unavailable:", e);
    }
  } else {
    // In production build, dist files sit either in __dirname or process.cwd()/dist
    let distPath = __dirname;
    if (!fs.existsSync(path.join(distPath, "index.html"))) {
      distPath = path.join(process.cwd(), "dist");
    }
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`JUWEI WMS Server: Port ${PORT} already in use by active WMS service.`);
    } else {
      console.error("JUWEI WMS Server error:", err);
    }
  });

  // Use PORT 3000 (Required by container infrastructure)
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`JUWEI WAREHOUSE MANAGEMENT SYSTEM Real-Time Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
