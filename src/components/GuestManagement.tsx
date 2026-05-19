import React, { useEffect, useState, useMemo } from 'react';
import { collection, getDocs, query, orderBy, addDoc, updateDoc, doc, deleteDoc, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { useAuth } from '../contexts/AuthContext';
import { Guest, OperationType, Reservation, CorporateAccount, LedgerEntry } from '../types';
import { 
  Users, 
  Plus, 
  Search, 
  Filter, 
  Mail, 
  Phone, 
  MapPin, 
  CreditCard, 
  History, 
  Star, 
  MoreVertical, 
  Edit2, 
  Trash2,
  ChevronRight,
  UserCheck,
  Calendar,
  Download,
  Clock,
  DollarSign,
  XCircle,
  Receipt,
  Building2,
  TrendingUp,
  ArrowDownRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../utils';
import { canManageGuest } from '../utils/policyUtils';
import Fuse from 'fuse.js';
import { format, startOfMonth, isWithinInterval, startOfDay, endOfDay, differenceInDays, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import { ReceiptGenerator } from './ReceiptGenerator';
import { GuestFolio } from './GuestFolio';
import { toast } from 'sonner';
import { ConfirmModal } from './ConfirmModal';

export function GuestManagement() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [viewingHistory, setViewingHistory] = useState<Guest | null>(null);
  const [guestHistory, setGuestHistory] = useState<Reservation[]>([]);
  const [guestLedger, setGuestLedger] = useState<LedgerEntry[]>([]);
  const [historyTab, setHistoryTab] = useState<'reservations' | 'ledger'>('reservations');
  const [showReceipt, setShowReceipt] = useState<{ res: Reservation; type: 'restaurant' | 'comprehensive' } | null>(null);
  const [showFolio, setShowFolio] = useState<Reservation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [guestTypeFilter, setGuestTypeFilter] = useState<'all' | 'individual' | 'corporate'>('all');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [vipFilter, setVipFilter] = useState<'all' | 'vip' | 'regular'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'ledgerBalance' | 'totalSpent' | 'totalStays'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [reportFilter, setReportFilter] = useState({
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    type: 'all' as 'all' | 'individual' | 'corporate'
  });
  const [corporateAccounts, setCorporateAccounts] = useState<CorporateAccount[]>([]);
  const [newGuest, setNewGuest] = useState({
    name: '',
    email: '',
    phone: '',
    idType: 'Passport',
    idNumber: '',
    address: '',
    notes: '',
    tags: [] as string[],
    preferences: [] as string[],
    ledgerBalance: 0,
    corporateId: ''
  });

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [prefInput, setPrefInput] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  const allExistingTags = useMemo(() => {
    const tags = new Set<string>();
    guests.forEach(g => (g.tags || []).forEach(t => tags.add(t)));
    return Array.from(tags);
  }, [guests]);

  const tagSuggestions = useMemo(() => {
    if (!tagInput.trim()) return [];
    return allExistingTags.filter(t => 
      t.toLowerCase().includes(tagInput.toLowerCase()) && 
      !newGuest.tags.includes(t)
    );
  }, [tagInput, allExistingTags, newGuest.tags]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    
    setIsLoading(true);
    const q = query(collection(db, 'hotels', hotel.id, 'guests'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setGuests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Guest)));
      setIsLoading(false);
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/guests`);
      if (error.code === 'permission-denied') setHasPermissionError(true);
      setIsLoading(false);
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  useEffect(() => {
    if (!viewingHistory || !hotel?.id) return;
    
    // Fetch reservations
    const qRes = query(
      collection(db, 'hotels', hotel.id, 'reservations'),
      where('guestEmail', '==', viewingHistory.email)
    );
    const unsubRes = onSnapshot(qRes, (snap) => {
      setGuestHistory(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    });

    // Fetch full ledger history for guest
    const qLedger = query(
      collection(db, 'hotels', hotel.id, 'ledger'),
      where('guestId', '==', viewingHistory.id)
    );
    const unsubLedger = onSnapshot(qLedger, (snap) => {
      const entries = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LedgerEntry));
      
      // Client-side sorting to avoid composite index
      const sortedEntries = [...entries].sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeB - timeA; // desc
      });

      setGuestLedger(sortedEntries);
    });
    
    return () => {
      unsubRes();
      unsubLedger();
    };
  }, [viewingHistory, hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    
    const corpRef = collection(db, 'hotels', hotel.id, 'corporate_accounts');
    const unsub = onSnapshot(corpRef, (snap) => {
      setCorporateAccounts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateAccount)));
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  const handleSaveGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;

    if (editingGuest) {
      const policy = canManageGuest(hotel, profile, 'edit');
      if (!policy.allowed) {
        toast.error(policy.message || 'Editing denied by hotel policy');
        return;
      }
    }

    try {
      if (editingGuest) {
        // Exclude read-only financial fields from update to prevent clearing them
        const { ledgerBalance, totalStays, totalSpent, stayHistory, createdAt, ...updateData } = newGuest as any;
        await database.safeUpdate(doc(db, 'hotels', hotel.id, 'guests', editingGuest.id), updateData, {
          hotelId: hotel.id,
          module: 'Guests',
          action: 'GUEST_UPDATED',
          details: `Updated guest: ${newGuest.name}`
        });
      } else {
        await database.safeAdd(collection(db, 'hotels', hotel.id, 'guests'), {
          ...newGuest,
          totalStays: 0,
          totalNights: 0,
          totalSpent: 0,
          ledgerBalance: 0,
          stayHistory: [],
          createdAt: new Date().toISOString()
        }, {
          hotelId: hotel.id,
          module: 'Guests',
          action: 'GUEST_CREATED',
          details: `Created new guest: ${newGuest.name}`
        });
      }

      // Log action for UI visibility
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: editingGuest ? 'GUEST_UPDATED' : 'GUEST_CREATED',
        resource: `${newGuest.name} (${newGuest.email})`,
        hotelId: hotel.id,
        module: 'Guests'
      }, {
        hotelId: hotel.id,
        module: 'Guests',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Guest profiles activity'
      });

      setShowAddModal(false);
      setEditingGuest(null);
      setNewGuest({ 
        name: '', 
        email: '', 
        phone: '', 
        idType: 'Passport', 
        idNumber: '', 
        address: '', 
        notes: '',
        tags: [],
        preferences: [],
        ledgerBalance: 0,
        corporateId: ''
      });
      toast.success(editingGuest ? 'Guest profile updated' : 'Guest profile created');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/guests`);
      toast.error('Failed to save guest profile');
    }
  };

  const deleteGuest = async (guestId: string) => {
    if (!hotel?.id || !profile) return;
    
    const policy = canManageGuest(hotel, profile, 'delete');
    if (!policy.allowed) {
      toast.error(policy.message || 'Deletion denied by hotel policy');
      return;
    }

    if (profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin') {
      toast.error('Only administrators can delete guest profiles');
      return;
    }
    
    try {
      const guest = guests.find(g => g.id === guestId);
      await database.safeDelete(doc(db, 'hotels', hotel.id, 'guests', guestId), {
        hotelId: hotel.id,
        module: 'Guests',
        action: 'GUEST_DELETED',
        details: `Deleted guest: ${guest?.name || guestId}`
      });
      
      // Log action
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        action: 'GUEST_DELETED',
        resource: `Guest: ${guest?.name || guestId}`,
        hotelId: hotel.id,
        module: 'Guests'
      }, {
        hotelId: hotel.id,
        module: 'Guests',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Guest deletion activity'
      });
      
      toast.success('Guest profile deleted');
      setConfirmDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/guests/${guestId}`);
      toast.error('Failed to delete guest profile');
    }
  };

  const exportGuests = () => {
    const data = guests
      .filter(guest => {
        const matchesType = reportFilter.type === 'all' || 
          (reportFilter.type === 'corporate' ? !!guest.corporateId : !guest.corporateId);
        
        const guestDate = guest.createdAt ? new Date(guest.createdAt) : null;
        const matchesDate = !guestDate || isWithinInterval(guestDate, {
          start: startOfDay(new Date(reportFilter.startDate)),
          end: endOfDay(new Date(reportFilter.endDate))
        });

        return matchesType && matchesDate;
      })
      .map(g => ({
        Name: g.name,
        Email: g.email,
        Phone: g.phone,
        'Guest Type': g.corporateId ? 'Corporate' : 'Individual',
        'ID Type': g.idType,
        'ID Number': g.idNumber,
        Address: g.address,
        'Total Stays': g.totalStays || 0,
        'Total Spent': g.totalSpent || 0,
        'Balance': g.ledgerBalance || 0,
        'Tags': (g.tags || []).join(', '),
        'Preferences': (g.preferences || []).join(', '),
        'Created At': g.createdAt ? format(new Date(g.createdAt), 'yyyy-MM-dd') : 'N/A'
      }));

    if (data.length === 0) {
      toast.info("No guests found for the selected report filters");
      return;
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Guests");
    XLSX.writeFile(wb, `guests_report_${reportFilter.startDate}_to_${reportFilter.endDate}.xlsx`);
    toast.success("Guest report exported to Excel");
  };

  const fuse = useMemo(() => new Fuse(guests, {
    keys: ['name', 'email', 'phone'],
    threshold: 0.3,
  }), [guests]);

  const filteredGuests = useMemo(() => {
    let result = guests;

    if (searchQuery.trim() !== '') {
      result = fuse.search(searchQuery).map(r => r.item);
    }

    return result.filter(guest => {
      // Guest Type filter
      const matchesType = guestTypeFilter === 'all' || 
        (guestTypeFilter === 'corporate' ? !!guest.corporateId : !guest.corporateId);
        
      // Balance filter
      const matchesBalance = balanceFilter === 'all' || 
        (balanceFilter === 'yes' ? (guest.ledgerBalance || 0) > 0 : (guest.ledgerBalance || 0) <= 0);

      // VIP filter
      const matchesVip = vipFilter === 'all' || 
        (vipFilter === 'vip' ? (guest.tags || []).includes('VIP') : !(guest.tags || []).includes('VIP'));

      // Date range filter
      let matchesDate = true;
      if (dateRange.start && dateRange.end) {
        const guestDate = new Date(guest.createdAt || guest.lastStay || Date.now());
        const start = startOfDay(new Date(dateRange.start));
        const end = endOfDay(new Date(dateRange.end));
        matchesDate = isWithinInterval(guestDate, { start, end });
      }

      return matchesType && matchesBalance && matchesVip && matchesDate;
    }).sort((a, b) => {
      let result = 0;
      if (sortBy === 'name') result = a.name.localeCompare(b.name);
      else if (sortBy === 'ledgerBalance') result = (a.ledgerBalance || 0) - (b.ledgerBalance || 0);
      else if (sortBy === 'totalSpent') result = (a.totalSpent || 0) - (b.totalSpent || 0);
      else if (sortBy === 'totalStays') result = (a.totalStays || 0) - (b.totalStays || 0);
      return sortOrder === 'desc' ? -result : result;
    });
  }, [guests, searchQuery, fuse, guestTypeFilter, balanceFilter, vipFilter, dateRange, sortBy, sortOrder]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-2 sm:mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-50 tracking-tight">Guest Management</h1>
          <p className="text-xs text-zinc-400">Manage guest profiles, history, and loyalty</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden xl:flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
            <div className="relative flex items-center gap-1">
              <Calendar size={12} className="text-emerald-500 ml-1" />
              <input
                type="date"
                value={reportFilter.startDate}
                onChange={(e) => setReportFilter({ ...reportFilter, startDate: e.target.value })}
                className="bg-transparent text-[10px] text-zinc-400 font-bold px-1 py-1 focus:outline-none appearance-none"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <span className="text-zinc-600 text-[10px]">to</span>
            <div className="relative flex items-center gap-1">
              <Calendar size={12} className="text-emerald-500 ml-1" />
              <input
                type="date"
                value={reportFilter.endDate}
                onChange={(e) => setReportFilter({ ...reportFilter, endDate: e.target.value })}
                className="bg-transparent text-[10px] text-zinc-400 font-bold px-1 py-1 focus:outline-none appearance-none"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div className="w-px h-4 bg-zinc-800 mx-1" />
            <select
              value={reportFilter.type}
              onChange={(e) => setReportFilter({ ...reportFilter, type: e.target.value as any })}
              className="bg-transparent text-[10px] text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="individual">Individual</option>
              <option value="corporate">Corporate</option>
            </select>
          </div>
          <button
            onClick={exportGuests}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-zinc-800 text-zinc-100 px-3 py-2 rounded-xl text-xs font-bold hover:bg-zinc-700 transition-all active:scale-95 border border-zinc-700"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Export</span>
            <span className="sm:hidden">Export</span>
          </button>
          <button
            onClick={() => {
              setEditingGuest(null);
            setNewGuest({ 
              name: '', 
              email: '', 
              phone: '', 
              idType: 'Passport', 
              idNumber: '', 
              address: '', 
              notes: '',
              tags: [],
              preferences: [],
              ledgerBalance: 0,
              corporateId: ''
            });
            setShowAddModal(true);
          }}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-black px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
        >
          <Plus size={14} />
          Add Guest
        </button>
      </div>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl group hover:border-emerald-500/30 transition-all shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1 sm:p-1.5 bg-zinc-800 rounded-lg text-zinc-400 group-hover:text-zinc-50 transition-colors">
              <Users size={14} />
            </div>
            <div className="text-[7px] font-bold text-zinc-500 uppercase tracking-widest">Database</div>
          </div>
          <div className="text-zinc-400 text-[8px] font-bold uppercase tracking-widest mb-0.5">Total Guests</div>
          <div className="text-lg sm:text-xl font-bold text-zinc-50 font-mono tracking-tight">{guests.length}</div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl group hover:border-emerald-500/30 transition-all shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1 sm:p-1.5 bg-emerald-500/10 rounded-lg text-emerald-500">
              <Star size={14} />
            </div>
            <div className="text-emerald-500 text-[7px] font-black uppercase tracking-tight">
              {Math.round((guests.filter(g => (g.totalStays || 0) > 1).length / (guests.length || 1)) * 100)}% Retention
            </div>
          </div>
          <div className="text-zinc-400 text-[8px] font-bold uppercase tracking-widest mb-0.5">Repeat Guests</div>
          <div className="text-lg sm:text-xl font-bold text-emerald-500 font-mono tracking-tight">{guests.filter(g => (g.totalStays || 0) > 1).length}</div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl group hover:border-blue-500/30 transition-all shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1 sm:p-1.5 bg-blue-500/10 rounded-lg text-blue-500">
              <DollarSign size={14} />
            </div>
          </div>
          <div className="text-zinc-400 text-[8px] font-bold uppercase tracking-widest mb-0.5">Lifetime Revenue</div>
          <div className="text-lg sm:text-xl font-bold text-blue-500 font-mono tracking-tight truncate">
            {formatCurrency(guests.reduce((acc, g) => acc + (g.totalSpent || 0), 0), currency, exchangeRate)}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl group hover:border-red-500/30 transition-all shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1 sm:p-1.5 bg-red-500/10 rounded-lg text-red-500">
              <CreditCard size={14} />
            </div>
            {guests.filter(g => (g.ledgerBalance || 0) > 0).length > 0 && (
              <div className="p-0.5 bg-red-500 text-white rounded text-[7px] font-black px-1.5 uppercase shadow-sm">
                {guests.filter(g => (g.ledgerBalance || 0) > 0).length} Owed
              </div>
            )}
          </div>
          <div className="text-zinc-400 text-[8px] font-bold uppercase tracking-widest mb-0.5">Net Outstanding</div>
          <div className="text-lg sm:text-xl font-bold text-red-500 font-mono tracking-tight truncate">
            {formatCurrency(guests.reduce((acc, g) => acc + (g.ledgerBalance || 0), 0), currency, exchangeRate)}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 mb-4 sm:mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={guestTypeFilter}
            onChange={(e) => setGuestTypeFilter(e.target.value as any)}
            className="bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-[11px] text-zinc-400 focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="individual">Individual</option>
            <option value="corporate">Corporate</option>
          </select>
          <select
            value={balanceFilter}
            onChange={(e) => setBalanceFilter(e.target.value as any)}
            className="bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-[11px] text-zinc-400 focus:outline-none"
          >
            <option value="all">All Balances</option>
            <option value="yes">Has Balance</option>
            <option value="no">No Balance</option>
          </select>
          <select
            value={vipFilter}
            onChange={(e) => setVipFilter(e.target.value as any)}
            className="bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-[11px] text-zinc-400 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="vip">VIP Only</option>
            <option value="regular">Regular Only</option>
          </select>
          
          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1.5">
            <span className="text-[9px] font-bold text-zinc-500 uppercase pr-1.5 border-r border-zinc-800">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-[11px] text-zinc-400 focus:outline-none cursor-pointer"
            >
              <option value="name">Name</option>
              <option value="ledgerBalance">Balance</option>
              <option value="totalSpent">Total Spent</option>
              <option value="totalStays">Stays</option>
            </select>
            <button
              onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="text-zinc-500 hover:text-emerald-500 transition-colors"
            >
              {sortOrder === 'asc' ? <TrendingUp size={12} /> : <ArrowDownRight size={12} />}
            </button>
          </div>

          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2 py-1.5">
            <Calendar size={12} className="text-zinc-500" />
            <input 
              type="date"
              className="bg-transparent text-[9px] text-zinc-50 focus:outline-none w-[85px]"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            />
            <span className="text-zinc-500 text-[9px]">-</span>
            <input 
              type="date"
              className="bg-transparent text-[9px] text-zinc-50 focus:outline-none w-[85px]"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        <AnimatePresence mode="popLayout">
          {isLoading ? (
            Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 h-64 animate-pulse space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex gap-3">
                    <div className="w-12 h-12 bg-zinc-800 rounded-full" />
                    <div className="space-y-2">
                      <div className="w-24 h-4 bg-zinc-800 rounded" />
                      <div className="w-16 h-2 bg-zinc-800 rounded opacity-50" />
                    </div>
                  </div>
                  <div className="w-12 h-6 bg-zinc-800 rounded-lg" />
                </div>
                <div className="space-y-3 mt-8">
                  <div className="w-full h-4 bg-zinc-800 rounded" />
                  <div className="w-3/4 h-4 bg-zinc-800 rounded" />
                  <div className="w-1/2 h-4 bg-zinc-800 rounded" />
                </div>
              </div>
            ))
          ) : filteredGuests.length === 0 ? (
            <div className="col-span-full py-12 text-center text-zinc-500 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl">
              <Users size={48} className="mx-auto text-zinc-700 mb-4" />
              <p>No guest profiles found matching your criteria</p>
            </div>
          ) : (
            filteredGuests.map((guest) => (
              <motion.div
                key={guest.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col group"
              >
                <div className="p-4 flex-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 bg-zinc-800 rounded-full flex items-center justify-center text-emerald-500 font-bold text-base border border-zinc-700">
                        {guest.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-zinc-50 text-sm font-bold leading-tight truncate max-w-[120px]">{guest.name}</h3>
                        <div className="flex items-center gap-1">
                          {(guest.tags || []).map(tag => (
                            <span key={tag} className={cn(
                              "px-1 py-0.5 rounded-[4px] text-[7px] font-black uppercase tracking-tighter",
                              tag === 'VIP' ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" : "bg-zinc-800 text-zinc-500"
                            )}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      <a 
                        href={`mailto:${guest.email}?subject=Hotel Communication for ${guest.name}`}
                        className="p-1.5 text-zinc-500 hover:text-blue-500 rounded-lg transition-all"
                        title="Email Guest"
                      >
                        <Mail size={14} />
                      </a>
                      <button 
                        type="button"
                        onClick={() => setViewingHistory(guest)}
                        className="p-1.5 text-zinc-500 hover:text-emerald-500 rounded-lg transition-all"
                        title="View History"
                      >
                        <History size={14} />
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          setEditingGuest(guest);
                          setNewGuest({
                            name: guest.name,
                            email: guest.email,
                            phone: guest.phone,
                            idType: guest.idType || 'Passport',
                            idNumber: guest.idNumber || '',
                            address: guest.address || '',
                            notes: guest.notes || '',
                            tags: guest.tags || [],
                            preferences: guest.preferences || [],
                            ledgerBalance: guest.ledgerBalance || 0,
                            corporateId: guest.corporateId || ''
                          });
                          setShowAddModal(true);
                        }}
                        className="p-1.5 text-zinc-500 hover:text-zinc-50 rounded-lg transition-all"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          if (profile?.role !== 'hotelAdmin' && profile?.role !== 'superAdmin') {
                            toast.error('Only administrators can delete guest profiles');
                            return;
                          }
                          setConfirmDelete(guest.id);
                        }}
                        className={cn(
                          "p-1.5 rounded-lg transition-all",
                          (profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') 
                            ? "text-zinc-500 hover:text-red-500" 
                            : "text-zinc-800 cursor-not-allowed"
                        )}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-4">
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <Mail size={12} className="text-zinc-600" />
                      <span className="truncate">{guest.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <Phone size={12} className="text-zinc-600" />
                      {guest.phone}
                    </div>
                    {guest.corporateId && (
                      <div className="flex items-center gap-2 text-[10px] text-emerald-500 font-bold uppercase tracking-wider">
                        <Building2 size={12} />
                        <span className="truncate max-w-[150px]">
                          {corporateAccounts.find(c => c.id === guest.corporateId)?.name || 'Corporate'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800/50 flex flex-col justify-center">
                      <div className="text-[7px] text-zinc-500 font-bold uppercase tracking-widest mb-0.5">Visits</div>
                      <div className="text-sm font-bold text-zinc-100">{guest.totalStays || 0}</div>
                    </div>
                    <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800/50 flex flex-col justify-center">
                      <div className="text-[7px] text-zinc-500 font-bold uppercase tracking-widest mb-0.5">Total Days</div>
                      <div className="text-sm font-bold text-amber-500">{((guest as any).totalNights || 0) + (guest.totalStays || 0)}</div>
                    </div>
                    <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800/50 flex flex-col justify-center">
                      <div className="text-[7px] text-zinc-500 font-bold uppercase tracking-widest mb-0.5">Total Spent</div>
                      <div className="text-sm font-bold text-blue-500 shrink-0">{formatCurrency(guest.totalSpent || 0, currency, exchangeRate)}</div>
                    </div>
                    <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800/50 flex flex-col justify-center">
                      <div className="text-[7px] text-zinc-500 font-bold uppercase tracking-widest mb-0.5">Owed</div>
                      <div className={cn(
                        "text-sm font-bold",
                        (guest.ledgerBalance || 0) > 0 ? "text-red-500" : "text-emerald-500"
                      )}>
                        {formatCurrency(Math.abs(guest.ledgerBalance || 0), currency, exchangeRate)}
                      </div>
                    </div>
                  </div>

                  {guest.preferences && guest.preferences.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-zinc-800/50">
                      <div className="flex flex-wrap gap-1">
                        {guest.preferences.slice(0, 3).map(pref => (
                          <span key={pref} className="px-1.5 py-0.5 bg-blue-500/5 text-blue-400 rounded text-[8px] border border-blue-500/10">
                            {pref}
                          </span>
                        ))}
                        {guest.preferences.length > 3 && (
                          <span className="text-[8px] text-zinc-600 font-bold ml-1">+{guest.preferences.length - 3}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="px-4 py-2 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
                  <div className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest">
                    Last: {guest.lastStay ? format(new Date(guest.lastStay), 'MMM d, yy') : 'Never'}
                  </div>
                  <ChevronRight size={12} className="text-zinc-800" />
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* History Modal */}
      {viewingHistory && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-zinc-50">Stay History</h2>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-zinc-500">{viewingHistory.name}</p>
                  <a 
                    href={`mailto:${viewingHistory.email}?subject=Message for ${viewingHistory.name}`}
                    className="p-1 px-2 bg-blue-500/10 text-blue-500 rounded-lg text-[10px] font-bold hover:bg-blue-500/20 flex items-center gap-1 transition-all"
                  >
                    <Mail size={10} />
                    Email Guest
                  </a>
                </div>
              </div>
              <button 
                onClick={() => setViewingHistory(null)}
                className="p-2 text-zinc-500 hover:text-zinc-50 transition-colors"
              >
                <XCircle size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                  <div className="text-[8px] font-bold text-zinc-500 uppercase mb-0.5">Total Stays</div>
                  <div className="text-lg font-bold text-zinc-50 leading-tight">{viewingHistory.totalStays || 0}</div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                  <div className="text-[8px] font-bold text-zinc-500 uppercase mb-0.5">Total Spent</div>
                  <div className="text-lg font-bold text-emerald-500 leading-tight">{formatCurrency(viewingHistory.totalSpent || 0, currency, exchangeRate)}</div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                  <div className="text-[8px] font-bold text-zinc-500 uppercase mb-0.5">Account Balance</div>
                  <div className={cn(
                    "text-lg font-bold leading-tight",
                    (viewingHistory.ledgerBalance || 0) > 0 ? "text-red-500" : "text-emerald-500"
                  )}>
                    {formatCurrency(Math.abs(viewingHistory.ledgerBalance || 0), currency, exchangeRate)}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 p-1 bg-zinc-950 rounded-lg border border-zinc-800 mb-4">
                <button
                  onClick={() => setHistoryTab('reservations')}
                  className={cn(
                    "flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all",
                    historyTab === 'reservations' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-400"
                  )}
                >
                  Reservations
                </button>
                <button
                  onClick={() => setHistoryTab('ledger')}
                  className={cn(
                    "flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all",
                    historyTab === 'ledger' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-400"
                  )}
                >
                  Account Ledger
                </button>
              </div>

              {historyTab === 'reservations' ? (
                <>
                  <h3 className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Recent Reservations</h3>
                  {guestHistory.length === 0 ? (
                    <div className="text-center py-10 text-zinc-500 bg-zinc-950 rounded-xl border border-dashed border-zinc-800">
                      <Clock size={24} className="mx-auto mb-2 opacity-20" />
                      <p className="text-xs">No reservation history found</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {guestHistory.sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime()).map(res => (
                        <div key={res.id} className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex items-center justify-between group hover:border-zinc-700 transition-all">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center text-emerald-500 border border-zinc-800">
                              <Calendar size={16} />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-zinc-50 leading-tight">Room {res.roomNumber}</div>
                              <div className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                                {format(new Date(res.checkIn), 'MMM d, yy')} - {format(new Date(res.checkOut), 'MMM d, yy')}
                                <span className="text-[9px] font-black text-emerald-500 bg-emerald-500/10 px-1 rounded lowercase">
                                  {(() => {
                                    const n = differenceInDays(parseISO(res.checkOut), parseISO(res.checkIn));
                                    const d = n + 1;
                                    return `${d} ${d === 1 ? 'day' : 'days'}`;
                                  })()}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <div className={cn(
                                  "text-[8px] font-black uppercase px-1 py-0.2 rounded-[3px]",
                                  res.paymentStatus === 'paid' ? "bg-emerald-500/10 text-emerald-500" :
                                  res.paymentStatus === 'partial' ? "bg-amber-500/10 text-amber-500" :
                                  "bg-red-500/10 text-red-500"
                                )}>
                                  {res.paymentStatus}
                                </div>
                                <button 
                                  onClick={() => setShowFolio(res)}
                                  className="text-[8px] font-black text-emerald-500 hover:text-emerald-400 flex items-center gap-0.5 uppercase tracking-tighter"
                                >
                                  <Receipt size={8} />
                                  Folio
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-bold text-zinc-50">{formatCurrency(res.totalAmount, currency, exchangeRate)}</div>
                            <div className={cn(
                              "text-[8px] font-black uppercase px-1.5 py-0.5 rounded-[4px] inline-block mt-1",
                              res.status === 'checked_out' ? "bg-emerald-500/10 text-emerald-500" : 
                              res.status === 'checked_in' ? "bg-blue-500/10 text-blue-500" :
                              res.status === 'cancelled' ? "bg-red-500/10 text-red-500" :
                              "bg-zinc-800 text-zinc-500"
                            )}>
                              {res.status.replace('_', ' ')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h3 className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Transaction History</h3>
                  {guestLedger.length === 0 ? (
                    <div className="text-center py-10 text-zinc-500 bg-zinc-950 rounded-xl border border-dashed border-zinc-800">
                      <CreditCard size={24} className="mx-auto mb-2 opacity-20" />
                      <p className="text-xs">No transactions found</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {guestLedger.map(entry => (
                        <div key={entry.id} className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 flex items-center justify-between">
                          <div>
                            <div className="text-xs font-bold text-zinc-50 leading-tight">{entry.description}</div>
                            <div className="text-[9px] text-zinc-500 flex items-center gap-2">
                              {format(new Date(entry.timestamp), 'MMM d, yy HH:mm')}
                              <span className="px-1 py-0.2 bg-zinc-900 rounded text-[7px] font-bold uppercase tracking-wider">
                                {entry.category}
                              </span>
                            </div>
                          </div>
                          <div className={cn(
                            "text-xs font-bold",
                            entry.type === 'credit' ? "text-emerald-500" : "text-red-500"
                          )}>
                            {entry.type === 'credit' ? '+' : '-'}{formatCurrency(entry.amount, currency, exchangeRate)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            
            <div className="p-6 bg-zinc-950 border-t border-zinc-800">
              <button
                onClick={() => setViewingHistory(null)}
                className="w-full py-3 bg-zinc-800 text-zinc-50 rounded-xl font-bold hover:bg-zinc-700 transition-all"
              >
                Close History
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Receipt Modal */}
      {showReceipt && hotel && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-start justify-center p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg my-8">
            <button 
              onClick={() => setShowReceipt(null)}
              className="absolute -top-12 right-0 text-zinc-50 hover:text-emerald-500 transition-colors flex items-center gap-2 font-bold uppercase text-xs print:hidden"
            >
              <XCircle size={20} />
              Close
            </button>
            <div className="bg-white rounded-2xl overflow-hidden">
              <ReceiptGenerator 
                hotel={hotel} 
                reservation={showReceipt.res} 
                type={showReceipt.type}
                ledgerEntries={[]} // Ledger entries should be fetched from collection, this is legacy path
              />
            </div>
          </div>
        </div>
      )}

      {showFolio && (
        <GuestFolio 
          reservation={showFolio} 
          onClose={() => setShowFolio(null)} 
        />
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-zinc-50">{editingGuest ? 'Edit Guest Profile' : 'Add New Guest'}</h2>
            </div>
            <form onSubmit={handleSaveGuest}>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Full Name</label>
                  <input
                    required
                    type="text"
                    value={newGuest.name}
                    onChange={(e) => setNewGuest({ ...newGuest, name: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    placeholder="John Doe"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Email Address</label>
                    <input
                      required
                      type="email"
                      value={newGuest.email}
                      onChange={(e) => setNewGuest({ ...newGuest, email: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      placeholder="john@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Phone Number</label>
                    <input
                      required
                      type="tel"
                      value={newGuest.phone}
                      onChange={(e) => setNewGuest({ ...newGuest, phone: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      placeholder="+1 234 567 890"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">ID Type</label>
                    <select
                      value={newGuest.idType}
                      onChange={(e) => setNewGuest({ ...newGuest, idType: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="Passport">Passport</option>
                      <option value="National ID">National ID</option>
                      <option value="Driver License">Driver License</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">ID Number</label>
                    <input
                      type="text"
                      value={newGuest.idNumber}
                      onChange={(e) => setNewGuest({ ...newGuest, idNumber: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      placeholder="ID Number"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Address</label>
                  <input
                    type="text"
                    value={newGuest.address}
                    onChange={(e) => setNewGuest({ ...newGuest, address: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    placeholder="Home or Business address"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Corporate Account (Optional)</label>
                  <select
                    value={newGuest.corporateId}
                    onChange={(e) => setNewGuest({ ...newGuest, corporateId: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="">None / Individual</option>
                    {corporateAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Tags</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {newGuest.tags.map((tag, index) => (
                      <span key={index} className="px-2 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-xs font-bold flex items-center gap-1">
                        {tag}
                        <button 
                          type="button"
                          onClick={() => setNewGuest({ ...newGuest, tags: newGuest.tags.filter((_, i) => i !== index) })}
                          className="hover:text-emerald-400"
                        >
                          <XCircle size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => {
                        setTagInput(e.target.value);
                        setShowTagSuggestions(true);
                      }}
                      onFocus={() => setShowTagSuggestions(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = tagInput.trim();
                          if (val && !newGuest.tags.includes(val)) {
                            setNewGuest({ ...newGuest, tags: [...newGuest.tags, val] });
                            setTagInput('');
                            setShowTagSuggestions(false);
                          }
                        }
                      }}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      placeholder="Type tag and press Enter (e.g. VIP)"
                    />
                    {showTagSuggestions && tagSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl max-h-40 overflow-y-auto">
                        {tagSuggestions.map(suggestion => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => {
                              setNewGuest({ ...newGuest, tags: [...newGuest.tags, suggestion] });
                              setTagInput('');
                              setShowTagSuggestions(false);
                            }}
                            className="w-full px-4 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 transition-colors"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Preferences</label>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {['Pillow Preference', 'Room Temperature', 'Newspaper Preference', 'Extra Pillows', 'Non-Smoking', 'Late Checkout'].map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          if (!newGuest.preferences.includes(p)) {
                            setNewGuest({ ...newGuest, preferences: [...newGuest.preferences, p] });
                          }
                        }}
                        className="px-2 py-1 bg-zinc-800 text-zinc-400 rounded-lg text-[10px] font-bold hover:bg-zinc-700 hover:text-zinc-50 transition-all"
                      >
                        + {p}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {newGuest.preferences.map((pref, index) => (
                      <span key={index} className="px-2 py-1 bg-blue-500/10 text-blue-500 rounded-lg text-xs font-bold flex items-center gap-1">
                        {pref}
                        <button 
                          type="button"
                          onClick={() => setNewGuest({ ...newGuest, preferences: newGuest.preferences.filter((_, i) => i !== index) })}
                          className="hover:text-blue-400"
                        >
                          <XCircle size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={prefInput}
                    onChange={(e) => setPrefInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = prefInput.trim();
                        if (val && !newGuest.preferences.includes(val)) {
                          setNewGuest({ ...newGuest, preferences: [...newGuest.preferences, val] });
                          setPrefInput('');
                        }
                      }
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    placeholder="Type custom preference (e.g. Firm Pillow) and press Enter"
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
                  className="flex-1 px-4 py-2 bg-emerald-500 text-zinc-50 rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95"
                >
                  {editingGuest ? 'Update Guest' : 'Add Guest'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmDelete}
        title="Delete Guest Profile"
        message="Are you sure you want to delete this guest profile? This action cannot be undone."
        onConfirm={() => confirmDelete && deleteGuest(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
        confirmText="Delete"
        type="danger"
      />
    </div>
  );
}
