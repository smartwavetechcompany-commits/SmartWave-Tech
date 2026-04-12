import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy, doc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { CorporateAccount, LedgerEntry, OperationType } from '../types';
import { 
  Receipt, 
  Building2, 
  Calendar, 
  DollarSign,
  Clock,
  XCircle,
  Printer,
  Download,
  FileText
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn, formatCurrency } from '../utils';
import { format } from 'date-fns';

interface CorporateFolioProps {
  account: CorporateAccount;
  onClose: () => void;
}

export function CorporateFolio({ account, onClose }: CorporateFolioProps) {
  const { hotel, currency, exchangeRate } = useAuth();
  const [currentAccount, setCurrentAccount] = useState<CorporateAccount>(account);

  useEffect(() => {
    setCurrentAccount(account);
  }, [account]);

  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

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

    return () => {
      unsubAccount();
      unsubLedger();
    };
  }, [hotel?.id, account.id]);

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

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
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
      </motion.div>
    </div>
  );
}
