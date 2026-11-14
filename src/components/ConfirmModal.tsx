import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle2, XCircle, Info, RefreshCw } from 'lucide-react';

export interface ConfirmActionConfig {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'danger' | 'primary' | 'warning';
  requiredConfirmationWord?: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

interface ConfirmModalProps {
  config: ConfirmActionConfig | null;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ config, onClose }) => {
  const [typedWord, setTypedWord] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    setTypedWord('');
    setIsProcessing(false);
  }, [config]);

  const handleCancel = () => {
    if (isProcessing) return;
    if (config?.onCancel) config.onCancel();
    onClose();
  };

  const isConfirmed = !config?.requiredConfirmationWord || 
    typedWord.trim().toUpperCase() === config.requiredConfirmationWord.trim().toUpperCase();

  const handleConfirm = async () => {
    if (!isConfirmed || isProcessing) return;
    setIsProcessing(true);
    try {
      await config?.onConfirm();
      onClose();
    } catch (e) {
      console.error('Error during confirmed action:', e);
    } finally {
      setIsProcessing(false);
    }
  };

  const content = (
    <AnimatePresence>
      {config && (
        <motion.div
          key="confirm-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto"
        >
          <motion.div
            key="confirm-modal-content"
            initial={{ opacity: 0, scale: 0.94, y: 14, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.94, y: 14, filter: 'blur(8px)' }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="frosted-glass-modal-light rounded-3xl shadow-2xl max-w-md w-full p-6 border border-white/80 text-slate-900 my-auto"
          >
            <div className="flex items-start gap-3.5 mb-4">
              <div className="p-2.5 rounded-2xl shrink-0 bg-blue-50/90 text-blue-700 border border-blue-200/80 backdrop-blur-md">
                {config.confirmVariant === 'danger' ? (
                  <AlertTriangle className="h-6 w-6 text-rose-600" />
                ) : config.confirmVariant === 'warning' ? (
                  <AlertTriangle className="h-6 w-6 text-amber-600" />
                ) : (
                  <Info className="h-6 w-6 text-blue-600" />
                )}
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900 leading-tight uppercase tracking-tight">{config.title}</h3>
                <p className="text-xs font-semibold text-slate-600 mt-1.5 leading-relaxed">{config.message}</p>
              </div>
            </div>

            {config.requiredConfirmationWord && (
              <div className="mb-4 p-3 rounded-2xl bg-rose-50/80 border border-rose-200 text-slate-800 space-y-2">
                <label className="block text-xs font-semibold text-rose-950">
                  Type <span className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-rose-300 text-rose-700 select-all">{config.requiredConfirmationWord}</span> to authorize:
                </label>
                <input
                  type="text"
                  autoFocus
                  placeholder={`Type "${config.requiredConfirmationWord}"`}
                  value={typedWord}
                  onChange={(e) => setTypedWord(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-rose-300 rounded-xl text-xs font-mono font-bold uppercase tracking-wider text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 shadow-inner"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200/80">
              <button
                type="button"
                onClick={handleCancel}
                disabled={isProcessing}
                className="px-4 py-2 bg-slate-100/90 hover:bg-slate-200 disabled:opacity-50 text-slate-800 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-slate-300/80 backdrop-blur-md"
              >
                <XCircle className="h-4 w-4 text-slate-500" />
                {config.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!isConfirmed || isProcessing}
                className={`px-5 py-2 text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${
                  config.confirmVariant === 'danger'
                    ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 shadow-rose-600/20'
                    : config.confirmVariant === 'warning'
                    ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600 shadow-amber-600/20'
                    : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 shadow-blue-600/20'
                }`}
              >
                {isProcessing ? (
                  <RefreshCw className="h-4 w-4 text-white animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-white" />
                )}
                {config.confirmLabel || 'Confirm'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }

  return content;
};


