import React, { useEffect, useState, useMemo } from 'react';
import { collection, getDocs, query, orderBy, addDoc, updateDoc, doc, deleteDoc, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
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
import Fuse from 'fuse.js';
import { format, startOfMonth, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
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
      where('guestId', '==', viewingHistory.id),
      orderBy('timestamp', 'desc')
    );
    const unsubLedger = onSnapshot(qLedger, (snap) => {
      setGuestLedger(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LedgerEntry)));
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

    try {
      if (editingGuest) {
        // Exclude read-only financial fields from update to prevent clearing them
        const { ledgerBalance, totalStays, totalSpent, stayHistory, createdAt, ...updateData } = newGuest as any;
        await updateDoc(doc(db, 'hotels', hotel.id, 'guests', editingGuest.id), updateData);
      } else {
        await addDoc(collection(db, 'hotels', hotel.id, 'guests'), {
          ...newGuest,
          totalStays: 0,
          totalSpent: 0,
          ledgerBalance: 0,
          stayHistory: [],
          createdAt: new Date().toISOString()
        });
      }

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: editingGuest ? 'GUEST_UPDATED' : 'GUEST_CREATED',
        resource: `${newGuest.name} (${newGuest.email})`,
        hotelId: hotel.id,
        module: 'Guests'
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
    
    if (profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin') {
      toast.error('Only administrators can delete guest profiles');
      return;
    }
    
    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'guests', guestId));
      
      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        action: 'GUEST_DELETED',
        resource: `Guest ID: ${guestId}`,
        hotelId: hotel.id,
        module: 'Guests'
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
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50 mb-2 tracking-tight">Guest Management</h1>
          <p className="text-zinc-400">Manage guest profiles, history, and loyalty</p>
        </div>
        <div className="flex gap-3">
          <div className="hidden lg:flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
            <input
              type="date"
              value={reportFilter.startDate}
              onChange={(e) => setReportFilter({ ...reportFilter, startDate: e.target.value })}
              className="bg-transparent text-[10px] text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            />
            <span className="text-zinc-600 text-[10px]">to</span>
            <input
              type="date"
              value={reportFilter.endDate}
              onChange={(e) => setReportFilter({ ...reportFilter, endDate: e.target.value })}
              className="bg-transparent text-[10px] text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            />
            <div className="w-px h-4 bg-zinc-800" />
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
            className="flex items-center gap-2 bg-zinc-800 text-zinc-50 px-4 py-2 rounded-xl font-bold hover:bg-zinc-700 transition-all active:scale-95"
          >
            <Download size={18} />
            <span className="hidden sm:inline">Export Report</span>
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
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
        >
          <Plus size={18} />
          Add Guest
        </button>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Total Guests</div>
          <div className="text-2xl font-bold text-zinc-50">{guests.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Repeat Guests</div>
          <div className="text-2xl font-bold text-emerald-500">{guests.filter(g => g.totalStays > 1).length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Total Revenue</div>
          <div className="text-2xl font-bold text-blue-500">{formatCurrency(guests.reduce((acc, g) => acc + g.totalSpent, 0), currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Total Ledger Debt</div>
          <div className="text-2xl font-bold text-red-500">{formatCurrency(guests.filter(g => (g.ledgerBalance || 0) > 0).reduce((acc, g) => acc + (g.ledgerBalance || 0), 0), currency, exchangeRate)}</div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
            <Filter size={16} className="text-zinc-500" />
            <select
              value={guestTypeFilter}
              onChange={(e) => setGuestTypeFilter(e.target.value as any)}
              className="bg-transparent text-sm text-zinc-400 focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="individual">Individual</option>
              <option value="corporate">Corporate</option>
            </select>
          </div>
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
            <DollarSign size={16} className="text-zinc-500" />
            <select
              value={balanceFilter}
              onChange={(e) => setBalanceFilter(e.target.value as any)}
              className="bg-transparent text-sm text-zinc-400 focus:outline-none"
            >
              <option value="all">All Balances</option>
              <option value="yes">Has Balance</option>
              <option value="no">No Balance</option>
            </select>
          </div>
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
            <Star size={16} className="text-zinc-500" />
            <select
              value={vipFilter}
              onChange={(e) => setVipFilter(e.target.value as any)}
              className="bg-transparent text-sm text-zinc-400 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="vip">VIP Only</option>
              <option value="regular">Regular Only</option>
            </select>
          </div>
          
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase px-2 border-r border-zinc-800">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-xs text-zinc-400 focus:outline-none cursor-pointer"
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
              {sortOrder === 'asc' ? <TrendingUp size={14} /> : <ArrowDownRight size={14} />}
            </button>
          </div>

          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-2 py-1">
            <Calendar size={14} className="text-zinc-500" />
            <input 
              type="date"
              className="bg-transparent text-[10px] text-zinc-50 focus:outline-none"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            />
            <span className="text-zinc-500 text-[10px]">-</span>
            <input 
              type="date"
              className="bg-transparent text-[10px] text-zinc-50 focus:outline-none"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                <div className="p-6 flex-1">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center text-emerald-500 font-bold text-lg">
                        {guest.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-zinc-50 font-bold">{guest.name}</h3>
                        <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                          <Star size={10} className={cn(guest.totalStays > 5 || guest.tags?.includes('VIP') ? "text-amber-500" : "text-zinc-600")} />
                          {guest.totalStays > 5 || guest.tags?.includes('VIP') ? 'VIP Guest' : 'Standard'}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(guest.tags || []).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded text-[8px] font-bold uppercase">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        type="button"
                        onClick={() => setViewingHistory(guest)}
                        className="p-2 text-zinc-500 hover:text-emerald-500 rounded-lg transition-all"
                        title="View History"
                      >
                        <History size={16} />
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
                        className="p-2 text-zinc-500 hover:text-zinc-50 rounded-lg transition-all"
                      >
                        <Edit2 size={16} />
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
                          "p-2 rounded-lg transition-all",
                          (profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') 
                            ? "text-zinc-500 hover:text-red-500" 
                            : "text-zinc-700 cursor-not-allowed"
                        )}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Mail size={14} className="text-zinc-600" />
                      {guest.email}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Phone size={14} className="text-zinc-600" />
                      {guest.phone}
                    </div>
                    {guest.corporateId && (
                      <div className="flex items-center gap-2 text-sm text-emerald-500 font-medium">
                        <Building2 size={14} />
                        {corporateAccounts.find(c => c.id === guest.corporateId)?.name || 'Corporate Guest'}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-3 pt-4">
                      <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Stays</div>
                        <div className="text-lg font-bold text-zinc-50">{guest.totalStays}</div>
                      </div>
                      <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Spent</div>
                        <div className="text-lg font-bold text-emerald-500">{formatCurrency(guest.totalSpent || 0, currency, exchangeRate)}</div>
                      </div>
                      <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Balance</div>
                        <div className={cn(
                          "text-lg font-bold",
                          (guest.ledgerBalance || 0) > 0 ? "text-red-500" : "text-emerald-500"
                        )}>
                          {formatCurrency(Math.abs(guest.ledgerBalance || 0), currency, exchangeRate)}
                          <div className="text-[8px] font-black uppercase mt-0.5">
                            {(guest.ledgerBalance || 0) > 0 ? "Debt / Owing" : (guest.ledgerBalance || 0) < 0 ? "Credit" : "Settled"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {guest.preferences && guest.preferences.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-zinc-800/50">
                      <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Preferences</div>
                      <div className="flex flex-wrap gap-1">
                        {guest.preferences.map(pref => (
                          <span key={pref} className="px-1.5 py-0.5 bg-blue-500/5 text-blue-400 rounded text-[9px]">
                            {pref}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="px-6 py-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
                  <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                    Last Stay: {guest.lastStay ? format(new Date(guest.lastStay), 'MMM d, yyyy') : 'Never'}
                  </div>
                  <ChevronRight size={14} className="text-zinc-700" />
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
                <p className="text-sm text-zinc-500">{viewingHistory.name}</p>
              </div>
              <button 
                onClick={() => setViewingHistory(null)}
                className="p-2 text-zinc-500 hover:text-zinc-50 transition-colors"
              >
                <XCircle size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Total Stays</div>
                  <div className="text-2xl font-bold text-zinc-50">{viewingHistory.totalStays || 0}</div>
                </div>
                <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Total Spent</div>
                  <div className="text-2xl font-bold text-emerald-500">{formatCurrency(viewingHistory.totalSpent || 0, currency, exchangeRate)}</div>
                </div>
                <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Ledger Balance</div>
                  <div className={cn(
                    "text-2xl font-bold",
                    (viewingHistory.ledgerBalance || 0) > 0 ? "text-red-500" : "text-emerald-500"
                  )}>
                    {formatCurrency(Math.abs(viewingHistory.ledgerBalance || 0), currency, exchangeRate)}
                    {(viewingHistory.ledgerBalance || 0) > 0 ? " (Debt)" : (viewingHistory.ledgerBalance || 0) < 0 ? " (Credit)" : ""}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 p-1 bg-zinc-950 rounded-xl border border-zinc-800 mb-6">
                <button
                  onClick={() => setHistoryTab('reservations')}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-xs font-bold transition-all",
                    historyTab === 'reservations' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-400"
                  )}
                >
                  Reservations
                </button>
                <button
                  onClick={() => setHistoryTab('ledger')}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-xs font-bold transition-all",
                    historyTab === 'ledger' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-400"
                  )}
                >
                  Account Ledger
                </button>
              </div>

              {historyTab === 'reservations' ? (
                <>
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Recent Reservations</h3>
                  {guestHistory.length === 0 ? (
                    <div className="text-center py-12 text-zinc-500 bg-zinc-950 rounded-2xl border border-dashed border-zinc-800">
                      <Clock size={32} className="mx-auto mb-2 opacity-20" />
                      <p>No reservation history found</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {guestHistory.sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime()).map(res => (
                        <div key={res.id} className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800 flex items-center justify-between group hover:border-zinc-700 transition-all">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-emerald-500">
                              <Calendar size={20} />
                            </div>
                            <div>
                              <div className="text-sm font-bold text-zinc-50">Room {res.roomNumber}</div>
                              <div className="text-xs text-zinc-500">
                                {format(new Date(res.checkIn), 'MMM d, yyyy')} - {format(new Date(res.checkOut), 'MMM d, yyyy')}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <div className={cn(
                                  "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                                  res.paymentStatus === 'paid' ? "bg-emerald-500/10 text-emerald-500" :
                                  res.paymentStatus === 'partial' ? "bg-amber-500/10 text-amber-500" :
                                  "bg-red-500/10 text-red-500"
                                )}>
                                  {res.paymentStatus}
                                </div>
                                <button 
                                  onClick={() => setShowFolio(res)}
                                  className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 flex items-center gap-1 uppercase tracking-wider"
                                >
                                  <Receipt size={10} />
                                  View Folio
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold text-zinc-50">{formatCurrency(res.totalAmount, currency, exchangeRate)}</div>
                            <div className={cn(
                              "text-[10px] font-bold uppercase px-2 py-0.5 rounded inline-block mt-1",
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
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Transaction History</h3>
                  {guestLedger.length === 0 ? (
                    <div className="text-center py-12 text-zinc-500 bg-zinc-950 rounded-2xl border border-dashed border-zinc-800">
                      <CreditCard size={32} className="mx-auto mb-2 opacity-20" />
                      <p>No transactions found</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {guestLedger.map(entry => (
                        <div key={entry.id} className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex items-center justify-between">
                          <div>
                            <div className="text-sm font-bold text-zinc-50">{entry.description}</div>
                            <div className="text-[10px] text-zinc-500 flex items-center gap-2">
                              {format(new Date(entry.timestamp), 'MMM d, yyyy HH:mm')}
                              <span className="px-1.5 py-0.5 bg-zinc-900 rounded text-[8px] font-bold uppercase tracking-wider">
                                {entry.category}
                              </span>
                            </div>
                          </div>
                          <div className={cn(
                            "text-sm font-bold",
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
                ledgerEntries={showReceipt.res.ledgerEntries || []}
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
