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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100 transform transition-all">
        <div className="flex items-start gap-3.5 mb-4">
          <div className={`p-2.5 rounded-xl shrink-0 ${
            confirmVariant === 'danger' 
              ? 'bg-rose-100 text-rose-600' 
              : confirmVariant === 'warning'
              ? 'bg-amber-100 text-amber-600'
              : 'bg-indigo-100 text-indigo-600'
          }`}>
            {confirmVariant === 'danger' ? (
              <AlertTriangle className="h-6 w-6" />
            ) : confirmVariant === 'warning' ? (
              <AlertTriangle className="h-6 w-6" />
            ) : (
              <Info className="h-6 w-6" />
            )}
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 leading-tight">{title}</h3>
            <p className="text-xs font-medium text-slate-600 mt-1.5 leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <XCircle className="h-4 w-4 text-slate-500" />
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`px-5 py-2 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer ${
              confirmVariant === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800'
                : confirmVariant === 'warning'
                ? 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800'
                : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800'
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
