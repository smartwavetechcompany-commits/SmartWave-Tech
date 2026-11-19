import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Guest, GuestDepositTransaction, LedgerEntry, Reservation } from '../types';
import {
  applyGuestDepositToReservation,
  canDepositToGuestAccount,
  depositToGuestAccount,
  getAvailableGuestDeposit,
  GUEST_DEPOSIT_PERMISSION_DENIED_MESSAGE,
  refundGuestDeposit,
} from '../services/guestDepositService';
import { getReservationLiveBalance } from '../utils/billingEngine';
import { cn, downloadCsvContent, escapeCsvCell, formatCurrency } from '../utils';
import { safeFormatDate } from '../utils/dateUtils';
import { generatePdfExport, printDocument } from '../utils/printUtils';
import { Pagination } from './Pagination';
import { toast } from 'sonner';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Calendar,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  History,
  Loader2,
  PlusCircle,
  Printer,
  RotateCcw,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';

interface GuestDepositModalProps {
  guest: Guest;
  onClose: () => void;
  defaultReservationId?: string;
}

export function GuestDepositModal({ guest, onClose, defaultReservationId }: GuestDepositModalProps) {
  const { hotel, currency, exchangeRate, profile, customRoles } = useAuth();
  const canDepositMoney = canDepositToGuestAccount(profile, customRoles);
  const [currentGuest, setCurrentGuest] = useState<Guest>(guest);
  const [transactions, setTransactions] = useState<GuestDepositTransaction[]>([]);
  const [guestReservations, setGuestReservations] = useState<Reservation[]>([]);
  const [guestLedgerEntries, setGuestLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeAction, setActiveAction] = useState<'none' | 'deposit' | 'apply' | 'refund'>(
    defaultReservationId && (guest.depositBalance || 0) > 0.01 ? 'apply' : 'none'
  );
  const [isSaving, setIsSaving] = useState(false);

  // Deposit form state
  const [depositForm, setDepositForm] = useState({
    amount: 0,
    method: 'cash' as 'cash' | 'card' | 'transfer',
    referenceCode: '',
    description: '',
  });

  // Apply to reservation form state
  const [applyForm, setApplyForm] = useState({
    reservationId: defaultReservationId || '',
    amount: 0,
    notes: '',
  });

  // Refund form state
  const [refundForm, setRefundForm] = useState({
    amount: 0,
    method: 'cash' as 'cash' | 'card' | 'transfer',
    referenceCode: '',
    reason: '',
  });

  // Printable statement / receipt modal
  const [showPrintStatement, setShowPrintStatement] = useState(false);
  const [printTxOnly, setPrintTxOnly] = useState<GuestDepositTransaction | null>(null);

  // Pagination
  const [txPage, setTxPage] = useState(1);
  const [txPageSize, setTxPageSize] = useState(10);

  useEffect(() => {
    setCurrentGuest(guest);
  }, [guest]);

  useEffect(() => {
    if (!hotel?.id || !guest.id) return;

    const unsubGuest = onSnapshot(doc(db, 'hotels', hotel.id, 'guests', guest.id), (snap) => {
      if (snap.exists()) {
        setCurrentGuest({ id: snap.id, ...snap.data() } as Guest);
      }
    });

    const unsubTx = onSnapshot(
      query(collection(db, 'hotels', hotel.id, 'guest_deposit_transactions'), where('guestId', '==', guest.id)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as GuestDepositTransaction))
          .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        setTransactions(list);
        setLoading(false);
      },
      (err) => {
        console.warn('Guest deposit transactions listener error:', err);
        setLoading(false);
      }
    );

    const unsubRes = onSnapshot(
      query(collection(db, 'hotels', hotel.id, 'reservations'), where('guestId', '==', guest.id)),
      (snap) => {
        const resList = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Reservation))
          .filter((r) => r.status !== 'cancelled' && r.status !== 'no_show')
          .sort((a, b) => new Date(b.checkIn || 0).getTime() - new Date(a.checkIn || 0).getTime());
        setGuestReservations(resList);
      }
    );

    const unsubLedger = onSnapshot(
      query(collection(db, 'hotels', hotel.id, 'ledger'), where('guestId', '==', guest.id)),
      (snap) => {
        setGuestLedgerEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LedgerEntry)));
      }
    );

    return () => {
      try { unsubGuest(); } catch (_) {}
      try { unsubTx(); } catch (_) {}
      try { unsubRes(); } catch (_) {}
      try { unsubLedger(); } catch (_) {}
    };
  }, [hotel?.id, guest.id]);

  const availableBalance = getAvailableGuestDeposit(currentGuest);

  const owingReservations = useMemo(() => {
    return guestReservations
      .map((res) => {
        const resEntries = guestLedgerEntries.filter((e) => e.reservationId === res.id);
        const liveBalance = getReservationLiveBalance(res, hotel || null, resEntries);
        return { res, owed: Math.max(0, Number(liveBalance.toFixed(2))) };
      })
      .filter((item) => item.owed > 0.01);
  }, [guestReservations, guestLedgerEntries, hotel]);

  useEffect(() => {
    if (activeAction === 'apply' && owingReservations.length > 0 && !applyForm.reservationId) {
      const first = owingReservations[0];
      setApplyForm({
        reservationId: first.res.id,
        amount: Math.min(availableBalance, first.owed),
        notes: '',
      });
    }
  }, [activeAction, owingReservations, availableBalance, applyForm.reservationId]);

  const userCtx = {
    uid: profile?.uid || 'system',
    email: profile?.email || '',
    role: profile?.role || 'staff',
    displayName: profile?.displayName || (profile as any)?.name || profile?.email || 'Staff',
  };

  const handleRecordDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || isSaving) return;
    if (!canDepositMoney) {
      toast.error(GUEST_DEPOSIT_PERMISSION_DENIED_MESSAGE);
      return;
    }
    if (depositForm.amount <= 0) {
      toast.error('Please enter a deposit amount greater than zero.');
      return;
    }

    setIsSaving(true);
    try {
      const result = await depositToGuestAccount(
        hotel.id,
        currentGuest.id,
        depositForm.amount,
        depositForm.method,
        userCtx,
        {
          referenceCode: depositForm.referenceCode,
          description: depositForm.description,
          profile,
          customRoles,
        }
      );
      toast.success(
        `Deposited ${formatCurrency(depositForm.amount, currency, exchangeRate)} into ${currentGuest.name}'s account.`
      );
      setDepositForm({ amount: 0, method: 'cash', referenceCode: '', description: '' });
      setActiveAction('none');
      setPrintTxOnly(result.transaction);
      setShowPrintStatement(true);
    } catch (err: any) {
      console.error('Guest deposit error:', err);
      toast.error(err?.message || 'Failed to record deposit.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyToReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || isSaving) return;
    if (!applyForm.reservationId) {
      toast.error('Please select a reservation to settle.');
      return;
    }
    if (applyForm.amount <= 0) {
      toast.error('Please enter an amount greater than zero.');
      return;
    }

    setIsSaving(true);
    try {
      await applyGuestDepositToReservation(
        hotel.id,
        currentGuest.id,
        applyForm.reservationId,
        applyForm.amount,
        userCtx,
        {
          description: applyForm.notes?.trim() || undefined,
          settlementSource: 'Front Desk',
        }
      );
      toast.success(
        `Applied ${formatCurrency(applyForm.amount, currency, exchangeRate)} from guest deposit account.`
      );
      setApplyForm({ reservationId: '', amount: 0, notes: '' });
      setActiveAction('none');
    } catch (err: any) {
      console.error('Apply deposit error:', err);
      toast.error(err?.message || 'Failed to apply deposit to stay.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefundDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || isSaving) return;
    if (refundForm.amount <= 0) {
      toast.error('Please enter a refund amount greater than zero.');
      return;
    }
    if (!refundForm.reason.trim()) {
      toast.error('Please provide a reason for refunding the deposit.');
      return;
    }

    setIsSaving(true);
    try {
      await refundGuestDeposit(
        hotel.id,
        currentGuest.id,
        refundForm.amount,
        refundForm.method,
        refundForm.reason,
        userCtx,
        {
          referenceCode: refundForm.referenceCode,
        }
      );
      toast.success(
        `Refunded ${formatCurrency(refundForm.amount, currency, exchangeRate)} from ${currentGuest.name}'s deposit account.`
      );
      setRefundForm({ amount: 0, method: 'cash', referenceCode: '', reason: '' });
      setActiveAction('none');
    } catch (err: any) {
      console.error('Refund deposit error:', err);
      toast.error(err?.message || 'Failed to refund guest deposit.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportCsv = () => {
    const headers = ['Date & Time', 'Type', 'Description', 'Method', 'Room', 'Reference', 'Amount', 'Balance After', 'Staff'];
    const rows = transactions.map((tx) => [
      escapeCsvCell(safeFormatDate(tx.timestamp, 'yyyy-MM-dd HH:mm')),
      escapeCsvCell(tx.type.replace('_', ' ').toUpperCase()),
      escapeCsvCell(tx.description),
      escapeCsvCell((tx.paymentMethod || 'cash').toUpperCase()),
      escapeCsvCell(tx.roomNumber || 'N/A'),
      escapeCsvCell(tx.referenceCode || ''),
      escapeCsvCell(tx.type === 'deposit' ? tx.amount : -tx.amount),
      escapeCsvCell(tx.balanceAfter),
      escapeCsvCell(tx.postedByName || 'Staff'),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadCsvContent(csv, `guest_deposit_account_${currentGuest.name.replace(/\s+/g, '_')}.csv`);
    toast.success('Guest deposit statement exported as CSV');
  };

  const paginatedTransactions = useMemo(() => {
    const start = (txPage - 1) * txPageSize;
    return transactions.slice(start, start + txPageSize);
  }, [transactions, txPage, txPageSize]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[85] flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl sm:rounded-3xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[94dvh] shadow-2xl my-auto">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-900/70">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Wallet size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-zinc-50 tracking-tight">
                  {currentGuest.name}
                </h2>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Guest Account Wallet
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {currentGuest.phone || 'No phone'} • {currentGuest.email || 'No email'} • Unused funds carry over across check-out & return visits
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold flex items-center gap-1.5 border border-zinc-700 transition-colors"
            >
              <Download size={14} />
              <span className="hidden sm:inline">CSV</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPrintTxOnly(null);
                setShowPrintStatement(true);
              }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold flex items-center gap-1.5 border border-zinc-700 transition-colors"
            >
              <Printer size={14} />
              <span>Statement / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-colors"
              title="Close"
            >
              <XCircle size={22} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 custom-scrollbar">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-1">
                Available Balance
              </div>
              <div className="text-xl sm:text-2xl font-black text-emerald-300 font-mono">
                {formatCurrency(availableBalance, currency, exchangeRate)}
              </div>
              <div className="text-[10px] text-emerald-400/80 mt-1">
                Ready for stays, extensions & F&B
              </div>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
                Total Deposited
              </div>
              <div className="text-xl font-bold text-zinc-100 font-mono">
                {formatCurrency(currentGuest.totalDeposited || 0, currency, exchangeRate)}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">Lifetime deposits recorded</div>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
                Total Charged / Used
              </div>
              <div className="text-xl font-bold text-blue-400 font-mono">
                {formatCurrency(currentGuest.totalDepositUsed || 0, currency, exchangeRate)}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">Settled to folios & POS</div>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
                Total Refunded
              </div>
              <div className="text-xl font-bold text-rose-400 font-mono">
                {formatCurrency(currentGuest.totalDepositRefunded || 0, currency, exchangeRate)}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">Returned to guest</div>
            </div>
          </div>

          {/* Action Buttons Bar */}
          <div className="flex flex-wrap items-center gap-2.5">
            {canDepositMoney && (
              <button
                type="button"
                onClick={() => setActiveAction(activeAction === 'deposit' ? 'none' : 'deposit')}
                className={cn(
                  'px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95',
                  activeAction === 'deposit'
                    ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20'
                    : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black'
                )}
              >
                <PlusCircle size={15} />
                <span>Deposit Money into Account</span>
              </button>
            )}

            <button
              type="button"
              disabled={availableBalance <= 0.01 || owingReservations.length === 0}
              onClick={() => setActiveAction(activeAction === 'apply' ? 'none' : 'apply')}
              className={cn(
                'px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed',
                activeAction === 'apply'
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500 hover:text-white'
              )}
            >
              <Calendar size={15} />
              <span>
                Apply to Stay / Folio ({owingReservations.length})
              </span>
            </button>

            <button
              type="button"
              disabled={availableBalance <= 0.01}
              onClick={() => setActiveAction(activeAction === 'refund' ? 'none' : 'refund')}
              className={cn(
                'px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed',
                activeAction === 'refund'
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'
                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500 hover:text-white'
              )}
            >
              <RotateCcw size={15} />
              <span>Refund Unused Balance</span>
            </button>
          </div>

          {/* Deposit Money Form */}
          {activeAction === 'deposit' && canDepositMoney && (
            <form
              onSubmit={handleRecordDeposit}
              className="bg-zinc-950 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                  <ArrowDownLeft size={16} />
                  Record Guest Account Deposit
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveAction('none')}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Deposit Amount ({currency}) *
                  </label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={currency === 'USD' ? depositForm.amount / exchangeRate || '' : depositForm.amount || ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setDepositForm({
                        ...depositForm,
                        amount: currency === 'USD' ? val * exchangeRate : val,
                      });
                    }}
                    placeholder="0.00"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Payment Method
                  </label>
                  <select
                    value={depositForm.method}
                    onChange={(e) =>
                      setDepositForm({ ...depositForm, method: e.target.value as any })
                    }
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card / POS</option>
                    <option value="transfer">Bank Transfer</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Reference Code (Optional)
                  </label>
                  <input
                    type="text"
                    value={depositForm.referenceCode}
                    onChange={(e) => setDepositForm({ ...depositForm, referenceCode: e.target.value })}
                    placeholder="e.g. TXN-9941"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                  Description / Notes (Optional)
                </label>
                <input
                  type="text"
                  value={depositForm.description}
                  onChange={(e) => setDepositForm({ ...depositForm, description: e.target.value })}
                  placeholder="e.g. Advance guest deposit for stay & restaurant expenses"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveAction('none')}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || depositForm.amount <= 0}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-black flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  <span>{isSaving ? 'Recording...' : 'Confirm Deposit'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Apply Deposit to Stay / Reservation Form */}
          {activeAction === 'apply' && (
            <form
              onSubmit={handleApplyToReservation}
              className="bg-zinc-950 border border-blue-500/30 rounded-2xl p-4 sm:p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-blue-400 flex items-center gap-2">
                  <ArrowUpRight size={16} />
                  Charge / Settle Reservation From Guest Deposit
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveAction('none')}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Select Owing Reservation *
                  </label>
                  <select
                    required
                    value={applyForm.reservationId}
                    onChange={(e) => {
                      const picked = owingReservations.find((o) => o.res.id === e.target.value);
                      setApplyForm({
                        ...applyForm,
                        reservationId: e.target.value,
                        amount: picked ? Math.min(availableBalance, picked.owed) : 0,
                      });
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Choose stay...</option>
                    {owingReservations.map(({ res, owed }) => (
                      <option key={res.id} value={res.id}>
                        Room {res.roomNumber} ({safeFormatDate(res.checkIn, 'MMM d')} –{' '}
                        {safeFormatDate(res.checkOut, 'MMM d')}) • {res.status.replace('_', ' ').toUpperCase()} •
                        Owed: {formatCurrency(owed, currency, exchangeRate)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Amount to Apply (Max {formatCurrency(availableBalance, currency, exchangeRate)}) *
                  </label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={availableBalance}
                    value={currency === 'USD' ? applyForm.amount / exchangeRate || '' : applyForm.amount || ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setApplyForm({
                        ...applyForm,
                        amount: currency === 'USD' ? val * exchangeRate : val,
                      });
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm font-bold text-blue-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  value={applyForm.notes}
                  onChange={(e) => setApplyForm({ ...applyForm, notes: e.target.value })}
                  placeholder="e.g. Settle room & restaurant charges from guest account deposit"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveAction('none')}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !applyForm.reservationId || applyForm.amount <= 0}
                  className="px-5 py-2 bg-blue-500 hover:bg-blue-400 text-white rounded-xl text-xs font-black flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  <span>{isSaving ? 'Applying...' : 'Apply Deposit to Stay'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Refund Unused Deposit Form */}
          {activeAction === 'refund' && (
            <form
              onSubmit={handleRefundDeposit}
              className="bg-zinc-950 border border-rose-500/30 rounded-2xl p-4 sm:p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-rose-400 flex items-center gap-2">
                  <RotateCcw size={16} />
                  Refund Unused Guest Deposit
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveAction('none')}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Refund Amount (Max {formatCurrency(availableBalance, currency, exchangeRate)}) *
                  </label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={availableBalance}
                    value={currency === 'USD' ? refundForm.amount / exchangeRate || '' : refundForm.amount || ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setRefundForm({
                        ...refundForm,
                        amount: currency === 'USD' ? val * exchangeRate : val,
                      });
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm font-bold text-rose-400 focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Refund Method
                  </label>
                  <select
                    value={refundForm.method}
                    onChange={(e) =>
                      setRefundForm({ ...refundForm, method: e.target.value as any })
                    }
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-rose-500"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card Reversal</option>
                    <option value="transfer">Bank Transfer</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Reference Code (Optional)
                  </label>
                  <input
                    type="text"
                    value={refundForm.referenceCode}
                    onChange={(e) => setRefundForm({ ...refundForm, referenceCode: e.target.value })}
                    placeholder="e.g. REF-4021"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                  Reason for Refund *
                </label>
                <input
                  required
                  type="text"
                  value={refundForm.reason}
                  onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })}
                  placeholder="e.g. Guest requested refund of remaining unused account balance upon departure"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-rose-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveAction('none')}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || refundForm.amount <= 0 || !refundForm.reason.trim()}
                  className="px-5 py-2 bg-rose-500 hover:bg-rose-400 text-white rounded-xl text-xs font-black flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  <span>{isSaving ? 'Refunding...' : 'Confirm Refund'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Transaction History */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History size={16} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-zinc-100">Account Deposit & Charge Ledger</h3>
                <span className="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded-full text-[10px] font-bold">
                  {transactions.length}
                </span>
              </div>
            </div>

            {loading ? (
              <div className="py-12 flex items-center justify-center gap-2 text-xs text-zinc-500">
                <Loader2 size={16} className="animate-spin text-emerald-400" />
                <span>Loading guest deposit transactions...</span>
              </div>
            ) : transactions.length === 0 ? (
              <div className="py-12 text-center text-zinc-500 text-xs">
                <Wallet size={32} className="mx-auto mb-2 opacity-25" />
                <p>No deposit transactions yet for {currentGuest.name}.</p>
                <p className="text-[11px] text-zinc-600 mt-1">
                  Click "Deposit Money into Account" to fund this guest's account wallet.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-900/50">
                      <th className="py-3 px-4">Date & Time</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4">Staff</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4 text-right">Balance After</th>
                      <th className="py-3 px-4 text-right">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {paginatedTransactions.map((tx) => {
                      const isDeposit = tx.type === 'deposit';
                      const isRefund = tx.type === 'refund';
                      return (
                        <tr key={tx.id} className="hover:bg-zinc-900/40 transition-colors">
                          <td className="py-3 px-4 text-zinc-400 whitespace-nowrap font-mono text-[11px]">
                            {safeFormatDate(tx.timestamp, 'MMM d, yyyy HH:mm')}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={cn(
                                'px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider',
                                isDeposit
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : isRefund
                                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                  : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                              )}
                            >
                              {isDeposit ? 'Deposit' : isRefund ? 'Refund' : 'Charged / Applied'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-zinc-200 max-w-xs">
                            <div className="font-medium leading-snug">{tx.description}</div>
                            {(tx.roomNumber || tx.paymentMethod || tx.referenceCode) && (
                              <div className="text-[10px] text-zinc-500 mt-0.5">
                                {tx.roomNumber ? `Room ${tx.roomNumber} • ` : ''}
                                {tx.paymentMethod ? tx.paymentMethod.toUpperCase() : ''}
                                {tx.referenceCode ? ` • Ref: ${tx.referenceCode}` : ''}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-zinc-400 whitespace-nowrap">
                            {tx.postedByName || 'Staff'}
                          </td>
                          <td
                            className={cn(
                              'py-3 px-4 text-right font-mono font-bold whitespace-nowrap',
                              isDeposit ? 'text-emerald-400' : isRefund ? 'text-rose-400' : 'text-blue-400'
                            )}
                          >
                            {isDeposit ? '+' : '-'}
                            {formatCurrency(tx.amount, currency, exchangeRate)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-zinc-100 whitespace-nowrap">
                            {formatCurrency(tx.balanceAfter, currency, exchangeRate)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setPrintTxOnly(tx);
                                setShowPrintStatement(true);
                              }}
                              className="p-1.5 text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 rounded-lg transition-colors"
                              title="Print / PDF Receipt"
                            >
                              <Printer size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {transactions.length > txPageSize && (
              <Pagination
                compact
                currentPage={txPage}
                totalItems={transactions.length}
                pageSize={txPageSize}
                onPageChange={setTxPage}
                onPageSizeChange={setTxPageSize}
                pageSizeOptions={[10, 25, 50]}
                itemLabel="transactions"
              />
            )}
          </div>
        </div>
      </div>

      {/* Printable / PDF Statement & Receipt Overlay */}
      {showPrintStatement && hotel && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[95] flex items-start justify-center p-4 overflow-y-auto">
          <div className="relative w-full max-w-3xl my-8">
            <div className="flex items-center justify-end gap-2 mb-3 print:hidden">
              <button
                type="button"
                onClick={() => {
                  const target = document.getElementById('guest-deposit-statement-doc');
                  generatePdfExport(target, {
                    title: printTxOnly ? 'Guest-Deposit-Receipt' : 'Guest-Account-Statement',
                    filename: `${hotel.name || 'Hotel'}-${printTxOnly ? 'Deposit-Receipt' : 'Guest-Wallet'}-${currentGuest.name.replace(/[^a-z0-9]/gi, '_')}`,
                  });
                }}
                className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl text-xs font-bold flex items-center gap-1.5 border border-zinc-700"
              >
                <Download size={14} className="text-emerald-400" />
                <span>Download PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  printDocument(document.getElementById('guest-deposit-statement-doc'), {
                    title: `${hotel.name || 'Hotel'} - ${printTxOnly ? 'Deposit Receipt' : 'Guest Account Statement'} - ${currentGuest.name}`,
                    pageSize: 'A4 portrait',
                    pageMargin: '10mm',
                  });
                }}
                className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <Printer size={14} />
                <span>Print</span>
              </button>
              <button
                type="button"
                onClick={() => setShowPrintStatement(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-full"
              >
                <XCircle size={24} />
              </button>
            </div>

            <div
              id="guest-deposit-statement-doc"
              className="bg-white text-zinc-900 rounded-2xl p-8 shadow-2xl space-y-6"
            >
              <div className="flex items-start justify-between border-b border-zinc-200 pb-5">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-zinc-900">{hotel.name}</h1>
                  {hotel.address && <p className="text-xs text-zinc-500 mt-0.5">{hotel.address}</p>}
                  {((hotel as any).phone || (hotel as any).contactPhone || (hotel as any).email || (hotel as any).contactEmail) && (
                    <p className="text-xs text-zinc-500">
                      {[(hotel as any).phone || (hotel as any).contactPhone, (hotel as any).email || (hotel as any).contactEmail].filter(Boolean).join(' • ')}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-xs font-black uppercase tracking-widest text-emerald-700">
                    {printTxOnly ? 'Guest Deposit Receipt' : 'Guest Account Statement'}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    Issued: {safeFormatDate(new Date().toISOString(), 'MMM dd, yyyy HH:mm')}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-xs">
                <div>
                  <div className="text-[10px] font-bold uppercase text-zinc-500">Guest Account Holder</div>
                  <div className="text-sm font-bold text-zinc-900 mt-0.5">{currentGuest.name}</div>
                  <div className="text-zinc-600">{currentGuest.phone}</div>
                  <div className="text-zinc-600">{currentGuest.email}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase text-zinc-500">Current Wallet Balance</div>
                  <div className="text-xl font-black text-emerald-700 font-mono mt-0.5">
                    {formatCurrency(availableBalance, currency, exchangeRate)}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Total Deposited: {formatCurrency(currentGuest.totalDeposited || 0, currency, exchangeRate)}
                  </div>
                </div>
              </div>

              {printTxOnly ? (
                <div className="border border-zinc-200 rounded-xl p-5 space-y-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500 font-semibold">Transaction ID</span>
                    <span className="font-mono font-bold text-zinc-900">{printTxOnly.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 font-semibold">Date & Time</span>
                    <span className="text-zinc-900">{safeFormatDate(printTxOnly.timestamp, 'MMM dd, yyyy HH:mm')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 font-semibold">Type</span>
                    <span className="font-bold uppercase text-zinc-900">{printTxOnly.type.replace('_', ' ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 font-semibold">Description</span>
                    <span className="text-zinc-900 text-right max-w-sm">{printTxOnly.description}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 font-semibold">Method</span>
                    <span className="uppercase text-zinc-900">{printTxOnly.paymentMethod || 'CASH'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 font-semibold">Recorded By</span>
                    <span className="text-zinc-900">{printTxOnly.postedByName}</span>
                  </div>
                  <div className="border-t border-zinc-200 pt-3 flex justify-between text-sm font-black">
                    <span>Amount</span>
                    <span className="font-mono">{formatCurrency(printTxOnly.amount, currency, exchangeRate)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-zinc-600">
                    <span>Balance Before → After</span>
                    <span className="font-mono font-bold">
                      {formatCurrency(printTxOnly.balanceBefore, currency, exchangeRate)} →{' '}
                      {formatCurrency(printTxOnly.balanceAfter, currency, exchangeRate)}
                    </span>
                  </div>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b-2 border-zinc-200 text-[10px] uppercase tracking-wider text-zinc-500">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 px-2">Type</th>
                      <th className="py-2 px-2">Description</th>
                      <th className="py-2 px-2">Staff</th>
                      <th className="py-2 px-2 text-right">Amount</th>
                      <th className="py-2 pl-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td className="py-2 pr-3 whitespace-nowrap text-zinc-600">
                          {safeFormatDate(tx.timestamp, 'MMM d, yy HH:mm')}
                        </td>
                        <td className="py-2 px-2 uppercase font-bold text-[10px] text-zinc-700">
                          {tx.type.replace('_', ' ')}
                        </td>
                        <td className="py-2 px-2 text-zinc-800">{tx.description}</td>
                        <td className="py-2 px-2 text-zinc-600">{tx.postedByName}</td>
                        <td className="py-2 px-2 text-right font-mono font-bold">
                          {tx.type === 'deposit' ? '+' : '-'}
                          {formatCurrency(tx.amount, currency, exchangeRate)}
                        </td>
                        <td className="py-2 pl-2 text-right font-mono font-bold">
                          {formatCurrency(tx.balanceAfter, currency, exchangeRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
