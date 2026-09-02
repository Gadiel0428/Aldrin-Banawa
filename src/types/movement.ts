/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  reference_id?: string;
  reference_number?: string; // e.g., PO-1029, ISS-9921, DEL-3301
  notes?: string;
  user_id?: string;
  user_name?: string;
  device_id?: string;
  idempotency_key?: string;
  created_at: string;
  
  // Relational details
  product_sku?: string;
  product_name?: string;
  warehouse_name?: string;
  unit?: string;
  lot_number?: string;
  location?: string;
}

export interface CreateStockMovementInput {
  productId: string;
  warehouseId: string;
  type: StockMovementType;
  quantity: number; // Absolute quantity or delta
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
}

export interface StockMovementResult {
  success: boolean;
  movementId?: string;
  productId: string;
  warehouseId: string;
  previousQuantity: number;
  newQuantity: number;
  delta: number;
  timestamp: string;
  error?: string;
}
