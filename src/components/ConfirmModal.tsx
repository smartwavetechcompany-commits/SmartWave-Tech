import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
  requireConfirmationText?: string;
  confirmationPlaceholder?: string;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'info',
  isLoading = false,
  requireConfirmationText,
  confirmationPlaceholder
}: ConfirmModalProps) {
  const [inputText, setInputText] = React.useState('');

  React.useEffect(() => {
    if (isOpen) {
      setInputText('');
    }
  }, [isOpen]);

  const isConfirmDisabled = isLoading || (!!requireConfirmationText && inputText.trim() !== requireConfirmationText.trim());
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md relative"
          >
            <button 
              onClick={onCancel}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-50 transition-colors"
            >
              <X size={20} />
            </button>

            <div className="flex flex-col items-center text-center">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-6 ${
                type === 'danger' ? 'bg-red-500/10 text-red-500' :
                type === 'warning' ? 'bg-amber-500/10 text-amber-500' :
                'bg-emerald-500/10 text-emerald-500'
              }`}>
                <AlertCircle size={32} />
              </div>
              
              <h3 className="text-xl font-bold text-zinc-50 mb-2">{title}</h3>
              <p className="text-zinc-400 text-sm mb-6">{message}</p>

              {requireConfirmationText && (
                <div className="w-full mb-8 text-left">
                  <label className="text-xs font-bold text-zinc-500 uppercase block mb-2 text-center">
                    Type <span className="text-red-400 font-mono select-all font-black bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">"{requireConfirmationText}"</span> to proceed
                  </label>
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={confirmationPlaceholder || "Type confirmation here..."}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-50 focus:outline-none focus:border-red-500/50 text-center font-bold text-sm tracking-wide"
                  />
                </div>
              )}

              <div className="flex gap-3 w-full">
                <button
                  onClick={onCancel}
                  className="flex-1 py-3 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-all"
                >
                  {cancelText}
                </button>
                <button
                  onClick={() => {
                    onConfirm();
                    if (!isLoading) onCancel();
                  }}
                  disabled={isConfirmDisabled}
                  className={`flex-1 py-3 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2 ${
                    type === 'danger' ? 'bg-red-500 text-zinc-50 hover:bg-red-400' :
                    type === 'warning' ? 'bg-amber-500 text-black hover:bg-amber-400' :
                    'bg-emerald-500 text-black hover:bg-emerald-400'
                  } ${isConfirmDisabled ? 'opacity-40 cursor-not-allowed scale-100! active:scale-100!' : ''}`}
                >
                  {isLoading && <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                  {confirmText}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
