import React, { useState } from 'react';
import { 
  AlertTriangle, 
  ArrowRight, 
  CreditCard, 
  DollarSign, 
  CheckCircle2, 
  Clock, 
  User, 
  Building, 
  X, 
  ShieldAlert,
  ArrowUpRight,
  FileText
} from 'lucide-react';
import { OutstandingDebt, Reservation } from '../types';
import { formatCurrency } from '../utils';
import { transferDebtToNewFolio, receiveDebtPayment } from '../services/debtService';
import { toast } from 'sonner';

interface ReturningGuestDebtModalProps {
  isOpen: boolean;
  onClose: () => void;
  debts: OutstandingDebt[];
  totalDebt: number;
  newReservation: Reservation;
  hotel: any;
  profile: any;
  currency: 'NGN' | 'USD';
  exchangeRate: number;
  onProceedCheckIn: () => Promise<void> | void;
}

export const ReturningGuestDebtModal: React.FC<ReturningGuestDebtModalProps> = ({
  isOpen,
  onClose,
  debts,
  totalDebt,
  newReservation,
  hotel,
  profile,
  currency,
  exchangeRate,
  onProceedCheckIn
}) => {
  const [selectedAction, setSelectedAction] = useState<'options' | 'collect'>('options');
  const [loading, setLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(totalDebt);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [paymentNotes, setPaymentNotes] = useState('');

  if (!isOpen) return null;

  const primaryDebt = debts[0];

  const handleTransferToNewFolio = async () => {
    try {
      setLoading(true);
      for (const debt of debts) {
        if (debt.outstandingAmount > 0.01) {
          await transferDebtToNewFolio(hotel.id, debt, newReservation, profile);
        }
      }
      toast.success(`Previous debt of ${formatCurrency(totalDebt, currency, exchangeRate)} transferred to new stay folio.`);
      onClose();
      await onProceedCheckIn();
    } catch (err: any) {
      console.error("Failed to transfer debt to new folio:", err);
      toast.error(err.message || "Failed to transfer debt.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeepSeparate = async () => {
    try {
      setLoading(true);
      toast.success("Previous debt kept separate in Outstanding Guest Ledger.");
      onClose();
      await onProceedCheckIn();
    } catch (err: any) {
      console.error("Failed to proceed with separate debt:", err);
      toast.error(err.message || "Failed to proceed.");
    } finally {
      setLoading(false);
    }
  };

  const handleCollectImmediately = async () => {
    try {
      if (paymentAmount <= 0) {
        toast.error("Please enter a valid payment amount.");
        return;
      }
      setLoading(true);
      
      let remainingToPay = paymentAmount;
      for (const debt of debts) {
        if (remainingToPay <= 0) break;
        if (debt.outstandingAmount > 0.01) {
          const payForThisDebt = Math.min(debt.outstandingAmount, remainingToPay);
          await receiveDebtPayment(
            hotel.id,
            debt.id,
            payForThisDebt,
            paymentMethod,
            profile,
            `Collected at check-in for Room ${newReservation.roomNumber}${paymentNotes ? ': ' + paymentNotes : ''}`
          );
          remainingToPay -= payForThisDebt;
        }
      }

      toast.success(`Collected ${formatCurrency(paymentAmount, currency, exchangeRate)} for past outstanding balance.`);
      onClose();
      await onProceedCheckIn();
    } catch (err: any) {
      console.error("Failed to collect debt payment:", err);
      toast.error(err.message || "Failed to process payment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-600 to-amber-700 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-500/40 rounded-xl">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold tracking-tight">Returning Guest Debt Alert</h3>
              <p className="text-amber-100 text-sm">
                Outstanding balance found from previous stay for {newReservation.guestName}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            disabled={loading}
            className="p-1.5 text-amber-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Highlight Banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 text-amber-900 font-semibold text-sm">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>Total Past Unpaid Balance:</span>
              </div>
              <div className="text-3xl font-extrabold text-amber-800 mt-1">
                {formatCurrency(totalDebt, currency, exchangeRate)}
              </div>
              <p className="text-xs text-amber-700 mt-1">
                {debts.length} previous stay{debts.length > 1 ? 's' : ''} with active outstanding debt
              </p>
            </div>

            <div className="bg-white/80 backdrop-blur rounded-lg px-3 py-2 border border-amber-200/60 text-right">
              <span className="text-xs text-slate-700 block font-medium">New Check-In Target</span>
              <span className="text-sm font-bold text-slate-800">
                Room {newReservation.roomNumber} ({newReservation.nights || 1} Night{(newReservation.nights || 1) > 1 ? 's' : ''})
              </span>
            </div>
          </div>

          {/* Previous Stay Details List */}
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
            {debts.map((d, idx) => (
              <div key={d.id || idx} className="p-3.5 flex items-center justify-between text-sm hover:bg-slate-50 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-slate-900">
                      {d.folioNumber || `Folio #${d.id.slice(-6).toUpperCase()}`}
                    </span>
                    <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-slate-100 text-slate-700">
                      Room {d.roomNumber || 'N/A'}
                    </span>
                    {d.agingDays !== undefined && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-red-100 text-red-800">
                        {d.agingDays} days overdue
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    Checked out: {d.checkoutDate} • Original: {formatCurrency(d.originalDebt, currency, exchangeRate)}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-red-600 block">
                    {formatCurrency(d.outstandingAmount, currency, exchangeRate)}
                  </span>
                  <span className="text-xs text-slate-600 capitalize">
                    {d.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {selectedAction === 'options' ? (
            /* Action Choice Selector */
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Select Resolution Action Before Check-In
              </label>

              <div className="grid grid-cols-1 gap-3">
                {/* Option 1: Transfer debt to new folio */}
                <button
                  onClick={handleTransferToNewFolio}
                  disabled={loading}
                  className="w-full p-4 text-left border-2 border-slate-200 hover:border-indigo-600 rounded-xl bg-white hover:bg-indigo-50/40 transition-all flex items-start space-x-4 group cursor-pointer"
                >
                  <div className="p-2.5 rounded-lg bg-indigo-100 text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    <ArrowUpRight className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 group-hover:text-indigo-700">
                        1. Transfer Debt to New Folio
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-medium">
                        Recommended
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Carries forward the <strong>{formatCurrency(totalDebt, currency, exchangeRate)}</strong> debt onto Room {newReservation.roomNumber}'s new stay folio. The guest can settle both stays together upon departure.
                    </p>
                  </div>
                </button>

                {/* Option 2: Collect immediately */}
                <button
                  onClick={() => setSelectedAction('collect')}
                  disabled={loading}
                  className="w-full p-4 text-left border-2 border-slate-200 hover:border-emerald-600 rounded-xl bg-white hover:bg-emerald-50/40 transition-all flex items-start space-x-4 group cursor-pointer"
                >
                  <div className="p-2.5 rounded-lg bg-emerald-100 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 group-hover:text-emerald-700">
                        2. Collect Immediately
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-medium">
                        Instant Settlement
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Collect the outstanding balance right now via Cash, Card, or Transfer before handing over room keys.
                    </p>
                  </div>
                </button>

                {/* Option 3: Keep separate */}
                <button
                  onClick={handleKeepSeparate}
                  disabled={loading}
                  className="w-full p-4 text-left border-2 border-slate-200 hover:border-amber-600 rounded-xl bg-white hover:bg-amber-50/40 transition-all flex items-start space-x-4 group cursor-pointer"
                >
                  <div className="p-2.5 rounded-lg bg-amber-100 text-amber-700 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <span className="font-bold text-slate-900 group-hover:text-amber-700 block">
                      3. Keep Separate
                    </span>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Leave the previous balance active in the Outstanding Guest Ledger. Proceed with checking in Room {newReservation.roomNumber} under a separate fresh folio.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            /* Collect Payment Form */
            <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-sm">Receive Payment for Previous Debt</span>
                <button 
                  onClick={() => setSelectedAction('options')}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                >
                  ← Back to Options
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Payment Amount ({currency})
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 text-sm font-semibold">₦</span>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                    max={totalDebt}
                    min={1}
                    className="w-full pl-8 pr-4 py-2 text-sm font-semibold border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['cash', 'card', 'transfer'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`py-2 px-3 text-xs font-bold rounded-lg border text-center capitalize transition-colors cursor-pointer ${
                        paymentMethod === method
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {method === 'transfer' ? 'Bank Transfer' : method}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Receipt / Reference Note</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="e.g. POS Ref #12345 or Cashier note"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  onClick={() => setSelectedAction('options')}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCollectImmediately}
                  disabled={loading || paymentAmount <= 0}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow flex items-center space-x-2 disabled:opacity-50"
                >
                  {loading ? (
                    <span>Processing...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Settle & Proceed to Check-In</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Footer Controls */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              Halt Check-In (Review Later)
            </button>
            <span className="text-[11px] text-slate-600">
              Audit log will record front desk decision
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
