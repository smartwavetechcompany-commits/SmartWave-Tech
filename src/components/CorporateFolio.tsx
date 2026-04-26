import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy, doc } from 'firebase/firestore';
import { db, handleFirestoreError, safeAdd, safeWrite, serverTimestamp } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { CorporateAccount, LedgerEntry, OperationType, Reservation } from '../types';
import { ReceiptGenerator } from './ReceiptGenerator';
import { 
  Receipt, 
  Building2, 
  Calendar, 
  DollarSign,
  Clock,
  XCircle,
  Printer,
  Download,
  FileText,
  Plus,
  ArrowRightLeft,
  Banknote,
  PlusCircle,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../utils';
import { format } from 'date-fns';
import { increment, updateDoc, addDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { transferCorporateBalance } from '../services/ledgerService';

interface CorporateFolioProps {
  account: CorporateAccount;
  onClose: () => void;
}

export function CorporateFolio({ account, onClose }: CorporateFolioProps) {
  const { hotel, currency, exchangeRate, profile } = useAuth();
  const [currentAccount, setCurrentAccount] = useState<CorporateAccount>(account);

  useEffect(() => {
    setCurrentAccount(account);
  }, [account]);

  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [individualReservations, setIndividualReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showSettlePayment, setShowSettlePayment] = useState(false);
  const [showPostCharge, setShowPostPostCharge] = useState(false);
  const [showTransferBalance, setShowTransferBalance] = useState(false);
  const [corporateAccounts, setCorporateAccounts] = useState<CorporateAccount[]>([]);
  const [transferData, setTransferData] = useState({ targetId: '', amount: 0, notes: '' });
  const [settleData, setSettleData] = useState({ 
    splits: [{ amount: 0, method: 'cash' }] as { amount: number; method: 'cash' | 'card' | 'transfer' }[], 
    notes: '' 
  });
  const [chargeData, setChargeData] = useState({ amount: 0, category: 'other', description: '' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!hotel?.id || !account.id) return;

    // Listen to account document for real-time updates
    const unsubAccount = onSnapshot(doc(db, 'hotels', hotel.id, 'corporate_accounts', account.id), (snap) => {
      if (snap.exists()) {
        setCurrentAccount({ id: snap.id, ...snap.data() } as CorporateAccount);
      }
    });

    // Listen to ledger entries for this corporate account
    const q = query(
      collection(db, 'hotels', hotel.id, 'ledger'),
      where('corporateId', '==', account.id),
      orderBy('timestamp', 'desc')
    );

    const unsubLedger = onSnapshot(q, (snap) => {
      setLedgerEntries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LedgerEntry)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/ledger`);
    });

    // Listen to individual reservations linked to this corporate account
    const qRes = query(
      collection(db, 'hotels', hotel.id, 'reservations'),
      where('corporateId', '==', account.id),
      where('status', '==', 'checked_in')
    );

    const unsubRes = onSnapshot(qRes, (snap) => {
      setIndividualReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    });

    return () => {
      unsubAccount();
      unsubLedger();
      unsubRes();
    };
  }, [hotel?.id, account.id]);

  useEffect(() => {
    if (!hotel?.id) return;
    const q = query(collection(db, 'hotels', hotel.id, 'corporate_accounts'));
    const unsub = onSnapshot(q, (snap) => {
      setCorporateAccounts(snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as CorporateAccount))
        .filter(acc => acc.id !== account.id)
      );
    });
    return () => unsub();
  }, [hotel?.id, account.id]);

  const handleSettlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !currentAccount) return;

    try {
      setIsSaving(true);
      const timestamp = new Date().toISOString();
      const totalAmount = settleData.splits.reduce((acc, s) => acc + s.amount, 0);

      if (totalAmount <= 0) {
        toast.error('Payment amount must be greater than zero');
        return;
      }

      // 1. Update account balance (total amount)
      await safeWrite(doc(db, 'hotels', hotel.id, 'corporate_accounts', currentAccount.id), {
        currentBalance: increment(-totalAmount),
        totalCredits: increment(totalAmount),
        updatedAt: serverTimestamp()
      }, hotel.id, 'SETTLE_CORPORATE_PAYMENT');

      // 2. Process each split
      const actionTimestamp = serverTimestamp();
      for (const split of settleData.splits) {
        if (split.amount > 0) {
          // Add to Ledger
          await safeAdd(collection(db, 'hotels', hotel.id, 'ledger'), {
            hotelId: hotel.id,
            corporateId: currentAccount.id,
            reservationId: 'CORPORATE_SETTLEMENT',
            amount: split.amount,
            type: 'credit',
            category: 'payment',
            description: settleData.notes || `Corporate Settlement: ${currentAccount.name} (${split.method})`,
            paymentMethod: split.method,
            postedBy: profile.uid,
            timestamp: actionTimestamp,
            createdAt: actionTimestamp,
            updatedAt: actionTimestamp
          }, hotel.id, 'POST_CORPORATE_PAYMENT_LEDGER');

          // Log to finance
          await safeAdd(collection(db, 'hotels', hotel.id, 'finance'), {
            type: 'income',
            amount: split.amount,
            category: 'Corporate Payment',
            description: `Corporate Settlement: ${currentAccount.name}`,
            paymentMethod: split.method,
            referenceId: currentAccount.id,
            timestamp: actionTimestamp,
            createdAt: actionTimestamp,
            updatedAt: actionTimestamp
          }, hotel.id, 'POST_CORPORATE_PAYMENT_FINANCE');
        }
      }

      toast.success('Payment settled successfully');
      setShowSettlePayment(false);
      setSettleData({ splits: [{ amount: 0, method: 'cash' }], notes: '' });
    } catch (err) {
      console.error("Settlement error:", err);
      toast.error('Failed to settle payment');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePostCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !currentAccount) return;

    try {
      setIsSaving(true);
      const timestamp = new Date().toISOString();

      // 1. Update account balance
      const actionTimestamp = serverTimestamp();
      await safeWrite(doc(db, 'hotels', hotel.id, 'corporate_accounts', currentAccount.id), {
        currentBalance: increment(chargeData.amount),
        totalDebits: increment(chargeData.amount),
        updatedAt: actionTimestamp
      }, hotel.id, 'POST_CORPORATE_CHARGE');

      // 2. Add to Ledger
      await safeAdd(collection(db, 'hotels', hotel.id, 'ledger'), {
        hotelId: hotel.id,
        corporateId: currentAccount.id,
        reservationId: 'CORPORATE_CHARGE',
        amount: chargeData.amount,
        type: 'debit',
        category: chargeData.category,
        description: chargeData.description,
        postedBy: profile.uid,
        timestamp: actionTimestamp,
        createdAt: actionTimestamp,
        updatedAt: actionTimestamp
      }, hotel.id, 'POST_CORPORATE_CHARGE_LEDGER');

      toast.success('Charge posted successfully');
      setShowPostPostCharge(false);
      setChargeData({ amount: 0, category: 'other', description: '' });
    } catch (err) {
      console.error("Charge error:", err);
      toast.error('Failed to post charge');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTransferBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !currentAccount || !transferData.targetId) return;

    try {
      setIsSaving(true);
      await transferCorporateBalance(
        hotel.id,
        currentAccount.id,
        transferData.targetId,
        transferData.amount,
        profile.uid,
        transferData.notes
      );

      toast.success('Balance transferred successfully');
      setShowTransferBalance(false);
      setTransferData({ targetId: '', amount: 0, notes: '' });
    } catch (err: any) {
      console.error("Transfer error:", err);
      toast.error('Failed to transfer balance');
    } finally {
      setIsSaving(false);
    }
  };

  const totalDebits = ledgerEntries.filter(e => e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
  const totalCredits = ledgerEntries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0);
  const balance = totalDebits - totalCredits;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500">
              <Building2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Corporate Folio</h2>
              <p className="text-sm text-zinc-500">{currentAccount.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowReceipt(true)}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-all"
              title="Print Receipt"
            >
              <Receipt size={20} />
            </button>
            <button 
              onClick={() => window.print()}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-all"
              title="Print Folio"
            >
              <Printer size={20} />
            </button>
            <button 
              onClick={onClose}
              className="p-2 text-zinc-500 hover:text-white transition-colors"
            >
              <XCircle size={24} />
            </button>
          </div>
        </div>

        {showReceipt && hotel && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[70] flex items-start justify-center p-4 overflow-y-auto">
            <div className="relative w-full max-w-md my-8">
              <button 
                onClick={() => setShowReceipt(false)}
                className="absolute -top-12 right-0 p-2 text-zinc-50 hover:bg-white/10 rounded-full transition-all"
              >
                <XCircle size={32} />
              </button>
              <ReceiptGenerator 
                hotel={hotel} 
                account={currentAccount} 
                type="corporate" 
                ledgerEntries={ledgerEntries} 
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Quick Actions Bar */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <button
              onClick={() => {
                setSettleData(prev => ({ ...prev, amount: balance > 0 ? balance : 0 }));
                setShowSettlePayment(true);
              }}
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
              onClick={() => {
                setTransferData(prev => ({ ...prev, amount: balance > 0 ? balance : 0 }));
                setShowTransferBalance(true);
              }}
              className="flex items-center justify-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-500 hover:bg-blue-500 hover:text-white transition-all group active:scale-95"
            >
              <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <ArrowRightLeft size={20} />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-wider">Transfer</p>
                <p className="text-sm font-bold">Balance</p>
              </div>
            </button>

            <button
              onClick={() => setShowPostPostCharge(true)}
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

          {/* Account Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <Building2 size={18} className="text-blue-500" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Account Details</h3>
              </div>
              <div className="space-y-2">
                <p className="text-lg font-bold text-white">{currentAccount.name}</p>
                <p className="text-sm text-zinc-400">{currentAccount.contactPerson}</p>
                <p className="text-sm text-zinc-400">{currentAccount.email}</p>
                <p className="text-sm text-zinc-400">{currentAccount.phone}</p>
              </div>
            </div>

            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <FileText size={18} className="text-emerald-500" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Billing Info</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Tax ID</span>
                  <span className="text-white font-medium">{currentAccount.taxId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Cycle</span>
                  <span className="text-white font-medium capitalize">{currentAccount.billingCycle}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Credit Limit</span>
                  <span className="text-white font-bold">{formatCurrency(currentAccount.creditLimit, currency, exchangeRate)}</span>
                </div>
              </div>
            </div>

            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <DollarSign size={18} className="text-amber-500" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Financial Summary</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Total Charges</span>
                  <span className="text-white font-bold">{formatCurrency(totalDebits, currency, exchangeRate)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Total Payments</span>
                  <span className="text-emerald-500 font-bold">{formatCurrency(totalCredits, currency, exchangeRate)}</span>
                </div>
                <div className="pt-3 border-t border-zinc-800 flex justify-between items-center">
                  <span className="text-sm font-bold text-white uppercase">Outstanding</span>
                  <span className={cn(
                    "text-xl font-bold",
                    balance > 0 ? "text-red-500" : "text-emerald-500"
                  )}>
                    {formatCurrency(balance, currency, exchangeRate)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Individual Guest Balances */}
          {individualReservations.length > 0 && (
            <div className="bg-zinc-950 rounded-2xl border border-zinc-800 overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Individual Guest Balances</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800 bg-zinc-900/30">
                      <th className="px-6 py-3">Guest Name</th>
                      <th className="px-6 py-3">Room</th>
                      <th className="px-6 py-3">Check In</th>
                      <th className="px-6 py-3">Check Out</th>
                      <th className="px-6 py-3 text-right">Ledger Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {individualReservations.map((res) => (
                      <tr key={res.id} className="hover:bg-zinc-900/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="text-sm text-white font-medium">{res.guestName}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-400">
                          Room {res.roomNumber}
                        </td>
                        <td className="px-6 py-4 text-xs text-zinc-400">
                          {format(new Date(res.checkIn), 'MMM d, yyyy')}
                        </td>
                        <td className="px-6 py-4 text-xs text-zinc-400">
                          {format(new Date(res.checkOut), 'MMM d, yyyy')}
                        </td>
                        <td className={cn(
                          "px-6 py-4 text-right text-sm font-bold",
                          (res.ledgerBalance || 0) > 0 ? "text-red-500" : "text-emerald-500"
                        )}>
                          {formatCurrency(Math.abs(res.ledgerBalance || 0), currency, exchangeRate)}
                          {(res.ledgerBalance || 0) > 0 ? " (Debt)" : (res.ledgerBalance || 0) < 0 ? " (Credit)" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ledger Entries Table */}
          <div className="bg-zinc-950 rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Transaction History</h3>
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
                        <Clock size={24} className="mx-auto mb-2 animate-spin opacity-20" />
                        Loading transactions...
                      </td>
                    </tr>
                  ) : ledgerEntries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
                        No transactions recorded for this account.
                      </td>
                    </tr>
                  ) : (
                    ledgerEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-900/50 transition-colors">
                        <td className="px-6 py-4 text-xs text-zinc-400">
                          {format(new Date(entry.timestamp), 'MMM d, HH:mm')}
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-white font-medium">{entry.description}</div>
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
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="bg-zinc-900/30 border-t border-zinc-800">
                  <tr>
                    <td colSpan={3} className="px-6 py-4 text-right text-[10px] font-bold text-zinc-500 uppercase">Totals</td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-red-500">
                      {formatCurrency(totalDebits, currency, exchangeRate)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-emerald-500">
                      {formatCurrency(totalCredits, currency, exchangeRate)}
                    </td>
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
              link.download = `corporate_folio_${currentAccount.name.replace(/\s+/g, '_')}.csv`;
              link.click();
            }}
            className="flex items-center gap-2 px-6 py-3 bg-zinc-800 text-white rounded-xl font-bold hover:bg-zinc-700 transition-all active:scale-95"
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

        {/* Transfer Balance Modal */}
        {showTransferBalance && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-zinc-50">Transfer Balance</h3>
                <button onClick={() => setShowTransferBalance(false)} className="text-zinc-500 hover:text-zinc-50">
                  <XCircle size={24} />
                </button>
              </div>

              <form onSubmit={handleTransferBalance} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Target Corporate Account</label>
                  <select 
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={transferData.targetId}
                    onChange={(e) => setTransferData({ ...transferData, targetId: e.target.value })}
                  >
                    <option value="">Select Account</option>
                    {corporateAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.name} (Bal: {formatCurrency(acc.currentBalance || 0, currency, exchangeRate)})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Amount to Transfer</label>
                  <input 
                    required
                    type="number" 
                    step="0.01"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={transferData.amount || ''}
                    onChange={(e) => setTransferData({ ...transferData, amount: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">Current Balance: {formatCurrency(balance, currency, exchangeRate)}</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Notes</label>
                  <textarea 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-20"
                    placeholder="Reason for transfer..."
                    value={transferData.notes}
                    onChange={(e) => setTransferData({ ...transferData, notes: e.target.value })}
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowTransferBalance(false)}
                    className="flex-1 py-3 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isSaving || !transferData.targetId || transferData.amount <= 0}
                    className="flex-1 py-3 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-400 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isSaving ? 'Processing...' : 'Transfer Now'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Settle Payment Modal */}
        <AnimatePresence>
          {showSettlePayment && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-800">
                  <h2 className="text-xl font-bold text-white">Settle Corporate Payment</h2>
                  <p className="text-sm text-zinc-500">Post a credit to settle the outstanding balance</p>
                </div>
                <form onSubmit={handleSettlePayment}>
                  <div className="p-6 space-y-6">
                    <div className="flex items-center gap-4 bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                        <Banknote size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-zinc-500 uppercase">Current Balance</p>
                        <p className="text-lg font-bold text-red-500">{formatCurrency(currentAccount.currentBalance, currency, exchangeRate)}</p>
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

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Notes</label>
                      <textarea
                        value={settleData.notes}
                        onChange={(e) => setSettleData({ ...settleData, notes: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50 h-20 resize-none"
                        placeholder="e.g. Monthly settlement, Check #1234..."
                      />
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
                      className="flex-1 px-4 py-2 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSaving ? 'Processing...' : 'Settle Payment'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {showPostCharge && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-800">
                  <h2 className="text-xl font-bold text-white">Post Corporate Charge</h2>
                  <p className="text-sm text-zinc-500">Add a debit entry to the corporate account</p>
                </div>
                <form onSubmit={handlePostCharge}>
                  <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Category</label>
                        <select
                          value={chargeData.category}
                          onChange={(e) => setChargeData({ ...chargeData, category: e.target.value })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="room">Room</option>
                          <option value="f&b">F&B</option>
                          <option value="laundry">Laundry</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Amount ({currency})</label>
                        <input
                          required
                          type="number"
                          min="1"
                          value={chargeData.amount}
                          onChange={(e) => setChargeData({ ...chargeData, amount: Number(e.target.value) })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Description</label>
                      <textarea
                        required
                        value={chargeData.description}
                        onChange={(e) => setChargeData({ ...chargeData, description: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50 h-20 resize-none"
                        placeholder="e.g. Conference room rental, Extra service fee..."
                      />
                    </div>
                  </div>
                  <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowPostPostCharge(false)}
                      className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="flex-1 px-4 py-2 bg-amber-500 text-black rounded-xl font-bold hover:bg-amber-400 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSaving ? 'Posting...' : 'Post Charge'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
