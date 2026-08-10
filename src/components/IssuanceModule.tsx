/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  FileSpreadsheet, 
  ShieldAlert, 
  ShieldCheck, 
  CheckCircle2, 
  HelpCircle, 
  User, 
  CornerDownRight,
  Edit,
  Trash2,
  ScanLine,
  Barcode,
  Printer
} from 'lucide-react';
import { MaterialStockItem, IssuanceRecord, MasterRegistryItem } from '../types';
import BarcodeScannerModal from './BarcodeScannerModal';
import PrintablePickingListModal, { DocViewMode } from './PrintablePickingListModal';
import { ConfirmModal, ConfirmActionConfig } from './ConfirmModal';

interface IssuanceModuleProps {
  stocks: MaterialStockItem[];
  issuances: IssuanceRecord[];
  onAddIssuance: (record: IssuanceRecord) => void;
  onDeductStock: (partCode: string, lotNumber: string, quantity: number) => boolean;
  onEditIssuance?: (record: IssuanceRecord) => void;
  onDeleteIssuance?: (id: string) => void;
  isSuperAdmin?: boolean;
  registries?: MasterRegistryItem[];
}

export default function IssuanceModule({
  stocks,
  issuances,
  onAddIssuance,
  onDeductStock,
  onEditIssuance,
  onDeleteIssuance,
  isSuperAdmin = false,
  registries = []
}: IssuanceModuleProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [editingIssuance, setEditingIssuance] = useState<IssuanceRecord | null>(null);
  const [selectedPickingDocIssuance, setSelectedPickingDocIssuance] = useState<IssuanceRecord | null>(null);
  const [printInitialView, setPrintInitialView] = useState<DocViewMode>('OFFICIAL_DOC');
  const [confirmAction, setConfirmAction] = useState<ConfirmActionConfig | null>(null);

  // Form states
  const [requisitionNumber, setRequisitionNumber] = useState('');
  const [department, setDepartment] = useState('Injection Molding Dept');
  const [selectedPartCode, setSelectedPartCode] = useState('');
  const [selectedLotNumber, setSelectedLotNumber] = useState('');
  const [quantityRequested, setQuantityRequested] = useState(0);
  const [quantityIssued, setQuantityIssued] = useState(0);
  const [issuedBy, setIssuedBy] = useState('Aldrin Warehouse Staff');
  const [receivedBy, setReceivedBy] = useState('');

  // Handle scanned barcode / QR code result
  const handleScanResult = (scannedCode: string) => {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    // Search stocks for matching part code or lot number
    const matchedPart = stocks.find(s => s.partCode.toLowerCase() === cleanCode.toLowerCase());
    const matchedLot = stocks.find(s => s.lotNumber.toLowerCase() === cleanCode.toLowerCase());
    const matchedUniqueCode = uniquePartCodes.find(c => c.toLowerCase() === cleanCode.toLowerCase());

    if (matchedPart) {
      setSelectedPartCode(matchedPart.partCode);
      setShowForm(true);
    } else if (matchedLot) {
      setSelectedPartCode(matchedLot.partCode);
      setSelectedLotNumber(matchedLot.lotNumber);
      setShowForm(true);
    } else if (matchedUniqueCode) {
      setSelectedPartCode(matchedUniqueCode);
      setShowForm(true);
    } else {
      setSelectedPartCode(cleanCode.toUpperCase());
      setShowForm(true);
    }
  };

  // Derived states for FIFO checks
  const [availableLots, setAvailableLots] = useState<MaterialStockItem[]>([]);
  const [fifoAlert, setFifoAlert] = useState<string | null>(null);

  // Filter approved stock items to select from
  const approvedStocks = stocks.filter(item => item.status === 'APPROVED' && item.quantity > 0);
  
  // Unique list of part codes
  const uniquePartCodes = Array.from(new Set(approvedStocks.map(item => item.partCode)));

  // Update available lots when part code changes
  useEffect(() => {
    if (selectedPartCode) {
      const lots = approvedStocks.filter(item => item.partCode === selectedPartCode);
      setAvailableLots(lots);
      if (lots.length > 0) {
        setSelectedLotNumber(lots[0].lotNumber);
      } else {
        setSelectedLotNumber('');
      }
    } else {
      setAvailableLots([]);
      setSelectedLotNumber('');
    }
  }, [selectedPartCode, stocks]);

  // FIFO validation checks: scan all approved lots of the part code to see if an older lot is ignored
  useEffect(() => {
    if (selectedPartCode && selectedLotNumber && availableLots.length > 1) {
      // Find the currently selected lot's received date
      const selectedLotItem = availableLots.find(item => item.lotNumber === selectedLotNumber);
      if (selectedLotItem) {
        const selectedDate = new Date(selectedLotItem.receivedDate).getTime();

        // Check if there is any other lot with an earlier received date
        const olderLots = availableLots.filter(item => {
          const itemDate = new Date(item.receivedDate).getTime();
          return item.lotNumber !== selectedLotNumber && itemDate < selectedDate && item.quantity > 0;
        });

        if (olderLots.length > 0) {
          const oldestLot = olderLots.sort((a, b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime())[0];
          setFifoAlert(
            `Warning: Lot "${oldestLot.lotNumber}" (received on ${oldestLot.receivedDate}) is older than your selected Lot "${selectedLotNumber}". FIFO mandates issuing older stock first!`
          );
        } else {
          setFifoAlert(null);
        }
      }
    } else {
      setFifoAlert(null);
    }
  }, [selectedLotNumber, selectedPartCode, availableLots]);

  // Auto-fill quantity issued when requested changes
  const handleQtyRequestChange = (val: number) => {
    setQuantityRequested(val);
    setQuantityIssued(val); // Default matching
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requisitionNumber || !selectedPartCode || !selectedLotNumber || quantityIssued <= 0 || !receivedBy) {
      alert('Please complete all required fields.');
      return;
    }

    // Attempt to deduct the inventory
    const success = onDeductStock(selectedPartCode, selectedLotNumber, quantityIssued);
    if (!success) {
      alert('Error: Not enough stock quantity available in the selected lot to fulfill this issuance.');
      return;
    }

    // Retrieve full item details
    const selectedItem = approvedStocks.find(item => item.partCode === selectedPartCode && item.lotNumber === selectedLotNumber);
    const itemDesc = selectedItem ? selectedItem.description : 'Unknown Item';

    const newIssuance: IssuanceRecord = {
      id: `ISS-${Date.now().toString().slice(-4)}`,
      date: new Date().toISOString().split('T')[0],
      requisitionNumber,
      department,
      partCode: selectedPartCode,
      description: itemDesc,
      quantityRequested,
      quantityIssued,
      lotNumber: selectedLotNumber,
      fifoVerified: fifoAlert === null,
      issuedBy,
      receivedBy
    };

    onAddIssuance(newIssuance);

    // Reset
    setRequisitionNumber('');
    setSelectedPartCode('');
    setSelectedLotNumber('');
    setQuantityRequested(0);
    setQuantityIssued(0);
    setReceivedBy('');
    setShowForm(false);
  };

  const filteredIssuances = issuances.filter(iss => 
    iss.requisitionNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    iss.partCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
    iss.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    iss.department.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6" id="issuance-module">
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-xl font-bold text-slate-800">Material Issuance to Production</h2>
        <p className="text-xs text-slate-500 mt-1">
          Issue approved materials and finished sub-parts to lines, perform FIFO sequence checks, and record receiver signatures.
        </p>
      </div>

      {/* Controls Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col gap-3">
        {/* Action Buttons Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full">
          <div className="flex flex-wrap items-center gap-2 overflow-x-auto">
            <button 
              type="button"
              onClick={() => setShowScannerModal(true)}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 px-3.5 rounded-lg flex items-center justify-center gap-2 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
              id="btn-scan-issuance-barcode"
            >
              <ScanLine className="h-4 w-4" /> Scan
            </button>

            <button 
              type="button"
              onClick={() => {
                const target = filteredIssuances[0] || issuances[0];
                if (target) {
                  setPrintInitialView('OFFICIAL_DOC');
                  setSelectedPickingDocIssuance(target);
                } else {
                  alert('No material issuance records available to print.');
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-3.5 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
              id="btn-print-active-mrs"
              title="Preview & Print Official Material Requisition Slip (MRS)"
            >
              <Printer className="h-4 w-4" /> Print Requisition Slip (MRS)
            </button>

            <button 
              type="button"
              onClick={() => {
                if (filteredIssuances.length > 0 || issuances.length > 0) {
                  setPrintInitialView('SUMMARY_LOG');
                  setSelectedPickingDocIssuance(filteredIssuances[0] || issuances[0]);
                } else {
                  alert('No material issuance records available to print log summary.');
                }
              }}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 px-3.5 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
              id="btn-print-issuance-log"
              title="Print Summary Log Report of all Filtered Issuance Records"
            >
              <Printer className="h-4 w-4 text-slate-300" /> Print Summary Log
            </button>
          </div>

          <div className="flex items-center sm:ml-auto shrink-0">
            {isSuperAdmin ? (
              <button 
                onClick={() => setShowForm(!showForm)}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap shrink-0"
                id="btn-new-requisition"
              >
                <Plus className="h-4 w-4" /> Process Material Requisition
              </button>
            ) : (
              <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 rounded-lg font-bold uppercase shrink-0 whitespace-nowrap">
                🔒 View-Only Mode
              </span>
            )}
          </div>
        </div>

        {/* Search Bar at Bottom */}
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            <Search className="h-4 w-4" />
          </span>
          <input 
            type="text" 
            placeholder="Search issuances by Requisition #, Part #, Item Name, Department..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none bg-slate-50/50"
          />
        </div>
      </div>

      {/* Issuance form */}
      {showForm && (
        <form 
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6"
          id="issuance-form"
        >
          <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
            <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
              <FileSpreadsheet className="h-4 w-4 text-slate-500" /> New Material Requisition Fulfill Form (MRS)
            </h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-slate-400">Cancel</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Requisition Slip Number *</label>
              <input 
                type="text"
                required
                placeholder="e.g. REQ-2026-009"
                value={requisitionNumber}
                onChange={e => setRequisitionNumber(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Requesting Department *</label>
              <select 
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="Injection Molding Dept">Injection Molding Dept</option>
                <option value="Printing & Assembly Dept">Printing & Assembly Dept</option>
                <option value="Production Control Line A">Production Control Line A</option>
                <option value="PMC Dept">PMC Dept (Logistics)</option>
                <option value="Packaging Section B">Packaging Section B</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Part Code to Issue *</label>
              <select 
                value={selectedPartCode}
                onChange={e => setSelectedPartCode(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="">-- Choose Approved Part Code --</option>
                {uniquePartCodes.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
          </div>

          {selectedPartCode && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-4">
              <h4 className="text-xs font-bold text-slate-700">FIFO Bin & Lot Allocation Check</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Select Lot Number *</label>
                  <select 
                    value={selectedLotNumber}
                    onChange={e => setSelectedLotNumber(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white focus:outline-none"
                  >
                    {availableLots.map(lot => (
                      <option key={lot.id} value={lot.lotNumber}>
                        {lot.lotNumber} ({lot.quantity.toLocaleString()} {lot.unit.toUpperCase()} available)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Quantity Requested *</label>
                  <input 
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required
                    placeholder="Qty requested"
                    value={quantityRequested || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const sanitized = e.target.value.replace(/\D/g, '');
                      const val = sanitized ? parseInt(sanitized, 10) : 0;
                      handleQtyRequestChange(val);
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Quantity to Issue (FIFO match) *</label>
                  <input 
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required
                    placeholder="Qty issued"
                    value={quantityIssued || ''}
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                        e.preventDefault();
                      }
                    }}
                    onChange={e => {
                      const sanitized = e.target.value.replace(/\D/g, '');
                      setQuantityIssued(sanitized ? parseInt(sanitized, 10) : 0);
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white font-mono focus:outline-none"
                  />
                </div>
              </div>

              {/* FIFO Alerts & Verification Results */}
              {fifoAlert ? (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
                  <span>{fifoAlert}</span>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg text-xs flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span><strong>SOP Verification Success:</strong> Selected lot is compliant with the FIFO sequence rules for this part code.</span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Issued By (Warehouse personnel) *</label>
              <input 
                type="text"
                required
                value={issuedBy}
                onChange={e => setIssuedBy(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Received By (Production Representative Signature) *</label>
              <input 
                type="text"
                required
                placeholder="Print Full Name"
                value={receivedBy}
                onChange={e => setReceivedBy(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-slate-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-1.5 pt-2">
            <button 
              type="button" 
              onClick={() => setShowForm(false)} 
              className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50"
            >
              Discard
            </button>
            <button 
              type="submit" 
              className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800"
            >
              Verify, Issue and Update Balance
            </button>
          </div>
        </form>
      )}

      {/* Issuances Logs Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="issuance-grid-panel">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Fulfill and Issuance Log History</span>
          <span className="text-xs font-mono text-slate-500 font-semibold">{filteredIssuances.length} issuances logged</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-500 font-medium border-b border-slate-200">
                <th className="p-4 font-semibold">Issuance ID</th>
                <th className="p-4 font-semibold">Date Issued</th>
                <th className="p-4 font-semibold">Requisition #</th>
                <th className="p-4 font-semibold">Department</th>
                <th className="p-4 font-semibold">Material Code & Description</th>
                <th className="p-4 font-semibold text-right">Quantity Issued</th>
                <th className="p-4 font-semibold">Lot Issued</th>
                <th className="p-4 font-semibold">FIFO Audit</th>
                <th className="p-4 font-semibold">Authorized Signatures</th>
                <th className="p-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredIssuances.map(iss => (
                <tr key={iss.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-4 font-mono font-semibold text-slate-600">{iss.id}</td>
                  <td className="p-4 text-slate-600 font-mono">{iss.date}</td>
                  <td className="p-4">
                    <button
                      type="button"
                      onClick={() => setSelectedPickingDocIssuance(iss)}
                      className="font-mono font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer"
                      title="Click to view & print official Material Requisition Picking List"
                    >
                      <Printer className="h-3 w-3 text-indigo-500 shrink-0" />
                      <span>{iss.requisitionNumber}</span>
                    </button>
                  </td>
                  <td className="p-4 font-medium text-slate-700">{iss.department}</td>
                  <td className="p-4">
                    <div className="font-mono font-semibold text-slate-800">{iss.partCode}</div>
                    <div className="text-slate-500 text-[11px] truncate max-w-[200px]">{iss.description}</div>
                  </td>
                  <td className="p-4 text-right font-mono font-bold text-slate-850">
                    {iss.quantityIssued.toLocaleString()}
                  </td>
                  <td className="p-4 font-mono text-slate-700">{iss.lotNumber}</td>
                  <td className="p-4">
                    {iss.fifoVerified ? (
                      <span className="text-emerald-600 font-semibold flex items-center gap-1">
                        <ShieldCheck className="h-4 w-4" /> Passed FIFO
                      </span>
                    ) : (
                      <span className="text-amber-600 font-semibold flex items-center gap-1" title="Issued out of chronological order">
                        <ShieldAlert className="h-4 w-4" /> Override Warning
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-slate-600 space-y-0.5">
                    <div className="flex items-center gap-1"><User className="h-3 w-3 text-slate-400" /> <span className="text-[10px]">Staff:</span> {iss.issuedBy}</div>
                    <div className="flex items-center gap-1"><CornerDownRight className="h-3 w-3 text-slate-400" /> <span className="text-[10px]">Recv:</span> {iss.receivedBy}</div>
                  </td>
                  <td className="p-4">
                    {isSuperAdmin ? (
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'PRINT_MRS') {
                            setPrintInitialView('OFFICIAL_DOC');
                            setSelectedPickingDocIssuance(iss);
                          } else if (val === 'PRINT_PL') {
                            setPrintInitialView('PICKING_LIST');
                            setSelectedPickingDocIssuance(iss);
                          } else if (val === 'EDIT') setEditingIssuance({ ...iss });
                          else if (val === 'DELETE') {
                            setConfirmAction({
                              title: 'Delete Issuance Record',
                              message: `Are you sure you want to delete issuance record ${iss.id} (${iss.requisitionNumber})?`,
                              confirmLabel: 'YES, DELETE RECORD',
                              confirmVariant: 'danger',
                              onConfirm: () => onDeleteIssuance?.(iss.id)
                            });
                          }
                          e.target.value = '';
                        }}
                        className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-800 text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow-2xs focus:ring-1 focus:ring-indigo-500 cursor-pointer outline-none transition-colors"
                        id={`action-select-iss-${iss.id}`}
                      >
                        <option value="" disabled>Actions...</option>
                        <option value="PRINT_MRS">📄 Print Requisition Slip (MRS)</option>
                        <option value="PRINT_PL">📋 Print Picking List</option>
                        <option value="EDIT">📝 Edit Record</option>
                        <option value="DELETE">🗑️ Delete Record</option>
                      </select>
                    ) : (
                      <span className="text-slate-400 italic text-[10px]">Super Admin Only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Issuance Modal (Super Admin) */}
      {editingIssuance && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-lg w-full space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Edit className="h-4 w-4 text-indigo-600" /> Edit Registered Issuance ({editingIssuance.id})
                </h4>
                <p className="text-[11px] text-slate-500">Super Admin Record Overwrite</p>
              </div>
              <button 
                onClick={() => setEditingIssuance(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Requisition Number</label>
                <input 
                  type="text" 
                  value={editingIssuance.requisitionNumber}
                  onChange={e => setEditingIssuance({ ...editingIssuance, requisitionNumber: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Date Issued</label>
                <input 
                  type="date" 
                  value={editingIssuance.date}
                  onChange={e => setEditingIssuance({ ...editingIssuance, date: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Department</label>
                <input 
                  type="text" 
                  value={editingIssuance.department}
                  onChange={e => setEditingIssuance({ ...editingIssuance, department: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Part Code</label>
                <input 
                  type="text" 
                  value={editingIssuance.partCode}
                  onChange={e => setEditingIssuance({ ...editingIssuance, partCode: e.target.value.toUpperCase() })}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Description</label>
                <input 
                  type="text" 
                  value={editingIssuance.description}
                  onChange={e => setEditingIssuance({ ...editingIssuance, description: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Quantity Requested</label>
                <input 
                  type="text" 
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={editingIssuance.quantityRequested || ''}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  onChange={e => {
                    const sanitized = e.target.value.replace(/\D/g, '');
                    setEditingIssuance({ ...editingIssuance, quantityRequested: sanitized ? parseInt(sanitized, 10) : 0 });
                  }}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Quantity Issued</label>
                <input 
                  type="text" 
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={editingIssuance.quantityIssued || ''}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  onChange={e => {
                    const sanitized = e.target.value.replace(/\D/g, '');
                    setEditingIssuance({ ...editingIssuance, quantityIssued: sanitized ? parseInt(sanitized, 10) : 0 });
                  }}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Lot Number</label>
                <input 
                  type="text" 
                  value={editingIssuance.lotNumber}
                  onChange={e => setEditingIssuance({ ...editingIssuance, lotNumber: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Issued By</label>
                <input 
                  type="text" 
                  value={editingIssuance.issuedBy}
                  onChange={e => setEditingIssuance({ ...editingIssuance, issuedBy: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Received By</label>
                <input 
                  type="text" 
                  value={editingIssuance.receivedBy}
                  onChange={e => setEditingIssuance({ ...editingIssuance, receivedBy: e.target.value })}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs font-semibold pt-3 border-t border-slate-100">
              <button 
                onClick={() => setEditingIssuance(null)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  onEditIssuance?.(editingIssuance);
                  setEditingIssuance(null);
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold"
              >
                Save Issuance Changes
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Barcode / QR Code Scanner Modal */}
      <BarcodeScannerModal 
        isOpen={showScannerModal}
        onClose={() => setShowScannerModal(false)}
        onScanResult={handleScanResult}
        title="Issuance Material Barcode Scanner"
        subtitle="Use handheld barcode scanner, enter barcode manually, or select registered barcode preset"
        sampleCodes={
          registries.filter(r => r.type === 'BARCODE_PRESET' && r.status === 'ACTIVE').length > 0
            ? registries
                .filter(r => r.type === 'BARCODE_PRESET' && r.status === 'ACTIVE')
                .map(r => ({ code: r.code || r.id, label: r.name }))
            : undefined
        }
      />

      {/* Printable Requisition & Picking List Modal */}
      {selectedPickingDocIssuance && (
        <PrintablePickingListModal
          issuance={selectedPickingDocIssuance}
          issuancesList={filteredIssuances}
          stocks={stocks}
          registries={registries}
          initialView={printInitialView}
          onClose={() => setSelectedPickingDocIssuance(null)}
        />
      )}

      {/* Confirmation Modal with YES / NO options */}
      <ConfirmModal config={confirmAction} onClose={() => setConfirmAction(null)} />
    </div>
  );
}
