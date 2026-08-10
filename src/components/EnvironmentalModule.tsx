/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Plus, 
  Boxes, 
  Layers, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle, 
  ShieldAlert,
  ClipboardCheck,
  Activity,
  Warehouse,
  Trash2,
  Lock,
  MapPin,
  Edit,
  Search,
  CheckCircle2,
  XCircle,
  FolderPlus
} from 'lucide-react';
import { EnvironmentalLog, StorageZone, MasterRegistryItem } from '../types';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';

interface EnvironmentalModuleProps {
  envLogs: EnvironmentalLog[];
  onAddEnvLog: (log: EnvironmentalLog) => void;
  onClearEnvLogs?: () => void;
  onDeleteEnvLog?: (id: string) => void;
  registries?: MasterRegistryItem[];
  onRegisterLocation?: (item: MasterRegistryItem) => void;
  onUpdateLocation?: (id: string, updated: Partial<MasterRegistryItem>) => void;
  onDeleteLocation?: (id: string) => void;
  isSuperAdmin?: boolean;
  currentUserRole?: string;
  currentUser?: string;
}

// Predefined capacities for each zone as helper metadata
const ZONE_CAPACITY_LIMITS: Record<StorageZone, number> = {
  'Zone A - Raw Materials': 150,
  'Zone B - Packagings': 120,
  'Zone C - WIP / Sub-parts': 200,
  'Zone D - Finished Goods': 250,
  'Zone E - Consumables': 80,
  'Quarantine Area': 50
};

