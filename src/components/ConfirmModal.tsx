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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-blue-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border-2 border-blue-200 transform transition-all text-slate-900">
        <div className="flex items-start gap-3.5 mb-4">
          <div className="p-2.5 rounded-xl shrink-0 bg-blue-100 text-blue-700">
            {confirmVariant === 'danger' ? (
              <AlertTriangle className="h-6 w-6 text-blue-800" />
            ) : confirmVariant === 'warning' ? (
              <AlertTriangle className="h-6 w-6 text-blue-800" />
            ) : (
              <Info className="h-6 w-6 text-blue-800" />
            )}
          </div>
          <div>
            <h3 className="text-base font-bold text-blue-950 leading-tight uppercase tracking-tight">{title}</h3>
            <p className="text-xs font-semibold text-slate-700 mt-1.5 leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-blue-100">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer border border-blue-200"
          >
            <XCircle className="h-4 w-4 text-blue-700" />
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <CheckCircle2 className="h-4 w-4 text-white" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

