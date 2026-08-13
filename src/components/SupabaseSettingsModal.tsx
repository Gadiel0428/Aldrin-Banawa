/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Database, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Copy, 
  Check, 
  Key, 
  Globe, 
  ShieldCheck, 
  Layers, 
  Terminal, 
  Server,
  X,
  Zap,
  Eye,
  EyeOff,
  ExternalLink
} from 'lucide-react';
import { 
  getStoredSupabaseConfig, 
  saveStoredSupabaseConfig, 
  isSupabaseConfigured, 
  getSupabase,
  processPendingSupabaseMutations,
  testSupabaseConnection
} from '../lib/supabase';

interface SupabaseSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  onForceSync: () => void;
}

export default function SupabaseSettingsModal({
  isOpen,
  onClose,
  connectionStatus,
  onForceSync
}: SupabaseSettingsModalProps) {
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const current = getStoredSupabaseConfig();
      setUrl(current.url);
      setAnonKey(current.anonKey);
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    let cleanUrl = url.trim();
    if (cleanUrl && !cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
      setUrl(cleanUrl);
    }
    const cleanKey = anonKey.trim();

    if (!cleanUrl || !cleanKey) {
      setTestResult({
        success: false,
        message: 'Please enter both your Supabase Project URL and Anon Public API Key.'
      });
      return;
    }

    if (cleanUrl.toLowerCase().includes('your-project-id')) {
      setTestResult({
        success: false,
        message: 'Please replace the placeholder URL with your actual Supabase Project URL (e.g. https://abc123xyz.supabase.co).'
      });
      return;
    }

    saveStoredSupabaseConfig({ url: cleanUrl, anonKey: cleanKey });
    
    // Broadcast config to central server so all other network PCs receive it automatically
    fetch('/api/supabase-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: cleanUrl, anonKey: cleanKey })
    }).catch(() => {});

    const testRes = await testSupabaseConnection();
    setTestResult(testRes);

    if (testRes.success) {
      await processPendingSupabaseMutations();
      onForceSync();
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);

    let cleanUrl = url.trim();
    if (cleanUrl && !cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
      setUrl(cleanUrl);
    }
    const cleanKey = anonKey.trim();

    if (!cleanUrl || !cleanKey) {
      setTestResult({
        success: false,
        message: 'Please enter your Supabase Project URL and Anon API Key from your Supabase Dashboard (Project Settings > API).'
      });
      setTestingConnection(false);
      return;
    }

    if (cleanUrl.toLowerCase().includes('your-project-id')) {
      setTestResult({
        success: false,
        message: 'Please replace the placeholder URL (https://your-project-id.supabase.co) with your real Supabase Project URL from Project Settings > API.'
      });
      setTestingConnection(false);
      return;
    }

    try {
      saveStoredSupabaseConfig({ url: cleanUrl, anonKey: cleanKey });
      
      const testRes = await testSupabaseConnection();
      setTestResult(testRes);

      if (testRes.success) {
        fetch('/api/supabase-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cleanUrl, anonKey: cleanKey })
        }).catch(() => {});

        await processPendingSupabaseMutations();
        onForceSync();
      }
    } catch (err: any) {
      setTestResult({ success: false, message: `Error testing connection: ${err?.message || 'Failed to reach Supabase server.'}` });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleCopySchemaSql = () => {
    const sqlSchemaText = `-- JUWEI PLASTIC MOULDING WMS - SUPABASE POSTGRESQL SCHEMA
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.stocks (id TEXT PRIMARY KEY, part_code TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'RAW', location TEXT NOT NULL, quantity NUMERIC NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'PCS', lot_number TEXT NOT NULL, model_name TEXT, color TEXT, received_date TEXT NOT NULL, expiration_date TEXT, fifo_color TEXT NOT NULL DEFAULT 'Dark Green', status TEXT NOT NULL DEFAULT 'APPROVED', resin_sack_risk BOOLEAN DEFAULT false, shelf_life_days NUMERIC, customer TEXT, reorder_min NUMERIC DEFAULT 0, remarks TEXT, bom JSONB DEFAULT '[]'::jsonb, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.receiving (id TEXT PRIMARY KEY, date TEXT NOT NULL, received_date TEXT, location TEXT, vendor_supplier TEXT, reorder_min NUMERIC, remarks TEXT, source TEXT NOT NULL, item_description TEXT NOT NULL, part_code TEXT NOT NULL, model_name TEXT, color TEXT, quantity NUMERIC NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'PCS', lot_number TEXT NOT NULL, physical_condition JSONB DEFAULT '{}'::jsonb, rr_number TEXT, po_number TEXT, dr_number TEXT, si_number TEXT, way_bill TEXT, transfer_form_number TEXT, supplier_or_dept TEXT NOT NULL, iqc_status TEXT NOT NULL DEFAULT 'PENDING_IQC', status TEXT NOT NULL DEFAULT 'DRAFT', fifo_color_code TEXT NOT NULL DEFAULT 'Dark Green', bom JSONB DEFAULT '[]'::jsonb, auto_deduct_bom BOOLEAN DEFAULT false, customer TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.returns (id TEXT PRIMARY KEY, date TEXT NOT NULL, category TEXT, material_description TEXT NOT NULL, part_code TEXT NOT NULL, quantity NUMERIC NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'PCS', lot_number TEXT NOT NULL, department TEXT NOT NULL, reason TEXT NOT NULL, condition TEXT NOT NULL DEFAULT 'Good', iqc_evaluation TEXT NOT NULL DEFAULT 'PENDING_IQC', status TEXT NOT NULL DEFAULT 'PENDING', return_slip_form_number TEXT NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.recycling (id TEXT PRIMARY KEY, date TEXT NOT NULL, item_type TEXT NOT NULL, quantity NUMERIC NOT NULL DEFAULT 0, condition TEXT NOT NULL DEFAULT 'Reusable', reuse_cycle_count NUMERIC NOT NULL DEFAULT 1, disposition TEXT NOT NULL DEFAULT 'Re-used', log_sheet_number TEXT NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.issuances (id TEXT PRIMARY KEY, date TEXT NOT NULL, requisition_number TEXT NOT NULL, department TEXT NOT NULL, part_code TEXT NOT NULL, description TEXT NOT NULL, quantity_requested NUMERIC NOT NULL DEFAULT 0, quantity_issued NUMERIC NOT NULL DEFAULT 0, lot_number TEXT NOT NULL, fifo_verified BOOLEAN DEFAULT false, issued_by TEXT NOT NULL, received_by TEXT NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.deliveries (id TEXT PRIMARY KEY, date TEXT NOT NULL, picking_list_number TEXT NOT NULL, po_number TEXT NOT NULL, model_name TEXT NOT NULL, part_code TEXT NOT NULL, quantity NUMERIC NOT NULL DEFAULT 0, packaging_condition_ok BOOLEAN DEFAULT true, fifo_verified BOOLEAN DEFAULT false, forklift_checklist_signed BOOLEAN DEFAULT false, gate_pass_number TEXT NOT NULL, dr_number TEXT, sales_invoice TEXT, way_bill TEXT, status TEXT NOT NULL DEFAULT 'PREPARING', prepared_by TEXT NOT NULL, loaded_by TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.env_logs (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, zone TEXT NOT NULL, occupied_slots NUMERIC NOT NULL DEFAULT 0, total_slots NUMERIC NOT NULL DEFAULT 150, cleanliness_ok BOOLEAN DEFAULT true, ventilation_ok BOOLEAN DEFAULT true, pest_free BOOLEAN DEFAULT true, recorded_by TEXT NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.forklift_checks (id TEXT PRIMARY KEY, date TEXT NOT NULL, operator TEXT NOT NULL, forklift_id TEXT NOT NULL, brakes_ok BOOLEAN DEFAULT true, lights_ok BOOLEAN DEFAULT true, hydraulic_ok BOOLEAN DEFAULT true, steering_ok BOOLEAN DEFAULT true, tires_ok BOOLEAN DEFAULT true, battery_fluid_ok BOOLEAN DEFAULT true, remarks TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.registries (id TEXT PRIMARY KEY, type TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', date_registered TEXT NOT NULL, preset_source TEXT, category TEXT, vendor_supplier TEXT, unit TEXT, location TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.registered_users (employee_id TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL, permission TEXT NOT NULL DEFAULT 'LIMITED_ACCESS', pin_hash TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.chat_messages (id TEXT PRIMARY KEY, sender TEXT NOT NULL, text TEXT NOT NULL, timestamp TEXT NOT NULL, is_system BOOLEAN DEFAULT false, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());

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

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF; END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stocks, public.receiving, public.returns, public.recycling, public.issuances, public.deliveries, public.env_logs, public.forklift_checks, public.registries, public.registered_users, public.chat_messages;
`;

    navigator.clipboard.writeText(sqlSchemaText);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden text-slate-100 my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-white">Supabase Cloud Database & Realtime Sync</h3>
              <p className="text-xs text-slate-400">PostgreSQL Multi-PC Sync & Offline Resilience Engine</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6">
          {/* Realtime Status Indicator Card */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="relative">
                <div className={`w-3.5 h-3.5 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
                  connectionStatus === 'connecting' ? 'bg-amber-500 animate-bounce' : 'bg-rose-500'
                }`} />
                {connectionStatus === 'connected' && (
                  <div className="absolute -inset-1 rounded-full bg-emerald-500/30 animate-ping" />
                )}
              </div>
              <div>
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 block">
                  Synchronization Engine Status
                </span>
                <span className="text-sm font-bold text-white">
                  {connectionStatus === 'connected' ? 'SUPABASE REALTIME CONNECTED & ACTIVE' :
                   connectionStatus === 'connecting' ? 'CONNECTING TO SUPABASE CLOUD...' :
                   'OFFLINE CACHE ACTIVE (LOCAL RESILIENCE MODE)'}
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                processPendingSupabaseMutations();
                onForceSync();
              }}
              className="flex items-center space-x-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg transition-colors border border-slate-700"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Force Sync</span>
            </button>
          </div>

          {/* Test Result Message */}
          {testResult && (
            <div className={`p-4 rounded-xl border flex items-start space-x-3 text-sm ${
              testResult.success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              )}
              <div className="break-words font-medium">{testResult.message}</div>
            </div>
          )}

          {/* Form Credentials */}
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 block mb-1.5">
                Supabase Project URL
              </label>
              <div className="relative">
                <Globe className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                <input 
                  type="text" 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-project-id.supabase.co"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Found in your Supabase Project Settings &gt; API</p>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 block mb-1.5">
                Supabase Anon / Public API Key
              </label>
              <div className="relative">
                <Key className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                <input 
                  type={showKey ? "text" : "password"} 
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-10 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 transition-colors"
                  title={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Publishable key safe for client-side multi-PC synchronization.</p>
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingConnection}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs py-2.5 rounded-lg transition-colors border border-slate-700 flex items-center justify-center space-x-2"
              >
                {testingConnection ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-amber-400" />}
                <span>{testingConnection ? 'Testing...' : 'Test Connection'}</span>
              </button>

              <button
                type="submit"
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2.5 rounded-lg transition-colors shadow-lg shadow-emerald-900/30 flex items-center justify-center space-x-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Save Credentials</span>
              </button>
            </div>
          </form>

          {/* Database Setup Helper Section */}
          <div className="pt-4 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Supabase Database Setup SQL
                </h4>
              </div>

              <button
                type="button"
                onClick={handleCopySchemaSql}
                className="flex items-center space-x-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-950/50 border border-emerald-800/50 px-2.5 py-1 rounded transition-colors"
              >
                {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSql ? 'Copied SQL!' : 'Copy Schema SQL'}</span>
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              To setup or reset your Supabase project, copy the SQL above and run it in the{' '}
              <strong className="text-slate-200">Supabase SQL Editor</strong>. It automatically configures all 11 WMS tables, Row Level Security policies, indexes, and Realtime publications.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 text-right">
          <button
            onClick={onClose}
            className="text-xs font-semibold text-slate-400 hover:text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            Close Window
          </button>
        </div>
      </div>
    </div>
  );
}