export default function EnvironmentalModule({
  envLogs,
  onAddEnvLog,
  onClearEnvLogs,
  onDeleteEnvLog,
  registries = [],
  onRegisterLocation,
  onUpdateLocation,
  onDeleteLocation,
  isSuperAdmin = false,
  currentUserRole = '',
  currentUser = ''
}: EnvironmentalModuleProps) {
  const [activeTab, setActiveTab] = useState<'audits' | 'locations'>('audits');
  const [showForm, setShowForm] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);

  // States for Location Registration Modal
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<MasterRegistryItem | null>(null);
  const [locCode, setLocCode] = useState('');
  const [locName, setLocName] = useState('');
  const [locDesc, setLocDesc] = useState('');
  const [locStatus, setLocStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [locationSearchQuery, setLocationSearchQuery] = useState('');
  const [locationStatusFilter, setLocationStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const normalizedRole = currentUserRole.toUpperCase();
  const normalizedUser = currentUser.toUpperCase();

  // ONLY SUPER ADMIN AND SYSTEM ADMIN CAN CLEAR LOGS
  const isSuperOrSystemAdmin = 
    isSuperAdmin || 
    normalizedRole.includes('SUPER') || 
    normalizedRole.includes('SYSTEM') ||
    normalizedUser.includes('SUPER') ||
    normalizedUser.includes('SYSTEM');
  
  // Form states for audit log
  const [zone, setZone] = useState<StorageZone>('Zone A - Raw Materials');
  const [occupiedSlots, setOccupiedSlots] = useState(100);
  const [totalSlots, setTotalSlots] = useState(150);
  const [cleanlinessOk, setCleanlinessOk] = useState(true); // Aisles clear
  const [ventilationOk, setVentilationOk] = useState(true); // Stack height correct
  const [pestFree, setPestFree] = useState(true); // QR codes visible
  const [recordedBy, setRecordedBy] = useState('M. Gomez');

  // Filter registered location items (type === 'LOCATION')
  const locationRegistries = registries.filter(r => r.type === 'LOCATION');
  const filteredLocations = locationRegistries.filter(loc => {
    const q = locationSearchQuery.toLowerCase();
    const matchesQuery = loc.name.toLowerCase().includes(q) || 
                         loc.code.toLowerCase().includes(q) || 
                         (loc.description && loc.description.toLowerCase().includes(q));
    const matchesStatus = locationStatusFilter === 'ALL' || loc.status === locationStatusFilter;
    return matchesQuery && matchesStatus;
  });

  const handleOpenNewLocationModal = () => {
    setEditingLocation(null);
    setLocCode(`LOC-${Math.floor(100 + Math.random() * 900)}`);
    setLocName('');
    setLocDesc('');
    setLocStatus('ACTIVE');
    setShowLocationModal(true);
  };

  const handleEditLocationModal = (item: MasterRegistryItem) => {
    setEditingLocation(item);
    setLocCode(item.code);
    setLocName(item.name);
    setLocDesc(item.description || '');
    setLocStatus(item.status);
    setShowLocationModal(true);
  };

  const handleLocationFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!locCode.trim() || !locName.trim()) {
      alert('Please enter both location code and location name.');
      return;
    }

    if (editingLocation) {
      onUpdateLocation?.(editingLocation.id, {
        code: locCode.trim().toUpperCase(),
        name: locName.trim(),
        description: locDesc.trim() || undefined,
        status: locStatus
      });
    } else {
      const newItem: MasterRegistryItem = {
        id: `REG-LOC-${Date.now().toString().slice(-4)}`,
        type: 'LOCATION',
        code: locCode.trim().toUpperCase(),
        name: locName.trim(),
        description: locDesc.trim() || undefined,
        status: locStatus,
        dateRegistered: new Date().toISOString().split('T')[0]
      };
      onRegisterLocation?.(newItem);
    }

    setShowLocationModal(false);
  };

  // Dynamically update total slot suggestion when zone changes
  const handleZoneChange = (selectedZone: StorageZone) => {
    setZone(selectedZone);
    const suggestion = ZONE_CAPACITY_LIMITS[selectedZone] || 100;
    setTotalSlots(suggestion);
    setOccupiedSlots(Math.min(occupiedSlots, suggestion));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (occupiedSlots < 0 || totalSlots <= 0 || !recordedBy) {
      alert('Please fill out all fields correctly.');
      return;
    }
    if (occupiedSlots > totalSlots) {
      alert('Occupied slots cannot exceed the total available slots in this zone.');
      return;
    }

    const newLog: EnvironmentalLog = {
      id: `SPC-${Date.now().toString().slice(-4)}`,
      timestamp: new Date().toISOString(),
      zone,
      occupiedSlots,
      totalSlots,
      cleanlinessOk,
      ventilationOk,
      pestFree,
      recordedBy
    };

    onAddEnvLog(newLog);
    setShowForm(false);
  };

  // Get latest log for each zone to display live metrics
  const getLatestZoneMetrics = (targetZone: StorageZone) => {
    const logs = envLogs.filter(l => l.zone === targetZone);
    if (logs.length > 0) {
      const latest = logs[logs.length - 1];
      return {
        occupied: latest.occupiedSlots,
        total: latest.totalSlots,
        percent: (latest.occupiedSlots / latest.totalSlots) * 100,
        aislesClear: latest.cleanlinessOk,
        stackHeightOk: latest.ventilationOk,
        labelsVisible: latest.pestFree,
        timestamp: latest.timestamp,
        officer: latest.recordedBy
      };
    }
    
    // Fallback default capacity estimate
    const cap = ZONE_CAPACITY_LIMITS[targetZone] || 100;
    return {
      occupied: Math.round(cap * 0.6), // 60% default
      total: cap,
      percent: 60,
      aislesClear: true,
      stackHeightOk: true,
      labelsVisible: true,
      timestamp: new Date().toISOString(),
      officer: 'System Default'
    };
  };

  // Compile overall stats
  const zonesList: StorageZone[] = [
    'Zone A - Raw Materials',
    'Zone B - Packagings',
    'Zone C - WIP / Sub-parts',
    'Zone D - Finished Goods',
    'Zone E - Consumables',
    'Quarantine Area'
  ];

  const zoneMetricsList = zonesList.map(z => ({ zone: z, ...getLatestZoneMetrics(z) }));
  const overallOccupied = zoneMetricsList.reduce((sum, item) => sum + item.occupied, 0);
  const overallTotal = zoneMetricsList.reduce((sum, item) => sum + item.total, 0);
  const overallPercent = (overallOccupied / overallTotal) * 100;

  const isAnyZoneOverloaded = zoneMetricsList.some(item => item.percent > 92);
  const anyBlockedAisles = zoneMetricsList.some(item => !item.aislesClear);

  return (
    <div className="space-y-6" id="environmental-module">
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Boxes className="h-6 w-6 text-indigo-600" /> Storage Space & Slot Utilization
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Monitor density across active storage zones, audit pallet slot allocation limits, and verify core warehouse safety rules.
        </p>
      </div>

      {/* Overview Analytics row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" id="space-overview-cards">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm space-y-1">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Warehouse Capacity</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-800">{overallOccupied}</span>
            <span className="text-xs text-slate-400 font-semibold">/ {overallTotal} Slots</span>
          </div>
          <p className="text-[10px] text-slate-500">Live active slot occupation</p>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm space-y-1">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Utilization Rate</span>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold font-mono ${overallPercent > 90 ? 'text-rose-600' : 'text-indigo-600'}`}>
              {overallPercent.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-400 font-semibold">Avg density</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2">
            <div 
              className={`h-1.5 rounded-full ${overallPercent > 90 ? 'bg-rose-500' : 'bg-indigo-600'}`} 
              style={{ width: `${Math.min(overallPercent, 100)}%` }}
            />
          </div>
        </div>

        <div 
          onClick={() => setActiveTab('locations')}
          className={`p-4 bg-white border rounded-xl shadow-sm space-y-1 cursor-pointer transition hover:border-indigo-300 ${
            activeTab === 'locations' ? 'border-indigo-500 ring-1 ring-indigo-500/30' : 'border-slate-200'
          }`}
          title="Click to view & manage registered storage locations"
        >
          <div className="flex justify-between items-center">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Registered Locations</span>
            <MapPin className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-indigo-600">{locationRegistries.length}</span>
            <span className="text-xs text-slate-400 font-semibold">Racks / Bins</span>
          </div>
          <p className="text-[10px] text-indigo-600 font-medium">Manage Storage Locations →</p>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm space-y-1">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Safety Compliance</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            {anyBlockedAisles ? (
              <span className="text-xs bg-rose-50 border border-rose-100 text-rose-700 font-bold px-2 py-1 rounded flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Aisle Warning
              </span>
            ) : (
              <span className="text-xs bg-emerald-50 border border-emerald-100 text-emerald-700 font-bold px-2 py-1 rounded flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5" /> All Aisles Clear
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Emergency pathways clear.</p>
        </div>
      </div>

      {/* Primary Sub-Tabs Switcher */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab('audits')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'audits'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-lg'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Boxes className="h-4 w-4" /> Space & Capacity Audits
        </button>

        <button
          onClick={() => setActiveTab('locations')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'locations'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-lg'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <MapPin className="h-4 w-4" /> Registered Storage Locations & Bins ({locationRegistries.length})
        </button>
      </div>

      {activeTab === 'audits' ? (
        <>
          {/* Visual Density Zones Dashboard Grid */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4" id="zone-utilization-panel">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <Warehouse className="h-4 w-4 text-slate-500" /> Warehouse Zone Occupancy Status
              </h3>
              <span className="text-[10px] font-mono text-slate-400">Density & Visual Layout Grid</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {zoneMetricsList.map(metrics => {
                const isCritical = metrics.percent > 90;
                const isHigh = metrics.percent > 75 && metrics.percent <= 90;
                const statusColor = isCritical 
                  ? 'bg-rose-500' 
                  : isHigh 
                    ? 'bg-amber-500' 
                    : 'bg-emerald-500';

                return (
                  <div 
                    key={metrics.zone}
                    className="p-4 rounded-xl border border-slate-150 bg-slate-50/50 hover:bg-slate-50 transition-colors space-y-3"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-xs text-slate-800 truncate max-w-[170px]">{metrics.zone}</h4>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">Limit: {metrics.total} slots</p>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        isCritical 
                          ? 'bg-rose-50 text-rose-700 border border-rose-100' 
                          : isHigh 
                            ? 'bg-amber-50 text-amber-700 border border-amber-100' 
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                      }`}>
                        {metrics.percent.toFixed(0)}% Full
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${statusColor}`}
                        style={{ width: `${Math.min(metrics.percent, 100)}%` }}
                      />
                    </div>

                    {/* Quick info */}
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>Used: <strong>{metrics.occupied}</strong></span>
                      <span>Free: <strong>{metrics.total - metrics.occupied}</strong></span>
                    </div>

                    {/* Safety checklist tags */}
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-1">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm ${metrics.aislesClear ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600 border border-rose-100'}`}>
                        {metrics.aislesClear ? '✓ Aisles Clear' : '✗ Blocked Aisle'}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm ${metrics.stackHeightOk ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                        {metrics.stackHeightOk ? '✓ Stacks Secure' : '⚠ Stack Height'}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm ${metrics.labelsVisible ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200 text-slate-600'}`}>
                        {metrics.labelsVisible ? '✓ Labels Intact' : '⚠ Missing QR'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action panel */}
          <div className="flex justify-between items-center bg-slate-50 p-4 border border-slate-200 rounded-xl">
            <h3 className="font-bold text-xs text-slate-700 uppercase tracking-wider">Zone Utilization Audits Log</h3>
            {isSuperAdmin ? (
              <button 
                onClick={() => setShowForm(!showForm)}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center gap-1.5 cursor-pointer"
                id="btn-log-env"
              >
                <Plus className="h-4 w-4" /> Log Storage Audit Verification
              </button>
            ) : (
              <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded font-bold uppercase">
                🔒 View-Only Mode (Add/Edit restricted to Super Admin)
              </span>
            )}
          </div>

          {showForm && (
            <form 
              onSubmit={handleSubmit}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4"
              id="env-form"
            >
              <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                <h4 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-slate-500" /> Space Utilization Audit Form
                </h4>
                <button type="button" onClick={() => setShowForm(false)} className="text-[10px] text-slate-400">Cancel</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Select Warehouse Zone *</label>
                  <select 
                    value={zone}
                    onChange={e => handleZoneChange(e.target.value as any)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs focus:outline-none"
                  >
                    <option value="Zone A - Raw Materials">Zone A - Raw Materials</option>
                    <option value="Zone B - Packagings">Zone B - Packagings</option>
                    <option value="Zone C - WIP / Sub-parts">Zone C - WIP / Sub-parts</option>
                    <option value="Zone D - Finished Goods">Zone D - Finished Goods</option>
                    <option value="Zone E - Consumables">Zone E - Consumables</option>
                    <option value="Quarantine Area">Quarantine Area</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Occupied Pallet Slots *</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required 
                    placeholder="Occupied slots"
                    value={occupiedSlots || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const sanitized = e.target.value.replace(/\D/g, '');
                      setOccupiedSlots(sanitized ? parseInt(sanitized, 10) : 0);
                    }}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Total Available Slots *</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required 
                    placeholder="Total slots"
                    value={totalSlots || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const sanitized = e.target.value.replace(/\D/g, '');
                      setTotalSlots(sanitized ? parseInt(sanitized, 10) : 0);
                    }}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-mono animate-fadeIn"
                  />
                </div>
              </div>

              {/* Condition audit check boxes */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-3">
                <h5 className="text-[11px] font-bold text-slate-700">Safety & Standards Checks</h5>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={cleanlinessOk} onChange={e => setCleanlinessOk(e.target.checked)} className="h-4 w-4 text-indigo-600 rounded" />
                    Aisles & Pathways Clear
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={ventilationOk} onChange={e => setVentilationOk(e.target.checked)} className="h-4 w-4 text-indigo-600 rounded" />
                    Safe Pallet Stack Heights
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={pestFree} onChange={e => setPestFree(e.target.checked)} className="h-4 w-4 text-indigo-600 rounded" />
                    QR Code & Bin Labels Intact
                  </label>
                </div>
              </div>

              {occupiedSlots / totalSlots > 0.92 && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-900 rounded-lg text-xs flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-rose-500 shrink-0" />
                  <div>
                    <strong>Warning: Zone Occupancy is Critical!</strong> Occupancy above 92% is high density and restricts forklift turning space. Check overflow options.
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center border-t border-slate-100 pt-3">
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-semibold text-slate-500">Audit Officer:</label>
                  <input 
                    type="text" required value={recordedBy}
                    onChange={e => setRecordedBy(e.target.value)}
                    className="border-b border-slate-200 text-xs font-semibold focus:outline-none w-32"
                  />
                </div>
                
                <div className="flex gap-1">
                  <button type="button" onClick={() => setShowForm(false)} className="px-3.5 py-1.5 border border-slate-200 rounded text-xs cursor-pointer">Discard</button>
                  <button type="submit" className="px-3.5 py-1.5 bg-slate-900 text-white rounded text-xs font-semibold cursor-pointer">Save Space Audit</button>
                </div>
              </div>
            </form>
          )}

          {/* Logs Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="env-logs-grid">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-wrap justify-between items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Historical Space Audit Sheet Logs</span>
                <span className="text-xs font-mono text-slate-500 font-semibold">({envLogs.length} audit records)</span>
              </div>

              <div className="flex items-center gap-2">
                {isSuperOrSystemAdmin ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (envLogs.length === 0) return;
                      setConfirmAction({
                        title: 'Clear Historical Space Audit Sheet Logs',
                        message: 'Are you sure you want to permanently clear ALL historical space audit sheet logs? This action cannot be undone.',
                        confirmLabel: 'YES, CLEAR ALL LOGS',
                        confirmVariant: 'danger',
                        onConfirm: () => onClearEnvLogs?.()
                      });
                    }}
                    disabled={envLogs.length === 0}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                      envLogs.length === 0
                        ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                        : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 cursor-pointer shadow-xs'
                    }`}
                    title="Clear all historical space audit sheet logs (Super Admin / System Admin only)"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                    Clear All Audit Logs
                  </button>
                ) : (
                  <span className="text-[11px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg flex items-center gap-1" title="Only Super Admin and System Admin can clear logs">
                    <Lock className="h-3 w-3 text-slate-400 shrink-0" /> Only Super Admin & System Admin can clear logs
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-500 font-medium border-b border-slate-200">
                    <th className="p-4 font-semibold">Audit ID</th>
                    <th className="p-4 font-semibold">Logged Timestamp</th>
                    <th className="p-4 font-semibold">Target Warehouse Zone</th>
                    <th className="p-4 font-semibold text-center">Occupied Slots</th>
                    <th className="p-4 font-semibold text-center">Total Slots</th>
                    <th className="p-4 font-semibold text-center">Density Rate (%)</th>
                    <th className="p-4 font-semibold">Pathway & Stack Check</th>
                    <th className="p-4 font-semibold">Audit Officer</th>
                    <th className="p-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {envLogs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400 font-sans italic text-xs">
                        No historical space audit sheet logs recorded.
                      </td>
                    </tr>
                  ) : (
                    envLogs.slice().reverse().map(log => {
                      const isOverloaded = log.occupiedSlots / log.totalSlots > 0.92;
                      const hasSafetyViolation = !log.cleanlinessOk || !log.ventilationOk || !log.pestFree;
                      const percent = (log.occupiedSlots / log.totalSlots) * 100;
                      
                      const dateObj = new Date(log.timestamp);
                      const readableTime = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      return (
                        <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-4 font-semibold text-slate-600">{log.id}</td>
                          <td className="p-4 text-slate-600">{readableTime}</td>
                          <td className="p-4 font-sans text-slate-800 font-medium">{log.zone}</td>
                          <td className="p-4 text-center font-bold text-slate-800">{log.occupiedSlots}</td>
                          <td className="p-4 text-center text-slate-500">{log.totalSlots}</td>
                          <td className={`p-4 text-center font-bold text-sm ${isOverloaded ? 'text-rose-600' : 'text-slate-800'}`}>
                            {percent.toFixed(1)}%
                          </td>
                          <td className="p-4 font-sans">
                            {!hasSafetyViolation && !isOverloaded ? (
                              <span className="text-emerald-600 font-semibold flex items-center gap-1 text-xs">
                                <CheckCircle className="h-4 w-4" /> Optimal & Safe
                              </span>
                            ) : (
                              <span className="text-rose-600 font-bold flex items-center gap-1 text-xs" title="Blocked aisles or excessive density">
                                <AlertTriangle className="h-4 w-4" /> SOP Violation
                              </span>
                            )}
                          </td>
                          <td className="p-4 font-sans font-medium text-slate-600">{log.recordedBy}</td>
                          <td className="p-4 text-right font-sans">
                            {isSuperOrSystemAdmin ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmAction({
                                    title: 'Delete Space Audit Log Record',
                                    message: `Are you sure you want to delete space audit record ${log.id} (${log.zone})?`,
                                    confirmLabel: 'YES, DELETE LOG',
                                    confirmVariant: 'danger',
                                    onConfirm: () => onDeleteEnvLog?.(log.id)
                                  });
                                }}
                                className="px-2 py-1 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded border border-transparent hover:border-rose-200 transition cursor-pointer inline-flex items-center gap-1 text-xs font-semibold"
                                title="Delete this audit record"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-mono inline-flex items-center gap-1" title="Only Super Admin and System Admin can delete logs">
                                <Lock className="h-3 w-3" /> Locked
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Location Registration Tab Content */
        <div className="space-y-4" id="location-registration-panel">
          {/* Location Controls & Header */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 border border-slate-200 rounded-xl shadow-sm">
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto flex-1 max-w-xl">
              <div className="relative w-full sm:w-64">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Search className="h-4 w-4" />
                </span>
                <input 
                  type="text" 
                  placeholder="Search location code or name..." 
                  value={locationSearchQuery}
                  onChange={e => setLocationSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <select
                value={locationStatusFilter}
                onChange={e => setLocationStatusFilter(e.target.value as any)}
                className="w-full sm:w-auto px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:ring-1 focus:ring-indigo-500 focus:outline-none cursor-pointer"
              >
                <option value="ALL">Status</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </div>

            <button
              onClick={handleOpenNewLocationModal}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition shadow-sm cursor-pointer shrink-0"
              id="btn-register-location"
            >
              <Plus className="h-4 w-4" /> Register New Storage Location
            </button>
          </div>

          {/* Location Master Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <MapPin className="h-4 w-4 text-indigo-600" /> Storage Location Master Registry
              </h3>
              <span className="text-xs font-mono text-slate-500 font-semibold">
                Showing {filteredLocations.length} of {locationRegistries.length} registered locations
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-500 font-medium border-b border-slate-200">
                    <th className="p-4 font-semibold">Location Code</th>
                    <th className="p-4 font-semibold">Storage Location / Rack Name</th>
                    <th className="p-4 font-semibold">Description / Notes</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold">Date Registered</th>
                    <th className="p-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {filteredLocations.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400 font-sans italic text-xs">
                        {locationRegistries.length === 0 
                          ? 'No storage locations registered yet. Click "+ Register New Storage Location" to create one.'
                          : 'No storage locations found matching your search.'}
                      </td>
                    </tr>
                  ) : (
                    filteredLocations.map(loc => (
                      <tr key={loc.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 font-bold text-slate-900 font-mono">
                          <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded text-[11px]">
                            {loc.code}
                          </span>
                        </td>
                        <td className="p-4 font-sans font-semibold text-slate-800">
                          {loc.name}
                        </td>
                        <td className="p-4 font-sans text-slate-500">
                          {loc.description || '—'}
                        </td>
                        <td className="p-4 font-sans">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border inline-flex items-center gap-1 ${
                            loc.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {loc.status === 'ACTIVE' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                            {loc.status}
                          </span>
                        </td>
                        <td className="p-4 text-slate-500 font-mono">{loc.dateRegistered}</td>
                        <td className="p-4 text-right font-sans">
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => handleEditLocationModal(loc)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                              title="Edit Location"
                            >
                              <Edit className="h-3 w-3 text-slate-500" /> Edit
                            </button>
                            <button
                              onClick={() => {
                                setConfirmAction({
                                  title: 'Delete Registered Storage Location',
                                  message: `Are you sure you want to delete storage location record "${loc.name}" (${loc.code})?`,
                                  confirmLabel: 'YES, DELETE LOCATION',
                                  confirmVariant: 'danger',
                                  onConfirm: () => onDeleteLocation?.(loc.id)
                                });
                              }}
                              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded text-xs font-semibold flex items-center gap-1 transition cursor-pointer border border-rose-200"
                              title="Delete Location"
                            >
                              <Trash2 className="h-3 w-3 text-rose-600" /> Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Location Registration Modal */}
      {showLocationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <MapPin className="h-5 w-5 text-indigo-600" />
                {editingLocation ? 'Edit Storage Location' : 'Register New Storage Location'}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowLocationModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold px-2 py-1 rounded"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleLocationFormSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Location Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. LOC-ZA, RACK-A01, BIN-B04"
                  value={locCode}
                  onChange={e => setLocCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono font-semibold focus:ring-1 focus:ring-indigo-500 focus:outline-none uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Storage Location / Rack Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Zone A - Raw Materials Rack 01"
                  value={locName}
                  onChange={e => setLocName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Description / Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Heavy-duty pallet rack row for resin sacks"
                  value={locDesc}
                  onChange={e => setLocDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                <select
                  value={locStatus}
                  onChange={e => setLocStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowLocationModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-sm cursor-pointer"
                >
                  {editingLocation ? 'Save Changes' : 'Register Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
