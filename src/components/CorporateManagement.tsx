import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, query, orderBy, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { CorporateAccount, OperationType } from '../types';
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
  Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../utils';

export function CorporateManagement() {
  const { hotel, profile } = useAuth();
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
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
    billingCycle: 'monthly' as 'weekly' | 'monthly' | 'quarterly',
    contractRates: {} as Record<string, number>
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(collection(db, 'hotels', hotel.id, 'corporate_accounts'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, 
      (snap) => {
        setAccounts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateAccount)));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/corporate_accounts`);
        if (error.code === 'permission-denied') setHasPermissionError(true);
      }
    );
    return () => unsubscribe();
  }, [hotel?.id, profile?.uid]);

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
        billingCycle: 'monthly', 
        contractRates: {}
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/corporate_accounts`);
    }
  };

  const filteredAccounts = accounts.filter(a => 
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    a.contactPerson.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Corporate Accounts</h1>
          <p className="text-zinc-400">Manage corporate partnerships and billing</p>
        </div>
        <button 
          onClick={() => {
            setEditingAccount(null);
            setNewAccount({
              name: '', email: '', phone: '', address: '', contactPerson: '', taxId: '',
              creditLimit: 0, currentBalance: 0, billingCycle: 'monthly', contractRates: {}
            });
            setShowAddModal(true);
          }}
          className="bg-emerald-500 text-black px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
        >
          <Plus size={18} />
          Add Account
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Total Accounts</div>
          <div className="text-2xl font-bold text-white">{accounts.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Total Credit Limit</div>
          <div className="text-2xl font-bold text-blue-500">{formatCurrency(accounts.reduce((acc, a) => acc + a.creditLimit, 0))}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Outstanding Balance</div>
          <div className="text-2xl font-bold text-red-500">{formatCurrency(accounts.reduce((acc, a) => acc + (a.currentBalance || 0), 0))}</div>
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
                    <div className="text-sm text-white">Limit: {formatCurrency(account.creditLimit)}</div>
                    <div className={cn(
                      "text-xs font-bold",
                      (account.currentBalance || 0) > account.creditLimit * 0.8 ? "text-red-500" : "text-emerald-500"
                    )}>
                      Balance: {formatCurrency(account.currentBalance || 0)}
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
                            billingCycle: account.billingCycle,
                            contractRates: account.contractRates || {}
                          });
                          setShowAddModal(true);
                        }}
                        className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-all"
                      >
                        <Edit2 size={18} />
                      </button>
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
                  <label className="text-xs font-bold text-zinc-500 uppercase">Credit Limit</label>
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
    </div>
  );
}
