import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, query, orderBy, doc, updateDoc, deleteDoc, onSnapshot, where, increment } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { CorporateAccount, CorporateRate, Room, OperationType, RoomType, Reservation } from '../types';
import { 
  Building2, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  CreditCard, 
  Users,
  FileText,
  TrendingUp,
  Briefcase,
  Tag,
  Calendar,
  DollarSign,
  X,
  Lock,
  Download,
  Clock,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency, exportToCSV } from '../utils';
import { fuzzySearch } from '../utils/searchUtils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { postToLedger } from '../services/ledgerService';

import { CorporateFolio } from './CorporateFolio';
import { ConfirmModal } from './ConfirmModal';

export function CorporateManagement() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRatesModal, setShowRatesModal] = useState<CorporateAccount | null>(null);
  const [showFolioModal, setShowFolioModal] = useState<CorporateAccount | null>(null);
  const [rates, setRates] = useState<CorporateRate[]>([]);
  const [editingAccount, setEditingAccount] = useState<CorporateAccount | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'contactPerson' | 'creditLimit' | 'currentBalance'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [editingRate, setEditingRate] = useState<CorporateRate | null>(null);
  const [newAccount, setNewAccount] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    contactPerson: '',
    taxId: '',
    creditLimit: 0,
    currentBalance: 0,
    billingCycle: 'monthly' as 'weekly' | 'monthly' | 'quarterly'
  });

  const [newRate, setNewRate] = useState({
    roomType: '',
    rate: 0,
    currency: 'NGN' as 'NGN' | 'USD',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(Date.now() + 31536000000), 'yyyy-MM-dd'), // 1 year
    discountType: 'fixed' as 'percentage' | 'fixed',
    discountValue: 0,
    conditions: ''
  });

  const [confirmDeleteRate, setConfirmDeleteRate] = useState<string | null>(null);
  const [hasPermissionError, setHasPermissionError] = useState(false);

  const hasPermission = () => {
    if (!profile) return false;
    if (profile.role === 'hotelAdmin' || profile.role === 'superAdmin') return true;
    const roles = (profile.roles || profile.permissions || []) as string[];
    return roles.includes('manager') || roles.includes('corporate');
  };

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    
    const q = query(collection(db, 'hotels', hotel.id, 'corporate_accounts'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setAccounts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateAccount)));
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/corporate_accounts`);
      if (error.code === 'permission-denied') setHasPermissionError(true);
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  useEffect(() => {
    if (!hotel?.id) return;
    
    const unsub = onSnapshot(collection(db, 'hotels', hotel.id, 'rooms'), (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/rooms`);
    });

    return () => unsub();
  }, [hotel?.id]);

  useEffect(() => {
    if (!hotel?.id) return;
    
    const unsub = onSnapshot(collection(db, 'hotels', hotel.id, 'room_types'), (snap) => {
      setRoomTypes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RoomType)));
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/room_types`);
    });

    return () => unsub();
  }, [hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !showRatesModal) {
      setRates([]);
      return;
    }
    
    const q = query(
      collection(db, 'hotels', hotel.id, 'corporate_accounts', showRatesModal.id, 'rates'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setRates(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateRate)));
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/corporate_accounts/${showRatesModal.id}/rates`);
    });

    return () => unsub();
  }, [hotel?.id, showRatesModal]);

  const availableRoomTypes = roomTypes.length > 0 
    ? roomTypes.map(t => t.name)
    : Array.from(new Set(rooms.map(r => r.type)));

  const [loading, setLoading] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState<CorporateAccount | null>(null);
  const [adjustmentData, setAdjustmentData] = useState({
    amount: 0,
    type: 'debit' as 'debit' | 'credit',
    description: '',
    paymentMethod: 'cash' as 'cash' | 'card' | 'transfer'
  });

  const postDailyCharges = async () => {
    if (!hotel?.id || !profile) return;
    
    try {
      setLoading(true);
      const today = format(new Date(), 'yyyy-MM-dd');
      
      // 1. Fetch all checked-in reservations
      const resQ = query(
        collection(db, 'hotels', hotel.id, 'reservations'),
        where('status', '==', 'checked_in')
      );
      const resSnap = await getDocs(resQ);
      const activeReservations = resSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation));
      
      let chargedCount = 0;
      
      for (const res of activeReservations) {
        // 2. Check if already charged for today
        const ledgerQ = query(
          collection(db, 'hotels', hotel.id, 'ledger'),
          where('reservationId', '==', res.id),
          where('category', '==', 'room'),
          where('type', '==', 'debit'),
          where('description', '>=', `Daily Room Charge: ${res.roomNumber} (${today}`)
        );
        const ledgerSnap = await getDocs(ledgerQ);
        
        if (ledgerSnap.empty) {
          const rate = res.nightlyRate || (res.totalAmount / (res.nights || 1)) || 0;
          if (rate > 0) {
            await postToLedger(hotel.id, res.guestId!, res.id, {
              amount: rate,
              type: 'debit',
              category: 'room',
              description: `Daily Room Charge: ${res.roomNumber} (${format(new Date(), 'MMM dd, yyyy')})`,
              referenceId: res.id,
              postedBy: profile.uid
            }, profile.uid, res.corporateId);
            chargedCount++;
          }
        }
      }
      
      if (chargedCount > 0) {
        toast.success(`Successfully posted daily charges for ${chargedCount} reservations.`);
      } else {
        toast.info('All daily charges for today have already been posted.');
      }
      
      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'DAILY_CHARGES_POSTED',
        resource: `Posted daily charges for ${chargedCount} rooms`,
        hotelId: hotel.id,
        module: 'Corporate'
      });
    } catch (err) {
      console.error("Daily charge error:", err);
      toast.error('Failed to post daily charges');
    } finally {
      setLoading(false);
    }
  };

  const handleManualAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !showAdjustmentModal) return;

    try {
      const account = showAdjustmentModal;
      const timestamp = new Date().toISOString();
      
      // 1. Update account balance
      const balanceAdjustment = adjustmentData.type === 'debit' ? adjustmentData.amount : -adjustmentData.amount;
      await updateDoc(doc(db, 'hotels', hotel.id, 'corporate_accounts', account.id), {
        currentBalance: increment(balanceAdjustment)
      });

      // 2. Add to Ledger
      await addDoc(collection(db, 'hotels', hotel.id, 'ledger'), {
        hotelId: hotel.id,
        corporateId: account.id,
        reservationId: 'MANUAL_ADJUSTMENT',
        timestamp,
        amount: adjustmentData.amount,
        type: adjustmentData.type,
        category: 'adjustment',
        description: adjustmentData.description || `Manual ${adjustmentData.type} adjustment`,
        paymentMethod: adjustmentData.paymentMethod,
        postedBy: profile.uid
      });

      // 3. If it's a payment (credit), log to finance
      if (adjustmentData.type === 'credit') {
        await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
          type: 'income',
          amount: adjustmentData.amount,
          category: 'Corporate Payment',
          description: `Corporate Payment: ${account.name} - ${adjustmentData.description}`,
          timestamp,
          paymentMethod: adjustmentData.paymentMethod,
          referenceId: account.id
        });
      }

      // 4. Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp,
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'CORPORATE_BALANCE_ADJUSTED',
        resource: `${account.name} adjusted by ${adjustmentData.type === 'debit' ? '+' : '-'}${formatCurrency(adjustmentData.amount, currency, exchangeRate)}`,
        hotelId: hotel.id,
        module: 'Corporate'
      });

      toast.success('Balance adjusted successfully');
      setShowAdjustmentModal(null);
      setAdjustmentData({ amount: 0, type: 'debit', description: '', paymentMethod: 'cash' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/corporate_accounts/${showAdjustmentModal.id}`);
      toast.error('Failed to adjust balance');
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;

    try {
      if (editingAccount) {
        await updateDoc(doc(db, 'hotels', hotel.id, 'corporate_accounts', editingAccount.id), {
          ...newAccount
        });
      } else {
        await addDoc(collection(db, 'hotels', hotel.id, 'corporate_accounts'), {
          ...newAccount,
          currentBalance: 0,
          createdAt: new Date().toISOString()
        });
      }

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: editingAccount ? 'CORPORATE_ACCOUNT_UPDATED' : 'CORPORATE_ACCOUNT_CREATED',
        resource: `${newAccount.name} (${newAccount.contactPerson})`,
        hotelId: hotel.id,
        module: 'Corporate'
      });

      setShowAddModal(false);
      setEditingAccount(null);
      setNewAccount({
        name: '', 
        email: '', 
        phone: '', 
        address: '', 
        contactPerson: '', 
        taxId: '',
        creditLimit: 0, 
        currentBalance: 0, 
        billingCycle: 'monthly'
      });
      toast.success(editingAccount ? 'Account updated successfully' : 'Account created successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/corporate_accounts`);
      toast.error('Failed to save account');
    }
  };

  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !showRatesModal || !profile) return;

    try {
      const selectedType = roomTypes.find(t => t.name === newRate.roomType);
      const rateData = {
        ...newRate,
        roomTypeId: selectedType?.id,
        corporateId: showRatesModal.id,
        status: 'active',
        updatedAt: new Date().toISOString()
      };

      if (editingRate) {
        await updateDoc(doc(db, 'hotels', hotel.id, 'corporate_accounts', showRatesModal.id, 'rates', editingRate.id), rateData);
      } else {
        await addDoc(collection(db, 'hotels', hotel.id, 'corporate_accounts', showRatesModal.id, 'rates'), {
          ...rateData,
          createdAt: new Date().toISOString()
        });
      }

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: editingRate ? 'CORPORATE_RATE_UPDATED' : 'CORPORATE_RATE_CREATED',
        resource: `Rate for ${showRatesModal.name} - ${newRate.roomType}`,
        hotelId: hotel.id,
        module: 'Corporate'
      });

      setNewRate({
        roomType: '',
        rate: 0,
        currency: 'NGN',
        startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(new Date(Date.now() + 31536000000), 'yyyy-MM-dd'),
        discountType: 'fixed',
        discountValue: 0,
        conditions: ''
      });
      setEditingRate(null);
      toast.success(editingRate ? 'Negotiated rate updated successfully' : 'Negotiated rate added successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/corporate_accounts/${showRatesModal.id}/rates`);
      toast.error('Failed to save rate');
    }
  };

  const deleteRate = async (rateId: string) => {
    if (!hotel?.id || !showRatesModal) return;
    
    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'corporate_accounts', showRatesModal.id, 'rates', rateId));
      toast.success('Rate deleted successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/corporate_accounts/${showRatesModal.id}/rates/${rateId}`);
      toast.error('Failed to delete rate');
    }
  };

  const filteredAccounts = accounts
    .filter(a => 
      fuzzySearch(a.name || '', searchQuery) || 
      fuzzySearch(a.contactPerson || '', searchQuery)
    )
    .sort((a, b) => {
      const factor = sortOrder === 'asc' ? 1 : -1;
      if (sortBy === 'name') return factor * (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'contactPerson') return factor * (a.contactPerson || '').localeCompare(b.contactPerson || '');
      if (sortBy === 'creditLimit') return factor * ((a.creditLimit || 0) - (b.creditLimit || 0));
      if (sortBy === 'currentBalance') return factor * ((a.currentBalance || 0) - (b.currentBalance || 0));
      return 0;
    });

  const handleExport = () => {
    const dataToExport = filteredAccounts.map(acc => ({
      Name: acc.name,
      Email: acc.email,
      Phone: acc.phone,
      Contact: acc.contactPerson,
      TaxID: acc.taxId,
      CreditLimit: acc.creditLimit,
      Balance: acc.currentBalance,
      BillingCycle: acc.billingCycle
    }));
    exportToCSV(dataToExport, `corporate_accounts_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Corporate accounts exported successfully');
  };

  if (!hotel?.id) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-6">
        <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center text-emerald-500">
          <Building2 size={40} />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-zinc-50">No Hotel Selected</h2>
          <p className="text-zinc-400 max-w-md mx-auto">
            As a Super Admin, you must select a specific hotel to manage its corporate accounts.
            Go to the Super Admin dashboard to select a hotel.
          </p>
        </div>
        <button 
          onClick={() => window.location.href = '/super-admin'}
          className="px-8 py-3 bg-emerald-500 text-black font-bold rounded-xl hover:bg-emerald-400 transition-all active:scale-95 flex items-center gap-2 mx-auto"
        >
          <ArrowRight size={18} />
          Go to Super Admin
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Corporate Accounts</h1>
          <p className="text-zinc-400">Manage corporate partnerships and billing</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Download size={18} />
            Export CSV
          </button>
          {hasPermission() && (
            <>
              <button 
                onClick={postDailyCharges}
                disabled={loading}
                className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50"
              >
                <Clock size={18} />
                Post Daily Charges
              </button>
              <button 
                onClick={() => {
                  setEditingAccount(null);
                  setNewAccount({
                    name: '', email: '', phone: '', address: '', contactPerson: '', taxId: '',
                    creditLimit: 0, currentBalance: 0, billingCycle: 'monthly'
                  });
                  setShowAddModal(true);
                }}
                className="bg-emerald-500 text-black px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
              >
                <Plus size={18} />
                Add Account
              </button>
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Total Accounts</div>
          <div className="text-2xl font-bold text-white">{accounts.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Total Credit Limit</div>
          <div className="text-2xl font-bold text-blue-500">{formatCurrency(accounts.reduce((acc, a) => acc + a.creditLimit, 0), currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Outstanding Balance</div>
          <div className="text-2xl font-bold text-red-500">{formatCurrency(accounts.reduce((acc, a) => acc + (a.currentBalance || 0), 0), currency, exchangeRate)}</div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input 
              type="text" 
              placeholder="Search accounts or contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <span className="text-xs font-bold text-zinc-500 uppercase whitespace-nowrap">Sort By:</span>
            <select 
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="name">Company Name</option>
              <option value="contactPerson">Contact Person</option>
              <option value="creditLimit">Credit Limit</option>
              <option value="currentBalance">Balance</option>
            </select>
            <button 
              onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="p-2 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all"
            >
              <TrendingUp size={16} className={cn(sortOrder === 'desc' && "rotate-180")} />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-6 py-4">Company</th>
                <th className="px-6 py-4">Contact</th>
                <th className="px-6 py-4">Credit Info</th>
                <th className="px-6 py-4">Billing</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredAccounts.map(account => (
                <tr key={account.id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-500">
                        <Building2 size={20} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">{account.name}</div>
                        <div className="text-xs text-zinc-500">{account.taxId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-white">{account.contactPerson}</div>
                    <div className="text-xs text-zinc-500">{account.email}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-white">Limit: {formatCurrency(account.creditLimit, currency, exchangeRate)}</div>
                    <div className={cn(
                      "text-xs font-bold",
                      Math.abs(account.currentBalance || 0) > account.creditLimit * 0.8 ? "text-red-500" : "text-emerald-500"
                    )}>
                      Balance: {formatCurrency(account.currentBalance || 0, currency, exchangeRate)}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-zinc-800 text-zinc-400 rounded text-[10px] font-bold uppercase tracking-wider">
                      {account.billingCycle}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => {
                          setAdjustmentData({ amount: 0, type: 'credit', description: '', paymentMethod: 'cash' });
                          setShowAdjustmentModal(account);
                        }}
                        className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all"
                        title="Manual Adjustment / Payment"
                      >
                        <DollarSign size={18} />
                      </button>
                      <button 
                        onClick={() => navigate(`/front-desk?action=book&corporateId=${account.id}`)}
                        className="p-2 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all"
                        title="Book Room"
                      >
                        <Calendar size={18} />
                      </button>
                      <button 
                        onClick={() => setShowFolioModal(account)}
                        className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all"
                        title="View Folio"
                      >
                        <FileText size={18} />
                      </button>
                      <button 
                        onClick={() => setShowRatesModal(account)}
                        className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all"
                        title="Manage Rates"
                      >
                        <Tag size={18} />
                      </button>
                      {hasPermission() && (
                        <button 
                          onClick={() => {
                            setEditingAccount(account);
                            setNewAccount({
                              name: account.name,
                              email: account.email,
                              phone: account.phone,
                              address: account.address,
                              contactPerson: account.contactPerson,
                              taxId: account.taxId,
                              creditLimit: account.creditLimit,
                              currentBalance: account.currentBalance,
                              billingCycle: account.billingCycle
                            });
                            setShowAddModal(true);
                          }}
                          className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-all"
                        >
                          <Edit2 size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Adjustment Modal */}
      {showAdjustmentModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-white">Manual Adjustment</h2>
              <p className="text-sm text-zinc-500">{showAdjustmentModal.name}</p>
            </div>
            <form onSubmit={handleManualAdjustment}>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Adjustment Type</label>
                    <select
                      value={adjustmentData.type}
                      onChange={(e) => setAdjustmentData({ ...adjustmentData, type: e.target.value as any })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="credit">Payment / Credit (-)</option>
                      <option value="debit">Charge / Debit (+)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Amount ({currency})</label>
                    <input
                      required
                      type="number"
                      min="1"
                      value={adjustmentData.amount}
                      onChange={(e) => setAdjustmentData({ ...adjustmentData, amount: Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
                {adjustmentData.type === 'credit' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Payment Method</label>
                    <select
                      value={adjustmentData.paymentMethod}
                      onChange={(e) => setAdjustmentData({ ...adjustmentData, paymentMethod: e.target.value as any })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="transfer">Bank Transfer</option>
                    </select>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Description / Reason</label>
                  <textarea
                    required
                    value={adjustmentData.description}
                    onChange={(e) => setAdjustmentData({ ...adjustmentData, description: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50 h-20 resize-none"
                    placeholder="e.g. Monthly settlement, Service charge adjustment..."
                  />
                </div>
              </div>
              <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAdjustmentModal(null)}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95"
                >
                  Apply Adjustment
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">{editingAccount ? 'Edit Account' : 'Add Corporate Account'}</h2>
              <button onClick={() => setShowAddModal(false)} className="text-zinc-500 hover:text-white">
                <Trash2 size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveAccount}>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[60vh] overflow-y-auto">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Company Name</label>
                  <input
                    required
                    type="text"
                    value={newAccount.name}
                    onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Contact Person</label>
                  <input
                    required
                    type="text"
                    value={newAccount.contactPerson}
                    onChange={(e) => setNewAccount({ ...newAccount, contactPerson: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Email</label>
                  <input
                    required
                    type="email"
                    value={newAccount.email}
                    onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Phone</label>
                  <input
                    required
                    type="tel"
                    value={newAccount.phone}
                    onChange={(e) => setNewAccount({ ...newAccount, phone: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Tax ID / Registration</label>
                  <input
                    type="text"
                    value={newAccount.taxId}
                    onChange={(e) => setNewAccount({ ...newAccount, taxId: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Credit Limit ({currency})</label>
                  <input
                    type="number"
                    value={newAccount.creditLimit}
                    onChange={(e) => setNewAccount({ ...newAccount, creditLimit: Number(e.target.value) })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Billing Cycle</label>
                    <select
                      value={newAccount.billingCycle}
                      onChange={(e) => setNewAccount({ ...newAccount, billingCycle: e.target.value as any })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Address</label>
                  <textarea
                    value={newAccount.address}
                    onChange={(e) => setNewAccount({ ...newAccount, address: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50 h-20 resize-none"
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
                  className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95"
                >
                  Save Account
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Rates Modal */}
      {showRatesModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-4xl overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Negotiated Rates</h2>
                <p className="text-sm text-zinc-500">{showRatesModal.name}</p>
              </div>
              <button onClick={() => setShowRatesModal(null)} className="text-zinc-500 hover:text-white">
                <X size={24} />
              </button>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3">
              {/* Add Rate Form */}
              {hasPermission() ? (
                <div className="p-6 border-r border-zinc-800 bg-zinc-950/50">
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Plus size={16} className="text-emerald-500" />
                      {editingRate ? 'Edit Rate' : 'Add New Rate'}
                    </div>
                    {editingRate && (
                      <button 
                        type="button"
                        onClick={() => {
                          setEditingRate(null);
                          setNewRate({
                            roomType: '',
                            rate: 0,
                            currency: 'NGN',
                            startDate: format(new Date(), 'yyyy-MM-dd'),
                            endDate: format(new Date(Date.now() + 31536000000), 'yyyy-MM-dd'),
                            discountType: 'fixed',
                            discountValue: 0,
                            conditions: ''
                          });
                        }}
                        className="text-[10px] text-zinc-500 hover:text-white"
                      >
                        Cancel
                      </button>
                    )}
                  </h3>
                  <form onSubmit={handleSaveRate} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase">Room Type</label>
                      <select
                        required
                        value={newRate.roomType}
                        onChange={(e) => {
                          const typeName = e.target.value;
                          const selectedType = roomTypes.find(t => t.name === typeName);
                          setNewRate({ 
                            ...newRate, 
                            roomType: typeName,
                            rate: selectedType ? selectedType.basePrice : newRate.rate
                          });
                        }}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                      >
                        <option value="">Select Type</option>
                        {availableRoomTypes.map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                      {newRate.roomType && (
                        <div className="text-[10px] text-zinc-500 mt-1">
                          Base Price: {formatCurrency(roomTypes.find(t => t.name === newRate.roomType)?.basePrice || 0, currency, exchangeRate)}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Discount Type</label>
                        <select
                          value={newRate.discountType}
                          onChange={(e) => setNewRate({ ...newRate, discountType: e.target.value as any })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="fixed">Fixed Amount</option>
                          <option value="percentage">Percentage (%)</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Discount Value</label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            value={newRate.discountValue}
                            onChange={(e) => setNewRate({ ...newRate, discountValue: Number(e.target.value) })}
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                            placeholder="0"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const selectedType = roomTypes.find(t => t.name === newRate.roomType);
                              if (!selectedType) {
                                toast.error('Please select a room type first');
                                return;
                              }
                              let calculatedRate = selectedType.basePrice;
                              if (newRate.discountType === 'percentage') {
                                calculatedRate = selectedType.basePrice * (1 - newRate.discountValue / 100);
                              } else {
                                calculatedRate = Math.max(0, selectedType.basePrice - newRate.discountValue);
                              }
                              setNewRate({ ...newRate, rate: Math.round(calculatedRate) });
                              toast.success('Discount applied to base price');
                            }}
                            className="px-3 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-black rounded-lg text-[10px] font-bold transition-all border border-emerald-500/20"
                            title="Apply Discount to Base Price"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Negotiated Rate</label>
                        <input
                          required
                          type="number"
                          value={newRate.rate}
                          onChange={(e) => setNewRate({ ...newRate, rate: Number(e.target.value) })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Currency</label>
                        <select
                          value={newRate.currency}
                          onChange={(e) => setNewRate({ ...newRate, currency: e.target.value as any })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="NGN">₦ (NGN)</option>
                          <option value="USD">$ (USD)</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Start Date</label>
                        <div className="relative">
                          <input
                            required
                            type="date"
                            value={newRate.startDate}
                            onChange={(e) => setNewRate({ ...newRate, startDate: e.target.value })}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none"
                            style={{ colorScheme: 'dark' }}
                          />
                          <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" size={16} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">End Date</label>
                        <div className="relative">
                          <input
                            required
                            type="date"
                            value={newRate.endDate}
                            onChange={(e) => setNewRate({ ...newRate, endDate: e.target.value })}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none"
                            style={{ colorScheme: 'dark' }}
                          />
                          <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" size={16} />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase">Conditions (Optional)</label>
                      <textarea
                        value={newRate.conditions}
                        onChange={(e) => setNewRate({ ...newRate, conditions: e.target.value })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 h-16 resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-2 bg-emerald-500 text-black font-bold rounded-lg hover:bg-emerald-400 transition-all active:scale-95 text-sm"
                    >
                      {editingRate ? 'Update Rate' : 'Add Rate'}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="p-6 border-r border-zinc-800 bg-zinc-950/50 flex flex-col items-center justify-center text-center">
                  <Lock size={32} className="text-zinc-700 mb-2" />
                  <p className="text-xs text-zinc-500">You don't have permission to manage rates.</p>
                </div>
              )}

              {/* Rates List */}
              <div className="lg:col-span-2 p-6 max-h-[60vh] overflow-y-auto">
                <div className="space-y-4">
                  {rates.length === 0 ? (
                    <div className="text-center py-12 text-zinc-500">
                      <Tag size={48} className="mx-auto mb-4 opacity-20" />
                      <p>No negotiated rates found for this account.</p>
                    </div>
                  ) : (
                    rates.map(rate => {
                      const isActive = new Date() >= new Date(rate.startDate) && new Date() <= new Date(rate.endDate);
                      return (
                        <div key={rate.id} className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl flex items-center justify-between group">
                          <div className="flex items-center gap-4">
                            <div className={cn(
                              "w-10 h-10 rounded-xl flex items-center justify-center",
                              isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-800 text-zinc-500"
                            )}>
                              <DollarSign size={20} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">{rate.roomType}</span>
                                <span className={cn(
                                  "px-1.5 py-0.5 rounded text-[8px] font-bold uppercase",
                                  isActive ? "bg-emerald-500/20 text-emerald-500" : "bg-zinc-800 text-zinc-500"
                                )}>
                                  {isActive ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                              <div className="text-lg font-bold text-white">
                                {rate.currency === 'NGN' ? '₦' : '$'}{rate.rate.toLocaleString()}
                                {rate.discountValue > 0 && (
                                  <span className="text-[10px] text-emerald-500 ml-2">
                                    (-{rate.discountType === 'percentage' ? `${rate.discountValue}%` : formatCurrency(rate.discountValue, rate.currency, exchangeRate)})
                                  </span>
                                )}
                                {rate.currency !== currency && (
                                  <span className="text-[10px] text-zinc-500 ml-2">
                                    ≈ {formatCurrency(rate.currency === 'NGN' ? rate.rate / exchangeRate : rate.rate * exchangeRate, currency, exchangeRate)}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                                <Calendar size={10} />
                                {format(new Date(rate.startDate), 'MMM d, yyyy')} - {format(new Date(rate.endDate), 'MMM d, yyyy')}
                              </div>
                              {rate.conditions && (
                                <div className="mt-2 p-2 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                                  <div className="text-[9px] font-bold text-zinc-500 uppercase mb-1 flex items-center gap-1">
                                    <FileText size={10} />
                                    Conditions
                                  </div>
                                  <p className="text-[10px] text-zinc-400 leading-relaxed italic">
                                    "{rate.conditions}"
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {hasPermission() && (
                              <>
                                <button 
                                  onClick={() => {
                                    setEditingRate(rate);
                                    setNewRate({
                                      roomType: rate.roomType,
                                      rate: rate.rate,
                                      currency: rate.currency,
                                      startDate: rate.startDate,
                                      endDate: rate.endDate,
                                      discountType: rate.discountType || 'fixed',
                                      discountValue: rate.discountValue || 0,
                                      conditions: rate.conditions || ''
                                    });
                                  }}
                                  className="p-2 text-zinc-400 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button 
                                  onClick={() => setConfirmDeleteRate(rate.id)}
                                  className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Corporate Folio Modal */}
      {showFolioModal && (
        <CorporateFolio 
          account={showFolioModal} 
          onClose={() => setShowFolioModal(null)} 
        />
      )}

      <ConfirmModal
        isOpen={!!confirmDeleteRate}
        title="Delete Negotiated Rate"
        message="Are you sure you want to delete this negotiated rate?"
        onConfirm={() => confirmDeleteRate && deleteRate(confirmDeleteRate)}
        onCancel={() => setConfirmDeleteRate(null)}
        confirmText="Delete"
        type="danger"
      />
    </div>
  );
}
