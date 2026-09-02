-- ==============================================================================
-- 001_inventory.sql: Centralized Real-time Inventory & Atomic Movements Migration
-- JUWEI WMS & Multi-Device Inventory Sync Architecture
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. COMPANIES & ORGANIZATIONS
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. WAREHOUSES & LOCATIONS
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    location TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PRODUCTS & MASTER SKUS
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    sku TEXT UNIQUE NOT NULL,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'RAW',
    type TEXT DEFAULT 'RAW',
    unit TEXT NOT NULL DEFAULT 'PCS',
    cost NUMERIC(12,2) DEFAULT 0,
    price NUMERIC(12,2) DEFAULT 0,
    min_stock NUMERIC(12,3) DEFAULT 0,
    model_name TEXT,
    color TEXT,
    shelf_life_days INTEGER DEFAULT 365,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CURRENT CALCULATED INVENTORY (Single Source of Truth per Product + Warehouse)
CREATE TABLE IF NOT EXISTS inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    location TEXT,
    lot_number TEXT,
    fifo_color TEXT,
    status TEXT DEFAULT 'APPROVED',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_product_warehouse UNIQUE (product_id, warehouse_id)
);

-- 5. ATOMIC STOCK MOVEMENTS AUDIT / EVENT LOG (Immutable Ledger)
CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    type TEXT NOT NULL, -- PURCHASE, SALE, SALE_RETURN, PURCHASE_RETURN, ADJUSTMENT_IN, ADJUSTMENT_OUT, TRANSFER_IN, TRANSFER_OUT, RECYCLING
    quantity NUMERIC(12,3) NOT NULL, -- Signed value (+ for addition, - for reduction)
    previous_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    new_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    reference_id UUID,
    reference_number TEXT,
    notes TEXT,
    user_id UUID,
    user_name TEXT,
    device_id TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for lightning-fast queries
CREATE INDEX IF NOT EXISTS idx_stock_movements_prod_wh ON stock_movements(product_id, warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_idemp ON stock_movements(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_inventory_prod_wh ON inventory(product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

-- 6. PURCHASES / RECEIVING
CREATE TABLE IF NOT EXISTS purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id),
    po_number TEXT UNIQUE,
    supplier_name TEXT,
    status TEXT DEFAULT 'RECEIVED',
    total_cost NUMERIC(12,2) DEFAULT 0,
    received_by TEXT,
    device_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID REFERENCES purchases(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    quantity NUMERIC(12,3) NOT NULL,
    unit_cost NUMERIC(12,2) DEFAULT 0,
    lot_number TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. SALES / ISSUANCE / DELIVERIES
CREATE TABLE IF NOT EXISTS sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id),
    issuance_number TEXT UNIQUE,
    customer_or_station TEXT,
    status TEXT DEFAULT 'COMPLETED',
    issued_by TEXT,
    device_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    quantity NUMERIC(12,3) NOT NULL,
    unit_price NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TRANSFERS
CREATE TABLE IF NOT EXISTS transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_number TEXT UNIQUE,
    source_warehouse_id UUID REFERENCES warehouses(id),
    destination_warehouse_id UUID REFERENCES warehouses(id),
    status TEXT DEFAULT 'COMPLETED',
    transferred_by TEXT,
    device_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transfer_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID REFERENCES transfers(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    quantity NUMERIC(12,3) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. CLIENT OFFLINE SYNC AUDIT QUEUE (For server inspection & idempotency tracking)
CREATE TABLE IF NOT EXISTS sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT UNIQUE NOT NULL,
    device_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- ==============================================================================
-- 10. ATOMIC STORED PROCEDURE: create_stock_movement
-- Guarantees ACID atomic consistency across multiple simultaneous devices.
-- Prevents race condition overwrites and checks negative inventory constraints.
-- ==============================================================================

CREATE OR REPLACE FUNCTION create_stock_movement(
    p_product_id UUID,
    p_warehouse_id UUID,
    p_type TEXT,
    p_quantity NUMERIC,
    p_reference_id UUID DEFAULT NULL,
    p_reference_number TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_user_name TEXT DEFAULT NULL,
    p_device_id TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_prevent_negative BOOLEAN DEFAULT TRUE,
    p_lot_number TEXT DEFAULT NULL,
    p_location TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_qty NUMERIC(12,3) := 0;
    v_new_qty NUMERIC(12,3) := 0;
    v_movement_id UUID;
    v_existing_movement JSONB;
BEGIN
    -- Step A: Check Idempotency (Prevent Duplicate Processing from Network Retries)
    IF p_idempotency_key IS NOT NULL THEN
        SELECT jsonb_build_object(
            'success', true,
            'idempotency_replayed', true,
            'movement_id', id,
            'product_id', product_id,
            'warehouse_id', warehouse_id,
            'previous_quantity', previous_quantity,
            'new_quantity', new_quantity,
            'delta', quantity,
            'created_at', created_at
        ) INTO v_existing_movement
        FROM stock_movements
        WHERE idempotency_key = p_idempotency_key;

        IF v_existing_movement IS NOT NULL THEN
            RETURN v_existing_movement;
        END IF;
    END IF;

    -- Step B: Acquire Row-Level Lock on Inventory Record FOR UPDATE
    -- Insert default row if none exists yet
    INSERT INTO inventory (product_id, warehouse_id, quantity, updated_at)
    VALUES (p_product_id, p_warehouse_id, 0, NOW())
    ON CONFLICT (product_id, warehouse_id) DO NOTHING;

    SELECT quantity INTO v_current_qty
    FROM inventory
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
    FOR UPDATE;

    IF v_current_qty IS NULL THEN
        v_current_qty := 0;
    END IF;

    -- Step C: Calculate New Quantity
    v_new_qty := v_current_qty + p_quantity;

    -- Step D: Enforce Business Rule (Prevent Negative Stock)
    IF p_prevent_negative AND v_new_qty < 0 THEN
        RAISE EXCEPTION 'Insufficient stock. Available: %, Requested Delta: %', v_current_qty, p_quantity
            USING ERRCODE = 'P0001';
    END IF;

    -- Step E: Update Inventory Table Atomically
    UPDATE inventory
    SET quantity = v_new_qty,
        location = COALESCE(p_location, location),
        lot_number = COALESCE(p_lot_number, lot_number),
        updated_at = NOW()
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;

    -- Step F: Record Movement in Audit Log
    INSERT INTO stock_movements (
        product_id,
        warehouse_id,
        type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_id,
        reference_number,
        notes,
        user_id,
        user_name,
        device_id,
        idempotency_key,
        created_at
    ) VALUES (
        p_product_id,
        p_warehouse_id,
        p_type,
        p_quantity,
        v_current_qty,
        v_new_qty,
        p_reference_id,
        p_reference_number,
        p_notes,
        p_user_id,
        p_user_name,
        p_device_id,
        p_idempotency_key,
        NOW()
    )
    RETURNING id INTO v_movement_id;

    -- Step G: Return Success Result JSON
    RETURN jsonb_build_object(
        'success', true,
        'movement_id', v_movement_id,
        'product_id', p_product_id,
        'warehouse_id', p_warehouse_id,
        'previous_quantity', v_current_qty,
        'new_quantity', v_new_qty,
        'delta', p_quantity,
        'timestamp', NOW()
    );
END;
$$;

-- Enable Realtime publication for tables
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE products, warehouses, inventory, stock_movements, sales, purchases, transfers;
    END IF;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;
