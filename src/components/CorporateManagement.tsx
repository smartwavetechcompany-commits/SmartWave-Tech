import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, query, orderBy, doc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { CorporateAccount, CorporateRate, Room, OperationType, RoomType } from '../types';
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
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency, exportToCSV } from '../utils';
import { fuzzySearch } from '../utils/searchUtils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

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
    if (profile.role === 'hotelAdmin') return true;
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
      await addDoc(collection(db, 'hotels', hotel.id, 'corporate_accounts', showRatesModal.id, 'rates'), {
        ...newRate,
        roomTypeId: selectedType?.id,
        corporateId: showRatesModal.id,
        status: 'active',
        createdAt: new Date().toISOString()
      });

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        action: 'CORPORATE_RATE_CREATED',
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
      toast.success('Negotiated rate added successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/corporate_accounts/${showRatesModal.id}/rates`);
      toast.error('Failed to add rate');
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

  const filteredAccounts = accounts.filter(a => 
    fuzzySearch(a.name || '', searchQuery) || 
    fuzzySearch(a.contactPerson || '', searchQuery)
  );

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
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
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
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
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
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <Plus size={16} className="text-emerald-500" />
                    Add New Rate
                  </h3>
                  <form onSubmit={handleSaveRate} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase">Room Type</label>
                      <select
                        required
                        value={newRate.roomType}
                        onChange={(e) => setNewRate({ ...newRate, roomType: e.target.value })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                      >
                        <option value="">Select Type</option>
                        {availableRoomTypes.map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Rate</label>
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
                        <input
                          required
                          type="date"
                          value={newRate.startDate}
                          onChange={(e) => setNewRate({ ...newRate, startDate: e.target.value })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">End Date</label>
                        <input
                          required
                          type="date"
                          value={newRate.endDate}
                          onChange={(e) => setNewRate({ ...newRate, endDate: e.target.value })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                        />
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
                      Add Rate
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
                            </div>
                          </div>
                          {hasPermission() && (
                            <button 
                              onClick={() => setConfirmDeleteRate(rate.id)}
                              className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
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
