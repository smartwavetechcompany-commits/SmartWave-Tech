import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy, addDoc, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { FinanceRecord, OperationType, Guest, Reservation, Room } from '../types';
import { settleLedger, refundGuest, settleOverpayment } from '../services/ledgerService';
import { syncDailyCharges } from '../services/financeService';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Plus,
  Search,
  Calendar,
  Filter,
  Download,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  PieChart,
  BarChart3,
  ChevronRight,
  CreditCard,
  Banknote,
  Send,
  RefreshCw,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { cn, formatCurrency, exportToCSV } from '../utils';
import { fuzzySearch } from '../utils/searchUtils';
import { format, isToday, isValid, startOfMonth, endOfMonth, isWithinInterval, subMonths, startOfDay } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { toast } from 'sonner';

export function Finance() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [timeRange, setTimeRange] = useState<'today' | 'month' | 'all'>('month');
  const [newRecord, setNewRecord] = useState({
    description: '',
    amount: 0,
    type: 'income' as 'income' | 'expense',
    category: 'Room Revenue',
    paymentMethod: 'cash' as 'cash' | 'card' | 'transfer'
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [activeTab, setActiveTab] = useState<'transactions' | 'ledger'>('transactions');
  const [guests, setGuests] = useState<Guest[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState<Guest | null>(null);
  const [settleData, setSettleData] = useState({
    amount: 0,
    method: 'cash' as 'cash' | 'card' | 'transfer',
    notes: ''
  });

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    
    const q = query(collection(db, 'hotels', hotel.id, 'finance'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setRecords(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceRecord)));
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/finance`);
      if (error.code === 'permission-denied') {
        setHasPermissionError(true);
      }
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    
    const q = query(collection(db, 'hotels', hotel.id, 'guests'), where('ledgerBalance', '!=', 0));
    const unsub = onSnapshot(q, (snap) => {
      setGuests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Guest)));
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/guests`);
    });

    // Fetch reservations and rooms for syncing
    const unsubRes = onSnapshot(collection(db, 'hotels', hotel.id, 'reservations'), (snap) => {
      setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    });

    const unsubRooms = onSnapshot(collection(db, 'hotels', hotel.id, 'rooms'), (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
    });

    return () => {
      unsub();
      unsubRes();
      unsubRooms();
    };
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  const handleSyncCharges = async () => {
    if (!hotel?.id || !profile) return;
    setIsSyncing(true);
    try {
      const result = await syncDailyCharges(hotel.id, profile.uid, profile.email, reservations, rooms, guests);
      if (result.chargedCount > 0) {
        toast.success(`Successfully synced ${result.chargedCount} charges totaling ${formatCurrency(result.totalAmount, currency, exchangeRate)}`);
      } else {
        toast.info('All guest accounts are up to date.');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to sync charges');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSettleBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !showSettleModal) return;

    try {
      setIsSaving(true);
      const guest = showSettleModal;
      const amount = settleData.amount;
      
      // Find the most recent reservation for this guest to post the ledger entry
      const lastRes = reservations
        .filter(r => r.guestId === guest.id)
        .sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime())[0];

      if (!lastRes) {
        toast.error('No reservation found for this guest to post the settlement.');
        return;
      }

      if (guest.ledgerBalance < 0) {
        // Guest owes money: Post a payment (credit)
        await settleLedger(hotel.id, guest.id, lastRes.id, amount, settleData.method, profile.uid);
        
        // Record as income
        await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
          type: 'income',
          amount: amount,
          category: 'Room Revenue',
          description: `Balance Settlement: ${guest.name} (${settleData.notes || 'No notes'})`,
          timestamp: new Date().toISOString(),
          paymentMethod: settleData.method
        });
      } else {
        // Guest has credit: Post a refund/settlement (debit)
        await settleOverpayment(hotel.id, guest.id, lastRes.id, amount, settleData.method, profile.uid);
        
        // Record as expense
        await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
          type: 'expense',
          amount: amount,
          category: 'Other',
          description: `Overpayment Refund: ${guest.name} (${settleData.notes || 'No notes'})`,
          timestamp: new Date().toISOString(),
          paymentMethod: settleData.method
        });
      }

      toast.success('Balance settled successfully');
      setShowSettleModal(null);
      setSettleData({ amount: 0, method: 'cash', notes: '' });
    } catch (err) {
      console.error(err);
      toast.error('Failed to settle balance');
    } finally {
      setIsSaving(false);
    }
  };
  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id) return;

    try {
      await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
        ...newRecord,
        timestamp: new Date().toISOString()
      });

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'FINANCE_RECORD_CREATED',
        resource: `${newRecord.type.toUpperCase()}: ${newRecord.description} (${formatCurrency(newRecord.amount, currency, exchangeRate)})`,
        hotelId: hotel.id,
        module: 'Finance'
      });

      setShowAddModal(false);
      setNewRecord({ description: '', amount: 0, type: 'income', category: 'Room Revenue', paymentMethod: 'cash' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/finance`);
    }
  };

  const filteredRecords = records.filter(r => {
    const matchesSearch = fuzzySearch(r.description || '', searchQuery) || 
                         fuzzySearch(r.category || '', searchQuery);
    const matchesType = filterType === 'all' || r.type === filterType;
    
    let matchesTime = true;
    if (timeRange === 'today') matchesTime = isToday(new Date(r.timestamp));
    if (timeRange === 'month') {
      const start = startOfMonth(new Date());
      const end = endOfMonth(new Date());
      matchesTime = isWithinInterval(new Date(r.timestamp), { start, end });
    }

    return matchesSearch && matchesType && matchesTime;
  });

  const totalIncome = filteredRecords.filter(r => r.type === 'income').reduce((acc, r) => acc + r.amount, 0);
  const totalExpense = filteredRecords.filter(r => r.type === 'expense').reduce((acc, r) => acc + r.amount, 0);
  const balance = totalIncome - totalExpense;

  const stats = [
    { label: 'Net Balance', value: formatCurrency(balance, currency, exchangeRate), icon: Wallet, color: 'text-white', bg: 'bg-zinc-900' },
    { label: 'Total Income', value: formatCurrency(totalIncome, currency, exchangeRate), icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/5' },
    { label: 'Total Expenses', value: formatCurrency(totalExpense, currency, exchangeRate), icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-500/5' },
    { label: "Transactions", value: filteredRecords.length, icon: BarChart3, color: 'text-amber-500', bg: 'bg-amber-500/5' },
  ];

  const categories = {
    income: ['Room Revenue', 'Restaurant', 'Laundry', 'Events', 'Other'],
    expense: ['Salaries', 'Maintenance', 'Utilities', 'Supplies', 'Marketing', 'Taxes', 'Other']
  };

  const chartData = [
    { name: 'Income', value: totalIncome, color: '#10b981' },
    { name: 'Expense', value: totalExpense, color: '#ef4444' }
  ];

  const filteredLedger = guests.filter(g => 
    (g.ledgerBalance || 0) !== 0 && (
      fuzzySearch(g.name || '', searchQuery) || 
      fuzzySearch(g.email || '', searchQuery) || 
      fuzzySearch(g.phone || '', searchQuery)
    )
  );

  const handleExport = () => {
    const dataToExport = activeTab === 'transactions' ? filteredRecords : filteredLedger;
    const filename = activeTab === 'transactions' ? `transactions_${format(new Date(), 'yyyy-MM-dd')}.csv` : `ledger_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    
    const formattedData = dataToExport.map(item => {
      if (activeTab === 'transactions') {
        const record = item as FinanceRecord;
        return {
          Date: format(new Date(record.timestamp), 'yyyy-MM-dd HH:mm'),
          Description: record.description,
          Type: record.type,
          Category: record.category,
          Amount: record.amount,
          PaymentMethod: record.paymentMethod
        };
      } else {
        const guest = item as Guest;
        return {
          Name: guest.name,
          Email: guest.email,
          Phone: guest.phone,
          Balance: guest.ledgerBalance || 0,
          Status: (guest.ledgerBalance || 0) < 0 ? 'Debt' : (guest.ledgerBalance || 0) > 0 ? 'Credit' : 'Balanced'
        };
      }
    });

    exportToCSV(formattedData, filename);
    toast.success('Exported successfully');
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Financial Management</h1>
          <p className="text-zinc-400">Track income, expenses and overall hotel performance</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleSyncCharges}
            disabled={isSyncing}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50"
            title="Sync missing daily charges for all checked-in guests"
          >
            <RefreshCw size={18} className={cn(isSyncing && "animate-spin")} />
            Sync Charges
          </button>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Download size={18} />
            Export CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Plus size={18} />
            Add Record
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className={cn("border border-zinc-800 p-6 rounded-2xl", stat.bg)}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-zinc-400 text-sm font-medium">{stat.label}</span>
              <stat.icon className={stat.color} size={20} />
            </div>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 border-b border-zinc-800 mb-8">
        <button
          onClick={() => setActiveTab('transactions')}
          className={cn(
            "px-4 py-2 font-bold text-sm transition-all relative",
            activeTab === 'transactions' ? "text-emerald-500" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          Transactions
          {activeTab === 'transactions' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />}
        </button>
        <button
          onClick={() => setActiveTab('ledger')}
          className={cn(
            "px-4 py-2 font-bold text-sm transition-all relative",
            activeTab === 'ledger' ? "text-emerald-500" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          City Ledger
          {activeTab === 'ledger' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />}
        </button>
      </div>

      {activeTab === 'transactions' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h3 className="font-bold text-white">Transaction History</h3>
              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                {(['all', 'income', 'expense'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={cn(
                      "px-3 py-1 rounded-md text-xs font-medium capitalize transition-all",
                      filterType === type ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as any)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1 text-xs text-zinc-400 outline-none focus:border-emerald-500/50"
              >
                <option value="today">Today</option>
                <option value="month">This Month</option>
                <option value="all">All Time</option>
              </select>
            </div>
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
              <input
                type="text"
                placeholder="Search transactions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10">
                <tr className="bg-zinc-950 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Description</th>
                  <th className="px-6 py-4">Category</th>
                  <th className="px-6 py-4">Method</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
                      No transactions found
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-zinc-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm text-white">{new Date(record.timestamp).toLocaleDateString()}</div>
                        <div className="text-[10px] text-zinc-500">{new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-white font-medium">{record.description}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-zinc-800 rounded text-[10px] font-medium text-zinc-400">
                          {record.category}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-xs text-zinc-500 capitalize">
                          {record.paymentMethod === 'card' ? <CreditCard size={12} /> : 
                           record.paymentMethod === 'cash' ? <Banknote size={12} /> : 
                           <Send size={12} />}
                          {record.paymentMethod}
                        </div>
                      </td>
                      <td className={cn(
                        "px-6 py-4 text-right font-bold text-sm",
                        record.type === 'income' ? "text-emerald-500" : "text-red-500"
                      )}>
                        {record.type === 'income' ? '+' : '-'}{formatCurrency(record.amount, currency, exchangeRate)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h3 className="font-bold text-white mb-6 flex items-center gap-2">
            <PieChart size={18} className="text-emerald-500" />
            Income vs Expense
          </h3>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="name" stroke="#71717a" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip 
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between p-3 bg-zinc-950 rounded-xl border border-zinc-800">
              <span className="text-xs text-zinc-500">Income Share</span>
              <span className="text-sm font-bold text-emerald-500">
                {totalIncome + totalExpense > 0 ? Math.round((totalIncome / (totalIncome + totalExpense)) * 100) : 0}%
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-zinc-950 rounded-xl border border-zinc-800">
              <span className="text-xs text-zinc-500">Expense Share</span>
              <span className="text-sm font-bold text-red-500">
                {totalIncome + totalExpense > 0 ? Math.round((totalExpense / (totalIncome + totalExpense)) * 100) : 0}%
              </span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h3 className="font-bold text-white mb-6 flex items-center gap-2">
            <BarChart3 size={18} className="text-amber-500" />
            Revenue by Category
          </h3>
          <div className="space-y-4">
            {categories.income.map(cat => {
              const amount = filteredRecords
                .filter(r => r.type === 'income' && r.category === cat)
                .reduce((acc, r) => acc + r.amount, 0);
              const percentage = totalIncome > 0 ? (amount / totalIncome) * 100 : 0;
              
              if (amount === 0) return null;

              return (
                <div key={cat} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">{cat}</span>
                    <span className="text-white font-bold">{formatCurrency(amount, currency, exchangeRate)}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      className="h-full bg-amber-500"
                    />
                  </div>
                </div>
              );
            })}
            {totalIncome === 0 && (
              <div className="h-[200px] flex items-center justify-center text-zinc-500 text-xs italic">
                No revenue data for this period
              </div>
            )}
          </div>
        </div>
      </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white">City Ledger (Guest Balances)</h3>
              <p className="text-xs text-zinc-500">Guests with outstanding balances or credits</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="px-3 py-1 bg-emerald-500/10 text-emerald-500 rounded-full text-[10px] font-bold uppercase">
                Total Credit: {formatCurrency(guests.filter(g => (g.ledgerBalance || 0) < 0).reduce((acc, g) => acc + Math.abs(g.ledgerBalance || 0), 0), currency, exchangeRate)}
              </div>
              <div className="px-3 py-1 bg-red-500/10 text-red-500 rounded-full text-[10px] font-bold uppercase">
                Total Debt: {formatCurrency(Math.abs(guests.filter(g => (g.ledgerBalance || 0) < 0).reduce((acc, g) => acc + (g.ledgerBalance || 0), 0)), currency, exchangeRate)}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-zinc-950 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  <th className="px-6 py-4">Guest Name</th>
                  <th className="px-6 py-4">Contact</th>
                  <th className="px-6 py-4">Last Stay</th>
                  <th className="px-6 py-4 text-right">Balance</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredLedger.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
                      No outstanding balances found
                    </td>
                  </tr>
                ) : (
                  filteredLedger.map((guest) => (
                    <tr key={guest.id} className="hover:bg-zinc-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm text-white font-medium">{guest.name}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-zinc-400">{guest.email}</div>
                        <div className="text-[10px] text-zinc-500">{guest.phone}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-zinc-400">
                          {guest.lastStay ? format(new Date(guest.lastStay), 'MMM d, yyyy') : 'N/A'}
                        </div>
                      </td>
                      <td className={cn(
                        "px-6 py-4 text-right font-bold text-sm",
                        (guest.ledgerBalance || 0) < 0 ? "text-red-500" : "text-emerald-500"
                      )}>
                        {formatCurrency(guest.ledgerBalance || 0, currency, exchangeRate)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => {
                            setShowSettleModal(guest);
                            setSettleData({ ...settleData, amount: Math.abs(guest.ledgerBalance || 0) });
                          }}
                          className="text-xs font-bold text-emerald-500 hover:text-emerald-400 transition-colors"
                        >
                          Settle
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-white">Add Financial Record</h2>
            </div>
            <form onSubmit={handleAddRecord}>
              <div className="p-6 space-y-4">
                <div className="flex p-1 bg-zinc-950 rounded-xl border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setNewRecord({ ...newRecord, type: 'income', category: categories.income[0] })}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-sm font-bold transition-all",
                      newRecord.type === 'income' ? "bg-emerald-500 text-white" : "text-zinc-500"
                    )}
                  >
                    Income
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRecord({ ...newRecord, type: 'expense', category: categories.expense[0] })}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-sm font-bold transition-all",
                      newRecord.type === 'expense' ? "bg-red-500 text-white" : "text-zinc-500"
                    )}
                  >
                    Expense
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Amount ({currency})</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">{currency === 'NGN' ? '₦' : '$'}</span>
                      <input
                        required
                        type="number"
                        value={newRecord.amount}
                        onChange={(e) => setNewRecord({ ...newRecord, amount: parseFloat(e.target.value) })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Category</label>
                    <select
                      value={newRecord.category}
                      onChange={(e) => setNewRecord({ ...newRecord, category: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      {categories[newRecord.type].map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Payment Method</label>
                  <select
                    value={newRecord.paymentMethod}
                    onChange={(e) => setNewRecord({ ...newRecord, paymentMethod: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="transfer">Bank Transfer</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Description</label>
                  <input
                    required
                    type="text"
                    value={newRecord.description}
                    onChange={(e) => setNewRecord({ ...newRecord, description: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    placeholder="e.g. Room 102 stay payment"
                  />
                </div>
              </div>
              <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newRecord.amount || !newRecord.description}
                  className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50"
                >
                  Save Record
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-white">
                {showSettleModal.ledgerBalance < 0 ? 'Settle Outstanding Debt' : 'Settle Overpayment/Credit'}
              </h2>
              <p className="text-sm text-zinc-500 mt-1">Guest: {showSettleModal.name}</p>
            </div>
            <form onSubmit={handleSettleBalance}>
              <div className="p-6 space-y-4">
                <div className={cn(
                  "p-4 rounded-2xl border flex items-center gap-4",
                  showSettleModal.ledgerBalance < 0 ? "bg-red-500/5 border-red-500/20" : "bg-emerald-500/5 border-emerald-500/20"
                )}>
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    showSettleModal.ledgerBalance < 0 ? "bg-red-500/20 text-red-500" : "bg-emerald-500/20 text-emerald-500"
                  )}>
                    <AlertCircle size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-500 uppercase">Current Balance</p>
                    <p className={cn(
                      "text-lg font-bold",
                      showSettleModal.ledgerBalance < 0 ? "text-red-500" : "text-emerald-500"
                    )}>
                      {formatCurrency(showSettleModal.ledgerBalance, currency, exchangeRate)}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Settlement Amount ({currency})</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">{currency === 'NGN' ? '₦' : '$'}</span>
                    <input
                      required
                      type="number"
                      value={settleData.amount}
                      onChange={(e) => setSettleData({ ...settleData, amount: parseFloat(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Payment Method</label>
                  <select
                    value={settleData.method}
                    onChange={(e) => setSettleData({ ...settleData, method: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="transfer">Bank Transfer</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Notes</label>
                  <textarea
                    value={settleData.notes}
                    onChange={(e) => setSettleData({ ...settleData, notes: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50 min-h-[80px]"
                    placeholder="e.g. Guest paid cash at front desk"
                  />
                </div>
              </div>
              <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowSettleModal(null)}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!settleData.amount || isSaving}
                  className={cn(
                    "flex-1 px-4 py-2 text-white rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50",
                    showSettleModal.ledgerBalance < 0 ? "bg-emerald-500 hover:bg-emerald-600" : "bg-red-500 hover:bg-red-600"
                  )}
                >
                  {isSaving ? 'Processing...' : showSettleModal.ledgerBalance < 0 ? 'Post Payment' : 'Post Refund'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
