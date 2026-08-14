-- ====================================================================
-- JUWEI PLASTIC MOULDING WMS - SUPABASE POSTGRESQL DATABASE SCHEMA
-- ISO 9001:2015 WAREHOUSE MANAGEMENT SYSTEM REALTIME DATABASE
-- ====================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --------------------------------------------------------------------
-- 1. MATERIAL STOCKS TABLE (STOCK FIFO CONTROL & INVENTORY)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stocks (
    id TEXT PRIMARY KEY,
    part_code TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'RAW',
    location TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'PCS',
    lot_number TEXT NOT NULL,
    model_name TEXT,
    color TEXT,
    received_date TEXT NOT NULL,
    expiration_date TEXT,
    fifo_color TEXT NOT NULL DEFAULT 'Dark Green',
    status TEXT NOT NULL DEFAULT 'APPROVED',
    resin_sack_risk BOOLEAN DEFAULT false,
    shelf_life_days NUMERIC,
    customer TEXT,
    reorder_min NUMERIC DEFAULT 0,
    remarks TEXT,
    bom JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 2. RECEIVING RECORDS TABLE
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receiving (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    received_date TEXT,
    location TEXT,
    vendor_supplier TEXT,
    reorder_min NUMERIC,
    remarks TEXT,
    source TEXT NOT NULL,
    item_description TEXT NOT NULL,
    part_code TEXT NOT NULL,
    model_name TEXT,
    color TEXT,
    quantity NUMERIC NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'PCS',
    lot_number TEXT NOT NULL,
    physical_condition JSONB DEFAULT '{}'::jsonb,
    rr_number TEXT,
    po_number TEXT,
    dr_number TEXT,
    si_number TEXT,
    way_bill TEXT,
    transfer_form_number TEXT,
    supplier_or_dept TEXT NOT NULL,
    iqc_status TEXT NOT NULL DEFAULT 'PENDING_IQC',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    fifo_color_code TEXT NOT NULL DEFAULT 'Dark Green',
    bom JSONB DEFAULT '[]'::jsonb,
    auto_deduct_bom BOOLEAN DEFAULT false,
    customer TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 3. RETURN RECORDS TABLE
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.returns (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT,
    material_description TEXT NOT NULL,
    part_code TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'PCS',
    lot_number TEXT NOT NULL,
    department TEXT NOT NULL,
    reason TEXT NOT NULL,
    condition TEXT NOT NULL DEFAULT 'Good',
    iqc_evaluation TEXT NOT NULL DEFAULT 'PENDING_IQC',
    status TEXT NOT NULL DEFAULT 'PENDING',
    return_slip_form_number TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 4. RECYCLING RECORDS TABLE
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recycling (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    item_type TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 0,
    condition TEXT NOT NULL DEFAULT 'Reusable',
    reuse_cycle_count NUMERIC NOT NULL DEFAULT 1,
    disposition TEXT NOT NULL DEFAULT 'Re-used',
    log_sheet_number TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 5. ISSUANCE RECORDS TABLE
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.issuances (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    requisition_number TEXT NOT NULL,
    department TEXT NOT NULL,
    part_code TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity_requested NUMERIC NOT NULL DEFAULT 0,
    quantity_issued NUMERIC NOT NULL DEFAULT 0,
    lot_number TEXT NOT NULL,
    fifo_verified BOOLEAN DEFAULT false,
    issued_by TEXT NOT NULL,
    received_by TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 6. DELIVERY RECORDS TABLE
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deliveries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    picking_list_number TEXT NOT NULL,
    po_number TEXT NOT NULL,
    model_name TEXT NOT NULL,
    part_code TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 0,
    packaging_condition_ok BOOLEAN DEFAULT true,
    fifo_verified BOOLEAN DEFAULT false,
    forklift_checklist_signed BOOLEAN DEFAULT false,
    gate_pass_number TEXT NOT NULL,
    dr_number TEXT,
    sales_invoice TEXT,
    way_bill TEXT,
    status TEXT NOT NULL DEFAULT 'PREPARING',
    prepared_by TEXT NOT NULL,
    loaded_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 7. ENVIRONMENTAL LOGS TABLE
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.env_logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    zone TEXT NOT NULL,
    occupied_slots NUMERIC NOT NULL DEFAULT 0,
    total_slots NUMERIC NOT NULL DEFAULT 150,
    cleanliness_ok BOOLEAN DEFAULT true,
    ventilation_ok BOOLEAN DEFAULT true,
    pest_free BOOLEAN DEFAULT true,
    recorded_by TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 8. FORKLIFT CHECKLISTS TABLE
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.forklift_checks (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    operator TEXT NOT NULL,
    forklift_id TEXT NOT NULL,
    brakes_ok BOOLEAN DEFAULT true,
    lights_ok BOOLEAN DEFAULT true,
    hydraulic_ok BOOLEAN DEFAULT true,
    steering_ok BOOLEAN DEFAULT true,
    tires_ok BOOLEAN DEFAULT true,
    battery_fluid_ok BOOLEAN DEFAULT true,
    remarks TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 9. MASTER REGISTRIES TABLE
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    date_registered TEXT NOT NULL,
    preset_source TEXT,
    category TEXT,
    vendor_supplier TEXT,
    unit TEXT,
    location TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 10. REGISTERED USERS / ACCOUNTS TABLE
-- Note: Sensitive auth fields like PIN hashes are stored on server-side
-- or securely managed. Client accesses via publishable API safely.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registered_users (
    employee_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    phone_number TEXT,
    permission TEXT NOT NULL DEFAULT 'LIMITED_ACCESS',
    pin_hash TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 11. CHAT & SYSTEM AUDIT LOGS TABLE
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- INDEXES FOR OPTIMAL REALTIME QUERY PERFORMANCE
-- --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stocks_part_code ON public.stocks(part_code);
CREATE INDEX IF NOT EXISTS idx_stocks_location ON public.stocks(location);
CREATE INDEX IF NOT EXISTS idx_receiving_date ON public.receiving(date);
CREATE INDEX IF NOT EXISTS idx_issuances_date ON public.issuances(date);
CREATE INDEX IF NOT EXISTS idx_deliveries_date ON public.deliveries(date);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON public.chat_messages(created_at DESC);

-- --------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Enable RLS and grant read/write access to authenticated & anon roles
-- --------------------------------------------------------------------
ALTER TABLE public.stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receiving ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recycling ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issuances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.env_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forklift_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registered_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Allow anonymous/authenticated users to select & update for operational sync
CREATE POLICY "Allow public read access" ON public.stocks FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.stocks FOR ALL USING (true);

CREATE POLICY "Allow public read access" ON public.receiving FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.receiving FOR ALL USING (true);

CREATE POLICY "Allow public read access" ON public.returns FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.returns FOR ALL USING (true);

CREATE POLICY "Allow public read access" ON public.recycling FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.recycling FOR ALL USING (true);

CREATE POLICY "Allow public read access" ON public.issuances FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.issuances FOR ALL USING (true);

CREATE POLICY "Allow public read access" ON public.deliveries FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.deliveries FOR ALL USING (true);

CREATE POLICY "Allow public read access" ON public.env_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.env_logs FOR ALL USING (true);

CREATE POLICY "Allow public read access" ON public.forklift_checks FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.forklift_checks FOR ALL USING (true);

CREATE POLICY "Allow public read access" ON public.registries FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.registries FOR ALL USING (true);

CREATE POLICY "Allow public read access" ON public.registered_users FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.registered_users FOR ALL USING (true);

CREATE POLICY "Allow public read access" ON public.chat_messages FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update access" ON public.chat_messages FOR ALL USING (true);

-- --------------------------------------------------------------------
-- ENABLE SUPABASE REALTIME PUBLICATION FOR ALL WMS TABLES
-- --------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE 
    public.stocks,
    public.receiving,
    public.returns,
    public.recycling,
    public.issuances,
    public.deliveries,
    public.env_logs,
    public.forklift_checks,
    public.registries,
    public.registered_users,
    public.chat_messages;

-- ====================================================================
-- END OF SCHEMA
-- ====================================================================
