import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { LedgerEntry, Reservation, Hotel, UserProfile } from '../types';
import { canApplyDiscount } from '../utils/policyUtils';
import { formatCurrency, cn } from '../utils';
import { postToLedger } from '../services/ledgerService';
import { toast } from 'sonner';
import { X, Percent, Tag, ShieldCheck, Sparkles, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DiscountApplicationProps {
  entry: LedgerEntry;
  hotel: Hotel | null;
  profile: UserProfile | null;
  reservation: Reservation;
  currency: 'NGN' | 'USD';
  exchangeRate: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function DiscountApplication({
  entry,
  hotel,
  profile,
  reservation,
  currency,
  exchangeRate,
  onClose,
  onSuccess
}: DiscountApplicationProps) {
  const [discountType, setDiscountType] = useState<'fixed' | 'percentage'>('percentage');
  const [discountValue, setDiscountValue] = useState<number>(10);
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Calculate base values
  const originalAmount = entry.amount;
  
  // Calculate final discount amount based on input
  const discountAmount = discountType === 'percentage'
    ? (originalAmount * discountValue) / 100
    : (currency === 'USD' ? discountValue * exchangeRate : discountValue);

  const remainingAmount = Math.max(0, originalAmount - discountAmount);
  
  // Custom display helper for the discount amount inside the input fields
  const displayValue = discountType === 'fixed' && currency === 'USD'
    ? Number((discountValue / exchangeRate).toFixed(2))
    : discountValue;

  const handleApplyDiscount = async () => {
    if (!hotel || !profile || !reservation) {
      toast.error('System error: Context is missing.');
      return;
    }

    if (discountValue <= 0 || isNaN(discountValue)) {
      toast.error('Please specify a positive discount amount.');
      return;
    }

    if (discountAmount > originalAmount) {
      toast.error('The discount amount matches or exceeds the original charge amount.');
      return;
    }

    if (!reason.trim()) {
      toast.error('A manager reason or adjustment details must be specified.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Direct permission policy verification
      const policyResponse = canApplyDiscount(hotel, profile, discountAmount, originalAmount);
      if (!policyResponse.allowed) {
        toast.error(policyResponse.message || 'The policy denied applying this discount.');
        setIsSubmitting(false);
        return;
      }

      const displayDiscountStr = discountType === 'percentage'
        ? `${discountValue}%`
        : formatCurrency(discountAmount, currency, exchangeRate);

      await postToLedger(
        hotel.id,
        reservation.guestId!,
        reservation.id,
        {
          amount: discountAmount,
          type: 'credit',
          category: 'discount',
          description: `Line Discount Adjustment (${displayDiscountStr}) on: "${entry.description}" - Reason: ${reason.trim()}`,
          referenceId: entry.id,
          postedBy: profile.uid,
          price: discountAmount,
          quantity: 1
        },
        profile.uid,
        reservation.corporateId
      );

      toast.success(`Discount of ${displayDiscountStr} applied on line item successfully!`);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to post discount ledger entry:', err);
      toast.error('An error occurred while posting checkout discount credit.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalContent = (
    <AnimatePresence>
      <div className="fixed inset-0 z-[10005] flex items-center justify-center p-4">
        {/* Backdrop overlay */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-md"
        />

        {/* Modal Panel */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl shadow-black p-6 space-y-6"
        >
          {/* Header */}
          <header className="flex items-center justify-between pb-4 border-b border-zinc-900">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-emerald-500/10 rounded-xl">
                <Tag className="text-emerald-500" size={18} />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-50 font-sans tracking-tight">Apply Line Discount</h3>
                <p className="text-xs text-zinc-500">Inject dynamic markdown credit to specific posted items</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 bg-zinc-900 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-zinc-50 transition-colors"
            >
              <X size={16} />
            </button>
          </header>

          {/* Original Transaction Summary */}
          <div className="p-4 bg-zinc-900/40 border border-zinc-90 w-full rounded-2xl space-y-2 text-xs">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Original Line Item</span>
            <div className="flex justify-between items-start">
              <span className="font-semibold text-zinc-100 max-w-[250px] truncate block">{entry.description}</span>
              <span className="font-mono font-medium text-red-400">{formatCurrency(originalAmount, currency, exchangeRate)}</span>
            </div>
            <div className="flex justify-between text-[11px] text-zinc-400">
              <span className="uppercase">Category: {entry.category}</span>
              <span>Ref: {entry.id?.slice(-8).toUpperCase()}</span>
            </div>
          </div>

          <div className="space-y-4">
            {/* Discount Type Picker */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">Discount Method</label>
              <div className="grid grid-cols-2 gap-2 bg-zinc-900/50 p-1 rounded-xl border border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setDiscountType('percentage');
                    setDiscountValue(10);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all",
                    discountType === 'percentage'
                      ? "bg-zinc-805 text-zinc-100 font-bold border border-zinc-700 shadow-md"
                      : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Percent size={14} />
                  Percentage
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDiscountType('fixed');
                    setDiscountValue(0);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all",
                    discountType === 'fixed'
                      ? "bg-zinc-850 text-zinc-100 font-bold border border-zinc-700 shadow-md"
                      : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Tag size={14} />
                  Fixed Cash
                </button>
              </div>
            </div>

            {/* Input Slider / Value Selector */}
            <div className="space-y-2.5">
              <div className="flex justify-between">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                  {discountType === 'percentage' ? 'Percentage Rate (%)' : `Amount Value (${currency})`}
                </label>
                <span className="text-xs font-semibold text-emerald-500 font-mono">
                  {discountType === 'percentage' ? `${discountValue}%` : formatCurrency(discountAmount, currency, exchangeRate)}
                </span>
              </div>
              <div className="flex gap-3">
                <input
                  type="number"
                  min="0"
                  max={discountType === 'percentage' ? "100" : undefined}
                  step="any"
                  value={displayValue || ''}
                  onChange={(e) => {
                    const rawVal = parseFloat(e.target.value) || 0;
                    if (discountType === 'fixed' && currency === 'USD') {
                      setDiscountValue(rawVal * exchangeRate);
                    } else {
                      setDiscountValue(rawVal);
                    }
                  }}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                  placeholder="0.00"
                />
              </div>

              {discountType === 'percentage' && (
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(parseInt(e.target.value) || 0)}
                  className="w-full accent-emerald-500"
                />
              )}
            </div>

            {/* Discount Reason Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">Reason for adjustment</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Manager authorization notes, VIP privilege override, or guest satisfaction adjustment"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-105 outline-none focus:border-emerald-500 h-20 resize-none font-sans"
              />
            </div>
          </div>

          {/* Real-time Dynamic Impact Preview */}
          <div className="p-4 bg-zinc-950 border border-zinc-900 rounded-2xl space-y-2">
            <span className="text-[10px] text-zinc-500 uppercase font-bold font-mono block">Dynamic Impact Preview</span>
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-400">Lines Reduction</span>
              <span className="font-mono text-emerald-500 hover:scale-105 transition-all">
                -{formatCurrency(discountAmount, currency, exchangeRate)}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs pt-1 border-t border-zinc-900 font-bold">
              <span className="text-zinc-300">Remaining Balance</span>
              <span className="font-mono text-zinc-100">
                {formatCurrency(remainingAmount, currency, exchangeRate)}
              </span>
            </div>
          </div>

          {/* Action Footer */}
          <footer className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl text-xs font-bold text-zinc-300 transition-all border border-zinc-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyDiscount}
              disabled={isSubmitting || discountValue <= 0 || discountAmount > originalAmount}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white shadow-xl shadow-emerald-950/20 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all disabled:opacity-50 disabled:scale-100"
            >
              {isSubmitting ? 'Applying...' : 'Apply Line Discount'}
            </button>
          </footer>
        </motion.div>
      </div>
    </AnimatePresence>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
