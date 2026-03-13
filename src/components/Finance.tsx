import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { FinanceRecord } from '../types';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Plus,
  Search,
  Calendar,
  Filter
} from 'lucide-react';
import { cn, formatCurrency } from '../utils';
import { format, isToday, isValid } from 'date-fns';

export function Finance() {
  const { hotel, profile } = useAuth();
  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newRecord, setNewRecord] = useState({
    description: '',
    amount: 0,
    type: 'income' as 'income' | 'expense',
    category: 'Room Revenue'
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    const q = query(collection(db, 'hotels', hotel.id, 'finance'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, 
      (snap) => {
        setRecords(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceRecord)));
      },
      (error) => {
        if (error.code === 'permission-denied') {
          console.warn("Finance access restricted.");
          setHasPermissionError(true);
        } else {
          console.error("Finance records listener error:", error);
        }
      }
    );
    return () => unsubscribe();
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id) return;

    await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
      ...newRecord,
      timestamp: new Date().toISOString()
    });

    // Log action
    await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
      timestamp: new Date().toISOString(),
      user: profile?.email || profile?.uid || 'Unknown',
      action: 'FINANCE_RECORD_CREATED',
      module: `${newRecord.type.toUpperCase()}: ${newRecord.description} (${formatCurrency(newRecord.amount)})`
    });

    setIsAdding(false);
    setNewRecord({ description: '', amount: 0, type: 'income', category: 'Room Revenue' });
  };

  const safeFormat = (date: any, formatStr: string) => {
    try {
      const d = new Date(date);
      if (!isValid(d)) return 'N/A';
      return format(d, formatStr);
    } catch (e) {
      return 'N/A';
    }
  };

  const totalIncome = records.filter(r => r.type === 'income').reduce((acc, r) => acc + r.amount, 0);
  const totalExpense = records.filter(r => r.type === 'expense').reduce((acc, r) => acc + r.amount, 0);
  const balance = totalIncome - totalExpense;

  const todayRecords = records.filter(r => isToday(new Date(r.timestamp)));
  const todayIncome = todayRecords.filter(r => r.type === 'income').reduce((acc, r) => acc + r.amount, 0);
  const todayExpense = todayRecords.filter(r => r.type === 'expense').reduce((acc, r) => acc + r.amount, 0);

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Finance</h1>
          <p className="text-zinc-400">Track income, expenses, and cash flow</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="w-full sm:w-auto bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
        >
          <Plus size={18} />
          Add Record
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <TrendingUp size={20} />
            </div>
            <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider bg-emerald-500/5 px-2 py-1 rounded">
              Today: {formatCurrency(todayIncome)}
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{formatCurrency(totalIncome)}</div>
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Income</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-red-500/10 text-red-500">
              <TrendingDown size={20} />
            </div>
            <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider bg-red-500/5 px-2 py-1 rounded">
              Today: {formatCurrency(todayExpense)}
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{formatCurrency(totalExpense)}</div>
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Expenses</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <DollarSign size={20} />
            </div>
            <div className="text-[10px] font-bold text-blue-500 uppercase tracking-wider bg-blue-500/5 px-2 py-1 rounded">
              Today: {formatCurrency(todayIncome - todayExpense)}
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{formatCurrency(balance)}</div>
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Net Balance</div>
        </div>
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-6">Add Finance Record</h3>
            <form onSubmit={handleAddRecord} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Description</label>
                <input 
                  required
                  type="text" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newRecord.description}
                  onChange={(e) => setNewRecord({ ...newRecord, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Amount</label>
                  <input 
                    required
                    type="number" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newRecord.amount}
                    onChange={(e) => setNewRecord({ ...newRecord, amount: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Type</label>
                  <select 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newRecord.type}
                    onChange={(e) => setNewRecord({ ...newRecord, type: e.target.value as 'income' | 'expense' })}
                  >
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-4 mt-8">
                <button 
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="font-bold text-white">Transaction History</h3>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
              <input 
                type="text" 
                placeholder="Search..."
                className="bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {records.map(record => (
                <tr key={record.id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4 text-sm text-zinc-400">
                    {safeFormat(record.timestamp, 'MMM d, yyyy')}
                  </td>
                  <td className="px-6 py-4 text-sm text-white font-medium">{record.description}</td>
                  <td className="px-6 py-4 text-sm text-zinc-500">{record.category}</td>
                  <td className={cn(
                    "px-6 py-4 text-sm font-bold",
                    record.type === 'income' ? "text-emerald-500" : "text-red-500"
                  )}>
                    {record.type === 'income' ? '+' : '-'}{formatCurrency(record.amount)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                      record.type === 'income' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                    )}>
                      {record.type}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
