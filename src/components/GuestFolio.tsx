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
  Trash2,
  DollarSign,
  PlusCircle,
  RefreshCw,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency, safeStringify } from '../utils';
import { format, addDays, startOfDay, isAfter } from 'date-fns';
import { toast } from 'sonner';

interface GuestFolioProps {
  reservation: Reservation;
  onClose: () => void;
  onPostCharge?: () => void;
}

export function GuestFolio({ reservation, onClose, onPostCharge }: GuestFolioProps) {
  const { hotel, currency, exchangeRate, profile } = useAuth();
  const [currentReservation, setCurrentReservation] = useState<Reservation>(reservation);

  useEffect(() => {
    setCurrentReservation(reservation);
  }, [reservation]);

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
  const [showPostChargeModal, setShowPostChargeModal] = useState(false);
  const [chargeDetails, setChargeDetails] = useState({
    amount: 0,
    category: 'restaurant' as 'restaurant' | 'service' | 'other',
    description: '',
    discount: 0,
    discountType: 'fixed' as 'fixed' | 'percentage'
  });
  const [settleData, setSettleData] = useState({ 
    splits: [{ amount: 0, method: 'cash' }] as { amount: number; method: 'cash' | 'card' | 'transfer' }[], 
    notes: '' 
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);

  const handleManualNightlyCharge = async () => {
    if (!hotel?.id || !profile || currentReservation.status !== 'checked_in') return;
    
    try {
      setIsAuditing(true);
      const checkInDateTime = new Date(`${currentReservation.checkIn}T${currentReservation.checkInTime || '14:00'}`);
      const now = new Date();
      const hoursStayed = (now.getTime() - checkInDateTime.getTime()) / (1000 * 60 * 60);
      let targetCharges = Math.max(1, Math.ceil(hoursStayed / 24));

      // Overstay logic: If past overstayChargeTime on checkout date, add an extra charge
      if (hotel.autoChargeOverstays !== false) {
        const overstayTime = hotel.overstayChargeTime || hotel.defaultCheckOutTime || '12:00';
        const checkOutDateTime = new Date(`${currentReservation.checkOut}T${overstayTime}`);
        if (isAfter(now, checkOutDateTime)) {
          // Calculate how many days past checkout they are
          const daysPastCheckout = Math.max(1, Math.ceil((now.getTime() - checkOutDateTime.getTime()) / (1000 * 60 * 60 * 24)));
          const expectedTotalNights = (currentReservation.nights || 1) + daysPastCheckout;
          targetCharges = Math.max(targetCharges, expectedTotalNights);
        }
      }
      
      const existingCharges = ledgerEntries.filter(e => e.category === 'room' && e.type === 'debit').length;
      
      if (existingCharges < targetCharges) {
        const nightsToCharge = targetCharges - existingCharges;
        const rate = currentReservation.nightlyRate || (currentReservation.totalAmount / (currentReservation.nights || 1)) || 0;
        
        for (let i = 0; i < nightsToCharge; i++) {
          const chargeDate = addDays(startOfDay(checkInDateTime), existingCharges + i);
          const isOverstay = isAfter(chargeDate, startOfDay(new Date(currentReservation.checkOut)));
          
          await postToLedger(hotel.id, currentReservation.guestId!, currentReservation.id, {
            amount: rate,
            type: 'debit',
            category: 'room',
            description: `${isOverstay ? 'Overstay' : 'Manual Nightly'} Charge: Room ${currentReservation.roomNumber} (Night of ${format(chargeDate, 'MMM dd, yyyy')})`,
            referenceId: currentReservation.id,
            postedBy: profile.uid
          }, profile.uid, currentReservation.corporateId);
        }
        toast.success(`Posted ${nightsToCharge} nightly charge(s)`);
      } else {
        toast.info('All nights are already charged up to date.');
      }
    } catch (err: any) {
      console.error("Manual audit error:", err.message || safeStringify(err));
      toast.error('Failed to post nightly charge');
    } finally {
      setIsAuditing(false);
    }
  };

  const handleSettlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;
    try {
      setIsSaving(true);
      
      const totalAmount = settleData.splits.reduce((acc, s) => acc + s.amount, 0);
      if (totalAmount <= 0) {
        toast.error('Payment amount must be greater than zero');
        return;
      }

      for (const split of settleData.splits) {
        if (split.amount > 0) {
          await settleLedger(
            hotel.id, 
            currentReservation.guestId || 'unknown', 
            currentReservation.id, 
            split.amount, 
            split.method, 
            profile.uid, 
            activeFolio === 'company' ? (currentReservation.corporateId || undefined) : undefined
          );
        }
      }

      toast.success('Payment recorded successfully');
      setShowSettlePayment(false);
      setSettleData({ splits: [{ amount: 0, method: 'cash' }], notes: '' });
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
      const totalAmount = settleData.splits.reduce((acc, s) => acc + s.amount, 0);
      await settleOverpayment(hotel.id, currentReservation.guestId || 'unknown', currentReservation.id, totalAmount, settleData.splits[0]?.method || 'cash', profile.uid, currentReservation.corporateId);
      toast.success('Overpayment settled successfully');
      setShowSettleOverpayment(false);
    } catch (err: any) {
      console.error("Settle overpayment error:", err.message || safeStringify(err));
      toast.error('Failed to settle overpayment');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePostCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !currentReservation.guestId) return;

    try {
      setIsSaving(true);
      const amountAfterDiscount = chargeDetails.discountType === 'fixed' 
        ? chargeDetails.amount - chargeDetails.discount
        : chargeDetails.amount * (1 - chargeDetails.discount / 100);

      await postToLedger(hotel.id, currentReservation.guestId, currentReservation.id, {
        amount: amountAfterDiscount,
        type: 'debit',
        category: chargeDetails.category,
        description: chargeDetails.description || `Charge: ${chargeDetails.category}`,
        referenceId: currentReservation.id,
        postedBy: profile.uid
      }, profile.uid, currentReservation.corporateId);

      toast.success('Charge posted successfully');
      setShowPostChargeModal(false);
      setChargeDetails({ amount: 0, category: 'restaurant', description: '', discount: 0, discountType: 'fixed' });
    } catch (err: any) {
      console.error("Post charge error:", err.message || safeStringify(err));
      toast.error('Failed to post charge');
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
        currentReservation.guestId!,
        currentReservation.id,
        transferTargetId,
        balance,
        profile.uid,
        currentReservation.corporateId
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

  const [activeFolio, setActiveFolio] = useState<'guest' | 'company'>('guest');

  const companyEntries = ledgerEntries.filter(e => 
    currentReservation.corporateId && e.corporateId
  );
  
  const guestEntries = ledgerEntries.filter(e => 
    !e.corporateId
  );

  const displayedEntries = currentReservation.corporateId && activeFolio === 'company' 
    ? companyEntries 
    : guestEntries;

  const totalDebits = displayedEntries.filter(e => e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
  const totalCredits = displayedEntries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0);
  const balance = totalDebits - totalCredits;

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
              <p className="text-sm text-zinc-500">Reservation #{currentReservation.id.slice(-6).toUpperCase()}</p>
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
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[70] flex items-start justify-center p-4 overflow-y-auto">
            <div className="relative w-full max-w-5xl my-8">
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
                folioType={activeFolio}
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Folio Tabs for Corporate Stays */}
          {currentReservation.corporateId && (
            <div className="flex items-center bg-zinc-950 p-1 rounded-2xl border border-zinc-800 w-fit mx-auto">
              <button
                onClick={() => setActiveFolio('guest')}
                className={cn(
                  "px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all",
                  activeFolio === 'guest' ? "bg-emerald-500 text-black shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                Folio 2 (Guest)
              </button>
              <button
                onClick={() => setActiveFolio('company')}
                className={cn(
                  "px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all",
                  activeFolio === 'company' ? "bg-blue-500 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                Folio 1 (Company)
              </button>
            </div>
          )}

          {/* Quick Actions Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => setShowSettlePayment(true)}
              className="flex items-center justify-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-500 hover:bg-emerald-500 hover:text-black transition-all group active:scale-95"
            >
              <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <DollarSign size={20} />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-wider">Settle</p>
                <p className="text-sm font-bold">Payment</p>
              </div>
            </button>

            <button
              onClick={() => setShowTransferBalanceModal(true)}
              className="flex items-center justify-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-500 hover:bg-blue-500 hover:text-white transition-all group active:scale-95"
            >
              <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <RefreshCw size={20} />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-wider">Transfer</p>
                <p className="text-sm font-bold">Balance</p>
              </div>
            </button>

            <button
              onClick={() => setShowPostChargeModal(true)}
              className="flex items-center justify-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-500 hover:bg-amber-500 hover:text-black transition-all group active:scale-95"
            >
              <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <Plus size={20} />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-wider">Post</p>
                <p className="text-sm font-bold">Charge</p>
              </div>
            </button>

            <button
              onClick={() => setShowReceipt(true)}
              className="flex items-center justify-center gap-3 p-4 bg-zinc-800 border border-zinc-700 rounded-2xl text-zinc-300 hover:bg-zinc-700 hover:text-white transition-all group active:scale-95"
            >
              <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <Printer size={20} />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-wider">Print</p>
                <p className="text-sm font-bold">Receipt</p>
              </div>
            </button>
          </div>

          {/* Guest & Stay Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <User size={18} className="text-emerald-500" />
                <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">Guest Details</h3>
              </div>
              <div className="space-y-2">
                <p className="text-lg font-bold text-zinc-50">{currentReservation.guestName}</p>
                <p className="text-sm text-zinc-400">{currentReservation.guestEmail}</p>
                <p className="text-sm text-zinc-400">{currentReservation.guestPhone}</p>
                {guest && (
                  <p className={cn(
                    "text-xs font-bold mt-1",
                    (guest.ledgerBalance || 0) > 0 ? "text-red-500" : "text-emerald-500"
                  )}>
                    Guest Ledger Balance: {formatCurrency(Math.abs(guest.ledgerBalance || 0), currency, exchangeRate)}
                    {(guest.ledgerBalance || 0) > 0 ? " (Debt)" : (guest.ledgerBalance || 0) < 0 ? " (Credit)" : ""}
                  </p>
                )}
                {currentReservation.corporateId && (
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
                    <p className="text-lg font-bold text-zinc-50">{currentReservation.roomNumber}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Status</p>
                    <span className={cn(
                      "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                      currentReservation.status === 'checked_in' ? "bg-emerald-500/10 text-emerald-500" : "bg-blue-500/10 text-blue-500"
                    )}>
                      {currentReservation.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Check In</p>
                    <p className="text-sm text-zinc-50 font-medium">{format(new Date(currentReservation.checkIn), 'MMM d, yyyy')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Check Out</p>
                    <p className="text-sm text-zinc-50 font-medium">{format(new Date(currentReservation.checkOut), 'MMM d, yyyy')}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Banknote size={18} className="text-amber-500" />
                  <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">Folio Summary</h3>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Total Charges (Debits)</span>
                  <span className="text-zinc-50 font-bold">{formatCurrency(totalDebits, currency, exchangeRate)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Total Payments (Credits)</span>
                  <span className="text-emerald-500 font-bold">{formatCurrency(totalCredits, currency, exchangeRate)}</span>
                </div>
                
                <div className="pt-3 border-t border-zinc-800 flex justify-between items-center">
                  <span className="text-sm font-bold text-zinc-50 uppercase">Ledger Balance</span>
                  <div className="flex flex-col items-end">
                    <span className={cn(
                      "text-xl font-bold",
                      balance > 0 ? "text-red-500" : "text-emerald-500"
                    )}>
                      {formatCurrency(Math.abs(balance), currency, exchangeRate)}
                    </span>
                    <span className={cn(
                      "text-[10px] font-bold uppercase",
                      balance > 0 ? "text-red-500" : "text-emerald-500"
                    )}>
                      {balance > 0 ? (activeFolio === 'company' ? "Company Owing" : "Guest Owing") : balance < 0 ? "Credit Balance" : "Settled"}
                    </span>
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
                  Select another active reservation for {currentReservation.guestName} to transfer the current balance of {formatCurrency(balance, currency, exchangeRate)}.
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
                  <p className="text-sm text-zinc-500 mt-1">Refund or balance adjustment for {currentReservation.guestName}</p>
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
                        value={currency === 'USD' ? ((settleData.splits[0]?.amount || 0) / exchangeRate) || '' : (settleData.splits[0]?.amount || '')}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          const newAmount = currency === 'USD' ? val * exchangeRate : val;
                          const newSplits = [...settleData.splits];
                          if (newSplits.length === 0) {
                            newSplits.push({ amount: newAmount, method: 'cash' });
                          } else {
                            newSplits[0].amount = newAmount;
                          }
                          setSettleData({ ...settleData, splits: newSplits });
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        max={currency === 'USD' ? Math.abs(balance) / exchangeRate : Math.abs(balance)}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Refund Method</label>
                      <select
                        value={settleData.splits[0]?.method || 'cash'}
                        onChange={(e) => {
                          const newSplits = [...settleData.splits];
                          if (newSplits.length === 0) {
                            newSplits.push({ amount: 0, method: e.target.value as any });
                          } else {
                            newSplits[0].method = e.target.value as any;
                          }
                          setSettleData({ ...settleData, splits: newSplits });
                        }}
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
                      disabled={settleData.splits.reduce((acc, s) => acc + s.amount, 0) <= 0 || isSaving}
                      className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSaving ? 'Processing...' : 'Confirm Refund'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {showPostChargeModal && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-800">
                  <h2 className="text-xl font-bold text-zinc-50">Post Charge</h2>
                  <p className="text-sm text-zinc-500 mt-1">Post a new charge for {currentReservation.guestName}</p>
                </div>
                <form onSubmit={handlePostCharge}>
                  <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Category</label>
                        <select
                          value={chargeDetails.category}
                          onChange={(e) => setChargeDetails({ ...chargeDetails, category: e.target.value as any })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="restaurant">Restaurant</option>
                          <option value="service">Room Service</option>
                          <option value="laundry">Laundry</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Amount ({currency})</label>
                        <input
                          required
                          type="number"
                          value={currency === 'USD' ? (chargeDetails.amount / exchangeRate) || '' : chargeDetails.amount || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setChargeDetails({ ...chargeDetails, amount: currency === 'USD' ? val * exchangeRate : val });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                          step="0.01"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Description</label>
                      <input
                        required
                        type="text"
                        value={chargeDetails.description}
                        onChange={(e) => setChargeDetails({ ...chargeDetails, description: e.target.value })}
                        placeholder="e.g. Dinner at Rooftop, Laundry service..."
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Discount Type</label>
                        <select
                          value={chargeDetails.discountType}
                          onChange={(e) => setChargeDetails({ ...chargeDetails, discountType: e.target.value as any })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="fixed">Fixed Amount</option>
                          <option value="percentage">Percentage (%)</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Discount</label>
                        <input
                          type="number"
                          value={chargeDetails.discount || ''}
                          onChange={(e) => setChargeDetails({ ...chargeDetails, discount: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                          step="0.01"
                        />
                      </div>
                    </div>

                    {/* Tax Summary in Post Charge */}
                    <div className="pt-4 border-t border-zinc-800 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-500">Subtotal</span>
                        <span className="text-zinc-50">{formatCurrency(chargeDetails.amount, currency, exchangeRate)}</span>
                      </div>
                      {(() => {
                        const amountAfterDiscount = chargeDetails.discountType === 'fixed' 
                          ? chargeDetails.amount - chargeDetails.discount
                          : chargeDetails.amount * (1 - chargeDetails.discount / 100);

                        const activeTaxes = (hotel?.taxes || []).filter(t => {
                          const status = (t.status || '').toLowerCase().trim();
                          const category = (t.category || '').toLowerCase().trim();
                          const entryCategory = (chargeDetails.category || '').toLowerCase().trim();
                          return status === 'active' && 
                            (category === 'all' || 
                             category === entryCategory || 
                             ((entryCategory === 'f & b' || entryCategory === 'restaurant') && (category === 'f & b' || category === 'restaurant'))
                            );
                        });
                        
                        const totalExclusiveTax = activeTaxes
                          .filter(t => !t.isInclusive)
                          .reduce((acc, t) => acc + (amountAfterDiscount * (t.percentage / 100)), 0);

                        return (
                          <>
                            {activeTaxes.map(tax => (
                              <div key={tax.id} className="flex justify-between text-[10px]">
                                <span className={cn(tax.isInclusive ? "text-blue-400" : "text-emerald-400")}>
                                  {tax.name} ({tax.percentage}%){tax.isInclusive ? " [Incl.]" : ""}
                                </span>
                                <span className="text-zinc-400">
                                  {formatCurrency(tax.isInclusive 
                                    ? amountAfterDiscount - (amountAfterDiscount / (1 + (tax.percentage / 100)))
                                    : (amountAfterDiscount * (tax.percentage / 100)), currency, exchangeRate)}
                                </span>
                              </div>
                            ))}
                            <div className="flex justify-between items-center pt-2 border-t border-zinc-800 mt-2">
                              <span className="text-sm font-bold text-zinc-50">Total Charge</span>
                              <span className="text-lg font-black text-emerald-500">
                                {formatCurrency(amountAfterDiscount + totalExclusiveTax, currency, exchangeRate)}
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowPostChargeModal(false)}
                      className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!chargeDetails.amount || isSaving}
                      className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSaving ? 'Posting...' : 'Post Charge'}
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
                  <p className="text-sm text-zinc-500 mt-1">Record payment for {currentReservation.guestName}</p>
                </div>
                <form onSubmit={handleSettlePayment}>
                  <div className="p-6 space-y-6">
                    <div className="flex flex-col gap-2 bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                          <Banknote size={20} />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-bold text-zinc-500 uppercase">Balance Due</p>
                          <p className="text-lg font-bold text-red-500">{formatCurrency(balance, currency, exchangeRate)}</p>
                        </div>
                      </div>
                      
                      {/* Detailed Balance Breakdown */}
                      <div className="pt-3 border-t border-zinc-800 space-y-1">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-zinc-500 uppercase">Principal Charges</span>
                          <span className="text-zinc-300">{formatCurrency(displayedEntries.filter(e => e.type === 'debit' && e.category !== 'tax').reduce((acc, e) => acc + e.amount, 0), currency, exchangeRate)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-zinc-500 uppercase">Taxes & Fees</span>
                          <span className="text-zinc-300">{formatCurrency(displayedEntries.filter(e => e.type === 'debit' && e.category === 'tax').reduce((acc, e) => acc + e.amount, 0), currency, exchangeRate)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-zinc-500 uppercase">Total Payments</span>
                          <span className="text-emerald-500">-{formatCurrency(displayedEntries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0), currency, exchangeRate)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Payment Splits</label>
                        <button
                          type="button"
                          onClick={() => setSettleData({
                            ...settleData,
                            splits: [...settleData.splits, { amount: 0, method: 'cash' }]
                          })}
                          className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 hover:text-emerald-400 uppercase"
                        >
                          <PlusCircle size={12} /> Add Split
                        </button>
                      </div>

                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {settleData.splits.map((split, index) => (
                          <div key={index} className="p-4 bg-zinc-950/50 border border-zinc-800 rounded-2xl space-y-3 relative group">
                            {settleData.splits.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const newSplits = [...settleData.splits];
                                  newSplits.splice(index, 1);
                                  setSettleData({ ...settleData, splits: newSplits });
                                }}
                                className="absolute top-2 right-2 p-1.5 text-zinc-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase">Amount ({currency})</label>
                                <input
                                  required
                                  type="number"
                                  value={currency === 'USD' ? (split.amount / exchangeRate) || '' : split.amount || ''}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    const newSplits = [...settleData.splits];
                                    newSplits[index].amount = currency === 'USD' ? val * exchangeRate : val;
                                    setSettleData({ ...settleData, splits: newSplits });
                                  }}
                                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                                  step="0.01"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase">Method</label>
                                <select
                                  value={split.method}
                                  onChange={(e) => {
                                    const newSplits = [...settleData.splits];
                                    newSplits[index].method = e.target.value as any;
                                    setSettleData({ ...settleData, splits: newSplits });
                                  }}
                                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                                >
                                  <option value="cash">Cash</option>
                                  <option value="card">Card</option>
                                  <option value="transfer">Bank Transfer</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="p-3 bg-zinc-900/50 rounded-xl border border-dashed border-zinc-800 flex justify-between items-center text-xs">
                        <span className="text-zinc-500 font-bold uppercase">Total Settlement</span>
                        <span className="text-zinc-50 font-black">
                          {formatCurrency(settleData.splits.reduce((acc, s) => acc + s.amount, 0), currency, exchangeRate)}
                        </span>
                      </div>
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
                      disabled={settleData.splits.reduce((acc, s) => acc + s.amount, 0) <= 0 || isSaving}
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
              <div className="flex items-center gap-4">
                {currentReservation.status === 'checked_in' && (
                  <button 
                    onClick={handleManualNightlyCharge}
                    disabled={isAuditing}
                    className="flex items-center gap-2 text-xs font-bold text-blue-500 hover:text-blue-400 transition-colors disabled:opacity-50"
                  >
                    <Clock size={14} />
                    {isAuditing ? 'Posting...' : 'Post Nightly Charge'}
                  </button>
                )}
                {onPostCharge && currentReservation.status === 'checked_in' && (
                  <button 
                    onClick={() => setShowPostChargeModal(true)}
                    className="flex items-center gap-2 text-xs font-bold text-emerald-500 hover:text-emerald-400 transition-colors"
                  >
                    <Plus size={14} />
                    Post Extra Charge
                  </button>
                )}
              </div>
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
                  ) : displayedEntries.length === 0 ? (
                    <tr>
                      <td colSpan={(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') ? 6 : 5} className="px-6 py-12 text-center text-zinc-500">
                        No transactions recorded for this folio.
                      </td>
                    </tr>
                  ) : (
                    displayedEntries.map((entry) => (
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
                    <td colSpan={3} className="px-6 py-4 text-right text-[10px] font-bold text-zinc-500 uppercase">Ledger Totals</td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-red-500">
                      {formatCurrency(totalDebits, currency, exchangeRate)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-emerald-500">
                      {formatCurrency(totalCredits, currency, exchangeRate)}
                    </td>
                    {(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                      <td className="px-6 py-4"></td>
                    )}
                  </tr>
                  <tr className="border-t border-zinc-800/50">
                    <td colSpan={3} className="px-6 py-2 text-right text-[10px] font-bold text-zinc-500 uppercase">Net Balance</td>
                    <td colSpan={2} className={cn(
                      "px-6 py-2 text-right text-sm font-black",
                      (totalDebits - totalCredits) > 0 ? "text-red-500" : "text-emerald-500"
                    )}>
                      {formatCurrency(Math.abs(totalDebits - totalCredits), currency, exchangeRate)}
                      {(totalDebits - totalCredits) > 0 ? " (Owing)" : (totalDebits - totalCredits) < 0 ? " (Credit)" : " (Settled)"}
                    </td>
                    {(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                      <td className="px-6 py-2"></td>
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
                ...displayedEntries.map(e => [
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
              link.download = `folio_${currentReservation.id.slice(-6)}.csv`;
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
