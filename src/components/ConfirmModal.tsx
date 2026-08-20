import React from 'react';
import { AlertTriangle, CheckCircle2, XCircle, Info } from 'lucide-react';

export interface ConfirmActionConfig {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'danger' | 'primary' | 'warning';
  onConfirm: () => void;
  onCancel?: () => void;
}

interface ConfirmModalProps {
  config: ConfirmActionConfig | null;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ config, onClose }) => {
  if (!config) return null;

  const {
    title,
    message,
    confirmLabel = 'YES',
    cancelLabel = 'NO',
    confirmVariant = 'danger',
    onConfirm,
    onCancel,
  } = config;

  const handleCancel = () => {
    if (onCancel) onCancel();
    onClose();
  };

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 border border-slate-300 transform transition-all text-slate-900">
        <div className="flex items-start gap-3.5 mb-4">
          <div className="p-2.5 rounded-2xl shrink-0 bg-blue-50 text-blue-700 border border-blue-200">
            {confirmVariant === 'danger' ? (
              <AlertTriangle className="h-6 w-6 text-rose-600" />
            ) : confirmVariant === 'warning' ? (
              <AlertTriangle className="h-6 w-6 text-amber-600" />
            ) : (
              <Info className="h-6 w-6 text-blue-600" />
            )}
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-900 leading-tight uppercase tracking-tight">{title}</h3>
            <p className="text-xs font-semibold text-slate-600 mt-1.5 leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer border border-slate-300"
          >
            <XCircle className="h-4 w-4 text-slate-500" />
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`px-5 py-2 text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer border ${
              confirmVariant === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 shadow-rose-600/20'
                : confirmVariant === 'warning'
                ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600 shadow-amber-600/20'
                : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 shadow-blue-600/20'
            }`}
          >
            <CheckCircle2 className="h-4 w-4 text-white" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

