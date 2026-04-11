import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy, doc, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, LedgerEntry, OperationType, Guest, Room } from '../types';
import { postToLedger, settleLedger, transferLedgerBalance, deleteLedgerEntry, settleOverpayment } from '../services/ledgerService';
import { ReceiptGenerator } from './ReceiptGenerator';
import { ConfirmModal } from './ConfirmModal';
import { 
  Receipt, 
  User, 
  Calendar, 
  CreditCard, 
  Plus, 
  History, 
  ArrowRight, 
  Banknote,
  Clock,
  Building2,
  XCircle,
  Printer,
  Download,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency, safeStringify } from '../utils';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface GuestFolioProps {
  reservation: Reservation;
  onClose: () => void;
  onPostCharge?: () => void;
}

export function GuestFolio({ reservation, onClose, onPostCharge }: GuestFolioProps) {
  const { hotel, currency, exchangeRate, profile } = useAuth();
  const [currentReservation, setCurrentReservation] = useState<Reservation>(reservation);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTransferBalanceModal, setShowTransferBalanceModal] = useState(false);
  const [otherReservations, setOtherReservations] = useState<Reservation[]>([]);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LedgerEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showSettleOverpayment, setShowSettleOverpayment] = useState(false);
  const [showSettlePayment, setShowSettlePayment] = useState(false);
  const [settleData, setSettleData] = useState({ amount: 0, method: 'cash' as 'cash' | 'card' | 'transfer', notes: '' });
  const [isSaving, setIsSaving] = useState(false);

  const handleSettlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;
    try {
      setIsSaving(true);
      await settleLedger(
        hotel.id, 
        reservation.guestId || 'unknown', 
        reservation.id, 
        settleData.amount, 
        settleData.method, 
        profile.uid, 
        reservation.corporateId
      );

      toast.success('Payment recorded successfully');
      setShowSettlePayment(false);
      setSettleData({ amount: 0, method: 'cash', notes: '' });
    } catch (err: any) {
      console.error("Settle payment error:", err.message || safeStringify(err));
      toast.error('Failed to record payment');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSettleOverpayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;
    try {
      setIsSaving(true);
      await settleOverpayment(hotel.id, reservation.guestId || 'unknown', reservation.id, settleData.amount, settleData.method, profile.uid, reservation.corporateId);
      toast.success('Overpayment settled successfully');
      setShowSettleOverpayment(false);
    } catch (err: any) {
      console.error("Settle overpayment error:", err.message || safeStringify(err));
      toast.error('Failed to settle overpayment');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!hotel?.id || !reservation.id || !reservation.guestId) return;

    // Fetch other active reservations for this guest
    const qOther = query(
      collection(db, 'hotels', hotel.id, 'reservations'),
      where('guestId', '==', reservation.guestId),
      where('status', 'in', ['confirmed', 'checked_in']),
      orderBy('checkIn', 'desc')
    );

    const unsubOther = onSnapshot(qOther, (snap) => {
      setOtherReservations(snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Reservation))
        .filter(r => r.id !== reservation.id)
      );
    });

    return () => unsubOther();
  }, [hotel?.id, reservation.id, reservation.guestId]);

  const handleTransferBalance = async () => {
    if (!hotel?.id || !profile || !transferTargetId || balance === 0) return;
    try {
      setLoading(true);
      await transferLedgerBalance(
        hotel.id,
        reservation.guestId!,
        reservation.id,
        transferTargetId,
        balance,
        profile.uid,
        reservation.corporateId
      );
      toast.success('Balance transferred successfully');
      setShowTransferBalanceModal(false);
    } catch (err: any) {
      console.error("Transfer error:", err.message || safeStringify(err));
      toast.error('Failed to transfer balance');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hotel?.id || !reservation.id) return;

    // Listen to reservation document for real-time updates
    const unsubRes = onSnapshot(doc(db, 'hotels', hotel.id, 'reservations', reservation.id), (snap) => {
      if (snap.exists()) {
        setCurrentReservation({ id: snap.id, ...snap.data() } as Reservation);
      }
    });

    // Listen to ledger entries for this reservation
    const q = query(
      collection(db, 'hotels', hotel.id, 'ledger'),
      where('reservationId', '==', reservation.id),
      orderBy('timestamp', 'desc')
    );

    const unsubLedger = onSnapshot(q, (snap) => {
      const entries = snap.docs.map(doc => ({ firestoreId: doc.id, ...doc.data() } as LedgerEntry & { firestoreId: string }));
      // If no entries in collection, fallback to currentReservation.ledgerEntries
      if (entries.length === 0 && currentReservation.ledgerEntries && currentReservation.ledgerEntries.length > 0) {
        setLedgerEntries(currentReservation.ledgerEntries as (LedgerEntry & { firestoreId: string })[]);
      } else {
        setLedgerEntries(entries as any);
      }
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/ledger`);
    });

    // Fetch guest details
    let unsubGuest = () => {};
    if (reservation.guestId) {
      unsubGuest = onSnapshot(doc(db, 'hotels', hotel.id, 'guests', reservation.guestId), (doc) => {
        if (doc.exists()) setGuest({ id: doc.id, ...doc.data() } as Guest);
      });
    }

    return () => {
      unsubRes();
      unsubLedger();
      unsubGuest();
    };
  }, [hotel?.id, reservation.id, reservation.guestId]);

  const totalDebits = ledgerEntries.filter(e => e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
  const totalCredits = ledgerEntries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0);
  const totalPayments = ledgerEntries.filter(e => e.type === 'credit' && e.category?.toLowerCase() === 'payment').reduce((acc, e) => acc + e.amount, 0);
  const totalOtherCredits = totalCredits - totalPayments;
  
  // If room charges are already in ledger, don't add currentReservation.totalAmount again
  const hasRoomChargeInLedger = ledgerEntries.some(e => e.category?.toLowerCase() === 'room' && e.type === 'debit');
  const hasPaymentInLedger = ledgerEntries.some(e => e.category?.toLowerCase() === 'payment');
  
  const grandTotal = hasRoomChargeInLedger ? totalDebits : (currentReservation.totalAmount + totalDebits);
  const totalPaid = totalCredits + (hasPaymentInLedger ? 0 : (currentReservation.paidAmount || 0));
  const balance = grandTotal - totalPaid;

  const handleDeleteEntry = async () => {
    if (!hotel?.id || !confirmDelete || !profile) return;
    
    try {
      setIsDeleting(true);
      await deleteLedgerEntry(hotel.id, confirmDelete as any);
      
      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'LEDGER_ENTRY_DELETED',
        resource: `${confirmDelete.description} (${formatCurrency(confirmDelete.amount, currency, exchangeRate)})`,
        hotelId: hotel.id,
        module: 'Folio'
      });
      
      toast.success('Transaction deleted');
      setConfirmDelete(null);
    } catch (err: any) {
      console.error("Delete error:", err.message || safeStringify(err));
      toast.error('Failed to delete transaction');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500">
              <Receipt size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-50">Guest Folio</h2>
              <p className="text-sm text-zinc-500">Reservation #{reservation.id.slice(-6).toUpperCase()}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowReceipt(true)}
              className="p-2 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-xl transition-all flex items-center gap-2"
              title="Print Receipt"
            >
              <Printer size={20} />
              <span className="text-xs font-bold">Print Receipt</span>
            </button>
            <button 
              onClick={onClose}
              className="p-2 text-zinc-500 hover:text-zinc-50 transition-colors"
            >
              <XCircle size={24} />
            </button>
          </div>
        </div>

        {showReceipt && hotel && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[70] flex items-center justify-center p-4 overflow-y-auto">
            <div className="relative w-full max-w-md">
              <button 
                onClick={() => setShowReceipt(false)}
                className="absolute -top-12 right-0 p-2 text-zinc-50 hover:bg-white/10 rounded-full transition-all"
              >
                <XCircle size={32} />
              </button>
              <ReceiptGenerator 
                hotel={hotel} 
                reservation={currentReservation} 
                type="comprehensive" 
                ledgerEntries={ledgerEntries} 
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Guest & Stay Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <User size={18} className="text-emerald-500" />
                <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">Guest Details</h3>
              </div>
              <div className="space-y-2">
                <p className="text-lg font-bold text-zinc-50">{reservation.guestName}</p>
                <p className="text-sm text-zinc-400">{reservation.guestEmail}</p>
                <p className="text-sm text-zinc-400">{reservation.guestPhone}</p>
                {reservation.corporateId && (
                  <div className="mt-4 pt-4 border-t border-zinc-800">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Corporate Account</p>
                    <p className="text-sm text-emerald-500 font-bold flex items-center gap-2">
                      <Building2 size={14} />
                      Corporate Booking
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <Calendar size={18} className="text-blue-500" />
                <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">Stay Info</h3>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Room</p>
                    <p className="text-lg font-bold text-zinc-50">{reservation.roomNumber}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Status</p>
                    <span className={cn(
                      "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                      reservation.status === 'checked_in' ? "bg-emerald-500/10 text-emerald-500" : "bg-blue-500/10 text-blue-500"
                    )}>
                      {reservation.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Check In</p>
                    <p className="text-sm text-zinc-50 font-medium">{format(new Date(reservation.checkIn), 'MMM d, yyyy')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Check Out</p>
                    <p className="text-sm text-zinc-50 font-medium">{format(new Date(reservation.checkOut), 'MMM d, yyyy')}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <Banknote size={18} className="text-amber-500" />
                <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">Financial Summary</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Total Charges</span>
                  <span className="text-zinc-50 font-bold">{formatCurrency(grandTotal, currency, exchangeRate)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Payments Received</span>
                  <span className="text-emerald-500 font-bold">{formatCurrency(hasPaymentInLedger ? totalPayments : (currentReservation.paidAmount || 0), currency, exchangeRate)}</span>
                </div>
                {totalOtherCredits > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">Discounts & Transfers</span>
                    <span className="text-emerald-500 font-bold">{formatCurrency(totalOtherCredits, currency, exchangeRate)}</span>
                  </div>
                )}
                <div className="pt-3 border-t border-zinc-800 flex justify-between items-center">
                  <span className="text-sm font-bold text-zinc-50 uppercase">Balance Due</span>
                  <div className="flex flex-col items-end">
                    <span className={cn(
                      "text-xl font-bold",
                      balance > 0 ? "text-red-500" : "text-emerald-500"
                    )}>
                      {formatCurrency(Math.abs(balance), currency, exchangeRate)}
                      {balance > 0 ? " (Due)" : balance < 0 ? " (Credit)" : ""}
                    </span>
                    {balance !== 0 && (
                      <div className="flex flex-col items-end gap-2 mt-2">
                        {otherReservations.length > 0 && (
                          <button 
                            onClick={() => setShowTransferBalanceModal(true)}
                            className="text-[10px] text-emerald-500 hover:underline flex items-center gap-1"
                          >
                            <ArrowRight size={10} /> Transfer to another stay
                          </button>
                        )}
                        {balance > 0 && (
                          <button 
                            onClick={() => {
                              setSettleData({ ...settleData, amount: balance });
                              setShowSettlePayment(true);
                            }}
                            className="text-[10px] text-emerald-500 hover:underline flex items-center gap-1 font-bold"
                          >
                            <Banknote size={10} /> Settle Full Balance
                          </button>
                        )}
                        {balance < 0 && (
                          <button 
                            onClick={() => {
                              setSettleData({ ...settleData, amount: Math.abs(balance) });
                              setShowSettleOverpayment(true);
                            }}
                            className="text-[10px] text-emerald-500 hover:underline flex items-center gap-1 font-bold"
                          >
                            <Banknote size={10} /> Settle Overpayment
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {showTransferBalanceModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
              <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl w-full max-w-md">
                <h3 className="text-lg font-bold text-zinc-50 mb-4">Transfer Balance</h3>
                <p className="text-sm text-zinc-400 mb-6">
                  Select another active reservation for {reservation.guestName} to transfer the current balance of {formatCurrency(balance, currency, exchangeRate)}.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Target Reservation</label>
                    <select 
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      value={transferTargetId}
                      onChange={(e) => setTransferTargetId(e.target.value)}
                    >
                      <option value="">Select Stay</option>
                      {otherReservations.map(r => (
                        <option key={r.id} value={r.id}>
                          Room {r.roomNumber} ({format(new Date(r.checkIn), 'MMM d')} - {format(new Date(r.checkOut), 'MMM d')})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button 
                      onClick={() => setShowTransferBalanceModal(false)}
                      className="flex-1 py-2 bg-zinc-800 text-zinc-50 rounded-lg font-bold hover:bg-zinc-700 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleTransferBalance}
                      disabled={!transferTargetId || loading}
                      className="flex-1 py-2 bg-emerald-500 text-black rounded-lg font-bold hover:bg-emerald-400 transition-all disabled:opacity-50"
                    >
                      Confirm Transfer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {showSettleOverpayment && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-800">
                  <h2 className="text-xl font-bold text-zinc-50">Settle Overpayment</h2>
                  <p className="text-sm text-zinc-500 mt-1">Refund or balance adjustment for {reservation.guestName}</p>
                </div>
                <form onSubmit={handleSettleOverpayment}>
                  <div className="p-6 space-y-4">
                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center">
                        <Banknote size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-zinc-500 uppercase">Available Credit</p>
                        <p className="text-lg font-bold text-emerald-500">{formatCurrency(Math.abs(balance), currency, exchangeRate)}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Refund Amount ({currency})</label>
                      <input
                        required
                        type="number"
                        value={currency === 'USD' ? (settleData.amount / exchangeRate) || '' : settleData.amount || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setSettleData({ ...settleData, amount: currency === 'USD' ? val * exchangeRate : val });
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        max={currency === 'USD' ? Math.abs(balance) / exchangeRate : Math.abs(balance)}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Refund Method</label>
                      <select
                        value={settleData.method}
                        onChange={(e) => setSettleData({ ...settleData, method: e.target.value as any })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="transfer">Bank Transfer</option>
                      </select>
                    </div>
                  </div>
                  <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowSettleOverpayment(false)}
                      className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!settleData.amount || isSaving}
                      className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSaving ? 'Processing...' : 'Confirm Refund'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {showSettlePayment && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-800">
                  <h2 className="text-xl font-bold text-zinc-50">Settle Payment</h2>
                  <p className="text-sm text-zinc-500 mt-1">Record payment for {reservation.guestName}</p>
                </div>
                <form onSubmit={handleSettlePayment}>
                  <div className="p-6 space-y-4">
                    <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center">
                        <Banknote size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-zinc-500 uppercase">Balance Due</p>
                        <p className="text-lg font-bold text-red-500">{formatCurrency(balance, currency, exchangeRate)}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Payment Amount ({currency})</label>
                      <input
                        required
                        type="number"
                        value={currency === 'USD' ? (settleData.amount / exchangeRate) || '' : settleData.amount || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setSettleData({ ...settleData, amount: currency === 'USD' ? val * exchangeRate : val });
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        max={currency === 'USD' ? balance / exchangeRate : balance}
                        step="0.01"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Payment Method</label>
                      <select
                        value={settleData.method}
                        onChange={(e) => setSettleData({ ...settleData, method: e.target.value as any })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="transfer">Bank Transfer</option>
                      </select>
                    </div>
                  </div>
                  <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowSettlePayment(false)}
                      className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!settleData.amount || isSaving}
                      className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSaving ? 'Processing...' : 'Confirm Payment'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {/* Ledger Entries Table */}
          <div className="bg-zinc-950 rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">Transaction History</h3>
              {onPostCharge && reservation.status === 'checked_in' && (
                <button 
                  onClick={onPostCharge}
                  className="flex items-center gap-2 text-xs font-bold text-emerald-500 hover:text-emerald-400 transition-colors"
                >
                  <Plus size={14} />
                  Post Charge
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800 bg-zinc-900/30">
                    <th className="px-6 py-3">Date & Time</th>
                    <th className="px-6 py-3">Description</th>
                    <th className="px-6 py-3">Category</th>
                    <th className="px-6 py-3 text-right">Debit</th>
                    <th className="px-6 py-3 text-right">Credit</th>
                    {(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                      <th className="px-6 py-3 text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {loading ? (
                    <tr>
                      <td colSpan={(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') ? 6 : 5} className="px-6 py-12 text-center text-zinc-500">
                        <Clock size={24} className="mx-auto mb-2 animate-spin opacity-20" />
                        Loading transactions...
                      </td>
                    </tr>
                  ) : ledgerEntries.length === 0 ? (
                    <tr>
                      <td colSpan={(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') ? 6 : 5} className="px-6 py-12 text-center text-zinc-500">
                        No transactions recorded for this stay.
                      </td>
                    </tr>
                  ) : (
                    ledgerEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-900/50 transition-colors">
                        <td className="px-6 py-4 text-xs text-zinc-400">
                          {format(new Date(entry.timestamp), 'MMM d, HH:mm')}
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-zinc-50 font-medium">{entry.description}</div>
                          <div className="text-[10px] text-zinc-500">Ref: {entry.id.slice(-8).toUpperCase()}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded">
                            {entry.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-bold text-red-500">
                          {entry.type === 'debit' ? formatCurrency(entry.amount, currency, exchangeRate) : '-'}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-bold text-emerald-500">
                          {entry.type === 'credit' ? formatCurrency(entry.amount, currency, exchangeRate) : '-'}
                        </td>
                        {(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => setConfirmDelete(entry)}
                              className="p-2 text-zinc-600 hover:text-red-500 transition-colors"
                              title="Delete Transaction"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="bg-zinc-900/30 border-t border-zinc-800">
                  <tr>
                    <td colSpan={3} className="px-6 py-4 text-right text-[10px] font-bold text-zinc-500 uppercase">Totals</td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-red-500">
                      {formatCurrency(grandTotal, currency, exchangeRate)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-emerald-500">
                      {formatCurrency(totalPaid, currency, exchangeRate)}
                    </td>
                    {(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                      <td className="px-6 py-4"></td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-4">
          <button
            onClick={() => {
              // Export CSV logic
              const headers = ['Date', 'Description', 'Category', 'Debit', 'Credit'];
              const csvContent = [
                headers.join(','),
                ...ledgerEntries.map(e => [
                  format(new Date(e.timestamp), 'yyyy-MM-dd HH:mm'),
                  `"${e.description}"`,
                  e.category,
                  e.type === 'debit' ? e.amount : 0,
                  e.type === 'credit' ? e.amount : 0
                ].join(','))
              ].join('\n');
              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              const link = document.createElement('a');
              link.href = URL.createObjectURL(blob);
              link.download = `folio_${reservation.id.slice(-6)}.csv`;
              link.click();
            }}
            className="flex items-center gap-2 px-6 py-3 bg-zinc-800 text-zinc-50 rounded-xl font-bold hover:bg-zinc-700 transition-all active:scale-95"
          >
            <Download size={18} />
            Export CSV
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95"
          >
            Close Folio
          </button>
        </div>
      </motion.div>

      <ConfirmModal
        isOpen={!!confirmDelete}
        title="Delete Transaction"
        message={`Are you sure you want to delete the transaction "${confirmDelete?.description}"? This will also reverse the balance update for the guest.`}
        onConfirm={handleDeleteEntry}
        onCancel={() => setConfirmDelete(null)}
        confirmText="Delete"
        type="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
